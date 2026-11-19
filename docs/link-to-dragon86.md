# How the Link to Dragon86 works

This document explains the connection between the DrakeForge workspace and Dragon86. The UI keeps this link deliberately minimal — there is no first-run wizard or floating connection panel — because the per-workspace browser tab itself is the connected IDE. The Dragon86 app launcher is now a **separate-tab pointer** to the standalone workspace, not an embedded IDE.

## 1. What "Link to Dragon86" means

DrakeForge does **not** add a new filesystem server to Dragon86. It uses the link Dragon86 already exposes for [Cheerpx-Bridge](https://github.com/Dragon-Gaming-Platforms/Cheerpx-Bridge):

- a v1 terminal bridge for `hello`, `ready`, `data`, `resize`, and `exit`;
- a v2 whole-file filesystem bridge named `fs1` for `fs-req` / `fs-res`.

Dragon86 advertises `caps: ["fs1"]` and serves its ZenFS `/home/user` tree through either an iframe `postMessage` channel or a same-origin `BroadcastChannel`. DrakeForge implements the **hoster/client** side of that contract. Therefore:

> **No Dragon86 source or selected-engine changes are required.**

The Dragon86 app launcher uses the **standalone** workspace instead: it opens `/DrakeForge/standalone` in a new top-level tab, does not connect `fs1`, and does not require Dragon86 or the PS1 emulator to be cross-origin isolated.

## 2. Exact URL contract

| Use case                             | URL                                                                                                | Transport                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Legacy separate tab / Cheerpx-Bridge | `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86`                                    | `BroadcastChannel("dragon86-hoster-v1")` + postMessage         |
| Root alias                           | `https://dragon-gaming-platforms.github.io/DrakeForge/`                                            | same as above                                                  |
| Agent-assigned dedicated session     | `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86?channel=dragon86-drakeforge-<uuid>` | **only** `BroadcastChannel("dragon86-drakeforge-<uuid>")`      |
| Dedicated session on root            | `https://dragon-gaming-platforms.github.io/DrakeForge/?channel=dragon86-drakeforge-<uuid>`         | same dedicated channel                                         |
| Explicit embedded iframe             | `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86?mode=embed`                         | **only** parent-frame `postMessage`; BroadcastChannel disabled |
| **Dragon86 launcher destination**    | `https://dragon-gaming-platforms.github.io/DrakeForge/standalone`                                  | standalone 9p Worker in a **separate top-level tab**           |
| Old standalone root alias            | `https://dragon-gaming-platforms.github.io/DrakeForge/?mode=standalone`                            | redirects to `/DrakeForge/standalone`                          |

`<uuid>` is a standard 8-4-4-4-12 hexadecimal UUID supplied by the Dragon86 agent, e.g. `11111111-2222-3333-4444-555555555555`. When `channel` is present in separate-tab mode, DrakeForge does **not** listen or broadcast on `dragon86-hoster-v1`; that legacy channel stays available for CheerpX and for older DrakeForge tabs. `?mode=embed` always ignores `channel` and uses only `postMessage`. An invalid channel is rejected with a visible startup error rather than silently falling back.

Other query options can be combined with connected URLs:

| Query               | Meaning                                                                             |
| ------------------- | ----------------------------------------------------------------------------------- |
| `?root=/Documents`  | Use a different project root inside Dragon86 `/home/user`. Default `/Dragon86-IDE`. |
| `?root=/`           | Use all of `/home/user`.                                                            |
| `?agent=codex`      | Open the inline Agents activity with Codex selected.                                |
| `?agent=openrouter` | Open the inline Agents activity with the key-only OpenRouter option selected.       |

`/agents`, `/agents/[tool]`, `/ide`, and `/embed` redirect into the unified workspace. The standalone route ignores `channel`; it does not use Dragon86's `fs1` bridge.

## 3. One browser tab per workspace

Opening the root URL boots one `IdeSession` and one VS Code-style shell. Files, Search, Source Control / Git, Agents, the Monaco editor, the BrowserPod portal preview, the bottom terminal, and the Sync panel all render inline in that single tab.

- The Agents activity view boots the selected CLI inline with `AgentShell`; it does not navigate to `/agents/[tool]` and does not open another workspace tab.
- In Dragon86 **Settings → Engine → Separate tab**, Dragon86 opens DrakeForge as its _engine tab_. That is the OS's remote-engine mechanism, not a second IDE workspace.
- The Dragon86 **app launcher** opens the standalone workspace in a **new top-level browser tab**. It is a pointer, not an iframe: `integrations/dragon86/drakeforge.d86` and the legacy `BrowserCode-IDE.d86` contain only a launch link and explanatory text.
- `?mode=embed` is retained for explicit embedded use, but the launcher does not use it. Embedded mode intentionally disables BroadcastChannel.
- Several dedicated `?channel=` sessions can run at the same time as CheerpX's legacy default channel without cross-talk.

## 4. Setup

### Connected workspace

1. Deploy DrakeForge Pages at `https://dragon-gaming-platforms.github.io/DrakeForge/`.
2. In Dragon86: **Settings → Engine → Separate tab**.
3. If the Dragon86 agent supplies a session UUID, set the engine URL to `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86?channel=dragon86-drakeforge-<uuid>`.
4. Otherwise set it to `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86` or the root `/DrakeForge/`.
5. Press **Reconnect** or **Open Engine Tab**.

Both project pages are on `https://dragon-gaming-platforms.github.io`, so BroadcastChannel and the origin allowlist work. A custom domain would break separate-tab mode.

### Standalone launcher

Copy `integrations/dragon86/drakeforge.d86` into Dragon86's `~/applications` (or use Dragon86's built-in **DrakeForge** app entry). The filename matches the `drakeforge` id in Dragon86's app registry. Opening the shortcut launches the new-tab launcher, which points at `/DrakeForge/standalone` with `target="_blank"` and `rel="noopener noreferrer"`.

Do **not** use the Files app's sandboxed HTML preview as the launcher. That preview uses `sandbox="allow-forms allow-popups"` without `allow-popups-to-escape-sandbox`, so a popped tab can inherit sandbox restrictions and would not be a full BrowserPod browsing context. The app launcher/shortcut path uses a normal top-level window.

## 5. Wire protocol

### v1 — terminal bridge

```text
Dragon86 → DrakeForge  { v:1, t:"hello", caps:["fs1"] }       repeated until ready
DrakeForge → Dragon86  { v:1, t:"ready", caps:["fs1"] }       after BrowserPod shell is live
Dragon86 → DrakeForge  { v:1, t:"data", d:string }            terminal keystrokes
Dragon86 → DrakeForge  { v:1, t:"resize", cols, rows }
DrakeForge → Dragon86  { v:1, t:"data", d:string }            shell output, batched ~16 ms
DrakeForge → Dragon86  { v:1, t:"exit", code }
```

`ready` advertises `fs1` only after DrakeForge has fetched the remote tree, hydrated the BrowserPod workspace, and completed the initial sync snapshot. An unavailable channel or failed mount is shown as disconnected/error; DrakeForge does not treat a local-only workspace as a successful Dragon86 connection. Repeated `hello` messages are handled, including after a DrakeForge reload.

### v2 — whole-file `fs1`

```text
DrakeForge → Dragon86  { via:"bc-hoster", v:2, t:"fs-req", id, op, path?, to?, data? }
Dragon86 → DrakeForge  { v:2, t:"fs-res", id, ok, error?, entries?, tree?, data?, stat? }
```

Ops: `list | tree | read | write | mkdir | remove | rename | stat`. Reads and writes are whole-file and capped at 16 MB; `tree` is capped at 5,000 entries. Paths are relative to Dragon86's `/home/user` share.

### Transports

- `PostMessageTransport` — explicit embedded iframe. Accepts messages only from `window.parent` and only from the same origin, `https://dragon-gaming-platforms.github.io`, localhost, or Arena preview origins. Replies go to the exact origin that said `hello`, never `*`.
- `BroadcastChannelTransport` — separate-tab mode. Dedicated sessions use the agent-assigned `dragon86-drakeforge-<uuid>` channel; legacy sessions use `dragon86-hoster-v1`.
- `resolveBridgeSession` / `createBridgeTransport` enforce these policies: a dedicated session opens only its own channel, an embedded session opens only postMessage, and the default session opens postMessage plus `dragon86-hoster-v1`.
- The **standalone launcher** uses none of these transports. It opens `/DrakeForge/standalone` in a new tab; that page uses its own in-browser 9p Worker.

## 6. Why this is not a 9p mount

Dragon86's `src/bridge/p9.ts` returns `(request: Uint8Array, reply: (Uint8Array) => void) => void` and is passed to v86 as `filesystem.handle9p`. There is no socket, URL, or cross-window listener. CheerpX cannot accept a 9p device either, which is why Dragon86 has `fs-bridge.ts` and the `fs1` protocol.

BrowserPod's public API exposes `openFile`, `createFile`, `createDirectory`, `run`, and terminals, but no filesystem mount hook. A `WorkspaceFs` adapter alone could make Monaco use remote files, but BrowserPod's bash and dev server would still read their own VFS. `SyncedWorkspaceFs` therefore keeps one pod-side copy at `/home/user/dragon86` and performs a **three-way reconcile**:

1. Boot: fetch `tree`, hydrate files into BrowserPod, and hash both remote and local baselines.
2. Local IDE save: write BrowserPod first, push the `fs1` operation, and surface/retry any failed remote write instead of swallowing it.
3. Poll every 2 s: scan the BrowserPod workdir with `scanTree`, so terminal-created and terminal-edited files are pushed to Dragon86 too.
4. Remote-only changes are pulled; local-only changes are pushed; identical edits on both sides are treated as converged.
5. Concurrent divergent edits **are not overwritten**. DrakeForge writes a `*.drakeforge-remote-<timestamp>` copy locally, reports a conflict in the bottom **Sync** panel and status bar, and lets the user choose **Use BrowserPod copy** or **Use Dragon86 copy**.
6. Remote poll errors, failed writes, and unreadable files are reported as sync issues rather than silently losing changes.

This is eventual, whole-file consistency — not byte-range POSIX semantics. The connected workspace uses the `fs1` whole-file bridge; it does **not** change or integrate the Terminal's separate 9P transport.

The UUID channel name avoids accidental cross-talk between concurrent sessions; it is **not an authorization boundary**. Anyone on the same origin who learns the name may join that BroadcastChannel. Do not put secrets in the channel name or treat it as access control.

## 7. Standalone mode is a different link

`/DrakeForge/standalone` does not contact Dragon86. It bundles Dragon86's real 9p2000.L handler in a Web Worker backed by ZenFS IndexedDB/InMemory and exchanges literal 9p frames over `postMessage`. GitHub Pages cannot host a TCP/WebSocket 9p listener. Files persist in that browser's IndexedDB and are mirrored into BrowserPod through the same `SyncedWorkspaceFs`.

`src/routes/standalone/+page.svelte` still renders the existing `<Workspace mode="standalone" />` component. No IDE UI is copied into Dragon86. The launcher files are only pointers; they contain no iframe, no scripts, and no BrowserCode components.

## 8. Automated tests

`npm run test` in `vendor/browsercode` runs:

- `tools/p9/test.ts` — standalone 9p client/server round-trip;
- `tools/bridge/test.ts` — exact dedicated-channel validation, no default-channel leakage, embedded postMessage-only, mount-gated hello/ready + `fs1`, reload/reconnect, multiple sessions, and simultaneous CheerpX use;
- `tools/fs1/test.ts` — CRUD contract, structured-clone byte preservation, path-escape rejection, 16 MiB / 5,000-entry limits, remote errors/timeouts, and no local-only fallback on disconnect;
- `tools/sync/test.ts` — remote→local and local→remote edits, terminal-created file push, failed-write retry/error surfacing, concurrent-edit conflict preservation/resolution, and remote poll failure surfacing;
- `tools/launcher/test.ts` — both `.d86` launchers point to `/DrakeForge/standalone` with `target="_blank"` and `rel="noopener noreferrer"`, contain no iframe/scripts/embed URL, clearly say "separate top-level tab", the standalone route still renders the real `Workspace`, the root alias redirects, and COI remains project-local;
- `tools/openrouter/test.ts` — the OpenRouter tool is enabled, has a paste-your-own-key credential, uses the existing Pi CLI with an `openrouter/*`-scoped preset, persists the pasted key locally, and injects it as `OPENROUTER_API_KEY` without committing a key.

These are automated protocol, sync, and static-contract tests. A live BrowserPod/Dragon86 end-to-end run also needs the `VITE_API_KEY` secret and a real Dragon86 app launcher.

## 9. Cross-origin isolation and BrowserPod

BrowserPod needs `SharedArrayBuffer`, which requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on the document. The standalone launcher opens a **top-level** tab, so `src/app.html` registers `coi-serviceworker.js` in that tab's own browsing context. It reloads once, then the controlled responses carry the COOP/COEP headers.

Embedded mode would have to inherit isolation from the parent Dragon86 page. The launcher avoids that: Dragon86 and the PS1 emulator are never put behind COOP/COEP, and no `cross-origin-isolated` permission is delegated through an iframe.

The **OpenRouter** agent option is a separate, user-pasted runtime credential. Selecting it (or `?agent=openrouter`) shows the standard credential card; the key is stored in browser `localStorage`, injected as `OPENROUTER_API_KEY` when the Pi CLI launches, and never committed or baked into the static bundle. DrakeForge writes an OpenRouter-only Pi settings preset in a dedicated Pi agent directory so the regular Pi tool's provider/model and `/login` state are not changed. Usage is billed per token to the user's OpenRouter account.

## 10. Constraints on route-local isolation

True **standalone-route-only** response headers are not possible on the current deployment without changing hosts or DrakeForge's runtime contract:

1. **GitHub Pages has no custom response headers.** `_headers` is a Netlify/Cloudflare convention and is inert on GitHub Pages; GitHub Pages serves static files from a CDN with no per-route header configuration ([GitHub community discussion](https://github.com/orgs/community/discussions/157852), [example report](https://github.com/privkeyio/website/issues/40)). We therefore do not pretend `_headers` sets real COOP/COEP on Pages.
2. **The service worker is the Pages-compatible workaround.** `coi-serviceworker.js` rewrites responses it controls, but it cannot affect the very first document load: it registers, then reloads once ([Stack Overflow workaround](https://stackoverflow.com/questions/68609682/is-there-any-way-to-use-sharedarraybuffer-on-github-pages), [MDN `register()`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)).
3. **Scope can be narrowed, but not to standalone-only without breaking connected mode.** MDN documents that `register(..., { scope })` can narrow a worker to a path below its script directory ([MDN `register()`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)); broadening beyond the script directory would need `Service-Worker-Allowed` ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Service-Worker-Allowed)). The script lives at `/DrakeForge/coi-serviceworker.js`, so `/DrakeForge/` is its natural project scope. BrowserPod boots on **both** connected and standalone workspace routes, so narrowing to `/DrakeForge/standalone` would break connected mode unless a second worker/registration were added.
4. **We keep isolation project-local, not origin-local.** `src/app.html` sets an explicit `/DrakeForge/` scope, `static/_headers` uses `/DrakeForge/*` rather than `/*` for hosts that honor it, and `vite.config.ts` uses a project-path middleware instead of Vite's global `headers` option. Dragon86 pages at `/Dragon86/` and PS1/emulator pages are not controlled. This is the narrowest compatible scope without moving to a header-capable host or duplicating the runtime.
5. **Dragon86's Files HTML preview is sandboxed.** It uses `allow-forms allow-popups` but not `allow-popups-to-escape-sandbox`; popped tabs can inherit sandbox flags. Launch from the app registry/shortcut instead. We do not change Dragon86's viewer or broaden its sandbox flags.

No response headers were broadened to unrelated pages, and no unrelated Dragon86/PS1 route was changed.

## 11. Prerequisites

- BrowserPod `VITE_API_KEY` GitHub Actions secret, authorized for `https://dragon-gaming-platforms.github.io`.
- Cross-origin isolation via `coi-serviceworker.js` for top-level DrakeForge visits; embedded frames inherit it from the parent when applicable.
- Pages source set to **GitHub Actions** so `.github/workflows/deploy.yml` publishes `vendor/browsercode/dist`.

## 12. Failure checklist

| Symptom                               | Likely cause                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| No `hello` in the workspace status    | Dragon86 engine URL is wrong, or the tab was opened manually instead of from Dragon86.      |
| `Invalid Dragon86 session channel`    | `channel` is not exactly `dragon86-drakeforge-<uuid>`; no fallback transport is opened.     |
| `ready` never arrives                 | BrowserPod API key missing/origin-restricted, or COI serviceworker did not reload the page. |
| `fs1` tree empty or timing out        | Wrong `?root=`, Dragon86 not on a same-origin Pages URL, or the remote tree exceeds caps.   |
| Sync conflict in the status bar       | Both Dragon86 and BrowserPod edited the same path; resolve explicitly in the Sync panel.    |
| Failed remote write                   | Local copy is kept, an error is shown, and the write is retried on the next poll.           |
| Standalone worker fails               | IndexedDB unavailable, or the 9p Worker bundle was not rebuilt.                             |
| Launcher opens a broken/sandboxed tab | It was opened from the Files HTML preview; launch the `.d86` as an app shortcut instead.    |
| Agent CLI opens a tab                 | Only OAuth sign-in should do that; the CLI itself runs inline.                              |
| OpenRouter has no available model     | Paste/replace the OpenRouter key with the key button; the session restarts inline.          |
