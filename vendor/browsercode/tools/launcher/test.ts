/**
 * Dragon86 launcher / standalone-route contract tests.
 *
 * These are static contract tests: the launcher must be a no-script pointer to
 * the existing standalone route, and that route must still render the real
 * BrowserCode Workspace component. They also guard against silently widening
 * COOP/COEP to the origin or to unrelated pages.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const appRoot = resolve(here, '../..');
const STANDALONE_URL = 'https://dragon-gaming-platforms.github.io/DrakeForge/standalone';
const LAUNCHER_FILES = ['BrowserCode-IDE.d86', 'drakeforge.d86'] as const;

function read(relative: string): string {
	return readFileSync(resolve(repoRoot, relative), 'utf8');
}

function readApp(relative: string): string {
	return readFileSync(resolve(appRoot, relative), 'utf8');
}

function attr(attrs: string, name: string): string | null {
	const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
	return match?.[1] ?? null;
}

function launchAnchor(html: string): { attrs: string; text: string } {
	const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
	const found = anchors.find((anchor) => attr(anchor[1], 'id') === 'drakeforge-launch');
	assert.ok(found, 'expected an <a id="drakeforge-launch"> element');
	return {
		attrs: found[1],
		text: found[2]
			.replace(/<[^>]*>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
	};
}

for (const file of LAUNCHER_FILES) {
	test(`${file}: opens the standalone route in a separate top-level tab`, () => {
		const html = read(`integrations/dragon86/${file}`);
		assert.doesNotMatch(html, /<iframe\b/i, 'launcher must not embed DrakeForge');
		assert.doesNotMatch(html, /<\/iframe>/i);
		assert.doesNotMatch(html, /allow="cross-origin-isolated"/i);
		assert.doesNotMatch(html, /mode=embed/i);
		assert.doesNotMatch(html, /<script\b/i, 'launcher must work without scripts');
		assert.doesNotMatch(html, /dragon86-hoster-v1|postMessage|BroadcastChannel/i);

		const anchor = launchAnchor(html);
		assert.equal(attr(anchor.attrs, 'href'), STANDALONE_URL);
		assert.equal(attr(anchor.attrs, 'target'), '_blank');
		assert.match(attr(anchor.attrs, 'rel') ?? '', /noopener/);
		assert.match(attr(anchor.attrs, 'rel') ?? '', /noreferrer/);
		assert.equal(attr(anchor.attrs, 'data-launch-mode'), 'separate-top-level-tab');
		assert.match(anchor.text, /new tab|separate tab|separate top-level/i);
		assert.match(html, /separate top-level browser tab|top-level browser tab/i);
		assert.match(html, /SharedArrayBuffer/i);
		assert.match(html, /Dragon86 and the PS1 emulator|Dragon86 or the PS1 emulator/i);
	});
}

test('standalone route still renders the existing Workspace component', () => {
	const route = readApp('src/routes/standalone/+page.svelte');
	assert.match(route, /import Workspace from '\$lib\/dragon86\/components\/Workspace\.svelte'/);
	assert.match(route, /<Workspace mode="standalone" \/>/);
	assert.doesNotMatch(route, /<iframe\b/i);
	assert.doesNotMatch(route, /IdeShell|Dragon86IdeShell/);
});

test('root ?mode=standalone redirects to the dedicated route', () => {
	const route = readApp('src/routes/+page.svelte');
	assert.match(route, /searchParams\.get\('mode'\)\s*!==\s*'standalone'/);
	assert.match(route, /appHref\('\/standalone'\)/);
	assert.match(route, /window\.location\.replace\(target\.href\)/);
	assert.match(route, /<Workspace \/>/);
});

test('Workspace mode switch points to /standalone, not the root alias', () => {
	const component = readApp('src/lib/dragon86/components/Workspace.svelte');
	assert.match(component, /appHref\('\/standalone'\)/);
	assert.doesNotMatch(component, /searchParams\.set\('mode', 'standalone'\)/);
});

test('COI stays top-level and project-local on Pages-compatible builds', () => {
	const appHtml = readApp('src/app.html');
	assert.match(appHtml, /window\.parent === window && window\.crossOriginIsolated !== true/);
	assert.match(appHtml, /const assets = '%sveltekit\.assets%'/);
	assert.match(appHtml, /scope: projectScope/);
	assert.match(appHtml, /projectScope/);

	const serviceWorker = readApp('static/coi-serviceworker.js');
	assert.match(serviceWorker, /scope: undefined/);
	assert.match(serviceWorker, /coi\.scope/);
	assert.match(serviceWorker, /registrationOptions/);
	assert.match(serviceWorker, /n\.serviceWorker\.register\(scriptUrl, registrationOptions\)/);

	const headers = readApp('static/_headers');
	assert.doesNotMatch(headers, /^\/\*\s*\n\s*Cross-Origin-Opener-Policy/m);
	assert.match(headers, /^\/DrakeForge\/\*\s*\n\s*Cross-Origin-Opener-Policy/m);
	assert.match(headers, /Cross-Origin-Embedder-Policy: require-corp/);

	const viteConfig = readApp('vite.config.ts');
	assert.doesNotMatch(viteConfig, /(?:server|preview)\s*:\s*\{[^}]*headers\s*:/s);
	assert.match(viteConfig, /projectLocalIsolation/);
	assert.match(viteConfig, /configurePreviewServer/);
});

test('CI runs the launcher tests', () => {
	const packageJson = readApp('package.json');
	assert.match(packageJson, /"test:launcher": "tsx tools\/launcher\/test\.ts"/);
	assert.match(packageJson, /"test": "[^"]*test:launcher/);
	const workflow = read('.github/workflows/deploy.yml');
	assert.match(workflow, /npm run test/);
});
