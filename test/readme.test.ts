import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { commandOptions, run } from '../src/cli/run.js';
import { SPEC_VERSION } from '../src/core/index.js';

/**
 * The README is the npm page (2.3.7): it has to explain the tool on its own, so it documents every
 * command and option, links only to absolute URLs, and its five-minute start is what ob prints.
 */

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const NOV = new Date(2026, 10, 21);
const tmps: string[] = [];
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }); });

/** The ```sh blocks of a section, from its "## " heading to the next. */
function shBlocks(heading: string): string[] {
  const start = README.indexOf(`\n## ${heading}\n`);
  const end = README.indexOf('\n## ', start + 1);
  const section = README.slice(start, end === -1 ? undefined : end);
  return [...section.matchAll(/```sh\n([\s\S]*?)```/g)].map(m => m[1] ?? '');
}

/** Words of a command line, with "double quotes" kept together. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] ?? m[2] ?? '');
}

describe('the README (the npm page)', () => {
  it('documents every command with every option, in a synopsis line', () => {
    const synopses = shBlocks('Commands').flatMap(b => b.split('\n')).filter(l => l.startsWith('ob '));
    for (const [name, options] of Object.entries(commandOptions())) {
      const line = synopses.find(l => l.startsWith(`ob ${name} `));
      expect(line, `ob ${name}`).toBeDefined();
      for (const o of options) expect(line, `ob ${name} --${o}`).toContain(`--${o}`);
    }
  });

  it('links only to absolute URLs, which work on npm without the repository', () => {
    const links = [...README.matchAll(/\]\(([^)]*)\)/g)].map(m => m[1] ?? '');
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toMatch(/^https:\/\//);
  });

  it('says which spec version it supports', () => {
    expect(README).toContain(`**version ${SPEC_VERSION}**`);
  });

  it('the five-minute start runs as written, and prints what it shows', () => {
    const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'ob-readme-'))), 'shop');
    tmps.push(join(root, '..'));
    mkdirSync(root);
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Ana Silva'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'ana@example.com'], { cwd: root });

    let commands = 0;
    for (const block of shBlocks('A five-minute start')) {
      // Each "$ " line and the output lines after it, up to the next "$ ".
      const steps = block.split(/^\$ /m).filter(Boolean).map(s => s.replace(/\n$/, '').split('\n'));
      for (const [line = '', ...shown] of steps) {
        commands++;
        if (line.startsWith('git ')) {
          execFileSync('sh', ['-c', line], { cwd: root, stdio: 'ignore' });
          continue;
        }
        const [ob, ...args] = words(line);
        expect(ob, line).toBe('ob');
        let out = '';
        const code = run(args, { out: t => { out += t; }, err: () => {}, cwd: root, now: NOV, env: {} });
        expect(code, line).toBe(0);
        if (shown.length) expect(out, line).toBe(`${shown.join('\n')}\n`);
      }
    }
    expect(commands).toBeGreaterThanOrEqual(12);
  });
});
