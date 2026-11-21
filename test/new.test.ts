import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { run } from '../src/cli/run.js';
import { addItem, initBacklog, loadBacklog, validateDir } from '../src/core/index.js';

const tmps: string[] = [];
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A folder with a new backlog (ob init), committed in git with its own identity unless `inGit` is false. */
function project(inGit = true): string {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'ob-new-'))), 'shop');
  tmps.push(join(root, '..'));
  initBacklog(join(root, 'backlog'), { name: 'shop' });
  if (inGit) {
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.name', 'Ana Silva');
    git(root, 'config', 'user.email', 'ana@example.com');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'ob init');
  }
  return root;
}

const NOV = new Date(2026, 10, 21), DEC = new Date(2026, 11, 2);

function ob(root: string, args: string[], extra: { env?: NodeJS.ProcessEnv; now?: Date } = {}) {
  let out = '', err = '';
  const code = run(['new', ...args], { out: t => { out += t; }, err: t => { err += t; }, cwd: root, now: extra.now ?? NOV, env: extra.env ?? {} });
  return { code, out, err };
}

const text = (root: string, path: string) => readFileSync(join(root, 'backlog', path), 'utf8');
const problems = (root: string) => validateDir(join(root, 'backlog')).problems.map(p => `${p.path}: ${p.code} ${p.message}`);
const log = (root: string) => git(root, 'log', '--format=%s', '-n', '1');
const lastFiles = (root: string) => git(root, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort();
/** Every file under a folder with its text, to show nothing was written. */
function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries((readdirSync(dir, { recursive: true }) as string[]).filter(f => !f.startsWith('.git/') && f !== '.git').sort()
    .map(f => [f, statSync(join(dir, f)).isFile() ? readFileSync(join(dir, f), 'utf8') : '/']));
}

describe('ob new', () => {
  it('adds the next epic, feature and story, each valid and in one commit of its own', () => {
    const root = project();
    expect(ob(root, ['epic', 'Checkout'])).toEqual({ code: 0, err: '', out: 'Created 1 backlog/epics/1-checkout.md\nCommitted: ob: add 1 Checkout\n' });
    expect(ob(root, ['feature', 'Pay by card', '--parent', '1']).out).toContain('Created 1.1 backlog/features/1.1-pay-by-card.md\n');
    expect(ob(root, ['story', 'Card form', '-p', '1.1']).out).toContain('Created 1.1.1 backlog/stories/todo/1.1.1-card-form.md\n');
    expect(log(root)).toBe('ob: add 1.1.1 Card form');
    expect(lastFiles(root)).toEqual(['backlog/stories/todo/1.1.1-card-form.md']);
    expect(git(root, 'log', '-1', '--format=%an')).toBe('Ana Silva');
    expect(text(root, 'epics/1-checkout.md')).toBe('---\nid: 1\ntype: epic\ntitle: Checkout\n---\n');
    expect(text(root, 'features/1.1-pay-by-card.md')).toBe('---\nid: 1.1\ntype: feature\ntitle: Pay by card\nparent: 1\n---\n');
    // Story-level items start from the template (spec section 3).
    expect(text(root, 'stories/todo/1.1.1-card-form.md')).toBe(
      '---\nid: 1.1.1\ntype: story\ntitle: Card form\nparent: 1.1\n---\n\n**As a** <who>, **I want to:**\n- <what they want>\n\n'
      + '**So that:**\n- <why, written so it can be checked>\n\n## Comments\n');
    for (const t of ['bug', 'spike', 'task']) expect(ob(root, [t, `A ${t}`, '-p', '1.1']).code).toBe(0);
    expect(ob(root, ['epic', 'Identity work', '--parent', 'C1']).err).toContain('parent C1 is not in this backlog');
    expect(ob(root, ['capability', 'Identity']).out).toContain('Created C1 backlog/capabilities/C1-identity.md');
    expect(ob(root, ['epic', 'Sign in', '--parent', 'C1']).out).toContain('Created 2 backlog/epics/2-sign-in.md');
    expect(loadBacklog(join(root, 'backlog')).items.map(i => i.id)).toEqual(['C1', '1', '1.1', '1.1.1', '1.1.2', '1.1.3', '1.1.4', '2']);
    expect(problems(root)).toEqual([]);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('takes the next number ever used, counting a removed item, and a title of several words', () => {
    const root = project();
    ob(root, ['epic', 'Checkout']);
    ob(root, ['feature', 'Cart', '-p', '1']);
    ob(root, ['story', 'One', '-p', '1.1']);
    ob(root, ['story', 'Two', '-p', '1.1']);
    git(root, 'rm', '-q', 'backlog/stories/todo/1.1.2-two.md');
    git(root, 'commit', '-qm', 'prune');
    expect(ob(root, ['story', 'Three', 'words', 'here', '-p', '1.1']).out).toContain('Created 1.1.3 backlog/stories/todo/1.1.3-three-words-here.md');
  });

  it('files a bug or task with no parent into this month\'s feature in epic 0, made if needed', () => {
    const root = project();
    const r = ob(root, ['bug', 'Login fails on Safari']);
    expect(r.out).toBe('Created 0 backlog/epics/0-unplanned.md\nCreated 0.1 backlog/features/0.1-2026-11.md\n'
      + 'Created 0.1.1 backlog/stories/todo/0.1.1-login-fails-on-safari.md\nCommitted: ob: add 0.1.1 Login fails on Safari\n');
    expect(lastFiles(root)).toEqual(['backlog/epics/0-unplanned.md', 'backlog/features/0.1-2026-11.md', 'backlog/stories/todo/0.1.1-login-fails-on-safari.md']);
    expect(text(root, 'features/0.1-2026-11.md')).toBe('---\nid: 0.1\ntype: feature\ntitle: Unplanned, 2026-11\nparent: 0\n---\n');
    expect(ob(root, ['task', 'Renew cert']).out).toBe('Created 0.1.2 backlog/stories/todo/0.1.2-renew-cert.md\nCommitted: ob: add 0.1.2 Renew cert\n');
    expect(ob(root, ['bug', 'Typo'], { now: DEC }).out).toContain('Created 0.2 backlog/features/0.2-2026-12.md\nCreated 0.2.1 backlog/stories/todo/0.2.1-typo.md\n');
    expect(text(root, 'stories/todo/0.2.1-typo.md')).toContain('parent: 0.2\n');
    expect(ob(root, ['epic', 'Launch']).out).toContain('Created 1 backlog/epics/1-launch.md');
    expect(problems(root)).toEqual([]);
  });

  it('checks the type, title, slug and parent before writing anything', () => {
    const root = project();
    ob(root, ['epic', 'Checkout']);
    ob(root, ['feature', 'Cart', '-p', '1']);
    ob(root, ['story', 'Form', '-p', '1.1']);
    const before = snapshot(root), head = git(root, 'rev-parse', 'HEAD');
    const refused: [string[], number, string][] = [
      [['story', 'X'], 1, 'a story needs --parent <feature>'],
      [['spike', 'X'], 1, 'a spike needs --parent <feature>'],
      [['feature', 'X'], 1, 'a feature needs --parent <epic>'],
      [['story', 'X', '-p', '9.9'], 1, 'parent 9.9 is not in this backlog'],
      [['story', 'X', '-p', '1'], 1, "parent 1 is an epic; a story's parent must be a feature"],
      [['feature', 'X', '-p', '1.1'], 1, "parent 1.1 is a feature; a feature's parent must be an epic"],
      [['epic', 'X', '-p', '1'], 1, "parent 1 is an epic; an epic's parent must be a capability"],
      [['capability', 'X', '-p', '1'], 1, 'a capability has no parent'],
      [['feature', 'X', '-p', '0'], 1, 'parent 0 is not in this backlog'],
      [['story', 'X', '-p', 'notes/2.3'], 1, 'in another backlog'],
      [['story', 'X', '-p', '1.1', '--slug', 'Bad Slug'], 1, "can't be a slug"],
      [['story', '!!!', '-p', '1.1'], 1, 'choose one with --slug'],
      [['story', '  ', '-p', '1.1'], 1, 'needs a title'],
      [['story', 'X', '-p', '1.1', '--edit'], 1, '--edit needs an editor'],
      [['story'], 2, 'needs a type and a title'],
      [['stroy', 'X'], 2, '"stroy" is not a type'],
      [['story', 'X', '--nope'], 2, 'ob new --help'],
    ];
    for (const [args, code, says] of refused) {
      const r = ob(root, args);
      expect([r.code, r.out], args.join(' ')).toEqual([code, '']);
      expect(r.err, args.join(' ')).toContain(says);
    }
    expect(snapshot(root)).toEqual(before);
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('refuses a feature under epic 0 once it exists: its features are one per month', () => {
    const root = project();
    ob(root, ['bug', 'X']);
    expect(ob(root, ['feature', 'Mine', '-p', '0']).err).toContain('epic 0 has one feature per month');
  });

  it('--slug chooses the file name, and --no-commit leaves the file for you to commit', () => {
    const root = project();
    expect(ob(root, ['epic', 'Checkout and payments', '--slug', 'checkout', '--no-commit']).out)
      .toBe('Created 1 backlog/epics/1-checkout.md\nNot committed (--no-commit).\n');
    expect(git(root, 'status', '--porcelain')).toBe('?? backlog/epics/1-checkout.md');
    expect(log(root)).toBe('ob init');
  });

  it('commits only the new files, not other changes', () => {
    const root = project();
    writeFileSync(join(root, 'README.md'), 'work in progress\n');
    git(root, 'add', 'README.md');
    ob(root, ['epic', 'Checkout']);
    expect(lastFiles(root)).toEqual(['backlog/epics/1-checkout.md']);
    expect(git(root, 'status', '--porcelain')).toBe('A  README.md');
  });

  it('works in a new repository with no commits yet (git init, ob init, ob new), and makes its first commit', () => {
    const root = project(false);
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.name', 'Ana Silva');
    git(root, 'config', 'user.email', 'ana@example.com');
    expect(ob(root, ['epic', 'Checkout'])).toEqual({ code: 0, err: '', out: 'Created 1 backlog/epics/1-checkout.md\nCommitted: ob: add 1 Checkout\n' });
    expect(lastFiles(root)).toEqual(['backlog/epics/1-checkout.md']);
    expect(ob(root, ['epic', 'Launch']).out).toContain('Created 2 ');
  });

  it('works outside git, without committing', () => {
    const root = project(false);
    expect(ob(root, ['epic', 'Checkout'])).toEqual({ code: 0, err: '', out: 'Created 1 backlog/epics/1-checkout.md\n' });
    expect(ob(root, ['bug', 'X']).out).toContain('Created 0.1.1');
    expect(problems(root)).toEqual([]);
  });

  it('--edit opens the new file in $EDITOR (through the shell, with its own arguments), then commits the edited file', () => {
    const root = project();
    const editor = join(root, '..', 'editor.sh');
    writeFileSync(editor, '#!/bin/sh\n[ "$1" = "--wait" ] && shift\nprintf -- "- 2026-11-21 @ana: noted\\n" >> "$1"\n');
    chmodSync(editor, 0o755);
    const r = ob(root, ['bug', 'Crash', '--edit'], { env: { ...process.env, EDITOR: `${editor} --wait` } });
    expect(r.code).toBe(0);
    expect(r.out).toContain('Committed: ob: add 0.1.1 Crash');
    expect(git(root, 'show', 'HEAD:backlog/stories/todo/0.1.1-crash.md')).toMatch(/## Comments\n- 2026-11-21 @ana: noted$/);
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(problems(root)).toEqual([]);
    // VISUAL wins over EDITOR, as in git.
    expect(ob(root, ['task', 'T', '--edit', '--no-commit'], { env: { ...process.env, VISUAL: editor, EDITOR: 'false' } }).code).toBe(0);
    expect(text(root, 'stories/todo/0.1.2-t.md')).toContain('@ana: noted');
  });

  it('an editor that fails leaves the file written but not committed, and says so', () => {
    const root = project();
    const r = ob(root, ['epic', 'Checkout', '--edit'], { env: { ...process.env, EDITOR: 'false' } });
    expect(r.code).toBe(1);
    expect(r.err).toContain('the editor (false) exited with 1; backlog/epics/1-checkout.md is written but not committed');
    expect(existsSync(join(root, 'backlog', 'epics', '1-checkout.md'))).toBe(true);
    expect(log(root)).toBe('ob init');
  });

  it('is in the core for the board: addItem gives the ID, the paths and whether it committed', () => {
    const root = project();
    const b = loadBacklog(join(root, 'backlog'));
    expect(addItem(b, { type: 'bug', title: 'X', day: NOV })).toEqual({
      id: '0.1.1', path: 'stories/todo/0.1.1-x.md', committed: true,
      created: [{ id: '0', path: 'epics/0-unplanned.md' }, { id: '0.1', path: 'features/0.1-2026-11.md' }, { id: '0.1.1', path: 'stories/todo/0.1.1-x.md' }],
    });
  });
});
