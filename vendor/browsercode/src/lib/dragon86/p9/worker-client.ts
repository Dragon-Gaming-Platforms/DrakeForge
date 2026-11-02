/** Browser-side transport and factory for the standalone 9p Worker. */
import { P9Client, type P9Transport } from './client';

type WorkerReply =
	| { type: 'ready'; root: string }
	| { type: 'error'; message: string }
	| { type: '9p:response'; id: number; bytes: ArrayBuffer }
	| { type: '9p:error'; id: number; message: string };

class WorkerP9Transport implements P9Transport {
	private readonly pending = new Map<
		number,
		{ resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }
	>();
	private counter = 0;

	constructor(private readonly worker: Worker) {
		worker.addEventListener('message', this.onMessage);
		worker.addEventListener('error', this.onError);
	}

	private readonly onMessage = (event: MessageEvent<WorkerReply>): void => {
		const message = event.data;
		if (message.type === '9p:response') {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			pending.resolve(new Uint8Array(message.bytes));
			return;
		}
		if (message.type === '9p:error') {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			pending.reject(new Error(message.message));
		}
	};

	private readonly onError = (event: ErrorEvent): void => {
		for (const pending of this.pending.values()) {
			pending.reject(new Error(event.message || '9p worker crashed'));
		}
		this.pending.clear();
	};

	send(request: Uint8Array): Promise<Uint8Array> {
		const id = ++this.counter;
		const copy = new Uint8Array(request.byteLength);
		copy.set(request);
		return new Promise<Uint8Array>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.worker.postMessage({ type: '9p:request', id, bytes: copy.buffer }, [copy.buffer]);
		});
	}

	close(): void {
		this.worker.removeEventListener('message', this.onMessage);
		this.worker.removeEventListener('error', this.onError);
		for (const pending of this.pending.values()) pending.reject(new Error('9p worker closed'));
		this.pending.clear();
		this.worker.terminate();
	}
}

/** Spawn the Worker, wait for ZenFS to be ready, then negotiate 9P2000.L. */
export async function createStandaloneP9Client(): Promise<P9Client> {
	const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
	await new Promise<void>((resolve, reject) => {
		const onMessage = (event: MessageEvent<WorkerReply>) => {
			if (event.data.type === 'ready') {
				cleanup();
				resolve();
			} else if (event.data.type === 'error') {
				cleanup();
				reject(new Error(event.data.message));
			}
		};
		const onError = (event: ErrorEvent) => {
			cleanup();
			reject(new Error(event.message || '9p worker failed to start'));
		};
		const cleanup = () => {
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('error', onError);
		};
		worker.addEventListener('message', onMessage);
		worker.addEventListener('error', onError);
		worker.postMessage({ type: 'init' });
	});
	const transport = new WorkerP9Transport(worker);
	const client = new P9Client(transport);
	await client.connect();
	return client;
}
