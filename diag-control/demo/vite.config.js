// diag branch only: the demo app on its own, outside the monorepo, without the editor plugin.
// The start command copies index.html, src/ and public/ in from examples/react-demo.
import react from '@vitejs/plugin-react';

export default { plugins: [react()] };
