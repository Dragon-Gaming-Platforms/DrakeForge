/**
 * Portal events as BrowserPod reports them: a service came up (or went away) on a port.
 *
 * Owned by the pod layer because both boot paths (the playground IDE and the agent CLIs)
 * produce these
 */
export type PortalUpdate = { port: number; url: string | null; active: boolean };
