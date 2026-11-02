# How the Link to Dragon86 works

This document explains the connection between the DrakeForge workspace and Dragon86. The UI keeps this link deliberately minimal — there is no first-run wizard or floating connection panel — because the per-workspace browser tab itself is the connected IDE. The setup is documented here and in `README.md`.

## 1. What "Link to Dragon86" means

DrakeForge does **not** add a new filesystem server to Dragon86. It uses the link Dragon86 already exposes for [Cheerpx-Bridge](https://github.com/Dragon-Gaming-Platforms/Cheerpx-Bridge):

- a v1 terminal bridge for `hello`, `ready`, `data`, `resize`, and `exit`;
- a v2 whole-file filesystem bridge named `fs1` for `fs-req` / `fs-res`.

Dragon86 advertises `caps: ["fs1"]` and serves its ZenFS `/home/user` tree through either an iframe `postMessage` channel or the same-origin `BroadcastChannel("dragon86-hoster-v1")`. DrakeForge implements the **hoster/client** side of that contract. Therefore:

> **No Dragon86 source changes are required.**

Only a new raw cross-window 9p endpoint would require Dragon86 changes, and DrakeForge does not use one for connected mode.

## 2. One browser tab per workspace

Opening `https://dragon-gaming-platforms.github.io/DrakeForge/` boots one `IdeSession` and one VS Code-style shell. Files, Search, Source Control / Git, Agents, the Monaco editor, the BrowserPod portal preview, and the bottom terminal all render inline in that single tab.

- The Agents activity view boots the selected CLI inline with `AgentShell`; it does not navigate to `/agents/[tool]` and does not open another workspace tab.
- `/agents`, `/agents/[tool]`, `/ide`, and `/embed` redirect back into the unified workspace.
- `?agent=codex` preselects Codex in the inline Agents view.
- `?mode=standalone` switches the same workspace shell to the in-browser 9p Worker instead of Dragon86.

### The one apparent extra tab

In Dragon86 **Settings → Engine → Separate tab**, Dragon86 opens DrakeForge as its _engine tab_. That is the OS's remote-engine mechanism, not a second IDE workspace: the IDE UI, agents, terminal, preview, files, and Git all remain in the one DrakeForge tab. If you want everything inside the Dragon86 window instead, use `?mode=embed` with `integrations/dragon86/BrowserCode-IDE.d86`; the iframe inherits cross-origin isolation from Dragon86's already-isolated top page.

## 3. Setup

1. Deploy DrakeForge Pages at `https://dragon-gaming-platforms.github.io/DrakeForge/`.
2. In Dragon86: **Settings → Engine → Separate tab**.
3. Set the engine URL to either:
   - `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86` (canonical connected alias), or
   - `https://dragon-gaming-platforms.github.io/DrakeForge/` (root now opens the connected workspace).
4. Press **Reconnect** or **Open Engine Tab**.

Both project pages are on `https://dragon-gaming-platforms.github.io`, so the BroadcastChannel and origin allowlist work. A custom domain would break separate-tab mode.

Query options on the workspace URL:

| Query              | Meaning                                                                             |
| ------------------ | ----------------------------------------------------------------------------------- |
| `?root=/Documents` | Use a different project root inside Dragon86 `/home/user`. Default `/Dragon86-IDE`. |
| `?root=/`          | Use all of `/home/user`.                                                            |
| `?mode=standalone` | Use the bundled 9p Worker instead of Dragon86.                                      |
| `?mode=embed`      | Render as an embedded engine iframe; no second COI serviceworker registration.      |
| `?agent=codex`     | Open the inline Agents activity with Codex selected.                                |

## 4. Wire protocol

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
- `BroadcastChannelTransport` — separate-tab mode on `dragon86-hoster-v1`. Hoster-originated messages carry `via: "bc-hoster"` so a second hoster tab ignores them. BroadcastChannel is same-origin by construction.

## 5. Why this is not a 9p mount

Dragon86's `src/bridge/p9.ts` returns `(request: Uint8Array, reply: (Uint8Array) => void) => void` and is passed to v86 as `filesystem.handle9p`. There is no socket, URL, or cross-window listener. CheerpX cannot accept a 9p device either, which is why Dragon86 has `fs-bridge.ts` and the `fs1` protocol.

BrowserPod's public API exposes `openFile`, `createFile`, `createDirectory`, `run`, and terminals, but no filesystem mount hook. A `WorkspaceFs` adapter alone could make Monaco use remote files, but BrowserPod's bash and dev server would still read their own VFS. `SyncedWorkspaceFs` therefore keeps one pod-side copy at `/home/user/dragon86` and reconciles it with the remote tree:

1. Boot: fetch `tree`, hydrate files into BrowserPod, set the baseline.
2. Local save: write BrowserPod first, push `fs1` write/mkdir/rename/remove, mark pending-local.
3. Poll every 2 s: pull remote changes; remote wins on conflict.
4. A pending-local hash prevents an in-flight save from being overwritten by the previous snapshot.

This is eventual, whole-file consistency — not byte-range POSIX semantics.

## 6. Standalone mode is a different link

`/DrakeForge/standalone` or `/?mode=standalone` does not contact Dragon86. It bundles Dragon86's real 9p2000.L handler in a Web Worker backed by ZenFS IndexedDB/InMemory and exchanges literal 9p frames over `postMessage`. GitHub Pages cannot host a TCP/WebSocket 9p listener. Files persist in that browser's IndexedDB and are mirrored into BrowserPod through the same `SyncedWorkspaceFs`.

## 7. Prerequisites

- BrowserPod `VITE_API_KEY` GitHub Actions secret, authorized for `https://dragon-gaming-platforms.github.io`.
- Cross-origin isolation via `coi-serviceworker.js` for top-level Pages visits; embedded frames inherit it from Dragon86.
- Pages source set to **GitHub Actions** so `.github/workflows/deploy.yml` publishes `vendor/browsercode/dist`.

## 8. Failure checklist

| Symptom                            | Likely cause                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| No `hello` in the workspace status | Dragon86 engine URL is wrong, or the tab was opened manually instead of from Dragon86.      |
| `ready` never arrives              | BrowserPod API key missing/origin-restricted, or COI serviceworker did not reload the page. |
| `fs1` tree empty or timing out     | Wrong `?root=`, Dragon86 not on a same-origin Pages URL, or the remote tree exceeds caps.   |
| Standalone worker fails            | IndexedDB unavailable, or the 9p Worker bundle was not rebuilt.                             |
| Agent CLI opens a tab              | Only OAuth sign-in should do that; the CLI itself runs inline.                              |
