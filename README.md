# DrakeForge — BrowserCode IDE for Dragon86

DrakeForge is a GitHub Pages-hosted fork of [BrowserCode](https://github.com/leaningtech/browsercode) that adds two Dragon86-aware IDE modes:

| Route | Mode | Filesystem | Dragon86 changes |
| --- | --- | --- | --- |
| `/DrakeForge/dragon86` | **Connected** | Dragon86's ZenFS `/home/user` over the existing `fs1` bridge | **None** |
| `/DrakeForge/standalone` | **Standalone** | A bundled, in-browser 9p2000.L server backed by ZenFS/IndexedDB | None; does not contact Dragon86 |
| `/DrakeForge/` and all original BrowserCode routes | Upstream BrowserCode | BrowserPod's normal filesystem | None |

The original BrowserCode feature set is preserved: the playground IDE, Monaco editor, BrowserPod terminal, npm/dev-server previews, portals, agent CLIs, templates, GitHub clone, and Java/CheerpJ mode.

## Do I need to change Dragon86?

**No — not for the connected mode.** Dragon86 already exposes `/home/user` through protocol v2 `fs1` over both of the transports used by [Cheerpx-Bridge](https://github.com/Dragon-Gaming-Platforms/Cheerpx-Bridge):

- hidden-iframe `postMessage`, and
- separate-tab `BroadcastChannel` named `dragon86-hoster-v1`.

Dragon86 advertises `caps: ["fs1"]` in its `hello` and answers `fs-req` messages from the hoster. DrakeForge implements the *hoster* side of that contract: it answers `hello` with `ready`, sends `fs-req`/`fs-res`, and mirrors the remote tree into BrowserPod's workspace so the editor, terminal, and dev server see the same project files.

Dragon86's real 9p2000.L server (`src/bridge/p9.ts`) is an in-page callback wired to v86's virtio channel, not a network endpoint. Cheerpx-Bridge deliberately uses the whole-file `fs1` protocol instead. Copying the Cheerpx-Bridge protocol is therefore the correct way to connect **without** modifying Dragon86. The standalone mode bundles a copy of Dragon86's 9p handler in a Web Worker; it emits literal 9p frames over `postMessage`, but it is not a network server and cannot be hosted as one by GitHub Pages.

## How the filesystem integration works

BrowserPod's public API does not expose a filesystem mount hook, so a direct 9p mount into BrowserPod is not available. DrakeForge uses a synchronization layer instead:

1. On boot, the IDE fetches the remote tree (`fs1` `tree` or local 9p `readdir`/`getattr`) and hydrates those files into BrowserPod at `/home/user/dragon86`.
2. Editor saves, creates, renames, and deletes are written to BrowserPod first, then pushed to the remote filesystem.
3. A 2-second poll pulls externally changed or newly created files from the remote filesystem into BrowserPod and refreshes the file tree.
4. A local-pending set prevents the poll from immediately overwriting a save that has not yet appeared in the remote tree. Remote edits win if both sides change the same file between polls.

This is eventual, whole-file consistency — not byte-range POSIX semantics. The `fs1` path is capped at 16 MB per file and 5,000 tree entries, matching Dragon86's implementation.

## Connected mode setup

1. Deploy this repository to GitHub Pages at `https://dragon-gaming-platforms.github.io/DrakeForge/`.
2. Open Dragon86 → **Settings → Engine**.
3. Choose **Separate tab**.
4. Set the engine URL to `https://dragon-gaming-platforms.github.io/DrakeForge/dragon86`.
5. Open the Terminal and press **Reconnect** (or use **Open Engine Tab**). Dragon86 opens DrakeForge as its engine tab and sends `hello` over the same-origin `BroadcastChannel`.
6. DrakeForge answers `ready` once BrowserPod and its bridged bash shell are running. Dragon86's Terminal now drives that shell, while the DrakeForge tab shows the full IDE.

The default remote project root is `/Dragon86-IDE` inside Dragon86's `/home/user`. Override it with `?root=/Documents` or `?root=/` (the whole home directory). To embed the IDE directly in Dragon86 instead, use `?mode=embed` and a `.d86` shortcut like the one in `integrations/dragon86/`.

All project sites under `dragon-gaming-platforms.github.io` share one origin, which is why `BroadcastChannel` works across the two project pages. A custom domain would break that tab mode and require an updated origin allowlist.

## Standalone mode

`/DrakeForge/standalone` needs no Dragon86 tab. It starts a Web Worker that:

- configures ZenFS with an IndexedDB-backed `/home` mount,
- seeds a tiny Node.js project on first run,
- runs Dragon86's `createP9Handler` at `/home/user/dragon86-ide`, and
- exchanges raw 9p2000.L frames with a client in the page over `postMessage`.

Files persist in that browser's IndexedDB. The IDE still boots BrowserPod for terminal/preview; the worker's files are mirrored into the pod through the same sync layer.

## Cross-origin isolation

BrowserPod needs `SharedArrayBuffer`. GitHub Pages cannot set `COOP`/`COEP` response headers directly, so this fork vendors `coi-serviceworker` (MIT), exactly as Dragon86 and Cheerpx-Bridge do. The worker registers only on a top-level, non-isolated page; an embedded DrakeForge frame inherits isolation from Dragon86's already-isolated top page.

## BrowserPod API key

The public BrowserCode/BrowserPod runtime requires `VITE_API_KEY`. Add a key authorized for `https://dragon-gaming-platforms.github.io` as the repository secret **`VITE_API_KEY`**. The workflow injects it only at build time; it is never committed. Without a valid key the static site still builds, but BrowserPod-backed routes will fail to boot. The standalone 9p worker itself needs no key.

## Local development

```sh
cd vendor/browsercode
npm ci
cp .env.example .env       # optional: put a development BrowserPod key here
npm run dev                # http://localhost:5173/DrakeForge/
npm run check
npm run test:p9            # exercises the bundled 9p client/server over a loopback transport
NODE_OPTIONS=--max-old-space-size=4096 PAGES_BASE=/DrakeForge PAGES_FALLBACK=404.html npm run build
```

`PAGES_BASE` defaults to `/DrakeForge`. Set `PAGES_BASE=/` when serving from a domain root. `PAGES_FALLBACK` defaults to `404.html`, which is what GitHub Pages uses for SPA routes. The Monaco/TypeScript worker bundles make Vite's production build exceed Node's default 2 GB heap; the workflow and the command above raise it to 4 GB with `NODE_OPTIONS`.

## Deployment

`.github/workflows/deploy.yml` builds `vendor/browsercode` and deploys `dist/` with `actions/deploy-pages`. It runs on `main` and supports `workflow_dispatch`. One-time requirement: Pages → Build and deployment → Source: **GitHub Actions** (the workflow's `actions/configure-pages` step also attempts this).

## Provenance and licenses

- `vendor/browsercode/` — BrowserCode 1.3.0, upstream commit `7ac575cf8f4449ec90b1891c4b038a86a14c41d5`, Apache-2.0. Its `LICENSE.txt` is preserved.
- Bridge protocol/transport code — adapted from Dragon-Gaming-Platforms/Cheerpx-Bridge, AGPL-3.0.
- 9p2000.L server code — adapted from Dragon-Gaming-Platforms/Dragon86 `src/bridge/p9.ts`, AGPL-3.0.
- `coi-serviceworker` — MIT, © Guido Zuidhof and contributors; license in `third-party/`.
- BrowserPod runtime — proprietary Leaning Technologies software loaded from its CDN under its own terms. It is not vendored here.

See [docs/architecture.md](docs/architecture.md) for the protocol and sync diagrams.
