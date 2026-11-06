/**
 * A BrowserCode WorkspaceFs that keeps BrowserPod's copy of a project in sync
 * with a remote whole-file filesystem (Dragon86 fs1 or standalone 9p).
 *
 * BrowserPod has no public mount hook, so its bash/dev server and Monaco must
 * share one pod-side copy. This wrapper now performs a three-way reconcile:
 * it scans the pod workdir too, so files created/edited by terminal commands
 * are either pushed or reported as conflicts instead of being silently lost
 * on the next remote poll. Failed remote writes are retried and surfaced.
 */
import type { WorkspaceFs } from '$lib/ide/workspace-fs';
import { FS_SYNC_INTERVAL_MS } from '../bridge/config';
import {
	hashBytes,
	relativeToWorkdir,
	snapshotOf,
	statChanged,
	toArrayBuffer,
	type RemoteEntry,
	type RemoteFs,
	type RemoteSnapshot,
	type RemoteStat
} from './remote-fs';

export type SyncIssueKind =
	| 'conflict'
	| 'remote-write-failed'
	| 'local-scan-failed'
	| 'remote-sync-failed'
	| 'pull-failed';

export interface SyncIssue {
	id: string;
	kind: SyncIssueKind;
	level: 'warn' | 'error';
	path?: string;
	message: string;
	at: number;
	localHash?: string;
	remoteHash?: string;
}

export type SyncResolution = 'local' | 'remote';

export interface SyncController {
	readonly issues: SyncIssue[];
	resolve(id: string, strategy: SyncResolution): Promise<void>;
}

export interface SyncedFsHooks {
	onStatus?: (text: string, level?: 'info' | 'warn' | 'error') => void;
	onSnapshot?: (snapshot: RemoteSnapshot) => void;
	onIssues?: (issues: SyncIssue[]) => void;
}

interface LocalSignature {
	isDir: boolean;
	hash: string;
	size: number;
}

type PendingOp = 'write' | 'mkdir' | 'delete' | 'rename';

interface PendingLocal {
	hash: string;
	isDir: boolean;
	at: number;
	op: PendingOp;
	to?: string;
	failed?: boolean;
}

interface Decision {
	path: string;
	action: 'none' | 'push' | 'pull' | 'delete-remote' | 'delete-local' | 'conflict';
	remoteStat?: RemoteStat;
	localSig?: LocalSignature;
	remoteHash?: string;
	localHash?: string;
}

const ABSENT = '<absent>';
const CONFLICT_MARKER = '.drakeforge-remote-';

function isSyncArtifact(path: string): boolean {
	return path.includes(CONFLICT_MARKER);
}

function depth(path: string): number {
	return path.split('/').length;
}

function issueId(kind: SyncIssueKind, path = 'workspace'): string {
	return `${kind}:${path}`;
}

function conflictCopyPath(path: string): string {
	const slash = path.lastIndexOf('/');
	const dir = slash === -1 ? '' : path.slice(0, slash + 1);
	const base = slash === -1 ? path : path.slice(slash + 1);
	return `${dir}${base}${CONFLICT_MARKER}${Date.now()}`;
}

function isUnderAnyParent(path: string, parents: ReadonlySet<string>): boolean {
	let slash = path.lastIndexOf('/');
	while (slash > 0) {
		const parent = path.slice(0, slash);
		if (parents.has(parent)) return true;
		slash = parent.lastIndexOf('/');
	}
	return false;
}

export class SyncedWorkspaceFs implements WorkspaceFs, SyncController {
	private baseline = new Map<string, RemoteStat>();
	private localBaseline = new Map<string, LocalSignature>();
	private remoteHashBaseline = new Map<string, string>();
	private lastRemote = new Map<string, RemoteStat>();
	private lastLocal = new Map<string, LocalSignature>();
	private pending = new Map<string, PendingLocal>();
	private issueMap = new Map<string, SyncIssue>();
	private activeIssues = new Set<string>();
	private timer: ReturnType<typeof setInterval> | null = null;
	private syncing = false;
	private hydrating = false;
	private disposed = false;
	private initialized = false;
	private announced = false;
	private snapshotHook: ((snapshot: RemoteSnapshot) => void) | null = null;

	constructor(
		private readonly podFs: WorkspaceFs,
		private readonly remote: RemoteFs,
		private readonly workdir: string,
		private readonly hooks: SyncedFsHooks = {}
	) {}

	get issues(): SyncIssue[] {
		return [...this.issueMap.values()].sort((a, b) => a.at - b.at);
	}

	/** Seed the remote comparison baseline from the tree fetched for the initial file list. */
	setInitialBaseline(entries: readonly RemoteEntry[]): void {
		this.baseline = baselineOf(entries);
		this.lastRemote = new Map(this.baseline);
		this.announced = false;
		this.initialized = false;
	}

	setSnapshotHook(hook: (snapshot: RemoteSnapshot) => void): void {
		this.snapshotHook = hook;
	}

	beginHydrate(): void {
		this.hydrating = true;
	}

	endHydrate(): void {
		this.hydrating = false;
	}

	/** Snapshot both sides after hydration so terminal edits are detectable. */
	async initialize(): Promise<void> {
		if (this.disposed) return;
		const remoteEntries = await this.remote.tree();
		this.setInitialBaseline(remoteEntries);
		this.remoteHashBaseline = await this.readRemoteHashes(remoteEntries);
		const local = await this.scanLocal();
		this.localBaseline = new Map(local);
		this.lastLocal = new Map(local);
		this.initialized = true;
		this.emitSnapshot(remoteEntries, local);
		this.emitIssues();
	}

	start(): void {
		if (this.timer !== null || this.disposed) return;
		this.timer = setInterval(() => void this.syncFromRemote(), FS_SYNC_INTERVAL_MS);
		void this.syncFromRemote();
	}

	stop(): void {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
		this.disposed = true;
		this.issueMap.clear();
		this.emitIssues();
	}

	readFile(path: string): Promise<string> {
		return this.podFs.readFile(path);
	}
	readFileWithinLimit(path: string, maxBytes: number): Promise<string | null> {
		return this.podFs.readFileWithinLimit(path, maxBytes);
	}
	readBinaryFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
		return this.podFs.readBinaryFile(path);
	}
	fileSize(path: string): Promise<number> {
		return this.podFs.fileSize(path);
	}

	async writeFile(path: string, content: string): Promise<void> {
		await this.podFs.writeFile(path, content);
		const bytes = new TextEncoder().encode(content);
		const rel = this.relative(path);
		if (rel === null || rel === '') return;
		await this.push(rel, hashBytes(bytes), false, 'write', () => this.remote.write(rel, bytes));
	}

	async writeBinaryFile(path: string, content: ArrayBuffer): Promise<void> {
		await this.podFs.writeBinaryFile(path, content);
		const bytes = new Uint8Array(content);
		const rel = this.relative(path);
		if (rel === null || rel === '') return;
		await this.push(rel, hashBytes(bytes), false, 'write', () => this.remote.write(rel, bytes));
	}

	async createDirectory(path: string): Promise<void> {
		await this.podFs.createDirectory(path);
		const rel = this.relative(path);
		if (rel === null || rel === '') return;
		await this.push(rel, 'dir', true, 'mkdir', () => this.remote.mkdir(rel));
	}

	async renameEntry(from: string, to: string): Promise<void> {
		await this.podFs.renameEntry(from, to);
		const fromRel = this.relative(from);
		const toRel = this.relative(to);
		if (fromRel === null || fromRel === '' || toRel === null || toRel === '') return;
		this.pending.set(fromRel, {
			hash: 'moved',
			isDir: false,
			at: Date.now(),
			op: 'rename',
			to: toRel
		});
		try {
			await this.remote.rename(fromRel, toRel);
			this.pending.delete(fromRel);
			await this.refreshBaselines();
		} catch (error) {
			this.markFailed(fromRel, error, 'rename', toRel);
			throw this.remoteError(fromRel, error);
		}
	}

	async deleteEntry(path: string): Promise<void> {
		await this.podFs.deleteEntry(path);
		const rel = this.relative(path);
		if (rel === null || rel === '') return;
		this.pending.set(rel, { hash: 'deleted', isDir: false, at: Date.now(), op: 'delete' });
		try {
			await this.remote.remove(rel);
			this.pending.delete(rel);
			await this.refreshBaselines();
		} catch (error) {
			this.markFailed(rel, error, 'delete');
			throw this.remoteError(rel, error);
		}
	}

	private relative(absPath: string): string | null {
		return relativeToWorkdir(this.workdir, absPath);
	}

	private abs(rel: string): string {
		return `${this.workdir}/${rel}`;
	}

	private async push(
		rel: string,
		hash: string,
		isDir: boolean,
		op: PendingOp,
		action: () => Promise<RemoteStat>
	): Promise<void> {
		if (this.hydrating || this.disposed) return;
		this.pending.set(rel, { hash, isDir, at: Date.now(), op });
		try {
			const stat = await action();
			this.baseline.set(rel, stat);
			this.lastRemote.set(rel, stat);
			this.remoteHashBaseline.set(rel, isDir ? 'dir' : hash);
			const local: LocalSignature = { isDir, hash, size: isDir ? 0 : Number(hash.split(':')[0]) };
			this.localBaseline.set(rel, local);
			this.lastLocal.set(rel, local);
			this.pending.delete(rel);
			this.clearIssue(issueId('remote-write-failed', rel));
		} catch (error) {
			this.markFailed(rel, error, op);
			throw this.remoteError(rel, error);
		}
	}

	private remoteError(rel: string, error: unknown): Error {
		const message = error instanceof Error ? error.message : String(error);
		return new Error(`Remote write for ${rel} failed: ${message}`);
	}

	private markFailed(rel: string, error: unknown, op: PendingOp, to?: string): void {
		const pending = this.pending.get(rel);
		if (pending) {
			pending.failed = true;
			pending.op = op;
			if (to !== undefined) pending.to = to;
		}
		const message = error instanceof Error ? error.message : String(error);
		this.reportIssue({
			id: issueId('remote-write-failed', rel),
			kind: 'remote-write-failed',
			level: 'error',
			path: rel,
			message: `Remote write for ${rel} failed: ${message}. Local copy kept; retrying automatically.`,
			at: Date.now()
		});
		this.hooks.onStatus?.(`Remote write for ${rel} failed: ${message}`, 'error');
	}

	private async retryFailedPending(): Promise<void> {
		for (const [rel, pending] of [...this.pending]) {
			if (!pending.failed) continue;
			try {
				switch (pending.op) {
					case 'write': {
						const bytes = await this.podFs.readBinaryFile(this.abs(rel));
						await this.remote.write(rel, new Uint8Array(bytes));
						break;
					}
					case 'mkdir':
						await this.remote.mkdir(rel);
						break;
					case 'delete':
						await this.remote.remove(rel);
						break;
					case 'rename':
						if (!pending.to) throw new Error('Missing rename destination');
						await this.remote.rename(rel, pending.to);
						break;
				}
				this.pending.delete(rel);
				this.clearIssue(issueId('remote-write-failed', rel));
				this.hooks.onStatus?.(`Remote write for ${rel} recovered`, 'info');
				await this.refreshBaselines();
			} catch (error) {
				this.markFailed(rel, error, pending.op, pending.to);
			}
		}
	}

	async syncFromRemote(): Promise<void> {
		if (this.syncing || this.disposed || this.hydrating) return;
		this.syncing = true;
		this.beginIssueCycle();
		try {
			if (!this.initialized) await this.initialize();
			await this.retryFailedPending();
			const remoteEntries = await this.remote.tree();
			const nextRemote = baselineOf(remoteEntries);
			const currentLocal = await this.scanLocal();
			this.lastRemote = new Map(nextRemote);
			this.lastLocal = new Map(currentLocal);
			await this.reconcile(nextRemote, currentLocal);
			await this.refreshBaselines();
			if (!this.announced) {
				this.announced = true;
				this.hooks.onStatus?.(`Synchronized ${remoteEntries.length} remote entries`, 'info');
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.reportIssue({
				id: issueId('remote-sync-failed'),
				kind: 'remote-sync-failed',
				level: 'error',
				message: `Remote sync failed: ${message}`,
				at: Date.now()
			});
			this.hooks.onStatus?.(`Waiting for remote filesystem: ${message}`, 'warn');
		} finally {
			this.endIssueCycle();
			this.syncing = false;
		}
	}

	private async reconcile(
		nextRemote: Map<string, RemoteStat>,
		currentLocal: Map<string, LocalSignature>
	): Promise<void> {
		const paths = new Set<string>([
			...nextRemote.keys(),
			...currentLocal.keys(),
			...this.baseline.keys(),
			...this.localBaseline.keys()
		]);
		const decisions: Decision[] = [];
		for (const path of paths) {
			if (isSyncArtifact(path)) continue;
			const remoteStat = nextRemote.get(path);
			const localSig = currentLocal.get(path);
			const baseRemote = this.baseline.get(path);
			const baseLocal = this.localBaseline.get(path);
			const remoteChanged = await this.remoteChanged(path, remoteStat, baseRemote);
			const localChanged = this.localChanged(path, localSig, baseLocal);
			let remoteHash: string | undefined;
			let localHash: string | undefined;
			if (remoteChanged && localChanged) {
				remoteHash = await this.hashRemote(path, remoteStat);
				localHash = localSig?.hash ?? ABSENT;
				if (remoteHash === localHash) continue; // Both sides made the same edit.
			}
			if (remoteChanged && localChanged) {
				decisions.push({
					path,
					action: 'conflict',
					remoteStat,
					localSig,
					remoteHash,
					localHash
				});
			} else if (localChanged) {
				decisions.push({
					path,
					action: localSig ? 'push' : 'delete-remote',
					remoteStat,
					localSig
				});
			} else if (remoteChanged) {
				decisions.push({
					path,
					action: remoteStat ? 'pull' : 'delete-local',
					remoteStat,
					localSig
				});
			}
		}

		const deletions = new Set(
			decisions
				.filter((d) => d.action === 'delete-remote' || d.action === 'delete-local')
				.map((d) => d.path)
		);
		for (const d of decisions
			.filter((x) => x.action === 'delete-remote' || x.action === 'delete-local')
			.sort((a, b) => depth(b.path) - depth(a.path))) {
			if (isUnderAnyParent(d.path, deletions)) continue;
			try {
				if (d.action === 'delete-remote') await this.remote.remove(d.path);
				else await this.podFs.deleteEntry(this.abs(d.path));
			} catch (error) {
				this.reportFailure('pull-failed', d.path, error, 'Failed to propagate deletion');
			}
		}

		for (const d of decisions
			.filter((x) => x.action === 'push' || x.action === 'pull')
			.sort((a, b) => depth(a.path) - depth(b.path))) {
			if (isUnderAnyParent(d.path, deletions)) continue;
			try {
				if (d.action === 'push' && d.localSig) {
					await this.pushLocal(d.path, d.localSig, d.remoteStat);
				} else if (d.action === 'pull' && d.remoteStat) {
					await this.pullRemote(d.path, d.remoteStat, d.localSig);
				}
			} catch (error) {
				this.reportFailure('pull-failed', d.path, error, 'Failed to synchronize');
			}
		}

		for (const d of decisions.filter((x) => x.action === 'conflict')) {
			await this.reportConflict(d);
		}
	}

	private async remoteChanged(
		path: string,
		stat: RemoteStat | undefined,
		base: RemoteStat | undefined
	): Promise<boolean> {
		if (stat === undefined || base === undefined) return stat !== undefined || base !== undefined;
		if (!statChanged(base, stat)) return false;
		const current = await this.hashRemote(path, stat);
		const previous = this.remoteHashBaseline.get(path);
		return previous === undefined || current !== previous;
	}

	private localChanged(
		_path: string,
		sig: LocalSignature | undefined,
		base: LocalSignature | undefined
	): boolean {
		if (sig === undefined || base === undefined) return sig !== undefined || base !== undefined;
		return sig.hash !== base.hash;
	}

	private async hashRemote(path: string, stat: RemoteStat | undefined): Promise<string> {
		if (!stat) return ABSENT;
		if (stat.isDir) return 'dir';
		try {
			return hashBytes(await this.remote.read(path));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.reportIssue({
				id: issueId('remote-sync-failed', path),
				kind: 'remote-sync-failed',
				level: 'error',
				path,
				message: `Could not read remote ${path}: ${message}`,
				at: Date.now()
			});
			return `error:${message}`;
		}
	}

	private async pushLocal(
		path: string,
		sig: LocalSignature,
		remoteStat: RemoteStat | undefined
	): Promise<void> {
		if (remoteStat && remoteStat.isDir !== sig.isDir) await this.remote.remove(path);
		if (sig.isDir) {
			const stat = await this.remote.mkdir(path);
			this.baseline.set(path, stat);
			this.remoteHashBaseline.set(path, 'dir');
		} else {
			const bytes = await this.podFs.readBinaryFile(this.abs(path));
			const stat = await this.remote.write(path, new Uint8Array(bytes));
			this.baseline.set(path, stat);
			this.remoteHashBaseline.set(path, hashBytes(new Uint8Array(bytes)));
		}
		this.localBaseline.set(path, sig);
		this.hooks.onStatus?.(`Pushed terminal/IDE change for ${path}`, 'info');
	}

	private async pullRemote(
		path: string,
		stat: RemoteStat,
		localSig: LocalSignature | undefined
	): Promise<void> {
		if (localSig && localSig.isDir !== stat.isDir) await this.podFs.deleteEntry(this.abs(path));
		if (stat.isDir) {
			await this.podFs.createDirectory(this.abs(path));
		} else {
			const bytes = await this.remote.read(path);
			await this.podFs.writeBinaryFile(this.abs(path), toArrayBuffer(bytes));
		}
		this.baseline.set(path, stat);
		this.remoteHashBaseline.set(path, await this.hashRemote(path, stat));
	}

	private async reportConflict(d: Decision): Promise<void> {
		const id = issueId('conflict', d.path);
		const alreadyReported = this.issueMap.has(id);
		let copy = '';
		if (!alreadyReported && d.remoteStat && !d.remoteStat.isDir) {
			try {
				const bytes = await this.remote.read(d.path);
				copy = conflictCopyPath(d.path);
				await this.podFs.writeBinaryFile(this.abs(copy), toArrayBuffer(bytes));
			} catch (error) {
				console.warn('[drakeforge] failed to save remote conflict copy', d.path, error);
			}
		}
		const message =
			`Concurrent edit: ${d.path} changed on Dragon86 and in BrowserPod. ` +
			`Neither copy was overwritten.${copy ? ` Remote version saved as ${copy}.` : ''}`;
		this.reportIssue({
			id,
			kind: 'conflict',
			level: 'error',
			path: d.path,
			message,
			at: Date.now(),
			localHash: d.localHash,
			remoteHash: d.remoteHash
		});
		this.hooks.onStatus?.(`Conflict on ${d.path}: resolve in the Sync panel`, 'error');
	}

	async resolve(id: string, strategy: SyncResolution): Promise<void> {
		const issue = this.issueMap.get(id);
		if (!issue || issue.kind !== 'conflict' || !issue.path) return;
		const path = issue.path;
		const remoteStat = this.lastRemote.get(path);
		const localSig = this.lastLocal.get(path);
		try {
			if (strategy === 'local') {
				if (localSig) await this.pushLocal(path, localSig, remoteStat);
				else await this.remote.remove(path);
			} else {
				if (remoteStat) await this.pullRemote(path, remoteStat, localSig);
				else await this.podFs.deleteEntry(this.abs(path));
			}
			this.issueMap.delete(id);
			this.activeIssues.delete(id);
			await this.refreshBaselines();
			this.hooks.onStatus?.(
				`Resolved ${path} using the ${strategy === 'local' ? 'BrowserPod' : 'Dragon86'} copy`,
				'info'
			);
			this.emitIssues();
		} catch (error) {
			this.markFailed(path, error, 'write');
		}
	}

	private async refreshBaselines(): Promise<void> {
		const remoteEntries = await this.remote.tree();
		const local = await this.scanLocal();
		this.baseline = baselineOf(remoteEntries);
		this.lastRemote = new Map(this.baseline);
		this.remoteHashBaseline = await this.readRemoteHashes(remoteEntries);
		this.localBaseline = new Map(local);
		this.lastLocal = new Map(local);
		this.emitSnapshot(remoteEntries, local);
	}

	private async readRemoteHashes(entries: readonly RemoteEntry[]): Promise<Map<string, string>> {
		const map = new Map<string, string>();
		for (const entry of entries) {
			if (entry.isDir) {
				map.set(entry.path, 'dir');
				continue;
			}
			try {
				map.set(entry.path, hashBytes(await this.remote.read(entry.path)));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.reportIssue({
					id: issueId('remote-sync-failed', entry.path),
					kind: 'remote-sync-failed',
					level: 'error',
					path: entry.path,
					message: `Could not read remote ${entry.path}: ${message}`,
					at: Date.now()
				});
			}
		}
		return map;
	}

	private async scanLocal(): Promise<Map<string, LocalSignature>> {
		const map = new Map<string, LocalSignature>();
		if (!this.podFs.scanTree) {
			this.reportIssue({
				id: issueId('local-scan-failed'),
				kind: 'local-scan-failed',
				level: 'warn',
				message:
					'This runtime cannot scan terminal-created files; the sync layer will only reconcile IDE writes.',
				at: Date.now()
			});
			return map;
		}
		const entries = await this.podFs.scanTree(this.workdir);
		for (const entry of entries) {
			if (isSyncArtifact(entry.path)) continue;
			if (entry.isDir) {
				map.set(entry.path, { isDir: true, hash: 'dir', size: 0 });
				continue;
			}
			try {
				const bytes = await this.podFs.readBinaryFile(this.abs(entry.path));
				map.set(entry.path, {
					isDir: false,
					hash: hashBytes(new Uint8Array(bytes)),
					size: bytes.byteLength
				});
			} catch (error) {
				this.reportFailure('local-scan-failed', entry.path, error, 'Could not read local file');
			}
		}
		return map;
	}

	private emitSnapshot(entries: readonly RemoteEntry[], local: Map<string, LocalSignature>): void {
		const remote = snapshotOf(entries);
		const files = new Set(remote.files);
		const dirs = new Set(remote.dirs);
		for (const [path, sig] of local) {
			if (isSyncArtifact(path)) continue;
			if (sig.isDir) dirs.add(path);
			else files.add(path);
		}
		this.snapshotHook?.({ files: [...files].sort(), dirs: [...dirs].sort() });
	}

	private reportFailure(kind: SyncIssueKind, path: string, error: unknown, prefix: string): void {
		const message = error instanceof Error ? error.message : String(error);
		this.reportIssue({
			id: issueId(kind, path),
			kind,
			level: 'error',
			path,
			message: `${prefix} for ${path}: ${message}`,
			at: Date.now()
		});
		this.hooks.onStatus?.(`${prefix} for ${path}: ${message}`, 'error');
	}

	private beginIssueCycle(): void {
		this.activeIssues = new Set();
	}

	private endIssueCycle(): void {
		for (const id of [...this.issueMap.keys()]) {
			if (!this.activeIssues.has(id)) this.issueMap.delete(id);
		}
		this.emitIssues();
	}

	private reportIssue(issue: SyncIssue): void {
		this.issueMap.set(issue.id, issue);
		this.activeIssues.add(issue.id);
		this.emitIssues();
	}

	private clearIssue(id: string): void {
		this.issueMap.delete(id);
		this.activeIssues.delete(id);
		this.emitIssues();
	}

	private emitIssues(): void {
		this.hooks.onIssues?.(this.issues);
	}
}

function baselineOf(entries: readonly RemoteEntry[]): Map<string, RemoteStat> {
	const map = new Map<string, RemoteStat>();
	for (const entry of entries) {
		map.set(entry.path, { isDir: entry.isDir, size: entry.size, mtime: entry.mtime });
	}
	return map;
}
