import type { Handle } from '@sveltejs/kit';

const AGENTS_CSP =
	"frame-ancestors 'self' https://browserpod.io https://*.browserpod.io https://*.browserpod.pages.dev";

/** Dev mirror of `static/_headers`; the static build has no server, so keep the two in step. */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
	response.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

	// Clears the blanket frame-ancestors vite.config.ts sets, so only /agents stays unframable.
	if (event.url.pathname.startsWith('/agents')) {
		response.headers.set('Content-Security-Policy', AGENTS_CSP);
	} else {
		response.headers.delete('Content-Security-Policy');
	}

	return response;
};
