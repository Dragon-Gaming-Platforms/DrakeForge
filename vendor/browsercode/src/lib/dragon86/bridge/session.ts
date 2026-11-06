/**
 * Session routing for the Dragon86 bridge.
 *
 * A Dragon86 agent can now assign each DrakeForge engine tab its own
 * BroadcastChannel via `?channel=dragon86-drakeforge-<uuid>`. Embedded frames
 * must never open a BroadcastChannel; they use parent-frame postMessage only.
 * Without a session channel, separate tabs keep the original Cheerpx-Bridge
 * channel for backward compatibility.
 */
import { BROADCAST_CHANNEL_NAME, normalizeSessionChannel } from './config';
import {
	BroadcastChannelTransport,
	CompositeTransport,
	PostMessageTransport,
	type BridgeTransport
} from './transport';

export type BridgeSessionMode = 'embedded' | 'separate';

export interface BridgeSessionConfig {
	mode: BridgeSessionMode;
	/** BroadcastChannel to use, or null in embedded mode. */
	channelName: string | null;
	dedicated: boolean;
	/** Raw agent-supplied channel, kept for status reporting. */
	sessionChannel: string | null;
	label: string;
}

export interface BridgeRuntime {
	transport: BridgeTransport;
	channelNames: string[];
	usesPostMessage: boolean;
	usesBroadcast: boolean;
	broadcastAvailable: boolean;
	status: string;
}

export interface BridgeTransportHooks {
	onPeer?: (text: string) => void;
}

/** Resolve the URL contract into exactly one session policy. */
export function resolveBridgeSession(params: URLSearchParams): BridgeSessionConfig {
	const embedded = params.get('mode') === 'embed';
	const rawChannel = params.get('channel');

	if (embedded) {
		return {
			mode: 'embedded',
			channelName: null,
			dedicated: false,
			sessionChannel: rawChannel,
			label: 'Embedded postMessage session — BroadcastChannel disabled'
		};
	}

	const sessionChannel = normalizeSessionChannel(rawChannel);
	if (sessionChannel !== null) {
		return {
			mode: 'separate',
			channelName: sessionChannel,
			dedicated: true,
			sessionChannel,
			label: `Dedicated session channel ${sessionChannel}`
		};
	}

	return {
		mode: 'separate',
		channelName: BROADCAST_CHANNEL_NAME,
		dedicated: false,
		sessionChannel: null,
		label: `Default Cheerpx-Bridge channel ${BROADCAST_CHANNEL_NAME}`
	};
}

/**
 * Build the transport for one session. Dedicated sessions open ONLY their
 * assigned channel; embedded sessions open ONLY postMessage; the default
 * separate session keeps both postMessage and the legacy BroadcastChannel.
 */
export function createBridgeTransport(
	config: BridgeSessionConfig,
	hooks: BridgeTransportHooks = {}
): BridgeRuntime {
	if (config.mode === 'embedded') {
		const transport = new PostMessageTransport((origin) =>
			hooks.onPeer?.(`Embedded peer hello from ${origin}`)
		);
		return {
			transport,
			channelNames: [],
			usesPostMessage: true,
			usesBroadcast: false,
			broadcastAvailable: false,
			status: config.label
		};
	}

	if (config.dedicated && config.channelName !== null) {
		const transport = new BroadcastChannelTransport(config.channelName, () =>
			hooks.onPeer?.(`Separate-tab peer hello on ${config.channelName}`)
		);
		return {
			transport,
			channelNames: [config.channelName],
			usesPostMessage: false,
			usesBroadcast: true,
			broadcastAvailable: transport.available,
			status: config.label
		};
	}

	const frameTransport = new PostMessageTransport((origin) =>
		hooks.onPeer?.(`Embedded peer hello from ${origin}`)
	);
	const tabTransport = new BroadcastChannelTransport(BROADCAST_CHANNEL_NAME, () =>
		hooks.onPeer?.('Separate-tab peer hello on the default channel')
	);
	return {
		transport: new CompositeTransport([frameTransport, tabTransport]),
		channelNames: [BROADCAST_CHANNEL_NAME],
		usesPostMessage: true,
		usesBroadcast: true,
		broadcastAvailable: tabTransport.available,
		status: config.label
	};
}
