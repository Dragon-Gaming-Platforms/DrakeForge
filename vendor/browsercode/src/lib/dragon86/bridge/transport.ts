/**
 * Transports for bridge protocol v1 + fs1. Adapted from Cheerpx-Bridge.
 *
 * One HosterBridge sits behind a CompositeTransport so an embedded Dragon86
 * parent and a separate Dragon86 tab can use the same BrowserPod shell.
 */
import {
	isOriginAllowed,
	parseFsResponse,
	parseIncomingMessage,
	type FsRequestMessage,
	type FsResponseMessage,
	type IncomingMessage,
	type OutgoingMessage
} from './protocol';
import { BROADCAST_CHANNEL_NAME, FS_PROTOCOL_VERSION } from './config';

export interface BridgeTransport {
	send(msg: OutgoingMessage): void;
	onMessage(handler: (msg: IncomingMessage) => void): void;
	sendFs(msg: FsRequestMessage): void;
	onFsMessage(handler: (msg: FsResponseMessage) => void): void;
	close(): void;
}

/** postMessage with the direct parent frame of an embedded hoster. */
export class PostMessageTransport implements BridgeTransport {
	private handler: ((msg: IncomingMessage) => void) | null = null;
	private fsHandler: ((msg: FsResponseMessage) => void) | null = null;
	private peerOrigin: string | null = null;
	private readonly warnedOrigins = new Set<string>();
	private readonly onWindowMessage = (ev: MessageEvent) => this.handle(ev);

	constructor(private readonly onPeerOrigin?: (origin: string) => void) {
		window.addEventListener('message', this.onWindowMessage);
	}

	onMessage(handler: (msg: IncomingMessage) => void): void {
		this.handler = handler;
	}
	onFsMessage(handler: (msg: FsResponseMessage) => void): void {
		this.fsHandler = handler;
	}
	send(msg: OutgoingMessage): void {
		if (this.peerOrigin === null || window.parent === window) return;
		window.parent.postMessage(msg, this.peerOrigin);
	}
	sendFs(msg: FsRequestMessage): void {
		if (this.peerOrigin === null || window.parent === window) return;
		window.parent.postMessage(msg, this.peerOrigin);
	}
	close(): void {
		window.removeEventListener('message', this.onWindowMessage);
	}

	private handle(ev: MessageEvent): void {
		if (window.parent === window || ev.source !== window.parent) return;
		if (!isOriginAllowed(ev.origin)) {
			this.warnRejectedHello(ev);
			return;
		}
		if ((ev.data as { v?: unknown } | null)?.v === FS_PROTOCOL_VERSION) {
			const fsMsg = parseFsResponse(ev.data);
			if (fsMsg !== null) this.fsHandler?.(fsMsg);
			return;
		}
		const msg = parseIncomingMessage(ev.data);
		if (msg === null) return;
		if (this.peerOrigin === null) {
			this.peerOrigin = ev.origin;
			this.onPeerOrigin?.(ev.origin);
		}
		this.handler?.(msg);
	}

	private warnRejectedHello(ev: MessageEvent): void {
		if (parseIncomingMessage(ev.data)?.t !== 'hello') return;
		if (this.warnedOrigins.has(ev.origin)) return;
		this.warnedOrigins.add(ev.origin);
		console.warn(`[drakeforge] Ignoring bridge hello from non-allowlisted origin "${ev.origin}".`);
	}
}

const BC_HOSTER_VIA = 'bc-hoster';

function isHosterChannelMessage(raw: unknown): boolean {
	return (
		typeof raw === 'object' &&
		raw !== null &&
		(raw as Record<string, unknown>).via === BC_HOSTER_VIA
	);
}

/** Same-origin BroadcastChannel used when Dragon86 opens us as a separate tab. */
export class BroadcastChannelTransport implements BridgeTransport {
	private handler: ((msg: IncomingMessage) => void) | null = null;
	private fsHandler: ((msg: FsResponseMessage) => void) | null = null;
	private readonly channel: BroadcastChannel | null;
	private readonly onChannelMessage = (ev: MessageEvent) => this.handle(ev);
	readonly available: boolean;

	constructor(
		channelName: string = BROADCAST_CHANNEL_NAME,
		private readonly onHello?: () => void
	) {
		try {
			this.channel =
				typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName);
		} catch {
			this.channel = null;
		}
		this.available = this.channel !== null;
		this.channel?.addEventListener('message', this.onChannelMessage);
	}

	onMessage(handler: (msg: IncomingMessage) => void): void {
		this.handler = handler;
	}
	onFsMessage(handler: (msg: FsResponseMessage) => void): void {
		this.fsHandler = handler;
	}
	send(msg: OutgoingMessage): void {
		this.channel?.postMessage({ ...msg, via: BC_HOSTER_VIA });
	}
	sendFs(msg: FsRequestMessage): void {
		this.channel?.postMessage({ ...msg, via: BC_HOSTER_VIA });
	}
	close(): void {
		this.channel?.removeEventListener('message', this.onChannelMessage);
		this.channel?.close();
	}

	private handle(ev: MessageEvent): void {
		if (isHosterChannelMessage(ev.data)) return;
		const msg = parseIncomingMessage(ev.data);
		if (msg !== null) {
			if (msg.t === 'hello') this.onHello?.();
			this.handler?.(msg);
			return;
		}
		const fsMsg = parseFsResponse(ev.data);
		if (fsMsg !== null) this.fsHandler?.(fsMsg);
	}
}

/** Fan-out: one bridge/engine, several transports. */
export class CompositeTransport implements BridgeTransport {
	constructor(private readonly transports: readonly BridgeTransport[]) {}
	send(msg: OutgoingMessage): void {
		for (const transport of this.transports) transport.send(msg);
	}
	sendFs(msg: FsRequestMessage): void {
		for (const transport of this.transports) transport.sendFs(msg);
	}
	onMessage(handler: (msg: IncomingMessage) => void): void {
		for (const transport of this.transports) transport.onMessage(handler);
	}
	onFsMessage(handler: (msg: FsResponseMessage) => void): void {
		for (const transport of this.transports) transport.onFsMessage(handler);
	}
	close(): void {
		for (const transport of this.transports) transport.close();
	}
}

/** In-page transport for tests and the standalone status harness. */
export class LoopbackTransport implements BridgeTransport {
	private handler: ((msg: IncomingMessage) => void) | null = null;
	private fsHandler: ((msg: FsResponseMessage) => void) | null = null;
	private peerHandler: ((msg: OutgoingMessage) => void) | null = null;
	private peerFsHandler: ((msg: FsRequestMessage) => void) | null = null;

	send(msg: OutgoingMessage): void {
		this.peerHandler?.(structuredClone(msg));
	}
	sendFs(msg: FsRequestMessage): void {
		this.peerFsHandler?.(structuredClone(msg));
	}
	onMessage(handler: (msg: IncomingMessage) => void): void {
		this.handler = handler;
	}
	onFsMessage(handler: (msg: FsResponseMessage) => void): void {
		this.fsHandler = handler;
	}
	onPeerMessage(handler: (msg: OutgoingMessage) => void): void {
		this.peerHandler = handler;
	}
	onPeerFsMessage(handler: (msg: FsRequestMessage) => void): void {
		this.peerFsHandler = handler;
	}
	sendToHoster(raw: unknown): void {
		const msg = parseIncomingMessage(structuredClone(raw));
		if (msg !== null) this.handler?.(msg);
	}
	sendFsToHoster(raw: unknown): void {
		const msg = parseFsResponse(structuredClone(raw));
		if (msg !== null) this.fsHandler?.(msg);
	}
	close(): void {
		this.handler = this.fsHandler = this.peerHandler = this.peerFsHandler = null;
	}
}
