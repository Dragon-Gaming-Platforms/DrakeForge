/** RemoteFs backed by literal 9p2000.L frames from the standalone Worker. */
import { P9Client } from '../p9/client';
import {
	cleanRelativePath,
	p9Path,
	type RemoteEntry,
	type RemoteFs,
	type RemoteStat
} from './remote-fs';

const MAX_TREE_ENTRIES = 5000;

export class P9RemoteFs implements RemoteFs {
	readonly root = '/';

	constructor(private readonly client: P9Client) {}

	async tree(): Promise<RemoteEntry[]> {
		const entries: RemoteEntry[] = [];
		const walk = async (dir: string, relative: string): Promise<void> => {
			if (entries.length >= MAX_TREE_ENTRIES) return;
			for (const child of await this.client.readdir(dir)) {
				if (entries.length >= MAX_TREE_ENTRIES) return;
				const path = relative ? `${relative}/${child.name}` : child.name;
				const absolute = dir === '/' ? `/${child.name}` : `${dir}/${child.name}`;
				const stat = await this.client.stat(absolute);
				entries.push({ path, ...stat });
				if (stat.isDir) await walk(absolute, path);
			}
		};
		await walk('/', '');
		return entries;
	}

	async read(rel: string): Promise<Uint8Array> {
		return this.client.readFile(p9Path(this.root, rel));
	}

	async write(rel: string, data: Uint8Array): Promise<RemoteStat> {
		const path = p9Path(this.root, rel);
		await this.client.writeFile(path, data);
		return this.stat(rel);
	}

	async mkdir(rel: string): Promise<RemoteStat> {
		await this.client.mkdirp(p9Path(this.root, rel));
		return this.stat(rel);
	}

	async remove(rel: string): Promise<void> {
		await this.client.remove(p9Path(this.root, rel));
	}

	async rename(from: string, to: string): Promise<RemoteStat> {
		await this.client.rename(p9Path(this.root, from), p9Path(this.root, to));
		return this.stat(to);
	}

	async stat(rel: string): Promise<RemoteStat> {
		const stat = await this.client.stat(p9Path(this.root, rel));
		return {
			isDir: stat.isDir,
			size: stat.size,
			mtime: stat.mtime
		};
	}

	close(): void {
		this.client.close();
	}
}

/** Build a standalone RemoteFs, negotiating 9P2000.L with the Worker. */
export async function createP9RemoteFs(client: P9Client): Promise<P9RemoteFs> {
	// A stat of the share root proves the server is attached and mounted.
	const root = await client.stat('/');
	if (!root.isDir) throw new Error('9p share root is not a directory');
	return new P9RemoteFs(client);
}

/** Sanitize a relative path before using it in a 9p operation. */
export function safeP9Relative(path: string): string {
	return cleanRelativePath(path);
}
