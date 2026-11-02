/** RemoteFs over Dragon86's existing protocol-v2 fs1 responder. No OS changes. */
import { FsClient } from '../bridge/fsClient';
import {
	cleanRelativePath,
	fs1Path,
	normalizeRemoteRoot,
	type RemoteEntry,
	type RemoteFs,
	type RemoteStat
} from './remote-fs';

export class Fs1RemoteFs implements RemoteFs {
	readonly root: string;

	constructor(
		private readonly client: FsClient,
		root = '/'
	) {
		this.root = normalizeRemoteRoot(root);
	}

	async tree(): Promise<RemoteEntry[]> {
		const entries = await this.client.tree(this.root);
		return entries.map((entry) => ({
			path: cleanRelativePath(entry.path),
			isDir: entry.isDir,
			size: entry.size,
			mtime: entry.mtime
		}));
	}

	async read(rel: string): Promise<Uint8Array> {
		return this.client.read(fs1Path(this.root, rel));
	}

	async write(rel: string, data: Uint8Array): Promise<RemoteStat> {
		const path = fs1Path(this.root, rel);
		const stat = await this.client.write(path, new Uint8Array(data));
		return stat ?? (await this.client.stat(path));
	}

	async mkdir(rel: string): Promise<RemoteStat> {
		const path = fs1Path(this.root, rel);
		const stat = await this.client.mkdir(path);
		return stat ?? (await this.client.stat(path));
	}

	async remove(rel: string): Promise<void> {
		await this.client.remove(fs1Path(this.root, rel));
	}

	async rename(from: string, to: string): Promise<RemoteStat> {
		const destination = fs1Path(this.root, to);
		// Dragon86's fs1 server creates missing parents for write/rename.
		const stat = await this.client.rename(fs1Path(this.root, from), destination);
		return stat ?? (await this.client.stat(destination));
	}

	async stat(rel: string): Promise<RemoteStat> {
		return this.client.stat(fs1Path(this.root, rel));
	}

	close(): void {
		this.client.close();
	}
}
