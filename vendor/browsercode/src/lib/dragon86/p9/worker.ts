/**
 * Standalone 9p2000.L server Worker.
 *
 * GitHub Pages cannot host a network 9p listener. Instead this module Worker
 * configures ZenFS on IndexedDB, runs Dragon86's real createP9Handler, and
 * exchanges raw 9p frames with the page over postMessage. No Dragon86 process
 * or server is required.
 */
import { configure, fs, InMemory } from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';
import { createP9Handler } from './server';

const ROOT = '/home/user/dragon86-ide';
const encoder = new TextEncoder();

type InitMessage = { type: 'init' };
type RequestMessage = { type: '9p:request'; id: number; bytes: ArrayBuffer };
type WorkerMessage = InitMessage | RequestMessage;

type WorkerScope = {
	onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
	postMessage(message: unknown, transfer?: Transferable[]): void;
};

const scope = self as unknown as WorkerScope;
let handler: ReturnType<typeof createP9Handler> | null = null;
let ready: Promise<void> | null = null;

const SEED: Record<string, string> = {
	'package.json':
		JSON.stringify(
			{
				name: 'drakeforge-standalone',
				private: true,
				version: '1.0.0',
				scripts: { dev: 'node server.js', start: 'node server.js' }
			},
			null,
			2
		) + '\n',
	'README.md': [
		'# DrakeForge standalone workspace',
		'',
		'These files live in a ZenFS IndexedDB mount and are served by a bundled',
		'9p2000.L server running in a Web Worker. Edit them here; BrowserPod runs',
		'`npm run dev` against its synchronized copy.',
		''
	].join('\n'),
	'index.html': `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>DrakeForge standalone</title></head>
<body style="margin:0;background:#0b0e14;color:#d7dee9;font:16px/1.5 system-ui;display:grid;place-items:center;height:100vh">
<main><h1>🐉 DrakeForge</h1><p>Your standalone 9p workspace is live.</p></main>
</body>
</html>
`,
	'server.js': `const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\\/+/, '');
  const file = path.join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('DrakeForge standalone server on port ' + (process.env.PORT || 3000));
});
`
};

async function writeSeedFile(name: string, contents: string): Promise<void> {
	await fs.promises.writeFile(`${ROOT}/${name}`, encoder.encode(contents) as never);
}

async function init(): Promise<void> {
	if (ready) return ready;
	ready = (async () => {
		await configure({
			mounts: {
				'/home': IndexedDB,
				'/tmp': InMemory
			}
		});
		await fs.promises.mkdir(ROOT, { recursive: true });
		try {
			await fs.promises.stat(`${ROOT}/package.json`);
		} catch {
			for (const [name, contents] of Object.entries(SEED)) await writeSeedFile(name, contents);
		}
		handler = createP9Handler(ROOT);
	})();
	return ready;
}

scope.onmessage = (event) => {
	const message = event.data;
	if (message.type === 'init') {
		void init().then(
			() => scope.postMessage({ type: 'ready', root: ROOT }),
			(error: unknown) =>
				scope.postMessage({
					type: 'error',
					message: error instanceof Error ? error.message : String(error)
				})
		);
		return;
	}
	if (message.type === '9p:request') {
		if (!handler) {
			scope.postMessage({ type: '9p:error', id: message.id, message: '9p server is not ready' });
			return;
		}
		const request = new Uint8Array(message.bytes);
		try {
			handler(request, (reply: Uint8Array) => {
				// Copy to an exact buffer before transferring it to the page.
				const copy = new Uint8Array(reply.byteLength);
				copy.set(reply);
				scope.postMessage({ type: '9p:response', id: message.id, bytes: copy.buffer }, [
					copy.buffer
				]);
			});
		} catch (error) {
			scope.postMessage({
				type: '9p:error',
				id: message.id,
				message: error instanceof Error ? error.message : String(error)
			});
		}
	}
};
