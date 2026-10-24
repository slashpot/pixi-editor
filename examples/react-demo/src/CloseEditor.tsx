import { createPortal } from 'react-dom';
import { toggleEditor } from './editorMode';

/**
 * While select mode is on, the editor takes every click on the canvas, the scene's
 * "Close editor" button too, so this one sits outside it, clear of the editor's panels.
 */
export function CloseEditor() {
  // on <body>, not in #root: the editor's orientation preview resizes #root
  return createPortal(
    <button className="close-editor" onClick={toggleEditor}>
      Close editor
    </button>,
    document.body,
  );
}
