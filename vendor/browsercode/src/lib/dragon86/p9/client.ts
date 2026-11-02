/**
 * Minimal 9p2000.L client for the standalone Worker.
 *
 * It speaks the exact wire subset implemented by Dragon86's createP9Handler
 * (../server.ts). Only path-oriented, whole-file operations are needed by
 * RemoteFs; there is no Linux mount, fid cache, or kernel client here.
 */

export interface P9Transport {
	/** Send one request frame and resolve with its one response frame. */
	send(request: Uint8Array): Promise<Uint8Array>;
	close(): void;
}

export class P9Error extends Error {
	readonly code: string;
	constructor(
		readonly errno: number,
		message?: string
	) {
		super(message ?? errnoName(errno));
		this.name = 'P9Error';
		this.code = errnoName(errno);
	}
}

const ENOENT = 2;
const EPERM = 1;
const EIO = 5;
const EEXIST = 17;
const ENOTDIR = 20;
const EISDIR = 21;
const EINVAL = 22;
const ENOTEMPTY = 39;
const ENOSYS = 38;
const ENOTSUP = 95;

function errnoName(errno: number): string {
	switch (errno) {
		case EPERM:
			return 'EPERM';
		case ENOENT:
			return 'ENOENT';
		case EIO:
			return 'EIO';
		case EEXIST:
			return 'EEXIST';
		case ENOTDIR:
			return 'ENOTDIR';
		case EISDIR:
			return 'EISDIR';
		case EINVAL:
			return 'EINVAL';
		case ENOSYS:
			return 'ENOSYS';
		case ENOTEMPTY:
			return 'ENOTEMPTY';
		case ENOTSUP:
			return 'ENOTSUP';
		default:
			return `E${errno}`;
	}
}

const MSIZE = 262144;
const IOUNIT = MSIZE - 64;
const ROOT_FID = 0;
const NOFID = 0xffffffff;
const O_WRONLY = 1;
const O_TRUNC = 0x200;
const AT_REMOVEDIR = 0x200;
const QTDIR = 0x80;
const GETATTR_ALL = 0x7ff;

class Reader {
	private readonly view: DataView;
	off = 0;
	constructor(private readonly buf: Uint8Array) {
		this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	}
	u8(): number {
		const value = this.view.getUint8(this.off);
		this.off += 1;
		return value;
	}
	u16(): number {
		const value = this.view.getUint16(this.off, true);
		this.off += 2;
		return value;
	}
	u32(): number {
		const value = this.view.getUint32(this.off, true);
		this.off += 4;
		return value;
	}
	u64(): number {
		const value = Number(this.view.getBigUint64(this.off, true));
		this.off += 8;
		return value;
	}
	str(): string {
		const length = this.u16();
		const value = new TextDecoder().decode(this.buf.subarray(this.off, this.off + length));
		this.off += length;
		return value;
	}
	bytes(length: number): Uint8Array {
		const value = this.buf.subarray(this.off, this.off + length);
		this.off += length;
		return value;
	}
	get done(): boolean {
		return this.off >= this.buf.byteLength;
	}
}

class Writer {
	private readonly chunks: number[] = [];
	u8(value: number): this {
		this.chunks.push(value & 0xff);
		return this;
	}
	u16(value: number): this {
		this.chunks.push(value & 0xff, (value >> 8) & 0xff);
		return this;
	}
	u32(value: number): this {
		this.chunks.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
		return this;
	}
	u64(value: number): this {
		let remaining = BigInt(Math.trunc(value));
		for (let i = 0; i < 8; i++) {
			this.chunks.push(Number(remaining & 0xffn));
			remaining >>= 8n;
		}
		return this;
	}
	str(value: string): this {
		const bytes = new TextEncoder().encode(value);
		this.u16(bytes.length);
		for (const byte of bytes) this.chunks.push(byte);
		return this;
	}
	raw(bytes: Uint8Array): this {
		for (const byte of bytes) this.chunks.push(byte);
		return this;
	}
	build(type: number, tag: number): Uint8Array {
		const body = new Uint8Array(this.chunks);
		const out = new Uint8Array(7 + body.length);
		const view = new DataView(out.buffer);
		view.setUint32(0, out.length, true);
		view.setUint8(4, type);
		view.setUint16(5, tag, true);
		out.set(body, 7);
		return out;
	}
}

interface Qid {
	type: number;
	version: number;
	path: number;
}
interface DirEntry {
	name: string;
	isDir: boolean;
}

function readQid(reader: Reader): Qid {
	return { type: reader.u8(), version: reader.u32(), path: reader.u64() };
}

function splitPath(path: string): string[] {
	const normalized = path.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
	if (normalized === '') return [];
	const parts = normalized.split('/');
	if (parts.some((part) => part === '..' || part === '.' || part.includes('\0'))) {
		throw new Error(`Unsafe 9p path: ${path}`);
	}
	return parts;
}

function parentOf(path: string): string {
	const parts = splitPath(path);
	parts.pop();
	return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

function baseName(path: string): string {
	const parts = splitPath(path);
	if (parts.length === 0) throw new Error('Cannot take the name of the 9p root');
	return parts[parts.length - 1];
}

function joinPath(base: string, name: string): string {
	return base === '/' ? `/${name}` : `${base}/${name}`;
}

function concatBytes(chunks: readonly Uint8Array[], length: number): Uint8Array {
	const out = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

function isEnoent(error: unknown): boolean {
	return error instanceof P9Error && error.errno === ENOENT;
}

/** Parse the server's serialized Rreaddir payload. */
function parseDirData(data: Uint8Array): { entries: DirEntry[]; nextOffset: number } {
	const reader = new Reader(data);
	const entries: DirEntry[] = [];
	let nextOffset = 0;
	while (!reader.done) {
		const qid = readQid(reader);
		nextOffset = reader.u64();
		const dtype = reader.u8();
		const name = reader.str();
		if (name === '' || name === '.' || name === '..') continue;
		entries.push({ name, isDir: dtype === 4 || (qid.type & QTDIR) !== 0 });
	}
	return { entries, nextOffset };
}

export class P9Client {
	private tag = 0;
	private nextFid = 1;
	private connected = false;
	private iounit = IOUNIT;

	constructor(private readonly transport: P9Transport) {}

	async connect(): Promise<void> {
		if (this.connected) return;
		const version = await this.transact(100, (w) => w.u32(MSIZE).str('9P2000.L'));
		const versionReader = this.responseReader(version, 101);
		const msize = versionReader.u32();
		const versionString = versionReader.str();
		if (!versionString.includes('2000.L')) {
			throw new Error(`9p server did not negotiate 9P2000.L (got ${versionString})`);
		}
		this.iounit = Math.min(msize, MSIZE) - 64;
		const attach = await this.transact(104, (w) =>
			w.u32(ROOT_FID).u32(NOFID).str('drakeforge').str('').u32(1000)
		);
		this.responseReader(attach, 105);
		this.connected = true;
	}

	async stat(path: string): Promise<{ isDir: boolean; size: number; mtime: number }> {
		this.assertConnected();
		return this.withFid(path, async (fid) => {
			const response = await this.transact(24, (w) => w.u32(fid).u64(GETATTR_ALL));
			const r = this.responseReader(response, 25);
			r.u64(); // valid
			const qid = readQid(r);
			r.u32(); // mode
			r.u32(); // uid
			r.u32(); // gid
			r.u64(); // nlink
			r.u64(); // rdev
			const size = r.u64();
			r.u64(); // blksize
			r.u64(); // blocks
			r.u64(); // atime sec
			r.u64(); // atime nsec
			const mtimeSec = r.u64();
			const mtimeNsec = r.u64();
			return {
				isDir: (qid.type & QTDIR) !== 0,
				size,
				mtime: mtimeSec * 1000 + mtimeNsec / 1e6
			};
		});
	}

	async readdir(path: string): Promise<DirEntry[]> {
		this.assertConnected();
		return this.withFid(path, async (fid) => {
			await this.lopen(fid, 0);
			const entries: DirEntry[] = [];
			let offset = 0;
			for (;;) {
				const response = await this.transact(40, (w) => w.u32(fid).u64(offset).u32(this.iounit));
				const r = this.responseReader(response, 41);
				const count = r.u32();
				const data = r.bytes(count);
				if (data.byteLength === 0) break;
				const parsed = parseDirData(data);
				if (parsed.entries.length === 0) break;
				entries.push(...parsed.entries);
				offset = parsed.nextOffset;
			}
			return entries;
		});
	}

	async readFile(path: string): Promise<Uint8Array> {
		this.assertConnected();
		return this.withFid(path, async (fid) => {
			const iounit = await this.lopen(fid, 0);
			const chunks: Uint8Array[] = [];
			let total = 0;
			let offset = 0;
			for (;;) {
				const response = await this.transact(116, (w) => w.u32(fid).u64(offset).u32(iounit));
				const r = this.responseReader(response, 117);
				const count = r.u32();
				const data = r.bytes(count);
				if (data.byteLength === 0) break;
				// Copy: the frame buffer belongs to the transport and may be reused.
				chunks.push(new Uint8Array(data));
				total += data.byteLength;
				offset += data.byteLength;
			}
			return concatBytes(chunks, total);
		});
	}

	async writeFile(path: string, data: Uint8Array): Promise<void> {
		this.assertConnected();
		const parent = parentOf(path);
		await this.mkdirp(parent);
		await this.withFid(parent, async (fid) => {
			const iounit = await this.lcreate(fid, baseName(path), O_WRONLY | O_TRUNC, 0o644, 0);
			let offset = 0;
			while (offset < data.byteLength) {
				const chunk = data.subarray(offset, Math.min(offset + iounit, data.byteLength));
				const response = await this.transact(118, (w) =>
					w.u32(fid).u64(offset).u32(chunk.byteLength).raw(chunk)
				);
				const r = this.responseReader(response, 119);
				const written = r.u32();
				if (written <= 0) throw new P9Error(EIO, 'short 9p write');
				offset += written;
			}
		});
	}

	async mkdirp(path: string): Promise<void> {
		this.assertConnected();
		if (path === '/') return;
		try {
			const stat = await this.stat(path);
			if (stat.isDir) return;
			throw new P9Error(EEXIST, `${path} exists and is not a directory`);
		} catch (error) {
			if (!isEnoent(error)) throw error;
			await this.mkdirp(parentOf(path));
			await this.withFid(parentOf(path), async (fid) => {
				const response = await this.transact(72, (w) =>
					w.u32(fid).str(baseName(path)).u32(0o755).u32(0)
				);
				this.responseReader(response, 73);
			});
		}
	}

	async remove(path: string): Promise<void> {
		this.assertConnected();
		let stat: { isDir: boolean };
		try {
			stat = await this.stat(path);
		} catch (error) {
			if (isEnoent(error)) return;
			throw error;
		}
		if (stat.isDir) {
			for (const child of await this.readdir(path)) {
				await this.remove(joinPath(path, child.name));
			}
		}
		const parent = parentOf(path);
		await this.withFid(parent, async (fid) => {
			const response = await this.transact(76, (w) =>
				w
					.u32(fid)
					.str(baseName(path))
					.u32(stat.isDir ? AT_REMOVEDIR : 0)
			);
			this.responseReader(response, 77);
		});
	}

	async rename(from: string, to: string): Promise<void> {
		this.assertConnected();
		const oldParent = parentOf(from);
		const newParent = parentOf(to);
		await this.mkdirp(newParent);
		const oldFid = this.allocFid();
		const newFid = this.allocFid();
		try {
			const oldParts = splitPath(oldParent);
			const newParts = splitPath(newParent);
			await this.walk(ROOT_FID, oldFid, oldParts);
			await this.walk(ROOT_FID, newFid, newParts);
			const response = await this.transact(74, (w) =>
				w.u32(oldFid).str(baseName(from)).u32(newFid).str(baseName(to))
			);
			this.responseReader(response, 75);
		} finally {
			await this.clunk(oldFid).catch(() => undefined);
			await this.clunk(newFid).catch(() => undefined);
		}
	}

	close(): void {
		this.connected = false;
		this.transport.close();
	}

	private assertConnected(): void {
		if (!this.connected) throw new Error('9p client is not attached');
	}

	private allocFid(): number {
		return this.nextFid++;
	}

	private async withFid<T>(path: string, fn: (fid: number) => Promise<T>): Promise<T> {
		const fid = this.allocFid();
		try {
			const parts = splitPath(path);
			const qids = await this.walk(ROOT_FID, fid, parts);
			if (qids.length !== parts.length) throw new P9Error(ENOENT);
			return await fn(fid);
		} finally {
			await this.clunk(fid).catch(() => undefined);
		}
	}

	private async transact(type: number, body: (writer: Writer) => void): Promise<Uint8Array> {
		const tag = this.tag++ & 0xffff;
		const writer = new Writer();
		body(writer);
		return this.transport.send(writer.build(type, tag));
	}

	private responseReader(response: Uint8Array, expected: number): Reader {
		const reader = new Reader(response);
		reader.u32(); // size
		const type = reader.u8();
		reader.u16(); // tag
		if (type === 7) throw new P9Error(reader.u32());
		if (type !== expected) {
			throw new Error(`Unexpected 9p response type ${type}; expected ${expected}`);
		}
		return reader;
	}

	private async walk(fid: number, newFid: number, names: readonly string[]): Promise<Qid[]> {
		const response = await this.transact(110, (w) => {
			w.u32(fid).u32(newFid).u16(names.length);
			for (const name of names) w.str(name);
		});
		const r = this.responseReader(response, 111);
		const count = r.u16();
		const qids: Qid[] = [];
		for (let i = 0; i < count; i++) qids.push(readQid(r));
		return qids;
	}

	private async lopen(fid: number, flags: number): Promise<number> {
		const response = await this.transact(12, (w) => w.u32(fid).u32(flags));
		const r = this.responseReader(response, 13);
		readQid(r);
		const iounit = r.u32();
		return iounit > 0 ? Math.min(iounit, this.iounit) : this.iounit;
	}

	private async lcreate(
		fid: number,
		name: string,
		flags: number,
		mode: number,
		gid: number
	): Promise<number> {
		const response = await this.transact(14, (w) =>
			w.u32(fid).str(name).u32(flags).u32(mode).u32(gid)
		);
		const r = this.responseReader(response, 15);
		readQid(r);
		const iounit = r.u32();
		return iounit > 0 ? Math.min(iounit, this.iounit) : this.iounit;
	}

	private async clunk(fid: number): Promise<void> {
		const response = await this.transact(120, (w) => w.u32(fid));
		this.responseReader(response, 121);
	}
}
