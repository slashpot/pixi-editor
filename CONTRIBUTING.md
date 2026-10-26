# Contributing

Thanks for helping improve vite-plugin-pixi-ui-editor!

## Setup

Requires Node 20.19+ and pnpm 10.

```bash
pnpm install
pnpm --filter e2e exec playwright install chromium   # once, for the e2e tests
```

## Layout

| Path                                                     | What                                                                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `packages/vite-plugin-pixi-ui-editor/src/vite-plugin.ts` | The plugin: source-tag transform, dev-server API, client injection                                                    |
| `packages/vite-plugin-pixi-ui-editor/src/tag-jsx.ts`     | Adds `__src="file:line:col"` to pixi intrinsics and project components                                                |
| `packages/vite-plugin-pixi-ui-editor/src/server/`        | Reading and rewriting source: attribute values, structure (insert / move / remove), drafts, undo history, HTTP routes |
| `packages/vite-plugin-pixi-ui-editor/src/client/`        | The in-browser overlay: fiber index, gizmo, Hierarchy, Inspector, toolbar                                             |
| `examples/react-demo`                                    | Demo app, also the fixture for the e2e tests                                                                          |
| `e2e`                                                    | Playwright tests; each test edits a private copy of the demo                                                          |

The plugin builds into two bundles: `dist/index.js` (Node; Babel and magic-string are bundled in) and `dist/client.js` (browser). The build fails if either one imports anything other than `vite` (Node built-ins are fine) or `pixi.js`, respectively. That check keeps users' dependency trees clean, so don't add runtime dependencies. A devDependency that gets bundled is fine, as long as its license is permissive; the build lists every bundled package in `dist/THIRD_PARTY_LICENSES.md`.

## StackBlitz

The README's "Open in StackBlitz" link runs `pnpm build && pnpm dev` in a WebContainer (see `.stackblitzrc`). Native binaries can't run there, so rolldown (used by both tsdown and Vite) loads its WebAssembly build, `@rolldown/binding-wasm32-wasi`. That package must be the exact rolldown version, so the root `package.json` pins both:

- `devDependencies["@rolldown/binding-wasm32-wasi"]`
- `pnpm.overrides.rolldown`, because StackBlitz ignores the lockfile and would otherwise resolve a newer rolldown

For the same reason, `pnpm.overrides["@napi-rs/wasm-runtime"]` pins the binding's runtime: 1.2.6 needs `@emnapi/*` 2.0.0-beta.2, but the 1.2.15 binding pins 2.0.0-alpha.5, and the binding then fails to load. Remove the override once a binding release depends on a compatible `@emnapi`.

When you update Vite or tsdown to a version that needs a newer rolldown, bump both to the same version. CI fails if they differ from the rolldown in `pnpm-lock.yaml`. The build skips the `.d.ts` output on WebContainer, because the declaration parser has no WebAssembly build.

## Before opening a PR

```bash
pnpm format       # prettier
pnpm build
pnpm typecheck
pnpm test         # unit tests
pnpm e2e          # end-to-end tests
```

- Source rewrites must stay **text splices**. Never regenerate code from the AST: users' formatting and comments must survive byte for byte.
- Add a unit test for any new source-rewriting rule (`src/server/*.test.ts`) and, for UI behaviour, an e2e test (`e2e/tests`).
- Note user-facing changes in `CHANGELOG.md`.
