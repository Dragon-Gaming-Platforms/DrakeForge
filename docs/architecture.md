# Architecture

## Repositories and trust boundaries

```mermaid
flowchart LR
  subgraph D86["Dragon86 (unchanged)"]
    term["Terminal / Files"]
    zen["ZenFS /home/user (IndexedDB)"]
    fs1["fs-bridge.ts: fs1 responder"]
    p9["p9.ts: 9p2000.L handler (v86 only)"]
    dbridge["hoster.ts: hello / ready / data / resize"]
    term --> dbridge
    zen --> fs1
    zen --> p9
  end

  subgraph DF["DrakeForge Pages (/DrakeForge/)"]
    ui["BrowserCode IDE + BrowserPod"]
    bridge["Dragon86Bridge: hoster-side protocol v1"]
    fsclient["FsClient: protocol v2 fs-req/fs-res"]
    sync["SyncedWorkspaceFs"]
    pod["BrowserPod filesystem /home/user/dragon86"]
    ui --> sync
    sync --> pod
    sync --> fsclient
    fsclient --> bridge
    bridge --> dbridge
    fs1 --> fsclient
  end

  subgraph SW["Standalone worker"]
    w["ZenFS IndexedDB + Dragon86 createP9Handler"]
    p9c["P9Client (raw 9p2000.L frames)"]
    w <-->|postMessage| p9c
    p9c --> sync
  end
```

## Connected protocol

DrakeForge copies the Cheerpx-Bridge wire contract rather than inventing a new one:

```
Dragon86 → DrakeForge  { v:1, t:"hello", caps:["fs1"] }         repeated until ready
DrakeForge → Dragon86  { v:1, t:"ready", caps:["fs1"] }         after BrowserPod shell is live
Dragon86 → DrakeForge  { v:1, t:"data", d:string }              terminal keystrokes
Dragon86 → DrakeForge  { v:1, t:"resize", cols, rows }
DrakeForge → Dragon86  { v:1, t:"data", d:string }              shell output, batched ~16 ms
DrakeForge → Dragon86  { v:1, t:"exit", code }

DrakeForge → Dragon86  { v:2, t:"fs-req", id, op, path?, to?, data? }
Dragon86 → DrakeForge  { v:2, t:"fs-res", id, ok, error?, entries?, tree?, data?, stat? }
```

`ops` are `list | tree | read | write | mkdir | remove | rename | stat`. Paths are relative to Dragon86's share root. `read`/`write` are whole-file and capped at 16 MB; `tree` is capped at 5,000 entries.

`resolveBridgeSession` / `createBridgeTransport` select exactly one session policy:

- **Embedded** (`?mode=embed`): only `PostMessageTransport`. It accepts messages only from `window.parent`, and only from the same origin, `https://dragon-gaming-platforms.github.io`, localhost, or Arena preview origins. Replies go to the exact origin that said `hello`, never `*`. No BroadcastChannel is constructed.
- **Dedicated separate tab** (`?channel=dragon86-drakeforge-<uuid>`): only `BroadcastChannelTransport` on that assigned channel. It does not listen or broadcast on `dragon86-hoster-v1`, so CheerpX and other DrakeForge sessions stay isolated.
- **Legacy separate tab** (no `channel`): `CompositeTransport` of `PostMessageTransport` and `BroadcastChannelTransport` on `dragon86-hoster-v1`, preserving Cheerpx-Bridge compatibility.

Hoster-originated channel messages carry `via: "bc-hoster"` so a second hoster tab ignores them. BroadcastChannel is same-origin by construction. A malformed `channel` is rejected with a visible startup error, not silently downgraded.

The `ready` capability `fs1` is advertised only after `remote.tree()` has answered successfully; `Dragon86Bridge.setFsLive(true)` calls `refreshReady()` to re-announce it if the terminal handshake finished earlier.

## Why this is not a 9p mount

Dragon86's `p9.ts` returns `(request: Uint8Array, reply: (Uint8Array) => void) => void`. v86 passes it as `filesystem.handle9p`; there is no socket, URL, or cross-window listener. Cheerpx cannot accept a 9p device either, which is why Dragon86's `fs-bridge.ts` exists.

BrowserPod exposes only `openFile`, `createFile`, `createDirectory`, `run`, and terminal APIs. It has no public mount hook. A BrowserCode `WorkspaceFs` adapter can make the _editor_ use a remote filesystem, but BrowserPod's bash and dev server would still read their own block-based VFS. `SyncedWorkspaceFs` therefore keeps a pod-side copy and reconciles it with the remote tree.

## Sync algorithm

State per path: remote stat/hash baseline, local content-hash baseline, pending failed writes, and active sync issues.

- **Boot:** `remote.tree()` → hydrate into PodFs → `scanTree()` the pod workdir → hash both baselines. This lets terminal-created files be seen even though they bypass `WorkspaceFs` writes.
- **Local IDE write:** PodFs write → remote `write`/`mkdir`/`rename`/`remove` → update both baselines. A failed remote write throws to the save handler, keeps the local copy, emits an error issue, and retries on the next poll.
- **Poll (2 s):** fetch `remote.tree()` and `scanTree()`; compute remote and local three-way deltas.
  - Remote-only change: pull into PodFs.
  - Local-only change, including terminal-created/terminal-edited files: push to Dragon86.
  - Both sides changed to identical content: converge without an operation.
  - Both sides changed divergently: **do not overwrite**. Save a `*.drakeforge-remote-<timestamp>` copy locally and emit a conflict issue with explicit local/remote resolution in the Sync panel.
  - Remote poll/read errors and failed writes are emitted as issues; they are never silently dropped.
- `refreshBaselines()` re-snapshots both sides after successful reconciliation or conflict resolution.
- The UI's `projectFiles` and `projectDirs` are refreshed from a merged remote/local snapshot through the optional `watchFiles` hook added to `ProjectSource`.

The sync layer ignores paths outside the IDE workdir (for example BrowserPod's `.bp_rc`) and filters conflict artifacts from scans/snapshots. This is whole-file eventual consistency, not byte-range POSIX semantics.

## Standalone 9p worker

`WorkerP9Transport` posts exact 9p frames to a module Worker. The Worker configures ZenFS (`/home` on IndexedDB, `/tmp` in memory), seeds a default project if empty, and calls Dragon86's `createP9Handler(root)`. Each response is copied into a transferable `ArrayBuffer`. `P9Client` implements the 9p2000.L subset needed by `P9RemoteFs`: `Tversion`, `Tattach`, `Twalk`, `Tlopen`, `Tlcreate`, `Tread`, `Twrite`, `Treaddir`, `Tgetattr`, `Tmkdir`, `Tunlinkat`, `Trenameat`, and `Tclunk`, plus `Rlerror` handling. Recursive removal is done with repeated `Tunlinkat` calls, including `AT_REMOVEDIR` for directories.

`tools/p9/test.ts` runs the real server and client over an in-process loopback with ZenFS `InMemory`, exercising the wire format without a browser.

## UI shell

DrakeForge is now a **single workspace entry point**. `src/routes/+page.svelte` opens the connected workspace; `/dragon86` and `/standalone` are mode aliases; `/agents`, `/agents/[tool]`, `/ide`, and `/embed` redirect back into it. `src/routes/+layout.svelte` removes BrowserCode's sidebar, ribbon, tour, announcement bar, and utility bar, and imports the global Dragon86 theme.

The layout is modeled on VS Code and Dragon86's real `src/styles/theme.css` / `src/styles/os.css` (upstream `e30b868`). Exact Dragon Red hex codes, glow shadows, uppercase `Orbitron`-style headings, `Rajdhani`-style body text, scrollbar treatment, radial desktop gradients, and the `#e60012 → #4a0000` status-bar gradient come from that stylesheet. `src/lib/dragon86/theme.css` maps those tokens onto BrowserCode's `--color-bc-*` variables so Monaco, xterm, file tree, and portals all inherit the Dragon86 palette.

The **Agents** activity view is inline: `AgentsPanel.svelte` constructs an `AgentSession` and renders `AgentShell` in the side bar. `src/lib/agents/session.svelte.ts` gained an optional `onRestart` hook so changing a credential relaunches only that inline CLI session instead of reloading the whole workspace tab. `GitPanel.svelte` runs real git commands in the Output terminal. The bottom panel has VS Code-style Problems/Output/Debug Console/**Sync**/Terminal/Ports tabs; the Sync tab lists failed writes, poll errors, and conflicts with **Use BrowserPod copy** / **Use Dragon86 copy** buttons. The terminal stays mounted and spans the full workspace width. See `docs/link-to-dragon86.md` for the connection explanation.

## Implementation map

- `src/routes/+page.svelte` and `src/lib/dragon86/components/Workspace.svelte` — one browser tab per workspace; owns the Dragon86/9p source and `IdeSession`.
- `src/routes/+layout.svelte` and `src/lib/dragon86/theme.css` — global VS Code/Dragon86 chrome and exact Dragon Red tokens.
- `src/lib/dragon86/components/Dragon86IdeShell.svelte` — title/menu bar, activity bar, side bar, editor group, preview group, bottom panel, and status bar.
- `src/lib/dragon86/components/AgentsPanel.svelte` — inline agent CLI runner; `GitPanel.svelte` — Source Control actions.
- `src/lib/dragon86/bridge/` — Cheerpx-Bridge-derived v1/v2 protocol, transports, session routing (`session.ts`), hoster handshake, fs1 client, and the BrowserPod-backed `Dragon86Bridge`.
- `src/lib/dragon86/fs/` — `RemoteFs` interface, fs1 and 9p implementations, three-way `SyncedWorkspaceFs`, and the `ProjectSource` adapter.
- `src/lib/dragon86/p9/` — copied Dragon86 9p handler, literal-frame client, Worker server, and Worker transport.
- `tools/p9/test.ts`, `tools/bridge/test.ts`, `tools/sync/test.ts` — Node loopback 9p test, dedicated/embedded/reconnect/multi-session bridge tests, and terminal/conflict/failure sync-safety tests. `npm run test` runs all three.
- `src/lib/ide/project-source.ts`, `runtime.ts`, `session.svelte.ts`, and `pod-runtime.ts` — small optional hooks for wrapping `WorkspaceFs`, watching remote trees, and attaching a hoster after BrowserPod boots.
- Upstream `IdeShell.svelte` remains in the tree but is no longer the entry UI; old landing/agent routes redirect rather than opening a second workspace.

## GitHub Pages constraints

- Static hosting only: no TCP/WebSocket 9p listener.
- No arbitrary response headers: `coi-serviceworker.js` supplies COOP/COEP on document navigations on first visit and reloads once.
- SPA routes need `404.html`; `svelte.config.js` uses that fallback on Pages.
- `paths.base = /DrakeForge`, `paths.relative = false`, and all internal links are base-aware.
- `.nojekyll` prevents Jekyll from dropping SvelteKit's `_app/` directory.
- All cross-origin scripts without CORS/CORP opt-in were removed from the static shell.
