/**
 * Dragon86 bridge configuration.
 *
 * Wire constants mirror Dragon-Gaming-Platforms/Cheerpx-Bridge and
 * Dragon-Gaming-Platforms/Dragon86. They must stay in sync or the OS will
 * ignore our messages.
 */

/** Bridge terminal protocol version (Dragon86 src/bridge/hoster.ts). */
export const PROTOCOL_VERSION = 1;

/** Shared-filesystem protocol version (Dragon86 docs/cheerpx-fs-protocol.md). */
export const FS_PROTOCOL_VERSION = 2;

/** Capability Dragon86 advertises on hello and we echo on ready. */
export const FS_CAP = 'fs1';

/** Same-origin tab-mode channel. BroadcastChannel is scoped to the origin, not the path. */
export const BROADCAST_CHANNEL_NAME = 'dragon86-hoster-v1';

/** Production Dragon86 Pages URL, exposed as a copyable setup link. */
export const DEFAULT_DRAGON86_URL = 'https://dragon-gaming-platforms.github.io/Dragon86/';

/** Origins allowed to drive an embedded DrakeForge frame over postMessage. */
export const ALLOWED_PARENT_ORIGINS: readonly string[] = [
	'https://dragon-gaming-platforms.github.io'
];

/** Generated Arena preview origins, useful while testing an embedded build. */
export const ALLOWED_PARENT_ORIGIN_PATTERNS: readonly RegExp[] = [
	/^https:\/\/\d+-[a-z0-9-]+\.e2b\.app$/
];

export const ALLOW_LOCALHOST_PARENTS = true;

/** Cheerpx-Bridge batches engine output on this cadence. */
export const FLUSH_INTERVAL_MS = 16;
export const FLUSH_MAX_BYTES = 64 * 1024;
export const BACKLOG_MAX_BYTES = 128 * 1024;
export const READY_FALLBACK_MS = 2000;

/** Whole-file fs1 requests can take a while, but a missing OS must not hang boot. */
export const FS_REQUEST_TIMEOUT_MS = 8000;
export const FS_SYNC_INTERVAL_MS = 2000;

/** Default remote project root. `?root=/` selects all of Dragon86's /home/user. */
export const DEFAULT_REMOTE_ROOT = '/Dragon86-IDE';

/** BrowserPod-side copy of the remote project. */
export const DRAGON86_WORKDIR = '/home/user/dragon86';
