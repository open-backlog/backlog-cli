import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { run } from '../src/cli/run.js';
import { fixDuplicates, initBacklog, validateDir } from '../src/core/index.js';

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));
const tmps: string[] = [];
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }); });

function ob(cwd: string, ...args: string[]) {
  let out = '', err = '';
  const code = run(['validate', ...args], { out: t => { out += t; }, err: t => { err += t; }, cwd });
  return { code, out, err };
}

/** git with a fixed identity and, for commits, a fixed time, so "added later" is certain. */
function git(cwd: string, args: string[], time?: number): string {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Ana Silva', GIT_AUTHOR_EMAIL: 'ana@example.com', GIT_COMMITTER_NAME: 'Ana Silva', GIT_COMMITTER_EMAIL: 'ana@example.com',
    ...(time ? { GIT_AUTHOR_DATE: `@${1_700_000_000 + time} +0000`, GIT_COMMITTER_DATE: `@${1_700_000_000 + time} +0000` } : {}) };
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}

const fm = (fields: string, body = '') => `---\n${fields}\n---\n${body}`;
const story = (id: string, title: string, parent: string) => fm(`id: ${id}\ntype: story\ntitle: ${title}\nparent: ${parent}`, '\nBody stays.\n');

/** Writes files into backlog/ and commits them at `time`. */
function add(root: string, time: number, files: Record<string, string>, msg = 'add'): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, 'backlog', path, '..'), { recursive: true });
    writeFileSync(join(root, 'backlog', path), text);
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', msg], time);
}

/** A repository with epic 1 and feature 1.1 on main. */
function repo(): string {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'ob-validate-cli-'))), 'shop');
  tmps.push(join(root, '..'));
  initBacklog(join(root, 'backlog'), { name: 'shop' });
  git(join(root, '..'), ['init', '-q', '-b', 'main', 'shop']);
  // ob commits as the user's git does, so the repository has its own identity (CI has none).
  git(root, ['config', 'user.name', 'Ana Silva']);
  git(root, ['config', 'user.email', 'ana@example.com']);
  add(root, 1000, {
    'epics/1-checkout.md': fm('id: 1\ntype: epic\ntitle: Checkout'),
    'features/1.1-cart.md': fm('id: 1.1\ntype: feature\ntitle: Cart\nparent: 1'),
  }, 'start');
  return root;
}

/** Two lines of history from the same start, merged: `main` first in time, `branch` later. */
function merge(root: string, main: Record<string, string>, branch: Record<string, string>): void {
  git(root, ['checkout', '-q', '-b', 'side']);
  add(root, 3000, branch, 'side');
  git(root, ['checkout', '-q', 'main']);
  add(root, 2000, main, 'main');
  git(root, ['merge', '-q', '--no-edit', 'side'], 4000);
}

function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries((readdirSync(dir, { recursive: true }) as string[]).sort()
    .filter(f => statSync(join(dir, f)).isFile()).map(f => [f, readFileSync(join(dir, f), 'utf8')]));
}

describe('ob validate', () => {
  it('prints nothing wrong and exits 0 for a valid backlog', () => {
    const root = repo();
    expect(ob(join(root, 'backlog', 'stories'))).toEqual({ code: 0, err: '', out: '../ is valid, 2 items\n' });
    expect(ob(root)).toEqual({ code: 0, err: '', out: 'backlog/ is valid, 2 items\n' });
  });

  it('prints each problem as file: code [rule] message. Fix: …, and exits 1 on errors', () => {
    const r = ob(join(fixtures, 'invalid', 'parent'));
    expect(r.code).toBe(1);
    const lines = r.out.trimEnd().split('\n');
    expect(lines.slice(0, -1).every(l => /^backlog\/\S+\.md: OB001 \[parent\] .+\. Fix: .+\.$/.test(l)), r.out).toBe(true);
    expect(lines.at(-1)).toMatch(/^backlog\/: \d+ errors?, 0 warnings, \d+ items$/);
  });

  it('exits 0 on warnings alone', () => {
    const r = ob(join(fixtures, 'tools', 'local-clones', 'portfolio'));
    expect(r.code).toBe(0);
    expect(r.out).toContain('backlog/config.yml: OB017 [local-clones] warning: ');
    expect(r.out).toContain('0 errors, 1 warning');
  });

  it('a config.yml it cannot read is an error, and no backlog at all says so', () => {
    const root = repo();
    writeFileSync(join(root, 'backlog', 'config.yml'), 'spec: [\n');
    expect(ob(root, '--fix')).toMatchObject({ code: 1, out: expect.stringContaining('backlog/config.yml: OB016 [config]') });
    const none = realpathSync(mkdtempSync(join(tmpdir(), 'ob-none-')));
    tmps.push(none);
    expect(ob(none)).toMatchObject({ code: 1, err: expect.stringContaining('no backlog here') });
    expect(ob(root, 'extra').code).toBe(2);
  });

  it('--json gives the problems for other tools, with the same exit code', () => {
    const r = ob(join(fixtures, 'invalid', 'parent'), '--json');
    expect(r.code).toBe(1);
    const j = JSON.parse(r.out);
    expect(j).toMatchObject({ valid: false, warnings: 0, renumbered: [], committed: false });
    expect(j.errors).toBe(j.problems.length);
    expect(j.problems[0]).toMatchObject({ code: 'OB001', rule: 'parent', severity: 'error', path: expect.stringMatching(/\.md$/), fix: expect.any(String) });
    expect(JSON.parse(ob(repo(), '--json').out)).toMatchObject({ valid: true, errors: 0, problems: [] });
  });
});

describe('ob validate --fix', () => {
  it('renumbers the story added later when a merge leaves two with one ID, in one commit, keeping its history', () => {
    const root = repo();
    merge(root, { 'stories/todo/1.1.1-coupon.md': story('1.1.1', 'Coupon', '1.1') }, { 'stories/todo/1.1.1-gift-card.md': story('1.1.1', 'Gift card', '1.1') });
    const before = ob(root);
    expect(before.code).toBe(1);
    expect(before.out).toContain('OB004 [id-unique]');
    const was = snapshot(join(root, 'backlog'));

    const r = ob(root, '--fix');
    expect(r).toEqual({ code: 0, err: '', out: 'Renumbered 1.1.1 to 1.1.2: backlog/stories/todo/1.1.1-gift-card.md → backlog/stories/todo/1.1.2-gift-card.md\n'
      + 'Committed: ob: renumber 1.1.1 to 1.1.2\nbacklog/ is valid, 4 items\n' });
    // Only what it reported changed: the one file, renamed, with only its id changed.
    const now = snapshot(join(root, 'backlog'));
    const { ['stories/todo/1.1.1-gift-card.md']: old, ...restWas } = was;
    const { ['stories/todo/1.1.2-gift-card.md']: renamed, ...restNow } = now;
    expect(restNow).toEqual(restWas);
    expect(renamed).toBe(old?.replace('id: 1.1.1', 'id: 1.1.2'));
    expect(git(root, ['show', '--name-status', '--format=%s', 'HEAD']).split('\n').filter(Boolean)).toEqual([
      'ob: renumber 1.1.1 to 1.1.2', expect.stringMatching(/^R\d+\tbacklog\/stories\/todo\/1\.1\.1-gift-card\.md\tbacklog\/stories\/todo\/1\.1\.2-gift-card\.md$/)]);
    // History follows the rename back to the branch that added it. (--follow guesses renames by
    // similarity, and some git versions also step into the other, similar story; only the first
    // two entries are ob's doing.)
    expect(git(root, ['log', '--follow', '--format=%s', '--', 'backlog/stories/todo/1.1.2-gift-card.md']).split('\n').slice(0, 2)).toEqual(['ob: renumber 1.1.1 to 1.1.2', 'side']);
    expect(git(root, ['status', '--porcelain'])).toBe('');
    // Run again: nothing to fix, nothing changes.
    expect(ob(root, '--fix')).toEqual({ code: 0, err: '', out: 'backlog/ is valid, 4 items\n' });
    expect(git(root, ['log', '-1', '--format=%s'])).toBe('ob: renumber 1.1.1 to 1.1.2');
  });

  it('the newer is the one added later, whichever side of the merge or file name it is', () => {
    const root = repo();
    merge(root, { 'stories/todo/1.1.1-zebra.md': story('1.1.1', 'Zebra', '1.1') }, { 'stories/todo/1.1.1-apple.md': story('1.1.1', 'Apple', '1.1') });
    expect(ob(root, '--fix').out).toContain('Renumbered 1.1.1 to 1.1.2: backlog/stories/todo/1.1.1-apple.md');
    // Uncommitted is newest of all.
    writeFileSync(join(root, 'backlog', 'stories', 'todo', '1.1.1-copy.md'), story('1.1.1', 'Copy', '1.1'));
    const again = ob(root, '--fix');
    expect(again.err).toBe('');
    expect(again.out).toContain('Renumbered 1.1.1 to 1.1.3: backlog/stories/todo/1.1.1-copy.md');
  });

  it('a duplicate feature takes its own children to its new number; their duplicates are renumbered under it', () => {
    const root = repo();
    merge(root, {
      'features/1.2-search.md': fm('id: 1.2\ntype: feature\ntitle: Search\nparent: 1'),
      'stories/todo/1.2.1-box.md': story('1.2.1', 'Box', '1.2'),
    }, {
      'features/1.2-pay.md': fm('id: 1.2\ntype: feature\ntitle: Pay\nparent: 1'),
      'stories/todo/1.2.1-card.md': story('1.2.1', 'Card', '1.2'),
      'stories/doing/1.2.2-wallet.md': story('1.2.2', 'Wallet', '1.2'),
    });
    const r = ob(root, '--fix');
    expect(r.code).toBe(0);
    expect(r.out).toBe([
      'Renumbered 1.2 to 1.3: backlog/features/1.2-pay.md → backlog/features/1.3-pay.md',
      '  parent 1.2 → 1.3: backlog/stories/todo/1.2.1-card.md',
      '  parent 1.2 → 1.3: backlog/stories/doing/1.2.2-wallet.md',
      'Renumbered 1.2.1 to 1.3.1: backlog/stories/todo/1.2.1-card.md → backlog/stories/todo/1.3.1-card.md',
      'Committed: ob: renumber 1.2 to 1.3, 1.2.1 to 1.3.1',
      'backlog/ is valid, 7 items', ''].join('\n'));
    const text = (p: string) => readFileSync(join(root, 'backlog', p), 'utf8');
    expect(text('stories/todo/1.2.1-box.md')).toBe(story('1.2.1', 'Box', '1.2'));
    expect(text('stories/doing/1.2.2-wallet.md')).toBe(story('1.2.2', 'Wallet', '1.3'));
    expect(text('stories/todo/1.3.1-card.md')).toBe(story('1.3.1', 'Card', '1.3'));
    expect(git(root, ['show', '--name-status', '--format=', 'HEAD']).split('\n').map(l => l.split('\t')[0]?.[0]).sort()).toEqual(['M', 'R', 'R']);
    expect(git(root, ['status', '--porcelain'])).toBe('');
  });

  it('--no-commit leaves the changes for you; --json reports them', () => {
    const root = repo();
    merge(root, { 'stories/todo/1.1.1-a.md': story('1.1.1', 'A', '1.1') }, { 'stories/todo/1.1.1-b.md': story('1.1.1', 'B', '1.1') });
    const j = JSON.parse(ob(root, '--fix', '--no-commit', '--json').out);
    expect(j).toMatchObject({ valid: true, committed: false, renumbered: [{ from: '1.1.1', to: '1.1.2', path: 'stories/todo/1.1.1-b.md', newPath: 'stories/todo/1.1.2-b.md', children: [] }] });
    expect(git(root, ['status', '--porcelain'])).toMatch(/^R. backlog\/stories\/todo\/1\.1\.1-b\.md -> backlog\/stories\/todo\/1\.1\.2-b\.md$/);
    expect(git(root, ['log', '-1', '--format=%s'])).toBe("Merge branch 'side'");
  });

  it('outside git it cannot tell which is newer, so it changes nothing', () => {
    const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'ob-nogit-'))), 'backlog');
    tmps.push(join(dir, '..'));
    cpSync(join(fixtures, 'invalid', 'id-unique', 'backlog'), dir, { recursive: true });
    const was = snapshot(dir);
    expect(() => fixDuplicates(dir)).toThrow('needs git history');
    expect(ob(join(dir, '..'), '--fix')).toMatchObject({ code: 1, err: expect.stringContaining('needs git history') });
    expect(snapshot(dir)).toEqual(was);
    expect(validateDir(dir).problems.some(p => p.code === 'OB004')).toBe(true);
  });
});
