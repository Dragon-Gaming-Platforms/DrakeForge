# DrakeForge — Dragon86-themed BrowserCode workspace

DrakeForge is a GitHub Pages-hosted fork of [BrowserCode](https://github.com/leaningtech/browsercode) that opens **one unified IDE workspace per browser tab**. It is themed after VS Code's layout and Dragon86's real "Dragon Red" stylesheet.

| Route                                                      | Mode                                        | Filesystem                                            | Dragon86 changes                |
| ---------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------- | ------------------------------- |
| `/DrakeForge/`                                             | **Unified workspace, connected by default** | Dragon86 ZenFS `/home/user` over `fs1`                | **None**                        |
| `/DrakeForge/dragon86`                                     | Connected alias                             | Same as root                                          | **None**                        |
| `/DrakeForge/dragon86?channel=dragon86-drakeforge-<uuid>`  | **Agent-assigned dedicated session**        | Same `fs1`, isolated BroadcastChannel                 | **None**                        |
| `/DrakeForge/?mode=embed`                                  | Embedded iframe                             | Same `fs1` over parent-frame `postMessage` only       | **None**                        |
| `/DrakeForge/standalone` or `/DrakeForge/?mode=standalone` | **Standalone**                              | Bundled in-browser 9p2000.L server on ZenFS/IndexedDB | None; does not contact Dragon86 |

The old BrowserCode landing, `/ide`, `/agents`, `/agents/[tool]` and `/embed` pages now redirect into this single workspace. The IDE runtime remains: Monaco editor, BrowserPod terminal, npm/dev-server previews, portals, CLI agents, Git commands, templates where reachable from the runtime, and the Java/CheerpJ runtime are not replaced.

## VS Code / Dragon86 UI

The shell is modeled on VS Code and on Dragon86's real `src/styles/theme.css` / `src/styles/os.css` (upstream `e30b868`). It uses the exact Dragon Red tokens:

```text
#e60012  primary        #ff1a2e  bright       #ff0033  glow
#8b0000  dark           #4a0000  dim          #ff4d5a  accent
#050505  darkest        #0a0a0a  dark         #0d0d0d  card
#121212  surface        #1a1a1a  border       #2a2a2a  border-light
#f0f0f0  text           #aaaaaa  secondary    #666666  dim
```

Layout:

- Dragon86-styled **title/menu bar** with the **DrakeForge** title.
- Left **activity bar**: Explorer / Files, Search, Source Control / Git, and Agents.
- **Explorer side bar** with new-file, new-folder, download, search, Git, and inline agent views.
- **Editor group** with Monaco tabs and a breadcrumb bar.
- **Preview group** for BrowserPod portals.
- VS Code-style **bottom panel** with Problems, Output, Debug Console, **Sync**, Terminal, and Ports tabs. The Sync panel surfaces failed writes, remote poll errors, and concurrent-edit conflicts with explicit local/remote resolution. The terminal spans the full workspace width and is resizable.
- Dragon Red **status bar** built from the same `linear-gradient(135deg,#e60012,#4a0000)` swatch Dragon86 uses for its Dragon Red theme.

The Git activity view echoes real `git status`, `log`, `add`, `commit`, `pull`, and `push` commands into the Output terminal. The **Agents** activity view runs the selected CLI agent inline through `AgentShell` in the same browser tab — no `/agents/[tool]` page and no `target="_blank"` launcher. Only one agent CLI is active at a time; switching tools or changing a credential relaunches that inline session without reloading the workspace. Provider OAuth may still open a temporary sign-in tab.

## Link to Dragon86

**Short version:** no Dragon86 changes are required. Point Dragon86's **Settings → Engine → Separate tab** URL at DrakeForge, press **Reconnect**, and Dragon86's existing `fs1` bridge does the rest. See [docs/link-to-dragon86.md](docs/link-to-dragon86.md) for the full wire protocol, transports, and one-tab explanation.

Dragon86 already advertises `caps: ["fs1"]` and serves `/home/user` over:

- hidden-iframe **parent-frame `postMessage`** in embedded mode, and
- separate-tab **`BroadcastChannel`** — `dragon86-hoster-v1` for legacy/CheerpX use, or `dragon86-drakeforge-<uuid>` when a Dragon86 agent assigns a dedicated session.

DrakeForge implements the _hoster/client_ side of that Cheerpx-Bridge-compatible contract: `hello` → `ready`, terminal `data`/`resize`/`exit`, and whole-file `fs-req`/`fs-res`. A dedicated `?channel=` session opens only its assigned BroadcastChannel; `?mode=embed` opens only postMessage; no `channel` keeps the default for backward compatibility. This is **not raw 9p**; Dragon86's `p9.ts` is an in-page v86 virtio callback, not a network endpoint. The standalone mode bundles that 9p handler in a Web Worker instead and speaks literal 9p frames over `postMessage`.

BrowserPod has no public mount hook, so `SyncedWorkspaceFs` mirrors the remote tree into `/home/user/dragon86` inside BrowserPod and performs a three-way reconcile every 2 seconds. It scans the pod workdir so terminal-created files are pushed too; failed writes are surfaced and retried; concurrent divergent edits are preserved as a conflict with a remote copy, not silently overwritten. The `fs1` path is capped at 16 MB per file and 5,000 tree entries, matching Dragon86.

## Connected setup

1. Deploy to GitHub Pages at `https://dragon-gaming-platforms.github.io/DrakeForge/`.
2. In Dragon86, open **Settings → Engine**, choose **Separate tab**.
3. If the Dragon86 agent supplies a session UUID, set the engine URL to `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86?channel=dragon86-drakeforge-<uuid>`; otherwise use `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86` or the root `/DrakeForge/`.
4. Press **Reconnect** / **Open Engine Tab**.
5. Dragon86 sends `hello`; DrakeForge answers `ready` once BrowserPod and its bridged bash shell are live. Dragon86's terminal then drives that shell while the workspace UI stays in the DrakeForge tab.

Default remote root: `/Dragon86-IDE` inside `/home/user`. Override with `?root=/Documents` or `?root=/`. Use `?mode=embed` and `integrations/dragon86/BrowserCode-IDE.d86` to embed the workspace inside a Dragon86 window; Dragon86's top page supplies cross-origin isolation. Embedded mode intentionally disables BroadcastChannel.

Both Pages sites share `https://dragon-gaming-platforms.github.io`, which is why the BroadcastChannel works. A custom domain would break tab mode.

## Standalone mode

`/DrakeForge/standalone` or `/DrakeForge/?mode=standalone` needs no Dragon86 tab. A Web Worker configures ZenFS (`/home` on IndexedDB, `/tmp` in memory), seeds a small Node project, runs Dragon86's `createP9Handler`, and exchanges raw 9p2000.L frames with the page over `postMessage`. Files persist in that browser's IndexedDB and are mirrored into BrowserPod through the same sync layer.

## Cross-origin isolation and API key

BrowserPod needs `SharedArrayBuffer`. GitHub Pages cannot set `COOP`/`COEP` directly, so `coi-serviceworker.js` supplies them on the first top-level visit. Embedded frames inherit isolation from Dragon86.

Add a BrowserPod key authorized for `https://dragon-gaming-platforms.github.io` as the repository Actions secret **`VITE_API_KEY`**. The workflow injects it at build time only. It is never committed; note that `VITE_*` values are visible in the static client bundle, so the key must be origin-restricted.

## Local development

```sh
cd vendor/browsercode
npm ci
cp .env.example .env       # optional local BrowserPod key
npm run dev                # http://localhost:5173/DrakeForge/
npm run check
npm run lint
npm run test               # 9p loopback + dedicated/embedded bridge + sync-safety tests
NODE_OPTIONS=--max-old-space-size=4096 PAGES_BASE=/DrakeForge PAGES_FALLBACK=404.html npm run build
```

The Monaco/TypeScript workers push Vite's production build past Node's default 2 GB heap; the workflow and command above raise it to 4 GB.

## Deployment

`.github/workflows/deploy.yml` runs `check`, `lint`, and the full `npm run test` suite on PRs to `main`, then deploys `vendor/browsercode/dist` after a `main` push or manual dispatch with `actions/deploy-pages`. Set Pages → Build and deployment → Source: **GitHub Actions** once; the workflow's `configure-pages` step also attempts this.

## Provenance and licenses

- `vendor/browsercode/` — BrowserCode 1.3.0, upstream `7ac575cf8f4449ec90b1891c4b038a86a14c41d5`, Apache-2.0.
- Bridge protocol — Dragon-Gaming-Platforms/Cheerpx-Bridge, AGPL-3.0.
- 9p server — Dragon-Gaming-Platforms/Dragon86 `src/bridge/p9.ts`, AGPL-3.0.
- UI tokens/styles — Dragon-Gaming-Platforms/Dragon86 `src/styles/theme.css` and `src/styles/os.css`, upstream `e30b868`, AGPL-3.0; VS Code layout is a visual model, not copied code.
- `coi-serviceworker` — MIT, © Guido Zuidhof and contributors.
- BrowserPod — proprietary runtime from Leaning Technologies, loaded from its CDN under its own terms.

See [docs/architecture.md](docs/architecture.md) and [docs/link-to-dragon86.md](docs/link-to-dragon86.md).
