/**
 * Bridge protocol — adapted from Cheerpx-Bridge src/bridge/protocol.ts.
 *
 * Terminal (v1):
 *   OS  → hoster : { v:1, t:"hello", caps? }
 *   hoster → OS  : { v:1, t:"ready", caps? }
 *   OS  → hoster : { v:1, t:"data", d:string }
 *   hoster → OS  : { v:1, t:"data", d:string }
 *   OS  → hoster : { v:1, t:"resize", cols, rows }
 *   hoster → OS  : { v:1, t:"exit", code }
 *
 * Shared filesystem (v2):
 *   hoster → OS  : { v:2, t:"fs-req", id, op, path?, to?, data? }
 *   OS  → hoster : { v:2, t:"fs-res", id, ok, error?, entries?, tree?, data?, stat? }
 */
import {
	ALLOWED_PARENT_ORIGINS,
	ALLOWED_PARENT_ORIGIN_PATTERNS,
	ALLOW_LOCALHOST_PARENTS,
	FS_PROTOCOL_VERSION,
	PROTOCOL_VERSION
} from './config';

export interface HelloMessage {
	v: typeof PROTOCOL_VERSION;
	t: 'hello';
	caps?: string[];
}
export interface ReadyMessage {
	v: typeof PROTOCOL_VERSION;
	t: 'ready';
	caps?: string[];
}
export interface DataMessage {
	v: typeof PROTOCOL_VERSION;
	t: 'data';
	d: string;
}
export interface ResizeMessage {
	v: typeof PROTOCOL_VERSION;
	t: 'resize';
	cols: number;
	rows: number;
}
export interface ExitMessage {
	v: typeof PROTOCOL_VERSION;
	t: 'exit';
	code: number;
}
export type IncomingMessage = HelloMessage | DataMessage | ResizeMessage;
export type OutgoingMessage = ReadyMessage | DataMessage | ExitMessage;

export type FsOp = 'list' | 'tree' | 'read' | 'write' | 'mkdir' | 'remove' | 'rename' | 'stat';
export interface FsEntry {
	name: string;
	isDir: boolean;
	size: number;
	mtime: number;
}
export interface FsTreeEntry {
	path: string;
	isDir: boolean;
	size: number;
	mtime: number;
}
export interface FsStat {
	isDir: boolean;
	size: number;
	mtime: number;
}
export interface FsRequestMessage {
	v: typeof FS_PROTOCOL_VERSION;
	t: 'fs-req';
	id: number;
	op: FsOp;
	path?: string;
	to?: string;
	data?: Uint8Array;
}
export interface FsResponseMessage {
	v: typeof FS_PROTOCOL_VERSION;
	t: 'fs-res';
	id: number;
	ok: boolean;
	error?: string;
	entries?: FsEntry[];
	tree?: FsTreeEntry[];
	data?: Uint8Array;
	stat?: FsStat;
}

const MAX_COLS = 2000;
const MAX_ROWS = 1000;

function clampDimension(value: unknown, max: number): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return Math.min(max, Math.max(1, Math.floor(value)));
}

function sanitizeCaps(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const cap of value) {
		if (typeof cap === 'string' && cap.length > 0 && cap.length <= 32 && !out.includes(cap)) {
			out.push(cap);
			if (out.length >= 16) break;
		}
	}
	return out;
}

/** Validate and normalize an untrusted v1 message from the OS. */
export function parseIncomingMessage(raw: unknown): IncomingMessage | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const msg = raw as Record<string, unknown>;
	if (msg.v !== PROTOCOL_VERSION) return null;
	switch (msg.t) {
		case 'hello': {
			const caps = sanitizeCaps(msg.caps);
			return caps.length > 0
				? { v: PROTOCOL_VERSION, t: 'hello', caps }
				: { v: PROTOCOL_VERSION, t: 'hello' };
		}
		case 'data':
			return typeof msg.d === 'string' ? { v: PROTOCOL_VERSION, t: 'data', d: msg.d } : null;
		case 'resize': {
			const cols = clampDimension(msg.cols, MAX_COLS);
			const rows = clampDimension(msg.rows, MAX_ROWS);
			return cols !== null && rows !== null
				? { v: PROTOCOL_VERSION, t: 'resize', cols, rows }
				: null;
		}
		default:
			return null;
	}
}

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isOriginAllowed(origin: string): boolean {
	if (origin === window.location.origin) return true;
	if (ALLOWED_PARENT_ORIGINS.includes(origin)) return true;
	if (ALLOWED_PARENT_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))) return true;
	return ALLOW_LOCALHOST_PARENTS && LOCALHOST_ORIGIN.test(origin);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function parseStatLike(raw: unknown): FsStat | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const o = raw as Record<string, unknown>;
	if (typeof o.isDir !== 'boolean' || !isFiniteNumber(o.size) || !isFiniteNumber(o.mtime)) {
		return null;
	}
	return { isDir: o.isDir, size: o.size, mtime: o.mtime };
}

function parseEntries(raw: unknown): FsEntry[] | null {
	if (!Array.isArray(raw)) return null;
	const out: FsEntry[] = [];
	for (const item of raw) {
		if (typeof item !== 'object' || item === null) return null;
		const o = item as Record<string, unknown>;
		const stat = parseStatLike(o);
		if (typeof o.name !== 'string' || stat === null) return null;
		out.push({ name: o.name, ...stat });
	}
	return out;
}

function parseTree(raw: unknown): FsTreeEntry[] | null {
	if (!Array.isArray(raw)) return null;
	const out: FsTreeEntry[] = [];
	for (const item of raw) {
		if (typeof item !== 'object' || item === null) return null;
		const o = item as Record<string, unknown>;
		const stat = parseStatLike(o);
		if (typeof o.path !== 'string' || stat === null) return null;
		out.push({ path: o.path, ...stat });
	}
	return out;
}

function asUint8Array(raw: unknown): Uint8Array | null {
	if (raw instanceof Uint8Array) return raw;
	if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
	return null;
}

/** Validate an fs-res from Dragon86. */
export function parseFsResponse(raw: unknown): FsResponseMessage | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const msg = raw as Record<string, unknown>;
	if (msg.v !== FS_PROTOCOL_VERSION || msg.t !== 'fs-res') return null;
	if (!isFiniteNumber(msg.id) || typeof msg.ok !== 'boolean') return null;
	const res: FsResponseMessage = {
		v: FS_PROTOCOL_VERSION,
		t: 'fs-res',
		id: msg.id,
		ok: msg.ok
	};
	if (msg.error !== undefined) {
		if (typeof msg.error !== 'string') return null;
		res.error = msg.error;
	}
	if (msg.entries !== undefined) {
		const entries = parseEntries(msg.entries);
		if (entries === null) return null;
		res.entries = entries;
	}
	if (msg.tree !== undefined) {
		const tree = parseTree(msg.tree);
		if (tree === null) return null;
		res.tree = tree;
	}
	if (msg.data !== undefined) {
		const data = asUint8Array(msg.data);
		if (data === null) return null;
		res.data = data;
	}
	if (msg.stat !== undefined) {
		const stat = parseStatLike(msg.stat);
		if (stat === null) return null;
		res.stat = stat;
	}
	return res;
}

/** Validate an fs-req; used by tests and the loopback harness. */
export function parseFsRequest(raw: unknown): FsRequestMessage | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const msg = raw as Record<string, unknown>;
	if (msg.v !== FS_PROTOCOL_VERSION || msg.t !== 'fs-req') return null;
	if (!isFiniteNumber(msg.id)) return null;
	if (typeof msg.op !== 'string') return null;
	const ops: readonly string[] = [
		'list',
		'tree',
		'read',
		'write',
		'mkdir',
		'remove',
		'rename',
		'stat'
	];
	if (!ops.includes(msg.op)) return null;
	const req: FsRequestMessage = {
		v: FS_PROTOCOL_VERSION,
		t: 'fs-req',
		id: msg.id,
		op: msg.op as FsOp
	};
	if (msg.path !== undefined) {
		if (typeof msg.path !== 'string') return null;
		req.path = msg.path;
	}
	if (msg.to !== undefined) {
		if (typeof msg.to !== 'string') return null;
		req.to = msg.to;
	}
	if (msg.data !== undefined) {
		const data = asUint8Array(msg.data);
		if (data === null) return null;
		req.data = data;
	}
	return req;
}
