/** Common shape shared by the Dragon86 fs1 client and the standalone 9p client. */
export interface RemoteStat {
	isDir: boolean;
	size: number;
	mtime: number;
}

export interface RemoteEntry extends RemoteStat {
	/** Project-relative path with `/` separators; never begins with `/`. */
	path: string;
}

export interface RemoteSnapshot {
	files: string[];
	dirs: string[];
}

/**
 * A whole-file remote filesystem rooted at `root`. Paths passed to every
 * method are project-relative; implementations map them into their own
 * guest-view path space.
 */
export interface RemoteFs {
	readonly root: string;
	tree(): Promise<RemoteEntry[]>;
	read(rel: string): Promise<Uint8Array>;
	write(rel: string, data: Uint8Array): Promise<RemoteStat>;
	mkdir(rel: string): Promise<RemoteStat>;
	remove(rel: string): Promise<void>;
	rename(from: string, to: string): Promise<RemoteStat>;
	stat(rel: string): Promise<RemoteStat>;
	close(): void;
}

/** Reject `..`, empty segments, and backslashes before any remote path is built. */
export function cleanRelativePath(value: string): string {
	const parts = value.split('/').filter((part) => part !== '' && part !== '.');
	if (parts.some((part) => part === '..' || part.includes('\\') || part.includes('\0'))) {
		throw new Error(`Unsafe remote path: ${value}`);
	}
	return parts.join('/');
}

/** Normalize a user-supplied fs1 guest-view root such as `/Documents` or `/`. */
export function normalizeRemoteRoot(root: string | null | undefined): string {
	const raw = (root ?? '/').trim();
	if (!raw.startsWith('/')) throw new Error('Remote root must start with /');
	const parts = raw.split('/').filter((part) => part !== '' && part !== '.');
	if (parts.some((part) => part === '..' || part.includes('\\'))) {
		throw new Error('Unsafe remote root');
	}
	return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

/** Join an fs1 root with a project-relative path. */
export function fs1Path(root: string, rel: string): string {
	const clean = cleanRelativePath(rel);
	if (root === '/') return clean === '' ? '/' : `/${clean}`;
	return clean === '' ? root : `${root}/${clean}`;
}

/** Join a 9p absolute path with a project-relative path. */
export function p9Path(root: string, rel: string): string {
	const clean = cleanRelativePath(rel);
	const base = root.endsWith('/') ? root.slice(0, -1) : root;
	return clean === '' ? base || '/' : `${base}/${clean}`;
}

/** Convert an absolute BrowserPod path to one relative to the IDE workdir. */
export function relativeToWorkdir(workdir: string, absPath: string): string | null {
	if (absPath === workdir) return '';
	const prefix = `${workdir}/`;
	return absPath.startsWith(prefix) ? absPath.slice(prefix.length) : null;
}

/** Exact ArrayBuffer copy, because WorkspaceFs.writeBinaryFile takes ArrayBuffer. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

/** Small deterministic content hash; enough to recognize our own pending write. */
export function hashBytes(bytes: Uint8Array): string {
	let hash = 0x811c9dc5;
	for (const byte of bytes) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${bytes.byteLength}:${hash.toString(16)}`;
}

export function snapshotOf(entries: readonly RemoteEntry[]): RemoteSnapshot {
	return {
		files: entries.filter((entry) => !entry.isDir).map((entry) => entry.path),
		dirs: entries.filter((entry) => entry.isDir).map((entry) => entry.path)
	};
}

export function statChanged(a: RemoteStat | undefined, b: RemoteStat): boolean {
	return (
		a === undefined ||
		a.isDir !== b.isDir ||
		a.size !== b.size ||
		Math.floor(a.mtime) !== Math.floor(b.mtime)
	);
}
