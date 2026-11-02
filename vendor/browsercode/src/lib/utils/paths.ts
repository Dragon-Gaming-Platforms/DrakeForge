import { base } from '$app/paths';

/**
 * Full pathname for an app-relative route under the configured Pages base.
 * `navigateWithLeaveGuard` and a few full-reload flows assign window.location
 * directly, so they need the base prepended (e.g. /DrakeForge/ide).
 */
export function appHref(path: string): string {
	const normalized = path.startsWith('/') ? path : `/${path}`;
	return `${base}${normalized}`;
}
