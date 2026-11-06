/**
 * BrowserPod-backed hoster for Dragon86.
 *
 * This is the DrakeForge equivalent of Cheerpx-Bridge's index.html: it owns
 * one BrowserPod shell, answers Dragon86's hello with ready, streams terminal
 * I/O, and exposes the fs1 client used to mirror ZenFS files into the IDE.
 */
import type { BrowserPod, Terminal } from '@leaningtech/browserpod';
import { writeToTerminal } from '$lib/pod/fs';
import { FsClient } from './fsClient';
import { HosterBridge } from './hosterBridge';
import {
	createBridgeTransport,
	resolveBridgeSession,
	type BridgeRuntime,
	type BridgeSessionConfig
} from './session';
import { FS_CAP, READY_FALLBACK_MS } from './config';

export interface Dragon86BridgeHooks {
	onState?: (text: string) => void;
	onPeer?: (text: string) => void;
	onFs?: (text: string) => void;
	onSyncIssues?: (issues: unknown[]) => void;
}

export interface Dragon86BridgeOptions {
	session?: BridgeSessionConfig;
}

export class Dragon86Bridge {
	readonly fsClient: FsClient;
	readonly session: BridgeSessionConfig;
	readonly runtime: BridgeRuntime;
	private readonly transport: BridgeRuntime['transport'];
	private readonly bridge: HosterBridge;
	private engine: { write(data: string): void; resize(cols: number, rows: number): void } | null =
		null;
	private readyTimer: ReturnType<typeof setTimeout> | null = null;
	private attached = false;
	private fsLive = false;

	constructor(
		private readonly workdir: string,
		private readonly hooks: Dragon86BridgeHooks = {},
		options: Dragon86BridgeOptions = {}
	) {
		this.session =
			options.session ??
			resolveBridgeSession(
				new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
			);
		const onPeer = (text: string) => this.hooks.onPeer?.(text);
		this.runtime = createBridgeTransport(this.session, { onPeer });
		this.transport = this.runtime.transport;
		this.fsClient = new FsClient(this.transport);
		this.bridge = new HosterBridge(
			this.transport,
			{
				write: (data) => this.engine?.write(data),
				resize: (cols, rows) => this.engine?.resize(cols, rows)
			},
			{
				onPeerReady: () => this.hooks.onState?.('Connected to Dragon86'),
				onPeerCaps: (caps) =>
					this.hooks.onFs?.(caps.includes(FS_CAP) ? 'fs1 offered' : 'no fs1 capability'),
				getReadyCaps: () => (this.fsLive ? [FS_CAP] : [])
			}
		);
		this.hooks.onState?.('Waiting for Dragon86 hello…');
		this.hooks.onPeer?.(
			this.runtime.usesBroadcast && !this.runtime.broadcastAvailable
				? `${this.runtime.status} — BroadcastChannel unavailable`
				: this.runtime.status
		);
	}

	/** Announce fs1 only once the remote tree has answered at least once. */
	setFsLive(live: boolean): void {
		if (this.fsLive === live) return;
		this.fsLive = live;
		this.hooks.onFs?.(live ? 'fs1 live — ZenFS files available' : 'fs1 unavailable');
		if (live) this.bridge.refreshReady();
	}

	/** PodAttachment hook called by PodRuntime.boot once BrowserPod is up. */
	async attach(pod: unknown): Promise<void> {
		if (this.attached) return;
		this.attached = true;
		const browserPod = pod as BrowserPod;
		this.hooks.onState?.('Starting BrowserPod bridge shell…');
		let terminal: Terminal;
		try {
			terminal = await browserPod.createCustomTerminal({
				cols: 80,
				rows: 24,
				onOutput: (chunk) => {
					const bytes = new Uint8Array(chunk);
					this.markShellReady();
					this.bridge.acceptOutput(bytes);
				}
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.hooks.onState?.(`Bridge shell failed: ${message}`);
			return;
		}
		this.engine = {
			write: (data) => writeToTerminal(terminal, data),
			resize: (cols, rows) => {
				const resizable = terminal as Terminal & {
					resize?: (cols: number, rows: number) => void;
				};
				resizable.resize?.(cols, rows);
			}
		};
		this.readyTimer = setTimeout(() => this.markShellReady(), READY_FALLBACK_MS);
		void browserPod
			.run('bash', ['--login'], {
				terminal,
				cwd: this.workdir,
				env: ['HOME=/home/user', 'TERM=xterm', 'USER=user', 'SHELL=/bin/bash']
			})
			.then((result) => this.bridge.acceptExit(exitCodeOf(result)))
			.catch((error: unknown) => {
				console.error('[drakeforge] bridge shell exited', error);
				this.bridge.acceptExit(1);
			});
	}

	shutdown(): void {
		if (this.readyTimer !== null) clearTimeout(this.readyTimer);
		this.readyTimer = null;
		this.fsClient.close();
		this.transport.close();
		this.hooks.onState?.('Bridge stopped');
	}

	private markShellReady(): void {
		if (this.readyTimer !== null) clearTimeout(this.readyTimer);
		this.readyTimer = null;
		this.bridge.markEngineReady();
	}
}

function exitCodeOf(result: unknown): number {
	return typeof result === 'number' && Number.isFinite(result) ? result : 0;
}
