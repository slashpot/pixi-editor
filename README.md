# vite-plugin-pixi-ui-editor

> [!WARNING]
> **Work in progress.** This project is still under development and is not published to npm yet. APIs and behavior may change without notice.

A Unity-like visual editor for [`@pixi/react`](https://github.com/pixijs/pixi-react) scenes, built as a dev-only Vite plugin. You select, drag, resize, add, delete and reorder UI elements on the running app.

**Your `.tsx` source stays the single source of truth.** Every editor action is a small, local rewrite of the source file, and Vite HMR updates the screen. Edits you make in your IDE show up in the editor too.

**Nothing touches your files until you confirm.** Editor changes are kept as a draft on the dev server: the app runs the draft, while the files on disk stay as they were. Review the diff and apply it (or discard it) from the toolbar.

- Runs only on the dev server. `vite build` output contains no editor code and no source tags.
- Your app needs nothing beyond `vite`, `pixi.js` and `@pixi/react`. The parser the plugin uses is bundled into it.
- Works with `@vitejs/plugin-react` (Babel, React Compiler) and `@vitejs/plugin-react-swc`.

## Try it online

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/slashpot/pixi-editor?file=examples/react-demo/src/Scene.tsx)

This runs the demo's dev server in your browser; no account is needed.

- The first start takes a while, because it installs the dependencies and builds the plugin.
- Press **Open editor** in the scene (or add `?editor` to the preview URL) to open the editor. When you apply your changes, they are written to the files in the StackBlitz editor next to the preview.
- Keyboard shortcuts such as `Ctrl/Cmd+S` only work while the preview has focus. Click the preview first.

## Setup

Peer dependencies: `vite` 6 (6.0.9 or later), 7 or 8, `pixi.js` 8, and `@pixi/react` 8.

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { pixiUiEditor } from 'vite-plugin-pixi-ui-editor';

export default defineConfig({
  plugins: [react(), pixiUiEditor()],
});
```

Run `vite` and open your app with `?editor`, for example `http://localhost:5173/?editor`. Without the query parameter the page runs untouched.

The editor finds your Pixi `Application` automatically, through the init hook that pixi.js v8 calls. If you create the app in an unusual way, set `globalThis.__PIXI_APP__ = app`; this is the same convention `@pixi/devtools` uses.

## Using the editor

The screen has three parts: the **Hierarchy** on the left, the **Inspector** on the right, and the **toolbar** at the bottom right.

### On the canvas

While select mode is on (`F2` toggles it), pointer input on the canvas goes to the editor instead of the app.

| Action                                           | Effect                                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Click                                            | Selects the JSX element under the pointer. A click on a reusable component (one called from more than one place, such as a `<Button>`) selects the **call site**, not the component's internals. |
| Click the same spot again                        | Drills one level deeper, for example into `Button.tsx`.                                                                                                                                          |
| Drag                                             | Moves the selection; you can press anywhere inside it. `Shift` locks the axis, `Alt` suspends snapping, `Esc` cancels.                                                                           |
| White handle at the bottom right                 | Resizes. If the element sets `width`/`height`, those are edited (`Shift` keeps the aspect ratio); otherwise `scale` is.                                                                          |
| Arrow keys                                       | Nudge by 1px (`Shift`: 10px). The change is written once the keys go quiet for 0.5s.                                                                                                             |
| `Delete` or `Backspace` / `Ctrl/Cmd+D`           | Deletes (after confirming) / duplicates.                                                                                                                                                         |
| `Esc`                                            | Clears the selection (during a drag, cancels the drag instead).                                                                                                                                  |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` | Undo / redo. These only cover changes the editor made.                                                                                                                                           |
| The selection's label on the canvas              | Click it to open the element's source in your IDE.                                                                                                                                               |
| `Ctrl/Cmd+S`                                     | Opens the review of unapplied changes (see [Drafts](#drafts)).                                                                                                                                   |

The change is drafted when you release the drag. How the new value is written back:

- **A literal, or a prop that isn't set yet**: changed or inserted in place.
- **A same-file `const`** (`y={popupY}`): the const is edited. If several places read it, the editor asks whether to move them all or to replace only this one with a literal.
- **A sum with a number term** (`y={40 + i * 100}`, `x={width - 20}`): dragging shifts only the number (`y={48 + i * 100}`), so the rest of the expression, such as a list's spacing, is kept.
- **`isPortrait ? a : b`** (also `!isPortrait`, `display.isLandscape`, or a const holding such a ternary): **only the side for the current orientation** is edited.
- **Any other expression**: the editor asks whether to replace it with a literal; if you cancel, the element snaps back. Elements rendered in a loop show how many instances share the source.
- **The written value is computed from the source**: it is the number in your source plus the drag delta. So a component that transforms its props (`x={props.x + 10}`) still gets the right number.
- **An item of a list** (rendered by `.map`): all items share one JSX source, so they all move together while you drag one. When you release, the editor asks before writing: OK writes the move (a sum such as `y={40 + i * 100}` keeps its spacing), Cancel puts every item back. Arrow-key nudges ask once the keys go quiet.
- Dragged positions are written as whole numbers. An axis that moved less than half a unit, such as hand jitter while dragging sideways, is left untouched.

### Hierarchy (left)

- A tree of every JSX element on screen. `◆` marks a component call, and an element's `label` prop is shown next to its name. Greyed-out rows are currently invisible. Hovering a row outlines the element on the canvas; double-clicking a row opens the file in your IDE.
- Filter by name, label or file name.
- **Add**: pick a kind (Container, Sprite, Text, Graphics), then **+ Child** or **+ After**. Any imports the new element needs are added to the file.
- **Drag & drop**: drop on the top edge of a row to place the element before it, on the bottom edge for after, and in the middle to make it a child. This only works within one file.

### Inspector (right)

| In the source                                                                                           | In the Inspector                                                                      |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `x={680}`, `eventMode="none"`, `visible`                                                                | Editable directly.                                                                    |
| `y={popupY}`                                                                                            | Editable; labelled `const popupY` (orange when the const is shared).                  |
| `texture={Texture.from('key')}`, `Assets.get('key')`                                                    | The key is editable, with suggestions from the loaded textures.                       |
| `y={isPortrait ? 650 : 360}`                                                                            | One field for portrait and one for landscape; the current orientation is highlighted. |
| `anchor={{ x: 0.5, y: 0 }}`, `layout={{ … }}`, `style={textStyle}` (pointing at `new TextStyle({ … })`) | Expanded into fields, each editable (up to 3 levels deep).                            |
| Any other expression                                                                                    | Read-only, with the live runtime value shown next to it.                              |

The Inspector also has Duplicate and Delete buttons, and **Add prop**, which inserts `x/y/alpha/scale/angle/visible` using the current runtime value.

### Toolbar (bottom right)

- **● N unapplied**: opens the review of drafted changes (see below).
- Undo / redo and the select-mode toggle.
- **Snap**: while dragging, positions snap to a grid in the parent's coordinates, and the grid is drawn.
- **Preview**: portrait 9:16 or landscape 16:9. This boxes the root element (`#root` by default) to that ratio and makes `window.innerWidth/innerHeight` report the box size, so your layout code reacts as it would on such a device. The chosen preview is kept across reloads.

### Drafts

Every change the editor makes, from a drag to a delete, goes into a draft first. The dev server serves the drafted text instead of the file on disk, so the app (and a page reload) shows your edits while your files stay untouched.

- The review panel (`Ctrl/Cmd+S`, or the toolbar's **● N unapplied** button) shows a diff per changed file.
- **Apply to source** writes every draft to disk. **Discard all** drops them all (after confirming) and the app goes back to your files.
- Undo / redo work on the draft. After applying, an undo drafts the revert; it doesn't touch the disk either.
- If a drafted file changes on disk (you edit it in your IDE, or `git checkout`), the disk wins: that file's draft is dropped and the app reloads it.

## Options

```ts
pixiUiEditor({
  // Query parameter that turns the overlay on. Default: 'editor'
  queryParam: 'editor',
  // Directory the editor may write to; source paths are shown relative to it.
  // Default: the workspace root Vite detects (your monorepo root, or the project itself).
  root: '../..',
  // Customize the Hierarchy's "Add" menu.
  palette: (defaults) => [
    ...defaults,
    {
      kind: 'button',
      label: 'Button',
      needsTexture: true,
      imports: [{ name: 'Button', from: '@acme/ui' }],
      jsx: ({ x, y, texture }) => `<Button x={${x}} y={${y}} texture="${texture}" />`,
    },
  ],
  // CSS selector of the element the orientation preview boxes. Default: '#root'
  previewRoot: '#app',
});
```

The default palette inserts `pixiContainer`, `pixiSprite`, `pixiText` and `pixiGraphics`. Your app must already register these with `extend()` from `@pixi/react` for the inserted elements to render.

## How it works

1. **Source tags** (`src/tag-jsx.ts`). A `pre` transform adds `__src="file:line:col"` to every pixi intrinsic JSX element (`<pixiSprite>`, `<layoutContainer>`, …). It also tags every component that is defined in the same file or imported from your own code; code that resolves into `node_modules` is never tagged. `@pixi/react` copies the attribute onto the Pixi object, while components keep it in their React props.
2. **Fiber index** (`src/client/fiber-index.ts`). The overlay script is injected at the very top of `<head>`, so it installs the React DevTools hook before `@pixi/react` loads. Walking the fiber tree maps each Pixi object on screen to its JSX element (including component call sites) and builds the Hierarchy.
3. **Dev-server API** (`src/server/`). The server locates elements with a Babel AST and edits the file by **splicing text**: only the edited value changes, and formatting and comments are kept byte for byte. Every write carries a hash of the file, so a file changed elsewhere is never overwritten. Every write is also recorded for undo; an undo is refused if the file was changed outside the editor in the meantime.
4. **Drafts** (`src/server/drafts.ts`). Writes land in an in-memory draft instead of on disk. The plugin's `load` hook serves a drafted file's text, and HMR reloads its module, so the app runs the draft. Applying writes the drafts to disk; a file changed on disk drops its draft.

## Security

The editor's API rewrites files under `root` (when you apply drafts). Its safeguards:

- Requests must carry a custom header, so other websites can't call the API through your browser; that would need a CORS preflight, which the dev server doesn't grant them.
- Vite's host check (`server.allowedHosts`) runs before the API, which blocks DNS rebinding.
- Writes are limited to `.jsx`/`.tsx` files inside `root`, and never under `node_modules`. A symlink that points outside `root` is refused.

These safeguards rely on Vite's defaults. Setting `server.cors: true` (or a CORS `origin` that lets other sites in) or `server.allowedHosts: true` turns them off, and any website you visit could then edit your files. The plugin prints a warning when the dev server starts with one of these settings, or with `--host`.

If you expose the dev server to your network (`vite --host`), **anyone who can reach it can edit those files**. Only do that on networks you trust.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Known limitations

- Pixi objects created imperatively (`new Sprite()` in an effect) have no JSX. Only the component that contains them is visible, and they cannot be edited on their own.
- Components from third-party packages are not tagged. Clicking one selects the element that wraps it.
- Moving an element across files is not supported, because another file is another component. An element that sits in a conditional, in a `.map`, or at the top of a `return` cannot be moved, deleted or duplicated; the editor tells you so.
- Elements with a `{...spread}`, or positioned with the `position` prop, can't be written back by dragging. Object fields can be edited but not added.
- Resizing scales around the anchor/pivot. The preview only overrides `innerWidth/innerHeight` and the root element, so code that reads `screen.*` or `matchMedia` won't follow it.
- Undo history and unapplied drafts live in dev-server memory: restarting the dev server (which Vite also does when `vite.config` changes) loses them. Apply before you restart.

## Roadmap

- **Plain pixi.js support** (no React): tag `new Sprite(...)` and similar call sites, build the Hierarchy from the stage tree, and write back constructor options and `sprite.x = …` assignments.

## Development

```bash
pnpm install
pnpm build        # build the plugin (packages/vite-plugin-pixi-ui-editor/dist)
pnpm dev          # run examples/react-demo, open http://localhost:5173/?editor
pnpm test         # unit tests (vitest)
pnpm e2e          # end-to-end tests (Playwright, against a copy of the demo)
pnpm typecheck
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Eric Lin
