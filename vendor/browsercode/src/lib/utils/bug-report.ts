/**
 * Prefilled bug reports on github issue tracker.
 */
import podPkg from '@leaningtech/browserpod/package.json';
import appPkg from '../../../package.json';

/** Single destination for every bug report. */
export const NEW_ISSUE_URL = 'https://github.com/leaningtech/browsercode/issues/new';

export type BugReportContext = {
	/** Repo the session cloned, as the session stored it; absent for framework templates. */
	repo?: { url: string; ref: string } | null;
	/** Live preview URL of the selected portal, when a dev server is up. */
	previewUrl?: string | null;
};

/** New-issue URL prefilled with the failing project and the environment. */
export function bugReportUrl(context: BugReportContext = {}): string {
	const params = new URLSearchParams({ title: title(context), body: body(context) });
	return `${NEW_ISSUE_URL}?${params}`;
}

function title({ repo }: BugReportContext): string {
	return repo ? `IDE bug: ${repoSlug(repo.url)}` : 'IDE bug report';
}

/** `owner/repo` out of a GitHub URL; the URL itself if it does not look like one. */
function repoSlug(url: string): string {
	const [owner, name] = url.replace(/^https?:\/\/github\.com\//, '').split('/');
	return owner && name ? `${owner}/${name}` : url;
}

/** Two labelled sections: where the bug happened, then what it happened on. */
function body({ repo, previewUrl }: BugReportContext): string {
	const where: string[] = [];
	if (repo) where.push(`- **Repo:** ${repo.url} on \`${repo.ref}\``);
	const page = typeof window === 'undefined' ? '' : window.location.href;
	if (page) where.push(`- **Page:** ${page}`);
	if (previewUrl) where.push(`- **Preview:** ${previewUrl}`);

	const environment = [
		`- **BrowserCode:** \`v${appPkg.version}\``,
		`- **BrowserPod:** \`v${podPkg.version}\``
	];
	if (typeof navigator !== 'undefined')
		environment.push(`- **Browser:** \`${navigator.userAgent}\``);

	return [
		'### What happened?',
		'',
		'<!-- What you expected, what happened instead, and the steps that got you there. -->',
		'',
		'### Session',
		'',
		...where,
		'',
		'### Environment',
		'',
		...environment,
		''
	].join('\n');
}
