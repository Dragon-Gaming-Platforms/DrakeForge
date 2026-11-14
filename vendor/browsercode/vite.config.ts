import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import {
	defineConfig,
	type Connect,
	type Plugin,
	type PreviewServer,
	type ViteDevServer
} from 'vite';

/**
 * BrowserPod needs SharedArrayBuffer, hence COOP/COEP. GitHub Pages cannot set
 * response headers, so static/coi-serviceworker.js supplies them there under the
 * /DrakeForge/ project scope. Dev and preview *can* set headers, so this plugin
 * keeps them project-local too instead of using Vite's global `headers` option,
 * which would isolate unrelated pages served from the same origin.
 *
 * The scope is /DrakeForge/* rather than /DrakeForge/standalone only: BrowserPod
 * boots on both the connected and standalone workspace routes.
 */
const projectBase = process.env.PAGES_BASE || '/DrakeForge';
const projectPrefix = projectBase.endsWith('/') ? projectBase.slice(0, -1) : projectBase;

const isolationHeaders: Record<string, string> = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'cross-origin'
};

function isProjectRequest(url: string | undefined): boolean {
	if (!url) return false;
	const path = url.split('?')[0];
	return path === projectPrefix || path.startsWith(`${projectPrefix}/`);
}

const projectLocalIsolation: Connect.NextHandleFunction = (req, res, next) => {
	if (isProjectRequest(req.url)) {
		for (const [name, value] of Object.entries(isolationHeaders)) res.setHeader(name, value);
	}
	next();
};

function isolationPlugin(): Plugin {
	return {
		name: 'drakeforge-project-local-isolation',
		configureServer(server: ViteDevServer) {
			server.middlewares.use(projectLocalIsolation);
		},
		configurePreviewServer(server: PreviewServer) {
			server.middlewares.use(projectLocalIsolation);
		}
	};
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), isolationPlugin()],
	server: {
		host: true,
		allowedHosts: true,
		port: Number(process.env.PORT) || 5173
	},
	preview: {
		host: true,
		allowedHosts: true,
		port: Number(process.env.PORT) || 4173
	},
	worker: {
		format: 'es'
	},
	build: {
		target: 'es2022'
	}
});
