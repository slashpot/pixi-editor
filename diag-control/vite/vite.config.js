// diag branch only: pre-bundle nothing; public/control.mjs loads pixi.js's prebuilt bundle
export default { optimizeDeps: { noDiscovery: true, include: [] } };
