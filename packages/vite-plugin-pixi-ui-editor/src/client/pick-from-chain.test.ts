import { describe, expect, it } from 'vitest';
import type { Entry } from './fiber-index';
import { isUnder, pickFromChain, type PickOptions } from './index';

/** A chain outer → inner; `◆` marks a component call. */
function chain(...items: string[]): Entry[] {
  const entries: Entry[] = [];
  for (const item of items) {
    const component = item.startsWith('◆');
    const [name, src] = item.replace('◆', '').split('@');
    const parent = entries.at(-1);
    const entry = { src, index: 0, name, component, fiber: {} as Entry['fiber'], parent, children: [] } as Entry;
    parent?.children.push(entry);
    entries.push(entry);
  }
  return entries;
}

const options = (widgets: string[] = [], appRoot = 'apps/game'): PickOptions => ({
  inApp: (e) => isUnder(e.src, appRoot),
  isWidget: (e) => e.component && widgets.includes(e.name),
});

const SCENE = chain(
  '◆Scene@apps/game/src/App.tsx:5:5',
  'pixiContainer@apps/game/src/Scene.tsx:3:5',
  '◆Button@apps/game/src/Scene.tsx:4:7',
  'pixiSprite@apps/game/src/Button.tsx:2:3',
);

describe('pickFromChain', () => {
  it('selects the innermost element when no reusable component is under the pointer', () => {
    expect(pickFromChain(SCENE, undefined, options())?.name).toBe('pixiSprite');
  });

  it("selects a reusable component's call site rather than its internals", () => {
    expect(pickFromChain(SCENE, undefined, options(['Button']))?.name).toBe('Button');
  });

  it('drills one level deeper when clicking inside the current selection', () => {
    const button = SCENE[2];
    expect(pickFromChain(SCENE, { src: button.src, index: 0 }, options(['Button']))?.name).toBe('pixiSprite');
    const sprite = SCENE[3];
    expect(pickFromChain(SCENE, { src: sprite.src, index: 0 }, options(['Button']))?.name).toBe('Button');
  });

  it('skips elements written outside the served app (shared workspace packages)', () => {
    const shared = chain('◆Popup@apps/game/src/App.tsx:5:5', 'pixiSprite@packages/kit/src/Popup.tsx:2:3');
    expect(pickFromChain(shared, undefined, options())?.name).toBe('Popup');
    // nothing from the app under the pointer: fall back to the whole chain
    const foreign = chain('pixiSprite@packages/kit/src/Popup.tsx:2:3');
    expect(pickFromChain(foreign, undefined, options())?.name).toBe('pixiSprite');
  });

  it('treats everything as app code when the app is the workspace root', () => {
    expect(isUnder('src/A.tsx:1:1', '')).toBe(true);
    expect(isUnder('apps/game/src/A.tsx:1:1', 'apps/game')).toBe(true);
    expect(isUnder('apps/gamer/src/A.tsx:1:1', 'apps/game')).toBe(false);
  });
});
