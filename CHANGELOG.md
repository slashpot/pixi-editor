# Changelog

## 0.1.0 — unreleased

- Dev-only Vite plugin with an in-browser overlay for `@pixi/react` scenes: Hierarchy, Inspector, toolbar, move / resize gizmo, snapping, portrait / landscape preview.
- Writes every change back to the `.tsx` source as a text splice: literals, same-file consts, orientation ternaries, object fields, texture keys; insert / delete / duplicate / reorder; undo and redo.
- Dragging one item of a `.map` list moves only that item, written as a per-index case (`x={i === 0 ? 80 : 40}`).
- Dragging edits the number term of a sum (`y={40 + i * 100}` → `y={48 + i * 100}`) instead of flattening it into a literal.
- Dragged positions are written as whole numbers; sub-unit jitter on the other axis is ignored.
- Source tagging runs as a Vite transform, so it works with both `@vitejs/plugin-react` and `@vitejs/plugin-react-swc`, and with React Compiler.
- No runtime dependencies besides the `vite`, `pixi.js` and `@pixi/react` peers.
- The dev-server API requires a custom header, which blocks cross-site requests.
- Options: `queryParam`, `root`, `palette`, `previewRoot`.
