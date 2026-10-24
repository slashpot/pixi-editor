import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { relative, resolve, sep } from 'node:path';
import {
  API_HEADER,
  type EditRequest,
  type ElementInfo,
  type InsertRequest,
  type MoveRequest,
  type StructureResult,
} from '../shared';
import { EditError, hashOf } from './ast';
import { createHistory } from './history';
import { findTemplate, type PaletteTemplate, paletteItems } from './palette';
import { applyEdits, describeElement } from './source-model';
import { duplicateElement, insertElement, type Located, moveElement, removeElement } from './structure';

interface SrcRequest {
  src: string;
  hash: string;
}

/**
 * Connect middleware mounted at API_BASE. Every write goes through `history`
 * (undo / redo); Vite's watcher + Fast Refresh then update the app.
 *
 * Every request must carry the `API_HEADER` header (and POSTs a JSON content type).
 * A custom header can't be sent cross-origin without a CORS preflight, which the
 * dev server doesn't grant to other sites — so a web page the developer happens to
 * visit can't rewrite their files.
 *
 *   GET  /element?src=src/Foo.tsx:12:7             → ElementInfo
 *   GET  /palette                                  → PaletteItem[]
 *   POST /edit       EditRequest                   → ElementInfo after the edit
 *   POST /insert     InsertRequest                 → StructureResult (the new element)
 *   POST /duplicate  { src, hash }                 → StructureResult (the copy)
 *   POST /move       MoveRequest                   → StructureResult (the moved element)
 *   POST /remove     { src, hash }                 → { hash }
 *   POST /undo, /redo                              → { file }
 */
export function editorApi(workspaceRoot: string, palette: PaletteTemplate[]) {
  const history = createHistory();

  const routes: Record<string, (body: never) => Promise<unknown>> = {
    'POST /edit': async ({ src, hash, edits }: EditRequest) => {
      const { loc, code } = await open(workspaceRoot, src, hash);
      const done = applyEdits(code, loc.abs, loc.line, loc.col, edits);
      await history.write(loc.abs, code, done.code);
      const at = { ...loc, line: done.line, col: done.col };
      return info(`${loc.file}:${done.line}:${done.col}`, done.code, at);
    },
    'POST /insert': async (req: InsertRequest) => {
      const { loc, code } = await open(workspaceRoot, req.src, req.hash);
      const tpl = findTemplate(palette, req.kind);
      if (tpl.needsTexture && !req.texture) throw new EditError('Choose a texture first');
      const jsx = tpl.jsx({ x: Math.round(req.x), y: Math.round(req.y), texture: req.texture ?? '' });
      const done = insertElement(code, loc.abs, loc, req.placement, jsx, tpl.imports);
      return written(code, done, loc);
    },
    'POST /duplicate': async ({ src, hash }: SrcRequest) => {
      const { loc, code } = await open(workspaceRoot, src, hash);
      return written(code, duplicateElement(code, loc.abs, loc.line, loc.col), loc);
    },
    'POST /move': async (req: MoveRequest) => {
      const { loc, code } = await open(workspaceRoot, req.src, req.hash);
      const to = parseSrc(workspaceRoot, req.target);
      if (to.abs !== loc.abs)
        throw new EditError('Elements can only be moved within the same file (another file is another component)');
      return written(code, moveElement(code, loc.abs, loc, to, req.placement), loc);
    },
    'POST /remove': async ({ src, hash }: SrcRequest) => {
      const { loc, code } = await open(workspaceRoot, src, hash);
      const next = removeElement(code, loc.abs, loc.line, loc.col);
      await history.write(loc.abs, code, next);
      return { hash: hashOf(next) };
    },
    'POST /undo': async () => ({ file: relative(workspaceRoot, await history.undo()) }),
    'POST /redo': async () => ({ file: relative(workspaceRoot, await history.redo()) }),
    'GET /palette': async () => paletteItems(palette),
  };

  async function written(before: string, done: Located, loc: Loc): Promise<StructureResult> {
    await history.write(loc.abs, before, done.code);
    return { src: `${loc.file}:${done.line}:${done.col}`, hash: hashOf(done.code) };
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // only the path and query matter; the base is a placeholder for the URL parser
      const url = new URL(req.url ?? '/', 'https://dev-server');
      if (req.headers[API_HEADER] !== '1') return send(res, 403, { error: `missing ${API_HEADER} header` });
      if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json')) {
        return send(res, 415, { error: 'expected application/json' });
      }
      if (req.method === 'GET' && url.pathname === '/element') {
        const src = url.searchParams.get('src') ?? '';
        const loc = parseSrc(workspaceRoot, src);
        return send(res, 200, info(src, await readFile(loc.abs, 'utf8'), loc));
      }
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) return send(res, 404, { error: `unknown endpoint ${req.method} ${url.pathname}` });
      const payload = req.method === 'POST' ? JSON.parse((await body(req)) || '{}') : {};
      send(res, 200, await route(payload as never));
    } catch (e) {
      send(res, statusOf(e), { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

type Loc = ReturnType<typeof parseSrc>;

function info(src: string, code: string, loc: Loc): ElementInfo {
  return { src, hash: hashOf(code), ...describeElement(code, loc.abs, loc.line, loc.col) };
}

async function open(workspaceRoot: string, src: string, hash: string) {
  const loc = parseSrc(workspaceRoot, src);
  const code = await readFile(loc.abs, 'utf8');
  if (hashOf(code) !== hash)
    throw new ConflictError('The file was changed elsewhere and has been reloaded; please try again');
  return { loc, code };
}

/** "src/Foo.tsx:12:7" → absolute path; refuses anything outside the workspace or not JSX. */
function parseSrc(workspaceRoot: string, src: string) {
  const m = /^(.+):(\d+):(\d+)$/.exec(src);
  if (!m) throw new EditError(`Invalid src: ${src}`);
  const abs = resolve(workspaceRoot, m[1]);
  if (!abs.startsWith(workspaceRoot + sep) || !/\.[jt]sx$/.test(abs) || abs.includes(`${sep}node_modules${sep}`)) {
    throw new EditError(`Not allowed to edit: ${m[1]}`);
  }
  return { file: m[1], abs, line: Number(m[2]), col: Number(m[3]) };
}

class ConflictError extends Error {}

function statusOf(e: unknown) {
  if (e instanceof ConflictError) return 409;
  if (e instanceof EditError) return 400;
  return 500;
}

function body(req: IncomingMessage) {
  return new Promise<string>((ok, fail) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (data += chunk));
    req.on('end', () => ok(data));
    req.on('error', fail);
  });
}

function send(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}
