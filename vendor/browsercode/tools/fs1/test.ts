/** Contract tests for Dragon86's channel-backed fs1 v2 client. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	FS_MAX_BYTES,
	FS_MAX_TREE_ENTRIES,
	FS_PROTOCOL_VERSION
} from '../../src/lib/dragon86/bridge/config';
import { FsClient, FsError } from '../../src/lib/dragon86/bridge/fsClient';
import type {
	FsRequestMessage,
	FsResponseMessage,
	FsStat,
	FsTreeEntry
} from '../../src/lib/dragon86/bridge/protocol';
import type { BridgeTransport } from '../../src/lib/dragon86/bridge/transport';
import { Fs1RemoteFs } from '../../src/lib/dragon86/fs/fs1-remote-fs';
import { fs1Path } from '../../src/lib/dragon86/fs/remote-fs';
import { dragon86ProjectSource } from '../../src/lib/dragon86/fs/project-source';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const clone = <T>(value: T): T => structuredClone(value);

class MemoryDragon86Transport implements BridgeTransport {
	private fsHandler: ((message: FsResponseMessage) => void) | null = null;
	private messageHandler: ((message: never) => void) | null = null;
	readonly requests: FsRequestMessage[] = [];
	readonly files = new Map<string, Uint8Array>();
	readonly dirs = new Set<string>(['/']);
	respond = true;

	send(): void {}
	onMessage(handler: (message: never) => void): void {
		this.messageHandler = handler;
	}
	sendFs(message: FsRequestMessage): void {
		const req = clone(message);
		this.requests.push(req);
		if (!this.respond) return;
		queueMicrotask(() => this.fsHandler?.(this.handle(req)));
	}
	onFsMessage(handler: (message: FsResponseMessage) => void): void {
		this.fsHandler = handler;
	}
	close(): void {
		this.messageHandler = null;
		this.fsHandler = null;
	}

	private stat(path: string): FsStat {
		const data = this.files.get(path);
		if (data) return { isDir: false, size: data.byteLength, mtime: 1 };
		if (this.dirs.has(path)) return { isDir: true, size: 0, mtime: 1 };
		throw new Error(`ENOENT: ${path}`);
	}

	private handle(req: FsRequestMessage): FsResponseMessage {
		try {
			const path = req.path ?? '/';
			const response: FsResponseMessage = {
				v: FS_PROTOCOL_VERSION,
				t: 'fs-res',
				id: req.id,
				ok: true
			};
			switch (req.op) {
				case 'list': {
					const entries = new Map<string, FsStat>();
					for (const [file, data] of this.files) {
						if (file.slice(0, file.lastIndexOf('/')) === path)
							entries.set(file.slice(file.lastIndexOf('/') + 1), {
								isDir: false,
								size: data.byteLength,
								mtime: 1
							});
					}
					response.entries = [...entries].map(([name, stat]) => ({ name, ...stat }));
					break;
				}
				case 'tree': {
					const prefix = path === '/' ? '/' : `${path}/`;
					const tree: FsTreeEntry[] = [];
					for (const [file, data] of this.files) {
						if (file.startsWith(prefix))
							tree.push({
								path: file.slice(prefix.length),
								isDir: false,
								size: data.byteLength,
								mtime: 1
							});
					}
					for (const dir of this.dirs) {
						if (dir !== '/' && dir.startsWith(prefix))
							tree.push({ path: dir.slice(prefix.length), isDir: true, size: 0, mtime: 1 });
					}
					response.tree = tree;
					break;
				}
				case 'read': {
					const data = this.files.get(path);
					if (!data) throw new Error(`ENOENT: ${path}`);
					response.data = clone(data);
					break;
				}
				case 'write':
					if (!req.data) throw new Error('EINVAL: data is required');
					this.files.set(path, clone(req.data));
					response.stat = this.stat(path);
					break;
				case 'mkdir':
					this.dirs.add(path);
					response.stat = this.stat(path);
					break;
				case 'remove':
					this.files.delete(path);
					this.dirs.delete(path);
					break;
				case 'rename': {
					if (!req.to) throw new Error('EINVAL: to is required');
					const file = this.files.get(path);
					if (!file) throw new Error(`ENOENT: ${path}`);
					this.files.set(req.to, file);
					this.files.delete(path);
					response.stat = this.stat(req.to);
					break;
				}
				case 'stat':
					response.stat = this.stat(path);
					break;
			}
			return response;
		} catch (error) {
			return {
				v: FS_PROTOCOL_VERSION,
				t: 'fs-res',
				id: req.id,
				ok: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
}

function fixture(timeout = 80) {
	const transport = new MemoryDragon86Transport();
	const client = new FsClient(transport, timeout);
	return { transport, client, remote: new Fs1RemoteFs(client, '/') };
}

test('fs1 CRUD covers all supported operations and preserves Uint8Array bytes', async () => {
	const { transport, client, remote } = fixture();
	try {
		await remote.mkdir('project');
		const original = new Uint8Array([0, 1, 127, 128, 255]);
		await remote.write('project/data.bin', original);
		assert.deepEqual(await remote.read('project/data.bin'), original);
		assert.equal((await remote.stat('project/data.bin')).size, original.byteLength);
		assert.deepEqual(await remote.tree(), [
			{ path: 'project/data.bin', isDir: false, size: original.byteLength, mtime: 1 },
			{ path: 'project', isDir: true, size: 0, mtime: 1 }
		]);
		assert.deepEqual(await client.list('/project'), [
			{ name: 'data.bin', isDir: false, size: original.byteLength, mtime: 1 }
		]);
		await remote.rename('project/data.bin', 'project/renamed.bin');
		assert.deepEqual(await remote.read('project/renamed.bin'), original);
		await remote.remove('project/renamed.bin');
		assert.deepEqual(await remote.tree(), [{ path: 'project', isDir: true, size: 0, mtime: 1 }]);
		assert.deepEqual(
			transport.requests.map(({ op }) => op),
			['mkdir', 'write', 'read', 'stat', 'tree', 'list', 'rename', 'read', 'remove', 'tree']
		);
		assert.ok(transport.requests.every((request) => request.v === 2 && request.t === 'fs-req'));
	} finally {
		remote.close();
	}
});

test('fs1 paths cannot escape the share root and root paths stay rooted', () => {
	assert.equal(fs1Path('/', ''), '/');
	assert.equal(fs1Path('/', 'Documents/readme.md'), '/Documents/readme.md');
	assert.equal(fs1Path('/Documents', 'readme.md'), '/Documents/readme.md');
	for (const unsafe of ['../outside', 'a/../../outside', 'a\\..\\outside', '../']) {
		assert.throws(() => fs1Path('/', unsafe), /Unsafe remote path/);
		assert.throws(() => fs1Path('/Documents', unsafe), /Unsafe remote path/);
	}
});

test('fs1 enforces the documented 16 MiB file/message and 5,000-entry tree limits', async () => {
	const { transport, remote } = fixture();
	try {
		const maxFile = new Uint8Array(FS_MAX_BYTES);
		await remote.write('at-limit.bin', maxFile);
		assert.equal((await remote.read('at-limit.bin')).byteLength, FS_MAX_BYTES);
		const sentBeforeOversize = transport.requests.length;
		await assert.rejects(remote.write('too-large.bin', new Uint8Array(FS_MAX_BYTES + 1)), /EFBIG/);
		assert.equal(transport.requests.length, sentBeforeOversize, 'oversized data was not posted');

		const oversized = new Uint8Array(FS_MAX_BYTES + 1);
		assert.equal(
			(await import('../../src/lib/dragon86/bridge/protocol')).parseFsResponse({
				v: 2,
				t: 'fs-res',
				id: 1,
				ok: true,
				data: oversized
			}),
			null
		);
		assert.equal(FS_MAX_TREE_ENTRIES, 5000);
		const tooMany = Array.from({ length: FS_MAX_TREE_ENTRIES + 1 }, (_, index) => ({
			path: `file-${index}`,
			isDir: false,
			size: 0,
			mtime: 1
		}));
		assert.equal(
			(await import('../../src/lib/dragon86/bridge/protocol')).parseFsResponse({
				v: 2,
				t: 'fs-res',
				id: 2,
				ok: true,
				tree: tooMany
			}),
			null
		);
	} finally {
		remote.close();
	}
});

test('Dragon86 error responses and disconnect/timeouts are surfaced', async () => {
	const { transport, client, remote } = fixture(20);
	try {
		await assert.rejects(remote.read('missing.txt'), /ENOENT/);
		transport.respond = false;
		await assert.rejects(client.stat('/'), (error: unknown) => {
			assert.ok(error instanceof FsError);
			assert.equal(error.code, 'ETIMEOUT');
			return true;
		});
		client.close();
		await assert.rejects(client.stat('/'), (error: unknown) => {
			assert.ok(error instanceof FsError);
			assert.equal(error.code, 'ECLOSED');
			return true;
		});
	} finally {
		client.close();
	}
});

test('a disconnected Dragon86 mount fails visibly instead of falling back to a local workspace', async () => {
	const { transport, remote } = fixture(20);
	transport.respond = false;
	let unavailable = '';
	const source = dragon86ProjectSource({
		id: 'dragon86',
		label: 'dragon86-workspace',
		hydrateLabel: 'syncing Dragon86 files',
		remote,
		onRemoteUnavailable: (message) => (unavailable = message)
	});
	try {
		await assert.rejects(source.listFiles(), /Could not read Dragon86 filesystem: ETIMEOUT/);
		assert.equal(unavailable, 'ETIMEOUT');
	} finally {
		source.shutdown?.();
	}
});

test('fs1 text payload test helpers remain UTF-8 safe', () => {
	const bytes = encoder.encode('Dragon86 filesystem');
	assert.equal(decoder.decode(bytes), 'Dragon86 filesystem');
});
