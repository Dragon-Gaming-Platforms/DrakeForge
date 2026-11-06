/**
 * Session/transport integration tests.
 *
 * These run in Node with the real BroadcastChannel and a fake parent window,
 * covering dedicated sessions, embedded postMessage-only sessions, reload,
 * multiple simultaneous sessions, and CheerpX's legacy default channel.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	BROADCAST_CHANNEL_NAME,
	FS_PROTOCOL_VERSION,
	PROTOCOL_VERSION,
	SESSION_CHANNEL_PREFIX
} from '../../src/lib/dragon86/bridge/config';
import {
	BroadcastChannelTransport,
	PostMessageTransport,
	type FsRequestMessage,
	type OutgoingMessage
} from '../../src/lib/dragon86/bridge/transport';
import {
	createBridgeTransport,
	resolveBridgeSession,
	type BridgeSessionConfig
} from '../../src/lib/dragon86/bridge/session';
import { FsClient } from '../../src/lib/dragon86/bridge/fsClient';
import { HosterBridge } from '../../src/lib/dragon86/bridge/hosterBridge';
import type { FsTreeEntry } from '../../src/lib/dragon86/bridge/protocol';

const UUID_A = '11111111-2222-3333-4444-555555555555';
const UUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CHANNEL_A = `${SESSION_CHANNEL_PREFIX}${UUID_A}`;
const CHANNEL_B = `${SESSION_CHANNEL_PREFIX}${UUID_B}`;
const ORIGIN = 'https://dragon-gaming-platforms.github.io';

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function treeEntry(path: string): FsTreeEntry {
	return { path, isDir: false, size: path.length, mtime: Date.now() / 1000 };
}

function onceMessage<T = Record<string, unknown>>(
	channel: BroadcastChannel,
	predicate: (data: Record<string, unknown>) => boolean,
	timeoutMs = 500
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			channel.removeEventListener('message', onMessage);
			reject(new Error('Timed out waiting for channel message'));
		}, timeoutMs);
		const onMessage = (ev: MessageEvent) => {
			const data = ev.data as Record<string, unknown>;
			if (!predicate(data)) return;
			clearTimeout(timer);
			channel.removeEventListener('message', onMessage);
			resolve(data as T);
		};
		channel.addEventListener('message', onMessage);
	});
}

function fakeEngine() {
	return {
		write: (data: string) => {
			void data;
		},
		resize: (cols: number, rows: number) => {
			void cols;
			void rows;
		}
	};
}

function sessionConfig(params: URLSearchParams): BridgeSessionConfig {
	return resolveBridgeSession(params);
}

function installBroadcastSpy(): { names: string[]; restore: () => void } {
	const Original = globalThis.BroadcastChannel;
	const names: string[] = [];
	class SpyChannel extends Original {
		constructor(name: string) {
			super(name);
			names.push(name);
		}
	}
	(globalThis as unknown as { BroadcastChannel: typeof BroadcastChannel }).BroadcastChannel =
		SpyChannel as unknown as typeof BroadcastChannel;
	return {
		names,
		restore: () => {
			(globalThis as unknown as { BroadcastChannel: typeof BroadcastChannel }).BroadcastChannel =
				Original;
		}
	};
}

type FakeWindow = {
	parent: { postMessage: (msg: unknown, origin: string) => void };
	location: { origin: string };
	listeners: Map<string, ((ev: unknown) => void)[]>;
	addEventListener: (type: string, listener: (ev: unknown) => void) => void;
	removeEventListener: (type: string, listener: (ev: unknown) => void) => void;
	dispatch: (ev: unknown) => void;
};

function installFakeWindow(posted: { msg: unknown; origin: string }[]): {
	window: FakeWindow;
	restore: () => void;
} {
	const original = (globalThis as unknown as { window?: unknown }).window;
	const listeners = new Map<string, ((ev: unknown) => void)[]>();
	const parent = {
		postMessage: (msg: unknown, origin: string) => {
			posted.push({ msg, origin });
			const request = msg as FsRequestMessage;
			if (request?.v === FS_PROTOCOL_VERSION && request?.t === 'fs-req') {
				queueMicrotask(() =>
					listeners.get('message')?.forEach((listener) =>
						listener({
							data: {
								v: FS_PROTOCOL_VERSION,
								t: 'fs-res',
								id: request.id,
								ok: true,
								tree: [treeEntry('embedded.txt')]
							},
							origin: ORIGIN,
							source: parent
						})
					)
				);
			}
		}
	};
	const fakeWindow: FakeWindow = {
		parent,
		location: { origin: ORIGIN },
		listeners,
		addEventListener: (type, listener) => {
			const list = listeners.get(type) ?? [];
			list.push(listener);
			listeners.set(type, list);
		},
		removeEventListener: (type, listener) => {
			listeners.set(
				type,
				(listeners.get(type) ?? []).filter((l) => l !== listener)
			);
		},
		dispatch: (ev) => listeners.get('message')?.forEach((listener) => listener(ev))
	};
	(globalThis as unknown as { window: unknown }).window = fakeWindow;
	return {
		window: fakeWindow,
		restore: () => {
			if (original === undefined) delete (globalThis as unknown as { window?: unknown }).window;
			else (globalThis as unknown as { window: unknown }).window = original;
		}
	};
}

test('URL contract: dedicated session, embedded postMessage-only, legacy default', () => {
	const dedicated = sessionConfig(new URLSearchParams(`channel=${CHANNEL_A}`));
	assert.equal(dedicated.mode, 'separate');
	assert.equal(dedicated.channelName, CHANNEL_A);
	assert.equal(dedicated.dedicated, true);
	assert.notEqual(dedicated.channelName, BROADCAST_CHANNEL_NAME);

	const embedded = sessionConfig(new URLSearchParams(`mode=embed&channel=${CHANNEL_A}`));
	assert.equal(embedded.mode, 'embedded');
	assert.equal(embedded.channelName, null);
	assert.equal(embedded.dedicated, false);
	assert.equal(embedded.sessionChannel, CHANNEL_A);

	const legacy = sessionConfig(new URLSearchParams());
	assert.equal(legacy.mode, 'separate');
	assert.equal(legacy.channelName, BROADCAST_CHANNEL_NAME);
	assert.equal(legacy.dedicated, false);

	assert.throws(() => sessionConfig(new URLSearchParams('channel=not-a-session')));
});

test('dedicated session opens only its assigned channel and never the default channel', async () => {
	const spy = installBroadcastSpy();
	const config = sessionConfig(new URLSearchParams(`channel=${CHANNEL_A}`));
	let runtime: ReturnType<typeof createBridgeTransport> | null = null;
	let defaultListener: BroadcastChannel | null = null;
	try {
		runtime = createBridgeTransport(config);
		assert.deepEqual(runtime.channelNames, [CHANNEL_A]);
		assert.equal(runtime.usesPostMessage, false);
		assert.equal(runtime.usesBroadcast, true);
		assert.deepEqual(spy.names, [CHANNEL_A]);

		defaultListener = new globalThis.BroadcastChannel(BROADCAST_CHANNEL_NAME);
		let leaked = false;
		defaultListener.onmessage = () => (leaked = true);
		runtime.transport.send({ v: PROTOCOL_VERSION, t: 'ready', caps: ['fs1'] });
		runtime.transport.sendFs({
			v: FS_PROTOCOL_VERSION,
			t: 'fs-req',
			id: 99,
			op: 'tree',
			path: '/'
		});
		await delay(80);
		assert.equal(leaked, false, 'dedicated session leaked onto dragon86-hoster-v1');
	} finally {
		defaultListener?.close();
		runtime?.transport.close();
		spy.restore();
	}
});

test('embedded mode uses parent postMessage only; BroadcastChannel is never constructed', async () => {
	const spy = installBroadcastSpy();
	const posted: { msg: unknown; origin: string }[] = [];
	const fake = installFakeWindow(posted);
	const config = sessionConfig(new URLSearchParams(`mode=embed&channel=${CHANNEL_A}`));
	let runtime: ReturnType<typeof createBridgeTransport> | null = null;
	let bridge: HosterBridge | null = null;
	let client: FsClient | null = null;
	try {
		runtime = createBridgeTransport(config);
		assert.equal(runtime.usesPostMessage, true);
		assert.equal(runtime.usesBroadcast, false);
		assert.deepEqual(runtime.channelNames, []);
		assert.deepEqual(spy.names, [], 'embedded mode must not open a BroadcastChannel');

		bridge = new HosterBridge(runtime.transport, fakeEngine(), {
			getReadyCaps: () => ['fs1']
		});
		bridge.markEngineReady();
		fake.window.dispatch({
			data: { v: PROTOCOL_VERSION, t: 'hello', caps: ['fs1'] },
			origin: ORIGIN,
			source: fake.window.parent
		});
		const ready = posted.find((entry) => (entry.msg as OutgoingMessage)?.t === 'ready') as
			| { msg: OutgoingMessage; origin: string }
			| undefined;
		assert.ok(ready, 'expected ready on parent postMessage');
		assert.equal(ready.origin, ORIGIN);
		assert.deepEqual((ready.msg as { caps?: string[] }).caps, ['fs1']);

		client = new FsClient(runtime.transport, 400);
		const tree = await client.tree('/');
		assert.deepEqual(
			tree.map((entry) => entry.path),
			['embedded.txt']
		);
		assert.ok(
			posted.some((entry) => (entry.msg as FsRequestMessage)?.t === 'fs-req'),
			'expected fs-req on parent postMessage'
		);
	} finally {
		client?.close();
		runtime?.transport.close();
		fake.restore();
		spy.restore();
	}
});

test('separate dedicated session: hello/ready and fs1 tree on the assigned channel', async () => {
	const config = sessionConfig(new URLSearchParams(`channel=${CHANNEL_A}`));
	const runtime = createBridgeTransport(config);
	const hoster = new globalThis.BroadcastChannel(CHANNEL_A);
	let bridge: HosterBridge | null = null;
	let client: FsClient | null = null;
	try {
		bridge = new HosterBridge(runtime.transport, fakeEngine(), {
			getReadyCaps: () => ['fs1']
		});
		bridge.markEngineReady();
		const readyPromise = onceMessage(
			hoster,
			(data) => data.t === 'ready' && data.via === 'bc-hoster'
		);
		hoster.postMessage({ v: PROTOCOL_VERSION, t: 'hello', caps: ['fs1'] });
		const ready = await readyPromise;
		assert.deepEqual(ready.caps, ['fs1']);

		hoster.onmessage = (ev) => {
			const req = ev.data as FsRequestMessage;
			if (req?.v === FS_PROTOCOL_VERSION && req?.t === 'fs-req') {
				hoster.postMessage({
					v: FS_PROTOCOL_VERSION,
					t: 'fs-res',
					id: req.id,
					ok: true,
					tree: [treeEntry('separate.txt')]
				});
			}
		};
		client = new FsClient(runtime.transport, 400);
		const tree = await client.tree('/');
		assert.deepEqual(
			tree.map((entry) => entry.path),
			['separate.txt']
		);
	} finally {
		client?.close();
		runtime.transport.close();
		hoster.close();
	}
});

test('reload/reconnect reuses the same dedicated channel', async () => {
	const config = sessionConfig(new URLSearchParams(`channel=${CHANNEL_A}`));
	for (let attempt = 0; attempt < 2; attempt++) {
		const runtime = createBridgeTransport(config);
		const hoster = new globalThis.BroadcastChannel(CHANNEL_A);
		let bridge: HosterBridge | null = null;
		try {
			bridge = new HosterBridge(runtime.transport, fakeEngine(), {
				getReadyCaps: () => ['fs1']
			});
			bridge.markEngineReady();
			const readyPromise = onceMessage(hoster, (data) => data.t === 'ready');
			hoster.postMessage({ v: PROTOCOL_VERSION, t: 'hello', caps: ['fs1'] });
			const ready = await readyPromise;
			assert.equal(ready.v, PROTOCOL_VERSION);
		} finally {
			runtime.transport.close();
			hoster.close();
		}
		await delay(20);
	}
});

test('multiple DrakeForge sessions and simultaneous CheerpX use stay isolated', async () => {
	const configs = [
		sessionConfig(new URLSearchParams()),
		sessionConfig(new URLSearchParams(`channel=${CHANNEL_A}`)),
		sessionConfig(new URLSearchParams(`channel=${CHANNEL_B}`))
	];
	const names = [BROADCAST_CHANNEL_NAME, CHANNEL_A, CHANNEL_B];
	const runtimes = configs.map((config) => createBridgeTransport(config));
	const hosters = names.map((name) => new globalThis.BroadcastChannel(name));
	const bridges: HosterBridge[] = [];
	const clients: FsClient[] = [];
	const crossTalk: string[] = [];
	try {
		for (let i = 0; i < runtimes.length; i++) {
			const cap = `cap-${i}`;
			bridges.push(
				new HosterBridge(runtimes[i].transport, fakeEngine(), {
					getReadyCaps: () => [cap, 'fs1']
				})
			);
			bridges[i].markEngineReady();
			hosters[i].postMessage({ v: PROTOCOL_VERSION, t: 'hello', caps: ['fs1', cap] });
			hosters[i].onmessage = (ev) => {
				const data = ev.data as Record<string, unknown>;
				if (data.t === 'ready') {
					const caps = data.caps as string[] | undefined;
					if (caps && !caps.includes(`cap-${i}`)) crossTalk.push(`ready:${i}`);
				}
				const req = data as unknown as FsRequestMessage;
				if (req?.v === FS_PROTOCOL_VERSION && req?.t === 'fs-req') {
					if (req.path !== `/session-${i}`) crossTalk.push(`fs-req:${i}:${req.path}`);
					hosters[i].postMessage({
						v: FS_PROTOCOL_VERSION,
						t: 'fs-res',
						id: req.id,
						ok: true,
						tree: [treeEntry(`session-${i}.txt`)]
					});
				}
			};
		}
		await delay(80);
		for (let i = 0; i < runtimes.length; i++) {
			const client = new FsClient(runtimes[i].transport, 400);
			clients.push(client);
			const tree = await client.tree(`/session-${i}`);
			assert.deepEqual(
				tree.map((entry) => entry.path),
				[`session-${i}.txt`]
			);
		}
		assert.deepEqual(crossTalk, [], 'one channel answered another session hello');
	} finally {
		clients.forEach((client) => client.close());
		runtimes.forEach((runtime) => runtime.transport.close());
		hosters.forEach((hoster) => hoster.close());
	}
});

test('BroadcastChannelTransport and PostMessageTransport remain separately constructible', () => {
	const bc = new BroadcastChannelTransport(CHANNEL_A);
	assert.equal(bc.channelName, CHANNEL_A);
	bc.close();
	const posted: { msg: unknown; origin: string }[] = [];
	const fake = installFakeWindow(posted);
	try {
		const pm = new PostMessageTransport();
		assert.equal(typeof pm.send, 'function');
		pm.close();
	} finally {
		fake.restore();
	}
});
