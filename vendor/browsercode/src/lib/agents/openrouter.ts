import type { BrowserPod, Terminal } from '@leaningtech/browserpod';
import { POD_HOME, podFileSize, writePodFile } from '$lib/pod/fs';
import { openPiUrl, piEnv, preparePiPod, PI_CLI_PATH } from './pi';

/**
 * OpenRouter-backed Pi session. Pi's own `/login` supports OpenRouter too, but
 * this option is deliberately key-only: the user pastes an API key once, it is
 * kept in browser localStorage, and it is injected as `OPENROUTER_API_KEY`
 * when the CLI starts. A dedicated Pi agent directory keeps this preset from
 * changing the regular Pi tool's saved provider/model or credentials.
 */
export const OPENROUTER_PROVIDER = 'openrouter';
/** Pi's bundled default OpenRouter chat model for this pinned version. */
export const OPENROUTER_DEFAULT_MODEL = 'moonshotai/kimi-k2.6';
export const OPENROUTER_API_KEY_STORAGE = 'openrouter-api-key';
export const OPENROUTER_AGENT_DIR = `${POD_HOME}/.browsercode/pi-openrouter`;
export const OPENROUTER_SETTINGS_PATH = `${OPENROUTER_AGENT_DIR}/settings.json`;

/** Scope startup and Ctrl+P cycling to OpenRouter models that the key can reach. */
export const OPENROUTER_SETTINGS = JSON.stringify(
	{
		defaultProvider: OPENROUTER_PROVIDER,
		defaultModel: OPENROUTER_DEFAULT_MODEL,
		enabledModels: [`${OPENROUTER_PROVIDER}/*`]
	},
	null,
	2
);

/** Force the provider at launch too, so an old Pi session cannot restore another model. */
export const OPENROUTER_ARGS = [
	PI_CLI_PATH,
	'--provider',
	OPENROUTER_PROVIDER,
	'--model',
	OPENROUTER_DEFAULT_MODEL,
	'--models',
	`${OPENROUTER_PROVIDER}/*`
] as const;

export const openRouterOpenCallback = openPiUrl;

/** Stored only in this browser; never committed or shipped in the static bundle. */
export function getOpenRouterApiKey(): string | null {
	try {
		return localStorage.getItem(OPENROUTER_API_KEY_STORAGE);
	} catch (error) {
		console.warn('Could not read the stored OpenRouter API key:', error);
		return null;
	}
}

export function setOpenRouterApiKey(key: string): void {
	try {
		localStorage.setItem(OPENROUTER_API_KEY_STORAGE, key);
	} catch (error) {
		console.warn('Could not persist the OpenRouter API key:', error);
	}
}

/** Pi reads provider keys from the environment at process launch. */
export function openRouterEnv(): string[] {
	const key = getOpenRouterApiKey();
	return [
		...piEnv(),
		`PI_CODING_AGENT_DIR=${OPENROUTER_AGENT_DIR}`,
		...(key ? [`OPENROUTER_API_KEY=${key}`] : [])
	];
}

/** Installs Pi once, then writes the OpenRouter-only settings preset. */
export async function prepareOpenRouterPod(pod: BrowserPod, terminal: Terminal): Promise<void> {
	await preparePiPod(pod, terminal);
	if (!(await hasOpenRouterSettings(pod))) {
		await writePodFile(pod, OPENROUTER_SETTINGS_PATH, OPENROUTER_SETTINGS);
	}
}

async function hasOpenRouterSettings(pod: BrowserPod): Promise<boolean> {
	try {
		return (await podFileSize(pod, OPENROUTER_SETTINGS_PATH)) > 0;
	} catch {
		return false;
	}
}
