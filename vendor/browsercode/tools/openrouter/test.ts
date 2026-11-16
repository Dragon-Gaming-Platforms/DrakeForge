/**
 * OpenRouter agent option contract tests.
 *
 * The key must be pasted by the user, stored locally, and injected as
 * OPENROUTER_API_KEY into a Pi session scoped to OpenRouter models.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const toolsSource = readFileSync(resolve(appRoot, 'src/lib/config/tools.ts'), 'utf8');
const launcherSource = readFileSync(resolve(appRoot, 'src/lib/agents/openrouter.ts'), 'utf8');

const store = new Map<string, string>();
const fakeStorage = {
	get length() {
		return store.size;
	},
	clear: () => store.clear(),
	getItem: (key: string) => store.get(key) ?? null,
	key: (index: number) => [...store.keys()][index] ?? null,
	removeItem: (key: string) => {
		store.delete(key);
	},
	setItem: (key: string, value: string) => {
		store.set(key, value);
	}
};
Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true });

const openRouter = await import('../../src/lib/agents/openrouter.ts');
const { PI_CLI_PATH } = await import('../../src/lib/agents/pi.ts');

test('OpenRouter is an enabled agent option with a paste-your-own-key credential', () => {
	assert.match(toolsSource, /export type ToolId = [^;]*'openrouter'/);
	assert.match(toolsSource, /id: 'openrouter'/);
	assert.match(toolsSource, /label: 'OpenRouter'/);
	assert.match(toolsSource, /disabled: false/);
	assert.match(toolsSource, /note: 'Paste an OpenRouter API key'/);
	assert.match(toolsSource, /label: 'OpenRouter API key'/);
	assert.match(toolsSource, /placeholder: 'sk-or-v1-…'/);
	assert.match(toolsSource, /consoleUrl: 'https:\/\/openrouter\.ai\/keys'/);
	assert.match(toolsSource, /createLabel: 'Create API key'/);
	assert.match(toolsSource, /get: getOpenRouterApiKey/);
	assert.match(toolsSource, /set: setOpenRouterApiKey/);
	assert.match(toolsSource, /credential: \{/);
});

test('OpenRouter uses the existing Pi CLI with an OpenRouter-scoped preset', () => {
	assert.match(toolsSource, /openrouter: \{/);
	assert.match(toolsSource, /storageKey: 'pi-openrouter'/);
	assert.match(toolsSource, /command: 'node'/);
	assert.match(toolsSource, /args: \[\.\.\.OPENROUTER_ARGS\]/);
	assert.match(toolsSource, /prepare: prepareOpenRouterPod/);
	assert.match(toolsSource, /env: openRouterEnv/);
	assert.match(toolsSource, /openCallback: openRouterOpenCallback/);

	assert.equal(openRouter.OPENROUTER_PROVIDER, 'openrouter');
	assert.equal(openRouter.OPENROUTER_DEFAULT_MODEL, 'moonshotai/kimi-k2.6');
	assert.deepEqual(
		[...openRouter.OPENROUTER_ARGS],
		[
			PI_CLI_PATH,
			'--provider',
			'openrouter',
			'--model',
			'moonshotai/kimi-k2.6',
			'--models',
			'openrouter/*'
		]
	);

	const settings = JSON.parse(openRouter.OPENROUTER_SETTINGS) as {
		defaultProvider: string;
		defaultModel: string;
		enabledModels: string[];
	};
	assert.equal(settings.defaultProvider, 'openrouter');
	assert.equal(settings.defaultModel, 'moonshotai/kimi-k2.6');
	assert.deepEqual(settings.enabledModels, ['openrouter/*']);
	assert.match(launcherSource, /PI_CODING_AGENT_DIR/);
	assert.match(launcherSource, /OPENROUTER_API_KEY=/);
});

test('pasted key is stored locally and injected only into the CLI environment', () => {
	store.clear();
	assert.equal(openRouter.getOpenRouterApiKey(), null);
	assert.ok(!openRouter.openRouterEnv().some((entry) => entry.startsWith('OPENROUTER_API_KEY=')));

	openRouter.setOpenRouterApiKey('sk-or-v1-test');
	assert.equal(openRouter.getOpenRouterApiKey(), 'sk-or-v1-test');
	const env = openRouter.openRouterEnv();
	assert.ok(env.includes('OPENROUTER_API_KEY=sk-or-v1-test'));
	assert.ok(env.includes('PI_SKIP_VERSION_CHECK=1'));
	assert.ok(env.includes(`PI_CODING_AGENT_DIR=${openRouter.OPENROUTER_AGENT_DIR}`));
	assert.equal(openRouter.OPENROUTER_API_KEY_STORAGE, 'openrouter-api-key');

	// No key is committed or baked into the static source.
	assert.doesNotMatch(launcherSource, /sk-or-v1-[A-Za-z0-9]/);
	assert.doesNotMatch(toolsSource, /sk-or-v1-[A-Za-z0-9]/);
});

test('OpenRouter settings are written to a dedicated Pi agent directory', () => {
	assert.ok(openRouter.OPENROUTER_AGENT_DIR.endsWith('.browsercode/pi-openrouter'));
	assert.ok(
		openRouter.OPENROUTER_SETTINGS_PATH.endsWith('.browsercode/pi-openrouter/settings.json')
	);
	assert.match(launcherSource, /preparePiPod\(pod, terminal\)/);
	assert.match(
		launcherSource,
		/writePodFile\(pod, OPENROUTER_SETTINGS_PATH, OPENROUTER_SETTINGS\)/
	);
});
