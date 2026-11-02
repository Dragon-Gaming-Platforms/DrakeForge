/** Typed fs1 request/response client — adapted from Cheerpx-Bridge src/fs/fsClient.ts. */
import { FS_PROTOCOL_VERSION, FS_REQUEST_TIMEOUT_MS } from './config';
import type {
	FsEntry,
	FsOp,
	FsRequestMessage,
	FsResponseMessage,
	FsStat,
	FsTreeEntry
} from './protocol';
import type { BridgeTransport } from './transport';

export class FsError extends Error {
	constructor(readonly code: string) {
		super(code);
		this.name = 'FsError';
	}
}

interface PendingRequest {
	resolve: (res: FsResponseMessage) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class FsClient {
	private readonly pending = new Map<number, PendingRequest>();
	private counter = 0;
	private readonly salt = Math.floor(Math.random() * 2 ** 31);
	private closed = false;

	constructor(
		private readonly transport: BridgeTransport,
		private readonly timeoutMs: number = FS_REQUEST_TIMEOUT_MS
	) {
		transport.onFsMessage((msg) => this.onResponse(msg));
	}

	async request(
		op: FsOp,
		opts: { path?: string; to?: string; data?: Uint8Array } = {}
	): Promise<FsResponseMessage> {
		if (this.closed) throw new FsError('ECLOSED');
		const id = this.salt + ++this.counter;
		const msg: FsRequestMessage = { v: FS_PROTOCOL_VERSION, t: 'fs-req', id, op };
		if (opts.path !== undefined) msg.path = opts.path;
		if (opts.to !== undefined) msg.to = opts.to;
		if (opts.data !== undefined) msg.data = opts.data;
		return new Promise<FsResponseMessage>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new FsError('ETIMEOUT'));
			}, this.timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.transport.sendFs(msg);
		});
	}

	async list(path: string): Promise<FsEntry[]> {
		return (await this.request('list', { path })).entries ?? [];
	}
	async tree(path = '/'): Promise<FsTreeEntry[]> {
		return (await this.request('tree', { path })).tree ?? [];
	}
	async read(path: string): Promise<Uint8Array> {
		const res = await this.request('read', { path });
		if (res.data === undefined) throw new FsError('EPROTO: read without data');
		return res.data;
	}
	async write(path: string, data: Uint8Array): Promise<FsStat | null> {
		return (await this.request('write', { path, data })).stat ?? null;
	}
	async mkdir(path: string): Promise<FsStat | null> {
		return (await this.request('mkdir', { path })).stat ?? null;
	}
	async remove(path: string): Promise<void> {
		await this.request('remove', { path });
	}
	async rename(from: string, to: string): Promise<FsStat | null> {
		return (await this.request('rename', { path: from, to })).stat ?? null;
	}
	async stat(path: string): Promise<FsStat> {
		const res = await this.request('stat', { path });
		if (res.stat === undefined) throw new FsError('EPROTO: stat without stat');
		return res.stat;
	}
	close(): void {
		this.closed = true;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new FsError('ECLOSED'));
		}
		this.pending.clear();
	}
	private onResponse(msg: FsResponseMessage): void {
		const pending = this.pending.get(msg.id);
		if (pending === undefined) return;
		this.pending.delete(msg.id);
		clearTimeout(pending.timer);
		if (msg.ok) pending.resolve(msg);
		else pending.reject(new FsError(msg.error ?? 'EIO'));
	}
}
