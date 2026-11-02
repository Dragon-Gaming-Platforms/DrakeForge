/**
 * Loopback integration test for the bundled 9p client and Dragon86's server.
 *
 * Runs the REAL createP9Handler against ZenFS InMemory, with the client and
 * server exchanging literal 9p2000.L frames through a function call instead
 * of a Worker. `npm run test:p9` exercises the wire format in Node without a
 * browser or BrowserPod API key.
 */
import assert from 'node:assert/strict';
import { configure, fs, InMemory } from '@zenfs/core';
import { createP9Handler } from '../../src/lib/dragon86/p9/server';
import { P9Client, type P9Transport } from '../../src/lib/dragon86/p9/client';
import { P9RemoteFs } from '../../src/lib/dragon86/fs/p9-remote-fs';

class LoopbackP9Transport implements P9Transport {
	constructor(private readonly handler: ReturnType<typeof createP9Handler>) {}
	send(request: Uint8Array): Promise<Uint8Array> {
		return new Promise((resolve, reject) => {
			try {
				this.handler(request, (reply: Uint8Array) => resolve(new Uint8Array(reply)));
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}
	close(): void {}
}

async function main(): Promise<void> {
	await configure({ mounts: { '/': InMemory } });
	const root = '/home/user/project';
	await fs.promises.mkdir(root, { recursive: true });
	await fs.promises.writeFile(`${root}/README.md`, new TextEncoder().encode('hello 9p\n') as never);
	await fs.promises.mkdir(`${root}/src`, { recursive: true });
	await fs.promises.writeFile(
		`${root}/src/main.js`,
		new TextEncoder().encode('console.log(1)\n') as never
	);

	const handler = createP9Handler(root);
	const client = new P9Client(new LoopbackP9Transport(handler));
	await client.connect();
	const remote = new P9RemoteFs(client);

	const firstTree = await remote.tree();
	assert.deepEqual(firstTree.map((entry) => entry.path).sort(), [
		'README.md',
		'src',
		'src/main.js'
	]);
	assert.equal(new TextDecoder().decode(await remote.read('README.md')), 'hello 9p\n');

	await remote.write('src/app.js', new TextEncoder().encode('export const answer = 42;\n'));
	assert.equal(
		new TextDecoder().decode(await remote.read('src/app.js')),
		'export const answer = 42;\n'
	);

	await remote.mkdir('public');
	assert.equal((await remote.stat('public')).isDir, true);

	await remote.rename('src/app.js', 'public/app.js');
	assert.equal(
		new TextDecoder().decode(await remote.read('public/app.js')),
		'export const answer = 42;\n'
	);
	await assert.rejects(() => remote.read('src/app.js'));

	await remote.remove('public');
	const finalTree = await remote.tree();
	assert.equal(
		finalTree.some((entry) => entry.path.startsWith('public')),
		false
	);
	assert.equal(
		finalTree.some((entry) => entry.path === 'README.md'),
		true
	);
	assert.equal(
		finalTree.some((entry) => entry.path === 'src/main.js'),
		true
	);

	client.close();
	console.log('✓ standalone 9p client/server round-trip passed');
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
