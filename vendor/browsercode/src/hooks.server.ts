import type { Handle } from '@sveltejs/kit';
import { base } from '$app/paths';

const AGENTS_CSP =
	"frame-ancestors 'self' https://browserpod.io https://*.browserpod.io https://*.browserpod.pages.dev https://dragon-gaming-platforms.github.io";

/** Dev/preview mirror of static/_headers; the static build has no server. */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
	response.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

	// Strip the project-site base before deciding whether this is an agent route.
	const localPath =
		base && event.url.pathname.startsWith(base)
			? event.url.pathname.slice(base.length) || '/'
			: event.url.pathname;
	if (localPath.startsWith('/agents')) {
		response.headers.set('Content-Security-Policy', AGENTS_CSP);
	} else {
		response.headers.delete('Content-Security-Policy');
	}

	return response;
};
