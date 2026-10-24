import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Plugin, searchForWorkspaceRoot } from 'vite';
import { DEFAULT_PALETTE, type PaletteTemplate } from './server/palette';
import { editorApi } from './server/api';
import { createDrafts, type Drafts } from './server/drafts';
import { exposureWarnings } from './server/exposure';
import { API_BASE, type ClientConfig, DEFAULT_QUERY_PARAM, DRAFTS_EVENT, type DraftsEvent } from './shared';
import { tagJsx } from './tag-jsx';

export interface PixiUiEditorOptions {
  /** Query param that turns the overlay on. Default `'editor'` (open `http://localhost:5173/?editor`). */
  queryParam?: string;
  /**
   * Directory the editor may write to; source paths are shown relative to it.
   * Default: the workspace root Vite detects for `root` (the monorepo root, or the project itself).
   */
  root?: string;
  /** Customize the Hierarchy's "Add" menu; receives the built-in Container / Sprite / Text / Graphics entries. */
  palette?: (defaults: PaletteTemplate[]) => PaletteTemplate[];
  /** CSS selector of the element the orientation preview boxes. Default `'#root'` (else the canvas' parent). */
  previewRoot?: string;
}

const CLIENT_ID = 'virtual:pixi-ui-editor/client';
const RESOLVED_CLIENT_ID = `\0${CLIENT_ID}`;
/** The bundled browser half (dist/client.js), next to this file once built. */
const CLIENT_ENTRY = fileURLToPath(new URL('./client.js', import.meta.url));
const JSX_FILE_RE = /\.[jt]sx$/;

/**
 * Dev-only visual editor for @pixi/react scenes. It is skipped for `build` and vitest,
 * so production bundles never contain the source tags or the overlay.
 * Works with @vitejs/plugin-react and @vitejs/plugin-react-swc alike: the tagging runs
 * as its own `pre` transform, before either sees the JSX.
 */
export function pixiUiEditor(options: PixiUiEditorOptions = {}): Plugin {
  const palette = options.palette ? options.palette([...DEFAULT_PALETTE]) : DEFAULT_PALETTE;
  let workspaceRoot = '';
  let client: ClientConfig;
  let base = '/';
  let drafts: Drafts | undefined;

  return {
    name: 'pixi-ui-editor',
    apply: (_config, env) => env.command === 'serve' && !process.env.VITEST,
    enforce: 'pre',

    // the overlay's inspector must see the app's pixi.js, not a second copy
    config: () => ({ resolve: { dedupe: ['pixi.js'] } }),

    configResolved(config) {
      workspaceRoot = options.root ? resolve(config.root, options.root) : searchForWorkspaceRoot(config.root);
      base = config.base;
      client = {
        workspaceRoot,
        appRoot: relative(workspaceRoot, config.root).split(sep).join('/'),
        queryParam: options.queryParam ?? DEFAULT_QUERY_PARAM,
        previewRoot: options.previewRoot ?? '#root',
      };
    },

    configureServer(server) {
      const warnings = exposureWarnings(server.config.server);
      if (warnings.length) {
        server.config.logger.warn(
          ['(!) pixi-ui-editor can rewrite your .jsx/.tsx files, and:', ...warnings.map((w) => `  - ${w}`)].join('\n'),
        );
      }
      const env = server.environments.client;
      const rel = (file: string) => relative(workspaceRoot, file).split(sep).join('/');
      const store = createDrafts({
        reload(file) {
          for (const mod of env.moduleGraph.getModulesByFile(file) ?? []) void env.reloadModule(mod);
        },
        changed() {
          env.hot.send(DRAFTS_EVENT, { files: store.list().map((d) => rel(d.file)) } satisfies DraftsEvent);
        },
      });
      drafts = store;
      // the IDE (or git) wins over a draft of the same file
      for (const event of ['change', 'unlink'] as const) {
        server.watcher.on(event, (file) => void store.diskChanged(file));
      }
      server.middlewares.use(API_BASE, editorApi(workspaceRoot, palette, store));
    },

    transform: {
      order: 'pre',
      async handler(code, id) {
        if (id.includes('?') || id.includes('/node_modules/') || !JSX_FILE_RE.test(id)) return;
        if (!id.startsWith(workspaceRoot + sep) && !id.startsWith(`${workspaceRoot}/`)) return;
        return tagJsx(code, id, workspaceRoot, async (source) => {
          const resolved = await this.resolve(source, id, { skipSelf: true });
          return !!resolved && !resolved.external && !resolved.id.includes('/node_modules/');
        });
      },
    },

    resolveId(id) {
      return id === CLIENT_ID ? RESOLVED_CLIENT_ID : undefined;
    },

    load(id) {
      if (id === RESOLVED_CLIENT_ID) {
        return [`import { start } from ${JSON.stringify(CLIENT_ENTRY)};`, `start(${JSON.stringify(client)});`].join(
          '\n',
        );
      }
      // a file with unapplied editor edits: the app runs the draft, the disk stays untouched
      if (drafts?.has(id)) return drafts.served(id);
    },

    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: `${base}@id/__x00__${CLIENT_ID}` },
          // before the app's own modules, so the hooks are in place before pixi.js / @pixi/react
          // load and the orientation preview can override the window size before the app reads it
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
