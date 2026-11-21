import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import * as core from '../src/core/index.js';

const coreDir = new URL('../src/core/', import.meta.url);

describe('core', () => {
  it('implements the spec version the fixtures are written in', () => {
    const config = readFileSync(new URL('fixtures/t1-minimal/backlog/config.yml', import.meta.url), 'utf8');
    expect(config).toMatch(new RegExp(`^spec: ${core.SPEC_VERSION.replace('.', '\\.')}$`, 'm'));
    expect(core.SPEC_URL).toBe('https://openbacklog.org/spec');
  });

  it('never imports the CLI (D1), so the board can use it on its own', () => {
    for (const f of readdirSync(coreDir, { recursive: true }) as string[]) {
      if (!f.endsWith('.ts')) continue;
      const text = readFileSync(new URL(f, coreDir), 'utf8');
      for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) expect(m[1], f).not.toMatch(/(^|\/)cli(\/|$)/);
    }
  });

  it("is the package's library entry", () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['.']).toEqual({ types: './dist/core/index.d.ts', import: './dist/core/index.js' });
  });
});
