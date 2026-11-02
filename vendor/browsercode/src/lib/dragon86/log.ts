/** Tiny logger for the vendored Dragon86 9p server running in a Worker. */
export function logInfo(tag: string, ...args: unknown[]): void {
	console.debug(`[drakeforge:${tag}]`, ...args);
}

export function logWarn(tag: string, ...args: unknown[]): void {
	console.warn(`[drakeforge:${tag}]`, ...args);
}
