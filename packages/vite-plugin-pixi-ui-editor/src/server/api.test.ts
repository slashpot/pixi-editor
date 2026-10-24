import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_HEADER, type DraftFile, type ElementInfo } from '../shared';
import { hashOf } from './ast';
import { editorApi } from './api';
import { DEFAULT_PALETTE } from './palette';

const CODE = `export const A = () => (
  <pixiContainer>
    <pixiSprite x={10} />
  </pixiContainer>
);
`;
const SPRITE = 'src/A.tsx:3:5';

let root: string;
let handle: ReturnType<typeof editorApi>;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pixi-ui-editor-api-')));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'node_modules/lib'), { recursive: true });
  await writeFile(join(root, 'src/A.tsx'), CODE);
  await writeFile(join(root, 'node_modules/lib/B.tsx'), CODE);
  handle = editorApi(root, DEFAULT_PALETTE);
});

afterEach(() => rm(root, { recursive: true, force: true }));

/** Calls the middleware the way Connect would, with the method, path, headers and JSON body given. */
async function request(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = defaultHeaders(method),
) {
  const req = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), {
    method,
    url,
    headers,
  }) as unknown as IncomingMessage;
  let status = 0;
  let payload = '';
  await new Promise<void>((done) => {
    const res = {
      set statusCode(code: number) {
        status = code;
      },
      setHeader() {},
      end(text: string) {
        payload = text;
        done();
      },
    } as unknown as ServerResponse;
    void handle(req, res);
  });
  return { status, json: JSON.parse(payload) };
}

function defaultHeaders(method: string): Record<string, string> {
  return method === 'POST' ? { [API_HEADER]: '1', 'content-type': 'application/json' } : { [API_HEADER]: '1' };
}

const fileText = () => readFile(join(root, 'src/A.tsx'), 'utf8');
/** What the editor and the app see: the draft, else the disk. */
const draftText = async () => {
  const { json } = await request('GET', '/drafts');
  return (json as DraftFile[]).find((d) => d.file === 'src/A.tsx')?.after ?? fileText();
};

describe('editorApi', () => {
  it('describes an element', async () => {
    const { status, json } = await request('GET', `/element?src=${encodeURIComponent(SPRITE)}`);
    expect(status).toBe(200);
    const info = json as ElementInfo;
    expect(info.tag).toBe('pixiSprite');
    expect(info.hash).toBe(hashOf(CODE));
    expect(info.props).toEqual([{ name: 'x', code: '{10}', edit: { value: 10, via: 'literal' } }]);
  });

  it('edits into a draft, then undoes and redoes it', async () => {
    const edit = await request('POST', '/edit', { src: SPRITE, hash: hashOf(CODE), edits: [{ prop: 'x', value: 42 }] });
    expect(edit.status).toBe(200);
    expect(await draftText()).toContain('<pixiSprite x={42} />');
    expect(await fileText()).toBe(CODE);

    expect((await request('POST', '/undo', {})).json).toEqual({ file: 'src/A.tsx' });
    expect((await request('GET', '/drafts')).json).toEqual([]);
    await request('POST', '/redo', {});
    expect(await draftText()).toContain('<pixiSprite x={42} />');
    expect(await fileText()).toBe(CODE);
  });

  it('reads the draft: the next edit carries its hash and describes it', async () => {
    await request('POST', '/edit', { src: SPRITE, hash: hashOf(CODE), edits: [{ prop: 'x', value: 42 }] });
    const { json } = await request('GET', `/element?src=${encodeURIComponent(SPRITE)}`);
    expect((json as ElementInfo).props[0].edit?.value).toBe(42);
    const again = await request('POST', '/edit', { src: SPRITE, hash: json.hash, edits: [{ prop: 'x', value: 43 }] });
    expect(again.status).toBe(200);
    expect(await draftText()).toContain('<pixiSprite x={43} />');
  });

  it('applies drafts to disk', async () => {
    await request('POST', '/edit', { src: SPRITE, hash: hashOf(CODE), edits: [{ prop: 'x', value: 42 }] });
    expect((await request('GET', '/drafts')).json).toEqual([
      { file: 'src/A.tsx', before: CODE, after: CODE.replace('x={10}', 'x={42}') },
    ]);
    expect((await request('POST', '/apply', {})).json).toEqual({ files: ['src/A.tsx'] });
    expect(await fileText()).toContain('<pixiSprite x={42} />');
    expect((await request('GET', '/drafts')).json).toEqual([]);

    // undo after applying drafts the revert; the disk keeps the applied edit
    await request('POST', '/undo', {});
    expect(await draftText()).toBe(CODE);
    expect(await fileText()).toContain('<pixiSprite x={42} />');
  });

  it('discards drafts, and with them the undo history', async () => {
    await request('POST', '/edit', { src: SPRITE, hash: hashOf(CODE), edits: [{ prop: 'x', value: 42 }] });
    expect((await request('POST', '/discard', {})).json).toEqual({ files: ['src/A.tsx'] });
    expect(await draftText()).toBe(CODE);
    expect((await request('POST', '/undo', {})).status).toBe(400);
  });

  it('answers 409 when the file changed since it was read', async () => {
    const { status } = await request('POST', '/edit', { src: SPRITE, hash: 'stale', edits: [{ prop: 'x', value: 1 }] });
    expect(status).toBe(409);
    expect(await fileText()).toBe(CODE);
  });

  it.each([
    ['outside the workspace', '../outside.tsx:1:1'],
    ['inside node_modules', 'node_modules/lib/B.tsx:3:5'],
    ['not a JSX file', 'src/A.ts:1:1'],
    ['malformed', 'src/A.tsx'],
  ])('refuses a src %s', async (_label, src) => {
    const { status } = await request('GET', `/element?src=${encodeURIComponent(src)}`);
    expect(status).toBe(400);
  });

  it('refuses requests without the editor header, or POSTs that are not JSON', async () => {
    const body = { src: SPRITE, hash: hashOf(CODE), edits: [{ prop: 'x', value: 1 }] };
    expect((await request('POST', '/edit', body, { 'content-type': 'application/json' })).status).toBe(403);
    expect((await request('GET', `/element?src=${encodeURIComponent(SPRITE)}`, undefined, {})).status).toBe(403);
    expect((await request('POST', '/edit', body, { [API_HEADER]: '1', 'content-type': 'text/plain' })).status).toBe(
      415,
    );
    expect(await fileText()).toBe(CODE);
  });

  it('inserts from the palette it was given', async () => {
    const palette = await request('GET', '/palette');
    expect(palette.json.map((p: { kind: string }) => p.kind)).toEqual(['container', 'sprite', 'text', 'graphics']);

    const insert = await request('POST', '/insert', {
      src: SPRITE,
      hash: hashOf(CODE),
      placement: 'after',
      kind: 'container',
      x: 1.4,
      y: 2,
    });
    expect(insert.json).toEqual({ src: 'src/A.tsx:4:5', hash: hashOf(await draftText()) });
    expect(await draftText()).toContain('    <pixiSprite x={10} />\n    <pixiContainer x={1} y={2} />\n');
  });

  it('reports unknown endpoints', async () => {
    expect((await request('GET', '/nope')).status).toBe(404);
  });
});
