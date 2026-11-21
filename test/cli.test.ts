import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { packageVersion, report, run } from '../src/cli/run.js';
import { BacklogError, SPEC_VERSION } from '../src/core/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string; bin: Record<string, string> };

function ob(...args: string[]) {
  let out = '', err = '';
  const code = run(args, { out: t => { out += t; }, err: t => { err += t; } });
  return { code, out, err };
}

describe('ob', () => {
  it('prints the package version for --version and -v', () => {
    expect(packageVersion()).toBe(pkg.version);
    for (const flag of ['--version', '-v']) expect(ob(flag)).toEqual({ code: 0, out: pkg.version + '\n', err: '' });
  });

  it('prints usage for --help, -h, and no arguments', () => {
    for (const args of [['--help'], ['-h'], []]) {
      const r = ob(...args);
      expect(r.code).toBe(0);
      expect(r.out).toContain('Usage: ob');
      expect(r.out).toContain(`spec ${SPEC_VERSION}`);
    }
  });

  it('exits 2 on an unknown command or option, with a hint on stderr', () => {
    for (const args of [['frobnicate'], ['--nope']]) {
      const r = ob(...args);
      expect(r.code).toBe(2);
      expect(r.out).toBe('');
      expect(r.err).toContain('ob --help');
    }
  });

  it('reports a backlog it cannot read in one line, exit 1, and lets a real bug keep its stack', () => {
    let err = '';
    expect(report(new BacklogError('/x/backlog/config.yml: not found; a backlog needs a config.yml'), { out: () => {}, err: t => { err += t; } })).toBe(1);
    expect(err).toBe('ob: /x/backlog/config.yml: not found; a backlog needs a config.yml\n');
    expect(() => report(new TypeError('bug'), { out: () => {}, err: () => {} })).toThrow(TypeError);
  });

  it('is installed as the ob command', () => {
    expect(pkg.bin).toEqual({ ob: 'dist/cli/main.js' });
    expect(readFileSync(new URL('../src/cli/main.ts', import.meta.url), 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/);
  });
});
