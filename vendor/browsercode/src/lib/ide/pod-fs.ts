/** A `WorkspaceFs` over a BrowserPod: its file API, plus a hidden shell for what that API lacks. */
import type { BrowserPod, Terminal } from '@leaningtech/browserpod';
import {
	POD_HOME,
	podFileSize,
	readPodBinaryFile,
	readPodFile,
	readPodFileWithinLimit,
	writePodBinaryFile,
	writePodFile
} from '$lib/pod/fs';
import type { LocalScanEntry, WorkspaceFs } from './workspace-fs';

export class PodFs implements WorkspaceFs {
	/** Lazily created hidden terminal that carries the shell-backed operations. */
	private fsTerminal: Terminal | null = null;
	/** Serializes shell commands so two never share the hidden terminal at once. */
	private fsQueue: Promise<unknown> = Promise.resolve();
	/** Separate hidden terminal whose output is captured for tree scans. */
	private scanTerminal: Terminal | null = null;
	private scanCollector: ((bytes: Uint8Array) => void) | null = null;

	constructor(private readonly pod: BrowserPod) {}

	async readFile(path: string): Promise<string> {
		return readPodFile(this.pod, path);
	}

	async readFileWithinLimit(path: string, maxBytes: number): Promise<string | null> {
		return readPodFileWithinLimit(this.pod, path, maxBytes);
	}

	async readBinaryFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
		return readPodBinaryFile(this.pod, path);
	}

	async fileSize(path: string): Promise<number> {
		return podFileSize(this.pod, path);
	}

	async writeFile(path: string, content: string): Promise<void> {
		return writePodFile(this.pod, path, content);
	}

	async writeBinaryFile(path: string, content: ArrayBuffer): Promise<void> {
		return writePodBinaryFile(this.pod, path, content);
	}

	async createDirectory(path: string): Promise<void> {
		await this.pod.createDirectory(path, { recursive: true });
	}

	renameEntry(from: string, to: string): Promise<void> {
		return this.runFsCommand(`mv -- ${shQuote(from)} ${shQuote(to)}`, `Failed to rename ${from}`);
	}

	deleteEntry(path: string): Promise<void> {
		return this.runFsCommand(`rm -rf -- ${shQuote(path)}`, `Failed to delete ${path}`);
	}

	/**
	 * Project-relative scan of the pod's workdir. BrowserPod terminal commands
	 * can create files that never pass through the IDE's WorkspaceFs methods;
	 * this sees them so the Dragon86 sync layer can push them or report a
	 * conflict instead of discarding them.
	 */
	async scanTree(root: string): Promise<LocalScanEntry[]> {
		const marker = '__DRAKEFORGE_SCAN__';
		const command =
			`printf '${marker}\\0'; ` +
			`find ${shQuote(root)} -mindepth 1 \\( -name node_modules -o -name .git -o -name .cache \\) -prune -o -printf '%y\\0%P\\0'`;
		const output = await this.runCaptureCommand(command, `Failed to scan ${root}`);
		const parts = output.split('\0');
		const markerIndex = parts.indexOf(marker);
		if (markerIndex === -1) throw new Error('Pod filesystem scan returned no marker');
		const entries: LocalScanEntry[] = [];
		for (let i = markerIndex + 1; i + 1 < parts.length; i += 2) {
			const type = parts[i];
			const path = parts[i + 1];
			if (!type || !path) continue;
			if (entries.length >= 5000) throw new Error('Pod filesystem scan exceeded 5000 entries');
			entries.push({ path, isDir: type === 'd', size: 0, mtime: 0 });
		}
		return entries;
	}

	/** Runs a shell command and captures its raw output from a dedicated hidden terminal. */
	private runCaptureCommand(command: string, failure: string): Promise<string> {
		const task = async (): Promise<string> => {
			if (!this.scanTerminal) {
				this.scanTerminal = await this.pod.createCustomTerminal({
					onOutput: (chunk) => this.scanCollector?.(new Uint8Array(chunk))
				});
			}
			const chunks: Uint8Array[] = [];
			this.scanCollector = (bytes) => chunks.push(bytes);
			try {
				const exitCode = (await this.pod.run('bash', ['-c', command], {
					echo: false,
					terminal: this.scanTerminal,
					cwd: POD_HOME
				})) as unknown as number;
				if (exitCode !== 0) throw new Error(`${failure} (exit code ${exitCode})`);
				const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
				const bytes = new Uint8Array(total);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.byteLength;
				}
				return new TextDecoder().decode(bytes);
			} finally {
				this.scanCollector = null;
			}
		};
		const result = this.fsQueue.then(task, task);
		this.fsQueue = result.catch(() => undefined);
		return result;
	}

	/**
	 * Runs a shell command in the hidden terminal (BrowserPod has no rename/delete API) and rejects
	 * with `failure` when it exits non-zero.
	 */
	private runFsCommand(command: string, failure: string): Promise<void> {
		const task = async (): Promise<void> => {
			if (!this.fsTerminal) {
				const decoder = new TextDecoder();
				this.fsTerminal = await this.pod.createCustomTerminal({
					// Typed as an ArrayBuffer, but it is a Uint8Array over a growable SharedArrayBuffer,
					// which TextDecoder refuses; the constructor copies it into a plain one.
					onOutput: (chunk) =>
						console.debug('[ide-fs]', decoder.decode(new Uint8Array(chunk), { stream: true }))
				});
			}
			// Typed as an opaque `Process`, but awaiting it yields the exit code.
			const exitCode = (await this.pod.run('bash', ['-c', command], {
				echo: true,
				terminal: this.fsTerminal,
				cwd: POD_HOME
			})) as unknown as number;
			if (exitCode !== 0) throw new Error(`${failure} (exit code ${exitCode})`);
		};
		const result = this.fsQueue.then(task, task);
		this.fsQueue = result.catch(() => undefined);
		return result;
	}
}

/** Single-quotes a path for `bash -c`. */
function shQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
