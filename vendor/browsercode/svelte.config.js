import adapter from '@sveltejs/adapter-static';

/**
 * GitHub Pages project site: https://dragon-gaming-platforms.github.io/DrakeForge/
 * PAGES_BASE must omit the trailing slash; PAGES_FALLBACK is 404.html because
 * GitHub Pages serves that for unknown SPA routes. Cloudflare Pages used
 * 200.html upstream, so the fallback is configurable.
 */
const base = process.env.PAGES_BASE || '/DrakeForge';
const fallback = process.env.PAGES_FALLBACK || '404.html';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			pages: 'dist',
			assets: 'dist',
			fallback
		}),
		// Absolute asset URLs so module scripts load on nested SPA-fallback routes,
		// with the project-site base prepended by SvelteKit.
		paths: { base, relative: false },
		prerender: {
			handleUnseenRoutes: 'ignore'
		}
	}
};

export default config;
