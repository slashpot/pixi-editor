import license from 'rollup-plugin-license';
import { defineConfig } from 'tsdown';

/** Babel and magic-string are bundled; the output may import nothing but vite (and Node built-ins). */
const thirdPartyLicenses = license({
  thirdParty: {
    includePrivate: false,
    output: { file: 'dist/THIRD_PARTY_LICENSES.md' },
  },
});

export default defineConfig([
  {
    // the Vite plugin and the dev-server API
    entry: { index: 'src/index.ts' },
    platform: 'node',
    format: 'esm',
    target: 'node20',
    fixedExtension: false,
    // the .d.ts parser has no WebAssembly build, so StackBlitz (WebContainer) can't run it; the demo doesn't need types
    dts: !process.versions.webcontainer,
    clean: true,
    deps: { neverBundle: ['vite'], onlyImport: ['vite'], onlyBundle: false },
    plugins: [thirdPartyLicenses],
  },
  {
    // the in-browser overlay, served to the app by the plugin
    entry: { client: 'src/client/index.ts' },
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    dts: false,
    clean: false,
    deps: { neverBundle: ['pixi.js'], onlyImport: ['pixi.js'], onlyBundle: false },
  },
]);
