/**
 * A BrowserCode ProjectSource whose files come from a remote whole-file
 * filesystem (Dragon86 fs1 or the standalone 9p Worker).
 *
 * The upstream IDE pipeline is unchanged: list files, boot BrowserPod,
 * hydrate files, optionally install/start, then render. Dragon86-specific
 * behavior is attached through the optional hooks added to ProjectSource.
 */
import type {
	BootContext,
	PodAttachment,
	ProjectCommand,
	ProjectSnapshot,
	ProjectSource
} from '$lib/ide/project-source';
import type { WorkspaceFs } from '$lib/ide/workspace-fs';
import { DRAGON86_WORKDIR } from '../bridge/config';
import { SyncedWorkspaceFs, type SyncController, type SyncIssue } from './synced-workspace-fs';
import { cleanRelativePath, snapshotOf, type RemoteEntry, type RemoteFs } from './remote-fs';

export interface Dragon86SourceOptions {
	id: string;
	label: string;
	hydrateLabel: string;
	remote: RemoteFs;
	podAttachment?: PodAttachment;
	onRemoteLive?: () => void;
	onRemoteUnavailable?: (message: string) => void;
	onStatus?: (text: string, level?: 'info' | 'warn' | 'error') => void;
	onIssues?: (issues: SyncIssue[]) => void;
	onSyncController?: (controller: SyncController | null) => void;
	onShutdown?: () => void;
}

export function dragon86ProjectSource(options: Dragon86SourceOptions): ProjectSource {
	const { remote } = options;
	let initialEntries: RemoteEntry[] = [];
	let synced: SyncedWorkspaceFs | null = null;
	let hasPackageJson = false;

	const status = (text: string, level: 'info' | 'warn' | 'error' = 'info') =>
		options.onStatus?.(text, level);

	return {
		id: options.id,
		runtime: 'pod',
		label: options.label,
		hydrateLabel: options.hydrateLabel,
		workdir: DRAGON86_WORKDIR,
		appPort: 3000,

		listFiles: async (): Promise<string[]> => {
			try {
				initialEntries = await remote.tree();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				options.onRemoteUnavailable?.(message);
				status(`Dragon86 filesystem is disconnected: ${message}`, 'error');
				throw new Error(`Could not read Dragon86 filesystem: ${message}`);
			}
			const snapshot = snapshotOf(initialEntries);
			hasPackageJson = snapshot.files.includes('package.json');
			status(`Found ${snapshot.files.length} remote files; hydrating Dragon86 workspace`);
			return snapshot.files;
		},

		hydrate: async (ctx: BootContext, files: string[]): Promise<void> => {
			synced?.setInitialBaseline(initialEntries);
			synced?.beginHydrate();
			try {
				for (const file of files) {
					if (ctx.cancelled()) return;
					try {
						const rel = cleanRelativePath(file);
						const bytes = await remote.read(rel);
						await ctx.fs.writeBinaryFile(`${ctx.workdir}/${rel}`, toBuffer(bytes));
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						options.onRemoteUnavailable?.(message);
						status(`Could not mount Dragon86 file ${file}: ${message}`, 'error');
						throw new Error(`Could not mount Dragon86 file ${file}: ${message}`);
					}
				}
				status('Dragon86 files hydrated; validating the connected filesystem');
			} finally {
				synced?.endHydrate();
			}
		},

		prepare: async (): Promise<void> => {
			synced?.setInitialBaseline(initialEntries);
			try {
				await synced?.initialize();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				options.onRemoteUnavailable?.(message);
				status(`Could not mount Dragon86 filesystem for sync: ${message}`, 'error');
				throw error;
			}
			synced?.start();
		},

		initialFile: (files: string[]) =>
			files.includes('README.md') ? 'README.md' : (files[0] ?? undefined),

		installCommands: (): ProjectCommand[] =>
			hasPackageJson ? [{ command: ['npm', 'install'] }] : [],

		startCommand: async (ctx: BootContext): Promise<ProjectCommand | null> => {
			if (!hasPackageJson) {
				ctx.write('\r\nNo package.json in the remote project — skipping npm install/start.\r\n');
				return null;
			}
			try {
				const raw = await ctx.fs.readFile(`${ctx.workdir}/package.json`);
				const scripts = (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts ?? {};
				const script = scripts.dev ? 'dev' : scripts.start ? 'start' : null;
				if (!script) {
					ctx.write('\r\npackage.json has no "dev" or "start" script — nothing to run.\r\n');
					return null;
				}
				return { command: ['npm', 'run', script] };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.write(`\r\nCould not read package.json: ${message}\r\n`);
				return null;
			}
		},

		trackBoot: () => undefined,

		wrapFs: (podFs: WorkspaceFs): WorkspaceFs => {
			synced = new SyncedWorkspaceFs(podFs, remote, DRAGON86_WORKDIR, {
				onStatus: (text, level) => status(text, level ?? 'info'),
				onIssues: (issues) => options.onIssues?.(issues),
				onRemoteLive: options.onRemoteLive,
				onRemoteUnavailable: options.onRemoteUnavailable
			});
			options.onSyncController?.(synced);
			return synced;
		},

		watchFiles: (onChange: (snapshot: ProjectSnapshot) => void): (() => void) => {
			if (!synced) return () => undefined;
			synced.setSnapshotHook(onChange);
			return () => synced?.stop();
		},

		podAttachment: options.podAttachment,

		shutdown: () => {
			synced?.stop();
			remote.close();
			options.onSyncController?.(null);
			options.onShutdown?.();
		}
	};
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}
