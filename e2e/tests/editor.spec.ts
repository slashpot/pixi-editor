import { expect, test } from './fixtures';

const SCENE = 'src/Scene.tsx';

test.describe('overlay', () => {
  test('lists the scene in the Hierarchy, components marked with ◆', async ({ editor }) => {
    for (const label of ['scene', 'background', 'title', 'star', 'panel', 'item-0', 'item-2']) {
      await expect(editor.row(label)).toBeVisible();
    }
    await expect(editor.row('play')).toContainText('◆ Button');
    await expect(editor.row('title')).toContainText('Scene.tsx:');
    await expect(editor.toolbar).toContainText('Select ON (F2)');
  });

  test('stays out of the page without ?editor', async ({ page, demo }) => {
    await page.goto(demo.url);
    await expect
      .poll(() => page.evaluate(() => !!globalThis.__PIXI_APP__?.stage.getChildByLabel('title', true)))
      .toBe(true);
    await expect(page.locator('[data-pixi-ui-editor]')).toHaveCount(0);
  });
});

test.describe('selecting on the canvas', () => {
  test('a click selects the element under the pointer', async ({ editor, demo }) => {
    await editor.click('title');
    await expect(editor.inspector).toContainText('pixiText');
    await expect(editor.inspector).toContainText(`${SCENE}:${await demo.lineOf(SCENE, 'label="title"')}:`);
    await expect(editor.row('title')).toHaveAttribute('data-selected', '');
  });

  test('a reusable component is selected at its call site; clicking again drills in', async ({ editor, demo }) => {
    await editor.click('settings');
    await expect(editor.inspector).toContainText('◆ Button');
    await expect(editor.inspector).toContainText(`${SCENE}:${await demo.lineOf(SCENE, 'label="settings"')}:`);

    await editor.click('settings');
    await expect(editor.inspector).toContainText('src/Button.tsx:');
  });
});

test.describe('writing back to the source', () => {
  test('dragging moves a literal, and undo / redo restore it', async ({ editor, demo, page }) => {
    const original = await demo.read(SCENE);
    await editor.click('play');
    await editor.drag('play', 40, 0);
    await editor.expectFile(SCENE, (code) => code.includes('label="play" x={340} y={BUTTON_ROW_Y}'));
    // HMR re-renders the scene from the new source
    await expect.poll(() => editor.live('play', 'x')).toBe(340);

    await page.keyboard.press('ControlOrMeta+z');
    await editor.expectFile(SCENE, (code) => code === original);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await editor.expectFile(SCENE, (code) => code.includes('label="play" x={340} y={BUTTON_ROW_Y}'));
  });

  test('dragging one item of a .map moves only that item', async ({ editor, page, demo }) => {
    const original = await demo.read(SCENE);
    await editor.click('item-0');
    await editor.drag('item-0', 40, 30, async () => {
      expect(await editor.live('item-1', 'x')).toBe(40);
      expect(await editor.live('item-1', 'y')).toBe(140);
    });
    await editor.expectFile(SCENE, (code) => code.includes('x={i === 0 ? 80 : 40} y={i === 0 ? 70 : 40 + i * 100}'));
    expect(editor.dialogs).toEqual([]);
    await expect.poll(() => editor.live('item-0', 'y')).toBe(70);
    expect(await editor.live('item-0', 'x')).toBe(80);
    expect(await editor.live('item-1', 'x')).toBe(40);
    expect(await editor.live('item-2', 'y')).toBe(240);

    // another item gets its own case; the first keeps its own
    await editor.click('item-2');
    await editor.drag('item-2', -20, 0);
    await editor.expectFile(SCENE, (code) => code.includes('x={i === 2 ? 20 : i === 0 ? 80 : 40}'));
    await expect.poll(() => editor.live('item-2', 'x')).toBe(20);
    expect(await editor.live('item-0', 'x')).toBe(80);

    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');
    await editor.expectFile(SCENE, (code) => code === original);
  });

  test('a tiny unintended move on one axis does not touch that axis', async ({ editor }) => {
    await editor.click('settings');
    // y reads the shared BUTTON_ROW_Y: writing it would have asked first
    await editor.drag('settings', 40, 0.3);
    await editor.expectFile(SCENE, (code) => code.includes('label="settings" x={740} y={BUTTON_ROW_Y}'));
    expect(editor.dialogs).toEqual([]);
  });

  test('dragging an expression replaces it with a literal once confirmed', async ({ editor }) => {
    await editor.click('title');
    await editor.drag('title', 30, 0);
    // x was `design.width / 2` = 960; the untouched y stays as written
    await editor.expectFile(SCENE, (code) => code.includes('label="title" text="Pixi UI Editor" x={990} y={140}'));
  });

  test('dragging an orientation ternary only edits the current side', async ({ editor }) => {
    await editor.select('panel');
    await editor.drag('panel', 30, -20);
    // the e2e viewport is landscape
    await editor.expectFile(SCENE, (code) => code.includes('x={isPortrait ? 140 : 1130} y={isPortrait ? 1000 : 280}'));
  });

  test('dragging a prop that reads a shared const edits the const for all users', async ({ editor }) => {
    await editor.click('settings');
    await editor.drag('settings', 0, 20);
    await editor.expectFile(SCENE, (code) => code.includes('const BUTTON_ROW_Y = 840;'));
    await expect.poll(() => editor.live('play', 'y')).toBe(840);
  });

  test('the inspector edits text, numbers and object fields', async ({ editor }) => {
    await editor.select('title');
    await editor.input('text').fill('Hello');
    await editor.input('text').press('Enter');
    await editor.expectFile(SCENE, (code) => code.includes('text="Hello"'));
    await expect.poll(() => editor.live('title', 'text')).toBe('Hello');

    await editor.input('y').fill('200');
    await editor.input('y').press('Enter');
    await editor.expectFile(SCENE, (code) => code.includes('y={200} anchor={0.5}'));

    // style={titleStyle} → the fields of `new TextStyle({ … })`
    await editor.input('style.fontSize').fill('80');
    await editor.input('style.fontSize').press('Enter');
    await editor.expectFile(SCENE, (code) => code.includes("fontSize: 80, fontWeight: 'bold', fill: '#cdd6f4'"));
  });

  test('an edit made in the IDE shows up in the inspector', async ({ editor, demo }) => {
    await editor.select('star');
    await expect(editor.input('x')).toHaveValue('180');
    const code = await demo.read(SCENE);
    await demo.write(
      SCENE,
      code.replace("texture={Texture.from('star')} x={180}", "texture={Texture.from('star')} x={190}"),
    );
    await expect(editor.input('x')).toHaveValue('190');
  });
});

test.describe('structure', () => {
  test('"+ Child" inserts a palette element inside the selection', async ({ editor }) => {
    await editor.select('panel');
    await editor.hierarchy.locator('select').selectOption('container');
    await editor.hierarchy.getByRole('button', { name: '+ Child' }).click();
    await editor.expectFile(SCENE, (code) =>
      /\)\)\}\n\s+<pixiContainer x=\{-?\d+\} y=\{-?\d+\} \/>\n\s+<\/pixiContainer>/.test(code),
    );
    await expect(editor.inspector).toContainText('pixiContainer');
  });

  test('Delete removes the selected element', async ({ editor, page }) => {
    await editor.select('star');
    await page.keyboard.press('Delete');
    await editor.expectFile(SCENE, (code) => !code.includes('label="star"'));
    await expect(editor.row('star')).toHaveCount(0);
  });

  test('Duplicate copies the selected element after itself', async ({ editor }) => {
    await editor.select('star');
    await editor.inspector.getByRole('button', { name: 'Duplicate' }).click();
    await editor.expectFile(SCENE, (code) => code.split('label="star"').length === 3);
  });

  test('dragging a Hierarchy row reorders the source', async ({ editor, demo }) => {
    const titleLine = await demo.lineOf(SCENE, 'label="title"');
    const row = editor.row('title');
    const box = (await row.boundingBox())!;
    // onto the upper quarter of the title row = "before"
    await editor.row('star').dragTo(row, { targetPosition: { x: box.width / 2, y: 2 } });
    await editor.expectFile(SCENE, (code) => code.split('\n')[titleLine - 1].includes('label="star"'));
  });
});

test.describe('dev-server API', () => {
  test('refuses requests without the editor header', async ({ request, demo }) => {
    const res = await request.post(`${demo.url}__pixi-ui-editor/remove`, {
      data: { src: `${SCENE}:1:1`, hash: '' },
    });
    expect(res.status()).toBe(403);
  });
});
