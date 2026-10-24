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

  test('dragging an item of a .map moves all items, and asks on release', async ({ editor }) => {
    await editor.click('item-0');
    await editor.drag('item-0', 40, 30, async () => {
      // no question while dragging; the other items preview the shared move
      expect(editor.dialogs).toEqual([]);
      expect(await editor.live('item-1', 'x')).toBe(80);
      expect(await editor.live('item-1', 'y')).toBe(170);
    });
    expect(editor.dialogs).toEqual([expect.stringContaining('one of 3 items')]);
    // `40 + i * 100` keeps its shape: only the number term moves
    await editor.expectFile(SCENE, (code) => code.includes('x={80} y={70 + i * 100}'));
    await expect.poll(() => editor.live('item-2', 'y')).toBe(270);
    expect(await editor.live('item-0', 'x')).toBe(80);
  });

  test('cancelling that question puts every item back', async ({ editor, demo, page }) => {
    const original = await demo.read(SCENE);
    editor.answer = false;
    await editor.click('item-0');
    await editor.drag('item-0', 40, 30);
    expect(editor.dialogs).toHaveLength(1);
    for (const label of ['item-0', 'item-1', 'item-2']) expect(await editor.live(label, 'x')).toBe(40);
    expect(await editor.live('item-1', 'y')).toBe(140);
    await page.waitForTimeout(500);
    expect(await demo.read(SCENE)).toBe(original);
  });

  test('arrow-key nudges on an item of a .map ask once the keys go quiet', async ({ editor, page }) => {
    await editor.select('item-0');
    for (let n = 0; n < 5; n++) await page.keyboard.press('ArrowRight');
    expect(editor.dialogs).toEqual([]);
    await editor.expectFile(SCENE, (code) => code.includes('x={45} y={40 + i * 100}'));
    expect(editor.dialogs).toHaveLength(1);
  });

  test('a pointerup the page never saw still ends the drag', async ({ editor, page }) => {
    await editor.click('item-0');
    const b = await editor.box('item-0');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2, { steps: 5 });
    // released outside the window: the next move arrives with no buttons pressed
    await page.evaluate(
      ({ x, y }) => window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, buttons: 0 })),
      { x: b.x + 300, y: b.y + 300 },
    );
    await editor.expectFile(SCENE, (code) => code.includes('x={80} y={40 + i * 100}'));
    await page.mouse.move(b.x + 400, b.y + 400, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await editor.live('item-0', 'x')).toBe(80);
  });

  test('a press-and-drag that ends before the source is read still writes', async ({ editor, page }) => {
    // a slow dev server: the drag is over long before the element's source arrives
    await page.route('**/__pixi-ui-editor/element?**', async (route) => {
      await new Promise((done) => setTimeout(done, 1000));
      await route.continue();
    });
    await editor.drag('play', 40, 0);
    await editor.expectFile(SCENE, (code) => code.includes('label="play" x={340} y={BUTTON_ROW_Y}'));
    await expect(editor.inspector.locator('[data-error]')).toHaveCount(0);
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

  test('a refresh while typing in the inspector keeps the draft and the selection', async ({ editor, demo }) => {
    await editor.select('star');
    const y = editor.input('y');
    await y.fill('15');
    await y.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 1));
    // an IDE edit to another prop makes the inspector re-render
    const code = await demo.read(SCENE);
    await demo.write(
      SCENE,
      code.replace("texture={Texture.from('star')} x={180}", "texture={Texture.from('star')} x={190}"),
    );
    await expect(editor.input('x')).toHaveValue('190');
    await expect(editor.input('y')).toBeFocused();
    await expect(editor.input('y')).toHaveValue('15');
    expect(await editor.input('y').evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([
      0, 1,
    ]);
    await editor.input('y').press('Enter');
    await editor.expectFile(SCENE, (next) => next.includes('x={190} y={15}'));
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
