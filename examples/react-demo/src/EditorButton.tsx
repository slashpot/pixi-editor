import { Button } from './Button';
import { editorOn, toggleEditor } from './editorMode';
import { COLORS } from './theme';

/** Opens (or closes) the editor; only on the dev server, the only place the editor exists. */
export function EditorButton({ x, y, label }: { x: number; y: number; label?: string }) {
  if (!import.meta.env.DEV) return null;
  return (
    <Button
      label={label}
      x={x}
      y={y}
      text={editorOn ? 'Close editor' : 'Open editor'}
      color={editorOn ? COLORS.red : COLORS.orange}
      onPress={toggleEditor}
    />
  );
}
