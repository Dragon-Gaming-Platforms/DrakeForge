/**
 * Sync-safety tests with in-memory BrowserPod and Dragon86-like remote FS.
 *
 * Covers two-way edits, terminal-created files, failed remote writes, and
 * concurrent edits. No live BrowserPod/Dragon86 runtime is required.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LocalScanEntry, WorkspaceFs } from '../../src/lib/ide/workspace-fs';
import type {
	RemoteEntry,
	RemoteFs,
	RemoteSnapshot,
	RemoteStat
} from '../../src/lib/dragon86/fs/remote-fs';
import { SyncedWorkspaceFs, type SyncIssue } from '../../src/lib/dragon86/fs/synced-workspace-fs';

const WORKDIR = '/home/user/dragon86';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytes(text: string): Uint8Array {
	return encoder.encode(text);
}

function text(data: Uint8Array): string {
	return decoder.decode(data);
}

function copy(data: Uint8Array): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(data.byteLength);
	out.set(data);
	return out;
}

class MemoryPodFs implements WorkspaceFs {
	readonly files = new Map<string, Uint8Array>();
	readonly dirs = new Set<string>();

	async readFile(path: string): Promise<string> {
		const data = this.files.get(path);
		if (!data) throw new Error(`ENOENT: ${path}`);
		return text(data);
	}
	async readFileWithinLimit(path: string, maxBytes: number): Promise<string | null> {
		const data = this.files.get(path);
		if (!data) throw new Error(`ENOENT: ${path}`);
		return data.byteLength > maxBytes ? null : text(data);
	}
	async readBinaryFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
		const data = this.files.get(path);
		if (!data) throw new Error(`ENOENT: ${path}`);
		return copy(data);
	}
	async fileSize(path: string): Promise<number> {
		const data = this.files.get(path);
		if (!data) throw new Error(`ENOENT: ${path}`);
		return data.byteLength;
	}
	async writeFile(path: string, content: string): Promise<void> {
		this.files.set(path, bytes(content));
	}
	async writeBinaryFile(path: string, content: ArrayBuffer): Promise<void> {
		this.files.set(path, new Uint8Array(content));
	}
	async createDirectory(path: string): Promise<void> {
		this.dirs.add(path);
	}
	async renameEntry(from: string, to: string): Promise<void> {
		const data = this.files.get(from);
		if (data) {
			this.files.set(to, data);
			this.files.delete(from);
		}
		for (const path of [...this.dirs, ...this.files.keys()]) {
			if (path === from || path.startsWith(`${from}/`)) {
				const suffix = path.slice(from.length);
				if (this.dirs.delete(path)) this.dirs.add(`${to}${suffix}`);
				const child = this.files.get(path);
				if (child) {
					this.files.set(`${to}${suffix}`, child);
					this.files.delete(path);
				}
			}
		}
	}
	async deleteEntry(path: string): Promise<void> {
		this.files.delete(path);
		this.dirs.delete(path);
		for (const key of [...this.files.keys()]) {
			if (key.startsWith(`${path}/`)) this.files.delete(key);
		}
		for (const key of [...this.dirs]) {
			if (key.startsWith(`${path}/`)) this.dirs.delete(key);
		}
	}
	async scanTree(root: string): Promise<LocalScanEntry[]> {
		const prefix = `${root}/`;
		const entries: LocalScanEntry[] = [];
		for (const [path, data] of this.files) {
			if (!path.startsWith(prefix)) continue;
			entries.push({
				path: path.slice(prefix.length),
				isDir: false,
				size: data.byteLength,
				mtime: 0
			});
		}
		for (const path of this.dirs) {
			if (!path.startsWith(prefix)) continue;
			entries.push({ path: path.slice(prefix.length), isDir: true, size: 0, mtime: 0 });
		}
		return entries.sort((a, b) => a.path.localeCompare(b.path));
	}
}

class FakeRemoteFs implements RemoteFs {
	readonly root = '/remote';
	readonly files = new Map<string, Uint8Array>();
	readonly dirs = new Set<string>();
	failWrite = false;
	failTree = false;
	private version = 0;

	private bump(): number {
		return ++this.version;
	}
	private statOf(isDir: boolean, size: number, mtime = this.bump()): RemoteStat {
		return { isDir, size, mtime };
	}
	async tree(): Promise<RemoteEntry[]> {
		if (this.failTree) throw new Error('remote tree unavailable');
		const entries: RemoteEntry[] = [];
		for (const path of this.dirs) {
			entries.push({ path, isDir: true, size: 0, mtime: this.version });
		}
		for (const [path, data] of this.files) {
			entries.push({ path, isDir: false, size: data.byteLength, mtime: this.version });
		}
		return entries.sort((a, b) => a.path.localeCompare(b.path));
	}
	async read(rel: string): Promise<Uint8Array> {
		const data = this.files.get(rel);
		if (!data) throw new Error(`ENOENT: ${rel}`);
		return copy(data);
	}
	async write(rel: string, data: Uint8Array): Promise<RemoteStat> {
		if (this.failWrite) throw new Error('remote write failed');
		this.files.set(rel, copy(data));
		return this.statOf(false, data.byteLength);
	}
	async mkdir(rel: string): Promise<RemoteStat> {
		this.dirs.add(rel);
		return this.statOf(true, 0);
	}
	async remove(rel: string): Promise<void> {
		this.files.delete(rel);
		this.dirs.delete(rel);
		for (const key of [...this.files.keys()]) {
			if (key.startsWith(`${rel}/`)) this.files.delete(key);
		}
		for (const key of [...this.dirs]) {
			if (key.startsWith(`${rel}/`)) this.dirs.delete(key);
		}
		this.bump();
	}
	async rename(from: string, to: string): Promise<RemoteStat> {
		const data = this.files.get(from);
		if (data) {
			this.files.set(to, data);
			this.files.delete(from);
		}
		for (const key of [...this.files.keys(), ...this.dirs]) {
			if (key === from || key.startsWith(`${from}/`)) {
				const suffix = key.slice(from.length);
				if (this.files.has(key)) {
					this.files.set(`${to}${suffix}`, this.files.get(key)!);
					this.files.delete(key);
				}
				if (this.dirs.delete(key)) this.dirs.add(`${to}${suffix}`);
			}
		}
		return this.statOf(false, 0);
	}
	async stat(rel: string): Promise<RemoteStat> {
		const data = this.files.get(rel);
		if (data) return { isDir: false, size: data.byteLength, mtime: this.version };
		if (this.dirs.has(rel)) return { isDir: true, size: 0, mtime: this.version };
		throw new Error(`ENOENT: ${rel}`);
	}
	close(): void {
		return;
	}
}

interface Setup {
	pod: MemoryPodFs;
	remote: FakeRemoteFs;
	synced: SyncedWorkspaceFs;
	issues: () => SyncIssue[];
	snapshot: () => RemoteSnapshot | null;
}

async function setup(): Promise<Setup> {
	const pod = new MemoryPodFs();
	const remote = new FakeRemoteFs();
	let issues: SyncIssue[] = [];
	let snapshot: RemoteSnapshot | null = null;
	const synced = new SyncedWorkspaceFs(pod, remote, WORKDIR, {
		onIssues: (next) => (issues = next)
	});
	synced.setSnapshotHook((next) => (snapshot = next));
	await synced.initialize();
	return { pod, remote, synced, issues: () => issues, snapshot: () => snapshot };
}

test('two-way edits: remote pull, IDE push, and terminal-created file push', async () => {
	const { pod, remote, synced, snapshot } = await setup();
	try {
		await remote.write('remote.txt', bytes('from Dragon86'));
		await synced.syncFromRemote();
		assert.equal(await pod.readFile(`${WORKDIR}/remote.txt`), 'from Dragon86');

		await synced.writeFile(`${WORKDIR}/ide.txt`, 'from Monaco');
		assert.equal(text(await remote.read('ide.txt')), 'from Monaco');

		await pod.writeFile(`${WORKDIR}/terminal.txt`, 'from bash');
		await synced.syncFromRemote();
		assert.equal(text(await remote.read('terminal.txt')), 'from bash');
		assert.ok(snapshot()?.files.includes('terminal.txt'));
	} finally {
		synced.stop();
	}
});

test('failed remote write is surfaced and retried without losing the local edit', async () => {
	const { pod, remote, synced, issues } = await setup();
	try {
		remote.failWrite = true;
		await assert.rejects(
			synced.writeFile(`${WORKDIR}/failed.txt`, 'local copy'),
			/Remote write for failed.txt failed/
		);
		assert.equal(await pod.readFile(`${WORKDIR}/failed.txt`), 'local copy');
		assert.ok(issues().some((issue) => issue.kind === 'remote-write-failed'));

		remote.failWrite = false;
		await synced.syncFromRemote();
		assert.equal(text(await remote.read('failed.txt')), 'local copy');
		assert.equal(issues().filter((issue) => issue.kind === 'remote-write-failed').length, 0);
	} finally {
		synced.stop();
	}
});

test('concurrent edits are reported as a conflict, not overwritten; resolution is explicit', async () => {
	const pod = new MemoryPodFs();
	const remote = new FakeRemoteFs();
	let issues: SyncIssue[] = [];
	await remote.write('shared.txt', bytes('base'));
	await pod.writeFile(`${WORKDIR}/shared.txt`, 'base');
	const synced = new SyncedWorkspaceFs(pod, remote, WORKDIR, {
		onIssues: (next) => (issues = next)
	});
	try {
		await synced.initialize();

		await remote.write('shared.txt', bytes('Dragon86 edit'));
		await pod.writeFile(`${WORKDIR}/shared.txt`, 'terminal edit');
		await synced.syncFromRemote();

		assert.equal(text(await remote.read('shared.txt')), 'Dragon86 edit');
		assert.equal(await pod.readFile(`${WORKDIR}/shared.txt`), 'terminal edit');
		const conflict = issues.find((issue) => issue.kind === 'conflict');
		assert.ok(conflict, 'expected a conflict issue');
		assert.equal(conflict.path, 'shared.txt');
		assert.ok([...pod.files.keys()].some((path) => path.includes('.drakeforge-remote-')));

		await synced.resolve(conflict.id, 'local');
		assert.equal(text(await remote.read('shared.txt')), 'terminal edit');
		assert.equal(issues.filter((issue) => issue.kind === 'conflict').length, 0);
	} finally {
		synced.stop();
	}
});

test('remote poll failure is surfaced instead of silently dropping sync', async () => {
	const { remote, synced, issues } = await setup();
	try {
		remote.failTree = true;
		await synced.syncFromRemote();
		assert.ok(issues().some((issue) => issue.kind === 'remote-sync-failed'));
		remote.failTree = false;
		await synced.syncFromRemote();
		assert.equal(issues().filter((issue) => issue.id === 'remote-sync-failed:workspace').length, 0);
	} finally {
		synced.stop();
	}
});
