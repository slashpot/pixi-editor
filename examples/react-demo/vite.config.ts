import { defineConfig } from 'vite';

// diag branch only: the full monorepo install and plugin build still run, but the dev server
// has no plugins and the page loads nothing, to tell that pipeline apart from the page
export default defineConfig({});
