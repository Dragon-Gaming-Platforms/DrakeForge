/** A repo location, in the shape the `/ide/github/...` route takes it. */
export type ParsedRepo = { owner: string; repo: string; ref: string; dir: string };

/** Characters allowed in an owner, repo, ref or directory segment. */
const SEGMENT = /^[\w.-]+$/;

/**
 * Parses a pasted GitHub URL or `owner/repo` shorthand. Accepts an optional
 * `/tree/<ref>/<dir…>`; a bare `owner/repo` defaults to the `main` branch and the repo root.
 * Returns null when the input isn't one of those shapes, or names segments the route would
 * refuse; so anything this returns can be navigated to.
 */
export function parseGitHubUrl(input: string): ParsedRepo | null {
	const cleaned = input
		.trim()
		.replace(/^https?:\/\//, '')
		.replace(/^github\.com\//, '')
		.replace(/\.git$/, '')
		.replace(/\/+$/, '');
	const parts = cleaned.split('/').filter(Boolean);
	if (parts.length < 2) return null;
	const [owner, repo, keyword, ref, ...dirParts] = parts;
	if (keyword === 'tree' && ref) return routable({ owner, repo, ref, dir: dirParts.join('/') });
	if (parts.length === 2) return routable({ owner, repo, ref: 'main', dir: '' });
	return null;
}

/**
 * Drops a parse that the `/ide/github/…` route would reject, so callers fail in place rather
 * than navigating to the route's error page.
 */
function routable(parsed: ParsedRepo): ParsedRepo | null {
	return isValidRepoPath(parsed) ? parsed : null;
}

/** True if `dir` is empty (repo root) or a clean relative path with no `..` traversal. */
function isValidDir(dir: string): boolean {
	if (dir === '') return true;
	return dir.split('/').every((segment) => SEGMENT.test(segment) && segment !== '..');
}

/** Guards the route params before a repo is cloned; rejects anything unroutable. */
export function isValidRepoPath({ owner, repo, ref, dir }: ParsedRepo): boolean {
	return SEGMENT.test(owner) && SEGMENT.test(repo) && SEGMENT.test(ref) && isValidDir(dir);
}
