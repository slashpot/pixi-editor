/**
 * The experiment this diag branch runs (diag branches only). Each diag/ipad-* branch sets
 * these differently, because the iPad preview crashes before a query string can be typed.
 */
export const VARIANT = {
  name: 'baseline',
  /** no shader filter on the backdrop */
  noSwirl: false,
  /** antialias off */
  noAntialias: false,
  /** don't render the Pixi app at all: only the diag overlay */
  noPixi: false,
  /** no Vite WebSocket (server.ws: false), so no HMR and no reload on disconnect */
  noHmr: false,
};
