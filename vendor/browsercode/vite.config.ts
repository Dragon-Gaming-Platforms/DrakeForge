import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/**
 * BrowserPod needs SharedArrayBuffer. GitHub Pages gets COOP/COEP from
 * coi-serviceworker.js; dev and preview servers set them directly so the first
 * load is already isolated. CORP: cross-origin lets Dragon86 embed this site.
 */
const crossOriginIsolationHeaders = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'cross-origin'
};

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		host: true,
		allowedHosts: true,
		port: Number(process.env.PORT) || 5173,
		headers: crossOriginIsolationHeaders
	},
	preview: {
		host: true,
		allowedHosts: true,
		port: Number(process.env.PORT) || 4173,
		headers: crossOriginIsolationHeaders
	},
	worker: {
		format: 'es'
	},
	build: {
		target: 'es2022'
	}
});
