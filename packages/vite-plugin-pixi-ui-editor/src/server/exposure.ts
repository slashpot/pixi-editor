import type { ResolvedServerOptions } from 'vite';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Dev-server settings that let someone other than the developer reach the editor's API,
 * one line each; empty when the safeguards described in the README's Security section hold.
 */
export function exposureWarnings(server: ResolvedServerOptions): string[] {
  const warnings: string[] = [];
  const { cors, allowedHosts, host } = server;
  // expressjs/cors answers every origin when `origin` is left out
  const origin = typeof cors === 'object' ? cors.origin : undefined;
  if (cors === true || (typeof cors === 'object' && (origin === undefined || origin === true || origin === '*'))) {
    warnings.push('server.cors lets every origin in, so any website you visit can edit your files.');
  }
  if (allowedHosts === true) {
    warnings.push('server.allowedHosts is true, so a website can reach the API through DNS rebinding.');
  }
  if (host !== undefined && host !== false && !LOOPBACK_HOSTS.has(host as string)) {
    warnings.push('server.host (or --host) exposes the dev server, so anyone on your network can edit your files.');
  }
  return warnings;
}
