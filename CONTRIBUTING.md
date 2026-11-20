# Contributing to DrakeForge

## Layout

| Path | What it is |
| --- | --- |
| `README.md`, `docs/` | Product and architecture docs for this fork |
| `integrations/dragon86/` | `.d86` launcher pointers (no scripts) |
| `vendor/browsercode/` | The SvelteKit app (vendored BrowserCode + DrakeForge changes) |
| `vendor/browsercode/src/lib/dragon86/` | Bridge, fs1/9p remote FS, sync layer, workspace UI |
| `vendor/browsercode/tools/` | Node test suites (no browser required) |
| `.github/workflows/deploy.yml` | CI: check → lint → test → build → Pages deploy |

## Local development

```sh
cd vendor/browsercode
npm ci
cp .env.example .env       # optional local BrowserPod key
npm run dev                # http://localhost:5173/DrakeForge/
npm run check
npm run lint
npm run test
NODE_OPTIONS=--max-old-space-size=4096 PAGES_BASE=/DrakeForge PAGES_FALLBACK=404.html npm run build
```

## Tests

`npm run test` runs these suites in order (also wired as separate npm scripts):

| Script | Covers |
| --- | --- |
| `test:p9` | Real 9p2000.L server + client loopback on ZenFS InMemory |
| `test:bridge` | Session routing, dedicated/embedded/legacy transports, hello/ready/fs1 |
| `test:fs1` | fs1 client contract: CRUD, path safety, size/tree caps, timeouts |
| `test:sync` | Three-way sync: pulls, pushes, failed writes, conflicts, issue GC |
| `test:protocol` | Untrusted message parsing, origin allowlist, fs bounds |
| `test:launcher` | `.d86` launcher + standalone route + project-local COI contracts |
| `test:openrouter` | OpenRouter credential storage and Pi preset isolation |

CI runs `check`, `lint`, and the full `test` suite on pull requests to `main`, then deploys
`vendor/browsercode/dist` after a push to `main`.

## Conventions

- Do not commit secrets. `VITE_API_KEY` is an Actions secret; agent keys are user `localStorage`.
- Conflict copies (`*.drakeforge-remote-*`) are sync artifacts — never commit them; Stage excludes them.
- Prefer extending `tools/*` tests over ad-hoc manual checks for bridge/sync behavior.
- The Dragon86 wire contract lives in Cheerpx-Bridge / Dragon86 docs; keep `bridge/config.ts` aligned.
