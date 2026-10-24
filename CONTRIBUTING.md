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
