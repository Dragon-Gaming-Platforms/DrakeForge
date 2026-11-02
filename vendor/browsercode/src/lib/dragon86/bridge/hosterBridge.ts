/**
 * Hoster side of bridge protocol v1 — adapted from Cheerpx-Bridge.
 *
 * `ready` is sent only after a peer said hello AND the BrowserPod shell is
 * booted/streaming. Output is batched and the first prompt is replayed after
 * the handshake. fs1 capability changes re-announce ready.
 */
import { BACKLOG_MAX_BYTES, FLUSH_INTERVAL_MS, FLUSH_MAX_BYTES, PROTOCOL_VERSION } from './config';
import type { BridgeTransport } from './transport';
import type { IncomingMessage } from './protocol';

export interface BridgeEngine {
	write(data: string): void;
	resize(cols: number, rows: number): void;
}

export interface BridgeHooks {
	onPeerReady?: () => void;
	onPeerCaps?: (caps: string[]) => void;
	getReadyCaps?: () => string[];
}

export class HosterBridge {
	private readonly decoder = new TextDecoder('utf-8');
	private pending: Uint8Array[] = [];
	private pendingBytes = 0;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private engineReady = false;
	private peerSeen = false;
	private peerCaps = new Set<string>();
	private announcedReady = false;
	private lastReadyAt = 0;
	private exited = false;

	constructor(
		private readonly transport: BridgeTransport,
		private readonly engine: BridgeEngine,
		private readonly hooks: BridgeHooks = {}
	) {
		transport.onMessage((msg) => this.handle(msg));
	}

	acceptOutput(bytes: Uint8Array): void {
		if (bytes.length === 0 || this.exited) return;
		this.pending.push(bytes);
		this.pendingBytes += bytes.length;
		if (!this.announcedReady) {
			while (this.pendingBytes > BACKLOG_MAX_BYTES && this.pending.length > 1) {
				this.pendingBytes -= this.pending.shift()!.length;
			}
			return;
		}
		if (this.pendingBytes >= FLUSH_MAX_BYTES) this.flush();
		else this.scheduleFlush();
	}

	markEngineReady(): void {
		if (this.engineReady) return;
		this.engineReady = true;
		this.maybeAnnounceReady();
	}

	acceptExit(code: number): void {
		if (this.exited) return;
		this.exited = true;
		if (!this.announcedReady) return;
		this.flush(true);
		this.transport.send({ v: PROTOCOL_VERSION, t: 'exit', code });
	}

	refreshReady(): void {
		if (!this.announcedReady || this.exited) return;
		this.lastReadyAt = performance.now();
		this.sendReady();
		this.hooks.onPeerReady?.();
	}

	get connected(): boolean {
		return this.announcedReady && !this.exited;
	}

	private handle(msg: IncomingMessage): void {
		switch (msg.t) {
			case 'hello':
				this.peerSeen = true;
				this.notePeerCaps(msg.caps ?? []);
				this.maybeAnnounceReady();
				break;
			case 'data':
				if (!this.exited) this.engine.write(msg.d);
				break;
			case 'resize':
				if (!this.exited) this.engine.resize(msg.cols, msg.rows);
				break;
		}
	}

	private maybeAnnounceReady(): void {
		if (!this.engineReady || !this.peerSeen || this.exited) return;
		const now = performance.now();
		if (this.announcedReady && now - this.lastReadyAt < 300) return;
		const first = !this.announcedReady;
		this.announcedReady = true;
		this.lastReadyAt = now;
		this.sendReady();
		this.hooks.onPeerReady?.();
		if (first) this.flush();
	}

	private sendReady(): void {
		const live = this.hooks.getReadyCaps?.() ?? [];
		const caps = live.filter((cap) => this.peerCaps.has(cap));
		this.transport.send(
			caps.length > 0
				? { v: PROTOCOL_VERSION, t: 'ready', caps }
				: { v: PROTOCOL_VERSION, t: 'ready' }
		);
	}

	private notePeerCaps(caps: string[]): void {
		const next = new Set(caps);
		const changed =
			next.size !== this.peerCaps.size || [...next].some((c) => !this.peerCaps.has(c));
		this.peerCaps = next;
		if (changed) this.hooks.onPeerCaps?.([...next]);
	}

	private scheduleFlush(): void {
		if (this.flushTimer !== null) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			this.flush();
		}, FLUSH_INTERVAL_MS);
	}

	private flush(final = false): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		if (this.pending.length === 0 && !final) return;
		let text = '';
		for (const chunk of this.pending) text += this.decoder.decode(chunk, { stream: true });
		this.pending = [];
		this.pendingBytes = 0;
		if (final) text += this.decoder.decode();
		if (text.length > 0 && this.announcedReady) {
			this.transport.send({ v: PROTOCOL_VERSION, t: 'data', d: text });
		}
	}
}
