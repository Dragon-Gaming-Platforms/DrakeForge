/**
 * Protocol validation tests for untrusted bridge messages.
 *
 * Covers parseIncomingMessage, origin allowlisting, and fs request/response
 * bounds — the security surface that session integration tests only exercise
 * indirectly.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	ALLOW_LOCALHOST_PARENTS,
	FS_MAX_BYTES,
	FS_MAX_TREE_ENTRIES,
	PROTOCOL_VERSION
} from '../../src/lib/dragon86/bridge/config';
import {
	isOriginAllowed,
	parseFsRequest,
	parseFsResponse,
	parseIncomingMessage
} from '../../src/lib/dragon86/bridge/protocol';

function withWindow(origin: string, fn: () => void): void {
	const original = (globalThis as { window?: unknown }).window;
	(globalThis as { window?: unknown }).window = {
		location: { origin },
		parent: {}
	};
	try {
		fn();
	} finally {
		if (original === undefined) delete (globalThis as { window?: unknown }).window;
		else (globalThis as { window: unknown }).window = original;
	}
}

test('parseIncomingMessage accepts valid hello/data/resize and rejects junk', () => {
	const hello = parseIncomingMessage({ v: PROTOCOL_VERSION, t: 'hello', caps: ['fs1', 'fs1', ''] });
	assert.ok(hello);
	assert.deepEqual(hello.t === 'hello' && hello.caps, ['fs1']);

	const data = parseIncomingMessage({ v: PROTOCOL_VERSION, t: 'data', d: 'hi' });
	assert.equal(data?.t, 'data');

	// Out-of-range dimensions are clamped into the supported range, not rejected.
	const resize = parseIncomingMessage({
		v: PROTOCOL_VERSION,
		t: 'resize',
		cols: 10 ** 9,
		rows: -3
	});
	assert.ok(resize && resize.t === 'resize');
	assert.ok(resize.cols > 0 && resize.cols <= 10_000);
	assert.ok(resize.rows > 0 && resize.rows <= 10_000);

	// Malformed resize payloads are rejected outright.
	assert.equal(parseIncomingMessage({ v: PROTOCOL_VERSION, t: 'resize', cols: 'wide' }), null);

	assert.equal(parseIncomingMessage({ v: 99, t: 'hello' }), null);
	assert.equal(parseIncomingMessage(null), null);
	assert.equal(parseIncomingMessage({ v: PROTOCOL_VERSION, t: 'data', d: 42 }), null);
	assert.equal(parseIncomingMessage({ v: PROTOCOL_VERSION, t: 'exit', code: 0 }), null);
});

test('caps are length-limited and deduped', () => {
	const caps = Array.from({ length: 40 }, (_, i) => `cap-${i}`);
	const msg = parseIncomingMessage({ v: PROTOCOL_VERSION, t: 'hello', caps });
	assert.ok(msg && msg.t === 'hello');
	assert.ok((msg.caps ?? []).length <= 16);
	assert.equal(new Set(msg.caps).size, (msg.caps ?? []).length);
});

test('isOriginAllowed: same origin, allowlist, and localhost policy', () => {
	const same = 'https://example.test';
	withWindow(same, () => {
		assert.equal(isOriginAllowed(same), true);
		assert.equal(isOriginAllowed('https://dragon-gaming-platforms.github.io'), true);
		assert.equal(isOriginAllowed('https://evil.example'), false);
		// Arena preview pattern
		assert.equal(isOriginAllowed('https://1-abc.e2b.app'), true);
		// Localhost only when DEV is enabled in the bundle under test.
		assert.equal(isOriginAllowed('http://localhost:5173'), ALLOW_LOCALHOST_PARENTS);
		assert.equal(isOriginAllowed('http://127.0.0.1:3000'), ALLOW_LOCALHOST_PARENTS);
	});
});

test('parseFsResponse enforces size and tree caps', () => {
	const ok = parseFsResponse({
		v: 2,
		t: 'fs-res',
		id: 1,
		ok: true,
		data: new Uint8Array(8)
	});
	assert.ok(ok);

	const tooBig = parseFsResponse({
		v: 2,
		t: 'fs-res',
		id: 1,
		ok: true,
		data: new Uint8Array(FS_MAX_BYTES + 1)
	});
	assert.equal(tooBig, null);

	const tree = Array.from({ length: FS_MAX_TREE_ENTRIES + 1 }, (_, i) => ({
		path: `f${i}`,
		isDir: false,
		size: 0,
		mtime: 0
	}));
	assert.equal(parseFsResponse({ v: 2, t: 'fs-res', id: 1, ok: true, tree }), null);

	assert.equal(parseFsResponse({ v: 2, t: 'fs-res', id: 'x', ok: true }), null);
	assert.equal(parseFsResponse({ v: 1, t: 'fs-res', id: 1, ok: true }), null);
});

test('parseFsRequest only allows known ops and rejects non-byte data', () => {
	const write = parseFsRequest({
		v: 2,
		t: 'fs-req',
		id: 3,
		op: 'write',
		path: '/home/user/x',
		data: new Uint8Array([1, 2, 3])
	});
	assert.ok(write);

	assert.equal(parseFsRequest({ v: 2, t: 'fs-req', id: 1, op: 'exec' }), null);
	assert.equal(parseFsRequest({ v: 2, t: 'fs-req', id: 1, op: 'write', data: 'not-bytes' }), null);
});
