import type { ResolvedServerOptions } from 'vite';
import { describe, expect, it } from 'vitest';
import { exposureWarnings } from './exposure';

const DEFAULTS = { cors: { origin: /^https?:\/\/localhost$/ }, allowedHosts: [], host: undefined };

function warnings(server: Partial<ResolvedServerOptions>) {
  return exposureWarnings({ ...DEFAULTS, ...server } as ResolvedServerOptions);
}

describe('exposureWarnings', () => {
  it("is quiet on Vite's defaults and on loopback hosts", () => {
    expect(warnings({})).toEqual([]);
    for (const host of ['localhost', '127.0.0.1', '::1']) expect(warnings({ host })).toEqual([]);
    expect(warnings({ cors: false })).toEqual([]);
    expect(warnings({ cors: { origin: 'https://my.app' }, allowedHosts: ['my.app'] })).toEqual([]);
  });

  it('warns about a CORS setting that lets every origin in', () => {
    for (const cors of [true, {}, { origin: true }, { origin: '*' }]) {
      expect(warnings({ cors })).toEqual([expect.stringContaining('server.cors')]);
    }
  });

  it('warns about allowedHosts: true', () => {
    expect(warnings({ allowedHosts: true })).toEqual([expect.stringContaining('DNS rebinding')]);
  });

  it('warns about a host other than loopback', () => {
    for (const host of [true, '0.0.0.0', '::', '192.168.1.5']) {
      expect(warnings({ host })).toEqual([expect.stringContaining('--host')]);
    }
  });
});
