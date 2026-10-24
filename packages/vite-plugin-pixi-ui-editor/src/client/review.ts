import { DRAFTS_EVENT, type DraftFile, type DraftsEvent } from '../shared';
import * as api from './api';
import { diffLines } from './diff';
import { BUTTON_STYLE, h } from './inspector';
import type { Session } from './session';

interface ReviewOptions {
  /** The drafted files changed (also called once at start). */
  onFiles(files: string[]): void;
}

/**
 * Every editor change is a draft: the app runs it, the files on disk don't have it.
 * This panel shows the drafts as diffs; Apply writes them all to disk, Discard drops
 * them all. The dev server reports draft changes over HMR (see vite-plugin), so the
 * count stays right after IDE edits and page reloads too.
 */
export function createReview(session: Session, { onFiles }: ReviewOptions) {
  const panel = h('div', { style: PANEL_STYLE, 'data-pixi-ui-editor': 'review' });
  document.body.append(panel);
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    panel.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'keydown' && (e as KeyboardEvent).key === 'Escape') close();
    });
  }

  let open = false;
  let error = '';

  import.meta.hot?.on(DRAFTS_EVENT, ({ files }: DraftsEvent) => {
    onFiles(files);
    if (open) void render();
  });
  void api.fetchDrafts().then(
    (drafts) => onFiles(drafts.map((d) => d.file)),
    () => onFiles([]),
  );

  async function render() {
    let drafts: DraftFile[];
    try {
      drafts = await api.fetchDrafts();
    } catch (e) {
      drafts = [];
      error = (e as Error).message;
    }
    if (!open) return;

    const apply = h('button', { style: BUTTON_STYLE, title: 'Write these changes to the files (Enter)' }, [
      'Apply to source',
    ]) as HTMLButtonElement;
    const discard = h(
      'button',
      { style: SECONDARY_STYLE, title: 'Drop every change; the app goes back to the files' },
      ['Discard all'],
    ) as HTMLButtonElement;
    const closeButton = h('button', { style: SECONDARY_STYLE, title: 'Keep editing (Esc)' }, ['Close']);
    apply.disabled = discard.disabled = drafts.length === 0;
    apply.onclick = async () => {
      if (await session.apply()) return close();
      error = session.error;
      void render();
    };
    discard.onclick = async () => {
      const what = drafts.length === 1 ? drafts[0].file : `${drafts.length} files`;
      if (!window.confirm(`Discard every unapplied change to ${what}?\n\nThis cannot be undone.`)) return;
      if (await session.discard()) return close();
      error = session.error;
      void render();
    };
    closeButton.onclick = close;

    const title = drafts.length
      ? `Unapplied changes · ${drafts.length} file${drafts.length > 1 ? 's' : ''}`
      : 'No unapplied changes';
    panel.replaceChildren(
      h('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:8px' }, [
        h('b', { style: 'flex:1' }, [title]),
        apply,
        discard,
        closeButton,
      ]),
      h('div', { style: 'color:#aaa;margin-bottom:8px' }, [
        'The app shows these edits; the files on disk do not have them until you apply.',
      ]),
      ...drafts.map(fileDiff),
    );
    if (error) panel.append(h('div', { style: ERROR_STYLE, 'data-error': '' }, [error]));
    apply.focus();
  }

  function close() {
    open = false;
    error = '';
    panel.style.display = 'none';
  }

  return {
    open() {
      open = true;
      error = '';
      panel.style.display = 'block';
      void render();
    },
    close,
  };
}

function fileDiff({ file, before, after }: DraftFile) {
  const pre = h('pre', { style: PRE_STYLE });
  for (const hunk of diffLines(before, after)) {
    pre.append(h('div', { style: 'color:#74c0fc' }, [`@@ -${hunk.oldStart} +${hunk.newStart} @@`]));
    for (const line of hunk.lines) {
      pre.append(h('div', { style: LINE_STYLE[line.kind] }, [`${line.kind} ${line.text}`]));
    }
  }
  return h('div', { style: 'margin-bottom:10px', 'data-file': file }, [
    h('div', { style: 'color:#f783ac' }, [file]),
    pre,
  ]);
}

const PANEL_STYLE =
  'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;width:min(900px,calc(100vw - 32px));max-height:calc(100vh - 96px);overflow:auto;padding:12px;font:12px/1.4 monospace;color:#eee;background:rgba(24,24,28,.97);border:1px solid #d6336c;border-radius:6px;box-sizing:border-box;text-align:left;box-shadow:0 8px 32px rgba(0,0,0,.6);display:none';
const SECONDARY_STYLE = `${BUTTON_STYLE};background:#444`;
const PRE_STYLE =
  'margin:4px 0 0;padding:6px 0;overflow-x:auto;background:#111;border-radius:3px;font:12px/1.4 monospace';
const LINE_STYLE = {
  ' ': 'padding:0 8px;color:#aaa;white-space:pre',
  '-': 'padding:0 8px;color:#ffc9c9;background:rgba(250,82,82,.22);white-space:pre',
  '+': 'padding:0 8px;color:#d3f9d8;background:rgba(64,192,87,.22);white-space:pre',
};
const ERROR_STYLE =
  'margin-top:8px;padding:4px 6px;color:#fff;background:#a61e4d;border-radius:3px;white-space:pre-wrap';
