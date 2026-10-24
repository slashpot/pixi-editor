/** pixiUiEditor()'s default `queryParam` (see vite.config.ts). */
const PARAM = 'editor';

export const editorOn = new URLSearchParams(window.location.search).has(PARAM);

/**
 * Turns the editor on or off by adding / removing `?editor` and reloading: the editor
 * hooks into pixi.js before the app loads, so it can't be switched on in a running page.
 */
export function toggleEditor() {
  const url = new URL(window.location.href);
  if (editorOn) url.searchParams.delete(PARAM);
  else url.search += `${url.search ? '&' : '?'}${PARAM}`; // `?editor`, where searchParams would write `?editor=`
  window.location.assign(url);
}
