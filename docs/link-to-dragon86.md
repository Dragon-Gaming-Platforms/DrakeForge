# How the Link to Dragon86 works

This document explains the connection between the DrakeForge workspace and Dragon86. The UI keeps this link deliberately minimal — there is no first-run wizard or floating connection panel — because the per-workspace browser tab itself is the connected IDE. The setup is documented here and in `README.md`.

## 1. What "Link to Dragon86" means

DrakeForge does **not** add a new filesystem server to Dragon86. It uses the link Dragon86 already exposes for [Cheerpx-Bridge](https://github.com/Dragon-Gaming-Platforms/Cheerpx-Bridge):

- a v1 terminal bridge for `hello`, `ready`, `data`, `resize`, and `exit`;
- a v2 whole-file filesystem bridge named `fs1` for `fs-req` / `fs-res`.

Dragon86 advertises `caps: ["fs1"]` and serves its ZenFS `/home/user` tree through either an iframe `postMessage` channel or a same-origin `BroadcastChannel`. DrakeForge implements the **hoster/client** side of that contract. Therefore:

> **No Dragon86 source or selected-engine changes are required.**

Only a new raw cross-window 9p endpoint would require Dragon86 changes, and DrakeForge does not use one for connected mode.

## 2. Exact URL contract

| Use case                             | URL                                                                                                | Transport                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Legacy separate tab / Cheerpx-Bridge | `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86`                                    | `BroadcastChannel("dragon86-hoster-v1")` + postMessage         |
| Root alias                           | `https://dragon-gaming-platforms.github.io/DrakeForge/`                                            | same as above                                                  |
| Agent-assigned dedicated session     | `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86?channel=dragon86-drakeforge-<uuid>` | **only** `BroadcastChannel("dragon86-drakeforge-<uuid>")`      |
| Dedicated session on root            | `https://dragon-gaming-platforms.github.io/DrakeForge/?channel=dragon86-drakeforge-<uuid>`         | same dedicated channel                                         |
| Embedded iframe                      | `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86?mode=embed`                         | **only** parent-frame `postMessage`; BroadcastChannel disabled |
| Standalone 9p Worker                 | `https://dragon-gaming-platforms.github.io/DrakeForge/standalone` or `/?mode=standalone`           | in-page Web Worker, no Dragon86                                |

`<uuid>` is a standard 8-4-4-4-12 hexadecimal UUID supplied by the Dragon86 agent, e.g. `11111111-2222-3333-4444-555555555555`. When `channel` is present in separate-tab mode, DrakeForge does **not** listen or broadcast on `dragon86-hoster-v1`; that legacy channel stays available for CheerpX and for older DrakeForge tabs. `?mode=embed` always ignores `channel` and uses only `postMessage`. An invalid channel is rejected with a visible startup error rather than silently falling back.

Other query options can be combined with any connected URL:

| Query              | Meaning                                                                             |
| ------------------ | ----------------------------------------------------------------------------------- |
| `?root=/Documents` | Use a different project root inside Dragon86 `/home/user`. Default `/Dragon86-IDE`. |
| `?root=/`          | Use all of `/home/user`.                                                            |
| `?agent=codex`     | Open the inline Agents activity with Codex selected.                                |

`/agents`, `/agents/[tool]`, `/ide`, and `/embed` redirect into the unified workspace. `?mode=standalone` switches to the bundled 9p Worker and ignores `channel`.

## 3. One browser tab per workspace

Opening the root URL boots one `IdeSession` and one VS Code-style shell. Files, Search, Source Control / Git, Agents, the Monaco editor, the BrowserPod portal preview, the bottom terminal, and the new Sync panel all render inline in that single tab.

- The Agents activity view boots the selected CLI inline with `AgentShell`; it does not navigate to `/agents/[tool]` and does not open another workspace tab.
- In Dragon86 **Settings → Engine → Separate tab**, Dragon86 opens DrakeForge as its _engine tab_. That is the OS's remote-engine mechanism, not a second IDE workspace.
- For everything inside the Dragon86 window, use `?mode=embed` with `integrations/dragon86/BrowserCode-IDE.d86`; the iframe inherits cross-origin isolation from Dragon86's already-isolated top page.
- Several dedicated `?channel=` sessions can run at the same time as CheerpX's legacy default channel without cross-talk.

## 4. Setup

1. Deploy DrakeForge Pages at `https://dragon-gaming-platforms.github.io/DrakeForge/`.
2. In Dragon86: **Settings → Engine → Separate tab**.
3. If the Dragon86 agent supplies a session UUID, set the engine URL to `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86?channel=dragon86-drakeforge-<uuid>`.
4. Otherwise set it to `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86` or the root `/DrakeForge/`.
5. Press **Reconnect** or **Open Engine Tab**.

Both project pages are on `https://dragon-gaming-platforms.github.io`, so BroadcastChannel and the origin allowlist work. A custom domain would break separate-tab mode.

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

`ready` advertises `fs1` only after `remote.tree()` has answered, so Dragon86 does not start issuing filesystem requests against a half-booted workspace.

### v2 — whole-file `fs1`

```text
DrakeForge → Dragon86  { v:2, t:"fs-req", id, op, path?, to?, data? }
Dragon86 → DrakeForge  { v:2, t:"fs-res", id, ok, error?, entries?, tree?, data?, stat? }
```

Ops: `list | tree | read | write | mkdir | remove | rename | stat`. Reads and writes are whole-file and capped at 16 MB; `tree` is capped at 5,000 entries. Paths are relative to Dragon86's `/home/user` share.

### Transports

- `PostMessageTransport` — embedded iframe. Accepts messages only from `window.parent` and only from the same origin, `https://dragon-gaming-platforms.github.io`, localhost, or Arena preview origins. Replies go to the exact origin that said `hello`, never `*`.
- `BroadcastChannelTransport` — separate-tab mode. Dedicated sessions use the agent-assigned `dragon86-drakeforge-<uuid>` channel; legacy sessions use `dragon86-hoster-v1`. Hoster-originated messages carry `via: "bc-hoster"` so a second hoster tab ignores them. BroadcastChannel is same-origin by construction.
- `resolveBridgeSession` / `createBridgeTransport` enforce these policies: a dedicated session opens only its own channel, an embedded session opens only postMessage, and the default session opens postMessage plus `dragon86-hoster-v1`.

## 6. Why this is not a 9p mount

Dragon86's `src/bridge/p9.ts` returns `(request: Uint8Array, reply: (Uint8Array) => void) => void` and is passed to v86 as `filesystem.handle9p`. There is no socket, URL, or cross-window listener. CheerpX cannot accept a 9p device either, which is why Dragon86 has `fs-bridge.ts` and the `fs1` protocol.

BrowserPod's public API exposes `openFile`, `createFile`, `createDirectory`, `run`, and terminals, but no filesystem mount hook. A `WorkspaceFs` adapter alone could make Monaco use remote files, but BrowserPod's bash and dev server would still read their own VFS. `SyncedWorkspaceFs` therefore keeps one pod-side copy at `/home/user/dragon86` and performs a **three-way reconcile**:

1. Boot: fetch `tree`, hydrate files into BrowserPod, and hash both remote and local baselines.
2. Local IDE save: write BrowserPod first, push the `fs1` operation, and surface/retry any failed remote write instead of swallowing it.
3. Poll every 2 s: scan the BrowserPod workdir with `scanTree`, so terminal-created and terminal-edited files are pushed to Dragon86 too.
4. Remote-only changes are pulled; local-only changes are pushed; identical edits on both sides are treated as converged.
5. Concurrent divergent edits **are not overwritten**. DrakeForge writes a `*.drakeforge-remote-<timestamp>` copy locally, reports a conflict in the bottom **Sync** panel and status bar, and lets the user choose **Use BrowserPod copy** or **Use Dragon86 copy**.
6. Remote poll errors, failed writes, and unreadable files are reported as sync issues rather than silently losing changes.

This is eventual, whole-file consistency — not byte-range POSIX semantics.

## 7. Standalone mode is a different link

`/DrakeForge/standalone` or `/?mode=standalone` does not contact Dragon86. It bundles Dragon86's real 9p2000.L handler in a Web Worker backed by ZenFS IndexedDB/InMemory and exchanges literal 9p frames over `postMessage`. GitHub Pages cannot host a TCP/WebSocket 9p listener. Files persist in that browser's IndexedDB and are mirrored into BrowserPod through the same `SyncedWorkspaceFs`.

## 8. Automated tests

`npm run test` in `vendor/browsercode` runs:

- `tools/p9/test.ts` — standalone 9p client/server round-trip;
- `tools/bridge/test.ts` — dedicated/embedded/default URL contract, no default-channel leakage, embedded postMessage-only, hello/ready + `fs1` on a dedicated channel, reload/reconnect, multiple sessions, and simultaneous CheerpX use;
- `tools/sync/test.ts` — remote→local and local→remote edits, terminal-created file push, failed-write retry/error surfacing, concurrent-edit conflict preservation/resolution, and remote poll failure surfacing.

These are automated protocol and sync tests with in-memory/fake transports; a live BrowserPod/Dragon86 end-to-end run also needs the `VITE_API_KEY` secret and a real Dragon86 agent.

## 9. Prerequisites

- BrowserPod `VITE_API_KEY` GitHub Actions secret, authorized for `https://dragon-gaming-platforms.github.io`.
- Cross-origin isolation via `coi-serviceworker.js` for top-level Pages visits; embedded frames inherit it from Dragon86.
- Pages source set to **GitHub Actions** so `.github/workflows/deploy.yml` publishes `vendor/browsercode/dist`.

## 10. Failure checklist

| Symptom                            | Likely cause                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| No `hello` in the workspace status | Dragon86 engine URL is wrong, or the tab was opened manually instead of from Dragon86.      |
| `Invalid Dragon86 session channel` | `channel` is not exactly `dragon86-drakeforge-<uuid>`; no fallback transport is opened.     |
| `ready` never arrives              | BrowserPod API key missing/origin-restricted, or COI serviceworker did not reload the page. |
| `fs1` tree empty or timing out     | Wrong `?root=`, Dragon86 not on a same-origin Pages URL, or the remote tree exceeds caps.   |
| Sync conflict in the status bar    | Both Dragon86 and BrowserPod edited the same path; resolve explicitly in the Sync panel.    |
| Failed remote write                | Local copy is kept, an error is shown, and the write is retried on the next poll.           |
| Standalone worker fails            | IndexedDB unavailable, or the 9p Worker bundle was not rebuilt.                             |
| Agent CLI opens a tab              | Only OAuth sign-in should do that; the CLI itself runs inline.                              |
