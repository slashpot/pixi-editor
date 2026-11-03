// StackBlitz only (see .stackblitzrc). Building the plugin with tsdown in the same WebContainer as
// the demo crashes iPad Safari, so there the demo installs the published plugin instead: the plugin
// package leaves the workspace (StackBlitz's pnpm would link it otherwise) and the demo asks for
// its current version from npm.
import { readFileSync, writeFileSync } from 'node:fs';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

writeFileSync('pnpm-workspace.yaml', "packages:\n  - 'examples/*'\n");

const { version } = readJson('packages/vite-plugin-pixi-ui-editor/package.json');
const demoFile = 'examples/react-demo/package.json';
const demo = readJson(demoFile);
demo.devDependencies['vite-plugin-pixi-ui-editor'] = `^${version}`;
writeFileSync(demoFile, `${JSON.stringify(demo, null, 2)}\n`);

console.log(`[stackblitz] the demo uses vite-plugin-pixi-ui-editor@^${version} from npm`);
