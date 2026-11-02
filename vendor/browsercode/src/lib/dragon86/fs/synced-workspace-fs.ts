/**
 * A BrowserCode WorkspaceFs that keeps BrowserPod's copy of a project in sync
 * with a remote whole-file filesystem (Dragon86 fs1 or standalone 9p).
 *
 * BrowserPod has no public mount hook, so its bash/dev server and Monaco must
 * share one pod-side copy. Local edits are pushed immediately; remote edits
 * are pulled on a short poll. A pending-local map prevents a save from being
 * overwritten by the snapshot taken before the remote write landed.
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

export interface SyncedFsHooks {
	onStatus?: (text: string, level?: 'info' | 'warn' | 'error') => void;
	onSnapshot?: (snapshot: RemoteSnapshot) => void;
}

interface PendingLocal {
	hash: string;
	isDir: boolean;
	at: number;
	failed?: boolean;
}

const PENDING_TTL_MS = 30_000;

export class SyncedWorkspaceFs implements WorkspaceFs {
	private baseline = new Map<string, RemoteStat>();
	private pending = new Map<string, PendingLocal>();
	private timer: ReturnType<typeof setInterval> | null = null;
	private syncing = false;
	private hydrating = false;
	private disposed = false;
	private announced = false;
	private snapshotHook: ((snapshot: RemoteSnapshot) => void) | null = null;

	constructor(
		private readonly podFs: WorkspaceFs,
		private readonly remote: RemoteFs,
		private readonly workdir: string,
		private readonly hooks: SyncedFsHooks = {}
	) {}

	/** Seed the comparison baseline from the tree fetched for the initial file list. */
	setInitialBaseline(entries: readonly RemoteEntry[]): void {
		this.baseline = baselineOf(entries);
		this.announced = false;
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

	start(): void {
		if (this.timer !== null || this.disposed) return;
		this.timer = setInterval(() => void this.syncFromRemote(), FS_SYNC_INTERVAL_MS);
		void this.syncFromRemote();
	}

	stop(): void {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
		this.disposed = true;
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
		await this.push(rel, hashBytes(bytes), false, () => this.remote.write(rel, bytes));
	}

	async writeBinaryFile(path: string, content: ArrayBuffer): Promise<void> {
		await this.podFs.writeBinaryFile(path, content);
		const bytes = new Uint8Array(content);
		const rel = this.relative(path);
		if (rel === null || rel === '') return;
		await this.push(rel, hashBytes(bytes), false, () => this.remote.write(rel, bytes));
	}

	async createDirectory(path: string): Promise<void> {
		await this.podFs.createDirectory(path);
		const rel = this.relative(path);
		if (rel === null || rel === '') return;
		await this.push(rel, 'dir', true, () => this.remote.mkdir(rel));
	}

	async renameEntry(from: string, to: string): Promise<void> {
		await this.podFs.renameEntry(from, to);
		const fromRel = this.relative(from);
		const toRel = this.relative(to);
		if (fromRel === null || fromRel === '' || toRel === null || toRel === '') return;
		this.pending.set(fromRel, { hash: 'moved', isDir: false, at: Date.now() });
		try {
			const stat = await this.remote.rename(fromRel, toRel);
			this.moveBaseline(fromRel, toRel, stat);
			this.pending.delete(fromRel);
			this.pending.set(toRel, { hash: 'moved', isDir: stat.isDir, at: Date.now() });
		} catch (error) {
			this.markFailed(fromRel, error);
		}
	}

	async deleteEntry(path: string): Promise<void> {
		await this.podFs.deleteEntry(path);
		const rel = this.relative(path);
		if (rel === null || rel === '') return;
		this.pending.set(rel, { hash: 'deleted', isDir: false, at: Date.now() });
		try {
			await this.remote.remove(rel);
			// Keep the old baseline until the next remote tree confirms deletion;
			// this avoids re-pulling a file that has not disappeared yet.
			this.pending.set(rel, { hash: 'deleted', isDir: false, at: Date.now() });
		} catch (error) {
			this.markFailed(rel, error);
		}
	}

	private relative(absPath: string): string | null {
		return relativeToWorkdir(this.workdir, absPath);
	}

	private async push(
		rel: string,
		hash: string,
		isDir: boolean,
		action: () => Promise<RemoteStat>
	): Promise<void> {
		if (this.hydrating || this.disposed) return;
		this.pending.set(rel, { hash, isDir, at: Date.now() });
		try {
			const stat = await action();
			this.baseline.set(rel, {
				isDir: stat.isDir,
				size: stat.size,
				mtime: stat.mtime
			});
			this.pending.set(rel, { hash, isDir, at: Date.now() });
		} catch (error) {
			this.markFailed(rel, error);
		}
	}

	private markFailed(rel: string, error: unknown): void {
		const pending = this.pending.get(rel);
		if (pending) pending.failed = true;
		const message = error instanceof Error ? error.message : String(error);
		this.hooks.onStatus?.(`Remote write for ${rel} failed: ${message}`, 'warn');
	}

	private moveBaseline(from: string, to: string, stat: RemoteStat): void {
		const next = new Map<string, RemoteStat>();
		for (const [path, value] of this.baseline) {
			if (path === from) next.set(to, stat);
			else if (path.startsWith(`${from}/`)) next.set(`${to}${path.slice(from.length)}`, value);
			else next.set(path, value);
		}
		this.baseline = next;
		const pending = new Map<string, PendingLocal>();
		for (const [path, value] of this.pending) {
			if (path === from) pending.set(to, value);
			else if (path.startsWith(`${from}/`)) pending.set(`${to}${path.slice(from.length)}`, value);
			else pending.set(path, value);
		}
		this.pending = pending;
	}

	async syncFromRemote(): Promise<void> {
		if (this.syncing || this.disposed || this.hydrating) return;
		this.syncing = true;
		try {
			const entries = await this.remote.tree();
			const next = baselineOf(entries);
			const snapshot = snapshotOf(entries);
			this.snapshotHook?.(snapshot);

			for (const [path, stat] of next) {
				const previous = this.baseline.get(path);
				if (!statChanged(previous, stat)) {
					this.expirePending(path);
					continue;
				}
				const pending = this.pending.get(path);
				if (await this.pendingMatches(path, pending, stat)) {
					this.pending.delete(path);
					this.baseline.set(path, stat);
					continue;
				}
				try {
					if (stat.isDir) {
						await this.podFs.createDirectory(this.abs(path));
					} else {
						const bytes = await this.remote.read(path);
						await this.podFs.writeBinaryFile(this.abs(path), toArrayBuffer(bytes));
					}
					this.baseline.set(path, stat);
					this.pending.delete(path);
				} catch (error) {
					console.warn('[drakeforge] failed to pull remote file', path, error);
				}
			}

			for (const [path] of this.baseline) {
				if (next.has(path)) continue;
				const pending = this.pending.get(path);
				if (pending?.hash === 'deleted' && !pending.failed) {
					this.pending.delete(path);
					continue;
				}
				if (this.isUnderRemovedParent(path, next)) continue;
				try {
					await this.podFs.deleteEntry(this.abs(path));
					this.pending.delete(path);
				} catch (error) {
					console.warn('[drakeforge] failed to delete local copy', path, error);
				}
			}

			this.baseline = next;
			if (!this.announced) {
				this.announced = true;
				this.hooks.onStatus?.(`Synchronized ${snapshot.files.length} files`, 'info');
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.hooks.onStatus?.(`Waiting for remote filesystem: ${message}`, 'warn');
		} finally {
			this.syncing = false;
		}
	}

	private async pendingMatches(
		path: string,
		pending: PendingLocal | undefined,
		stat: RemoteStat
	): Promise<boolean> {
		if (!pending || pending.failed) return false;
		if (pending.hash === 'dir' && stat.isDir) return true;
		if (pending.hash.startsWith('moved') || stat.isDir) return false;
		try {
			const bytes = await this.remote.read(path);
			return hashBytes(bytes) === pending.hash;
		} catch {
			return false;
		}
	}

	private expirePending(path: string): void {
		const pending = this.pending.get(path);
		if (pending && Date.now() - pending.at > PENDING_TTL_MS) this.pending.delete(path);
	}

	private isUnderRemovedParent(path: string, next: Map<string, RemoteStat>): boolean {
		let parent = path.slice(0, path.lastIndexOf('/'));
		while (parent) {
			if (!next.has(parent)) return true;
			parent = parent.slice(0, parent.lastIndexOf('/'));
		}
		return false;
	}

	private abs(rel: string): string {
		return `${this.workdir}/${rel}`;
	}
}

function baselineOf(entries: readonly RemoteEntry[]): Map<string, RemoteStat> {
	const map = new Map<string, RemoteStat>();
	for (const entry of entries) {
		map.set(entry.path, { isDir: entry.isDir, size: entry.size, mtime: entry.mtime });
	}
	return map;
}
