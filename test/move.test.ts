import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { run } from '../src/cli/run.js';
import { addItem, initBacklog, loadBacklog } from '../src/core/index.js';

const tmps: string[] = [];
const saved = { ...process.env };
afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
  for (const k of ['GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE']) if (saved[k] === undefined) Reflect.deleteProperty(process.env, k); else process.env[k] = saved[k];
});
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const NOV = new Date(2026, 10, 21);

/** A committed backlog: epic 1, feature 1.1 and story 1.1.1 in todo, with its own git identity. */
function project(opts: { git?: boolean; config?: string; name?: string } = {}): string {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'ob-move-'))), opts.name ?? 'shop');
  tmps.push(join(root, '..'));
  const dir = join(root, 'backlog');
  initBacklog(dir, { name: 'shop' });
  if (opts.config) writeFileSync(join(dir, 'config.yml'), opts.config);
  const b = () => loadBacklog(dir);
  addItem(b(), { type: 'epic', title: 'Checkout', commit: false });
  addItem(b(), { type: 'feature', title: 'Cart', parent: '1', commit: false });
  addItem(b(), { type: 'story', title: 'Add to cart', parent: '1.1', commit: false });
  if (opts.git !== false) {
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.name', 'Ana Silva');
    git(root, 'config', 'user.email', 'ana@example.com');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'start');
  }
  return root;
}

function ob(root: string, ...args: string[]) {
  let out = '', err = '';
  const code = run(args, { out: t => { out += t; }, err: t => { err += t; }, cwd: root, now: NOV });
  return { code, out, err };
}

const TODO = 'backlog/stories/todo/1.1.1-add-to-cart.md';
const DOING = 'backlog/stories/doing/1.1.1-add-to-cart.md';
const DONE = 'backlog/stories/done/1.1.1-add-to-cart.md';
const head = (root: string) => git(root, 'show', '--name-status', '--format=%s', 'HEAD').split('\n').filter(Boolean);

describe('ob move, start, done', () => {
  it('each is a git mv and one commit, and git log --follow shows the story across moves', () => {
    const root = project();
    expect(ob(root, 'start', '1.1.1')).toEqual({ code: 0, err: '', out: `Moved 1.1.1 to doing: ${TODO} → ${DOING}\nCommitted: ob: move 1.1.1 to doing\n` });
    expect(head(root)).toEqual(['ob: move 1.1.1 to doing', `R100\t${TODO}\t${DOING}`]);
    expect(ob(root, 'done', '1.1.1').out).toBe(`Moved 1.1.1 to done: ${DOING} → ${DONE}\nCommitted: ob: move 1.1.1 to done\n`);
    expect(head(root)).toEqual(['ob: move 1.1.1 to done', `R100\t${DOING}\t${DONE}`]);
    expect(ob(root, 'move', '1.1.1', 'todo').out).toContain(`Moved 1.1.1 to todo: ${DONE} → ${TODO}`);
    expect(git(root, 'log', '--follow', '--format=%s', '--', TODO).split('\n'))
      .toEqual(['ob: move 1.1.1 to todo', 'ob: move 1.1.1 to done', 'ob: move 1.1.1 to doing', 'start']);
    expect(git(root, 'log', '-1', '--format=%an')).toBe('Ana Silva');
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(loadBacklog(join(root, 'backlog')).items.find(i => i.id === '1.1.1')?.status).toBe('todo');
  });

  it('gives exactly what a hand-run git mv and commit give: the same commit, byte for byte', () => {
    process.env['GIT_AUTHOR_DATE'] = process.env['GIT_COMMITTER_DATE'] = '@1800000000 +0000';
    const byOb = project({ name: 'a' }), byHand = project({ name: 'a' });
    expect(git(byOb, 'rev-parse', 'HEAD')).toBe(git(byHand, 'rev-parse', 'HEAD'));
    ob(byOb, 'start', '1.1.1');
    git(byHand, 'mv', TODO, 'backlog/stories/doing/');
    git(byHand, 'commit', '-qm', 'ob: move 1.1.1 to doing');
    expect(git(byOb, 'rev-parse', 'HEAD')).toBe(git(byHand, 'rev-parse', 'HEAD'));
  });

  it('done files into stories/done/YYYY-MM/ with done-folders: month, and moves back out of it', () => {
    const root = project({ config: 'spec: 0.1\nname: shop\ndone-folders: month\n' });
    expect(ob(root, 'done', '1.1.1').out).toContain(`→ backlog/stories/done/2026-11/1.1.1-add-to-cart.md\n`);
    expect(ob(root, 'done', '1.1.1')).toEqual({ code: 0, err: '', out: '1.1.1 is already in done: backlog/stories/done/2026-11/1.1.1-add-to-cart.md; nothing changed.\n' });
    expect(ob(root, 'start', '1.1.1').out).toContain(`backlog/stories/done/2026-11/1.1.1-add-to-cart.md → ${DOING}`);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('refuses an epic, feature or capability, an unknown status or id, and bad usage, changing nothing', () => {
    const root = project();
    addItem(loadBacklog(join(root, 'backlog')), { type: 'capability', title: 'Identity' });
    const before = git(root, 'rev-parse', 'HEAD');
    const refused: [string[], number, string][] = [
      [['start', '1'], 1, "1 is an epic, which doesn't move: only stories, bugs, spikes and tasks do. An epic is done when all its items are done"],
      [['done', '1.1'], 1, "1.1 is a feature, which doesn't move: only stories, bugs, spikes and tasks do. A feature is done when all its items are done"],
      [['move', 'C1', 'done'], 1, 'C1 is a capability'],
      [['move', '1.1.1', 'finished'], 2, '"finished" is not a status: use todo, doing or done'],
      [['move', '1.1.1', 'Done'], 2, 'is not a status'],
      [['start', '9.9.9'], 1, 'no item 9.9.9 in this backlog'],
      [['move', '1.1.1'], 2, 'ob move needs an id and a status'],
      [['start'], 2, 'ob start needs one id'],
      [['done', '1.1.1', '1.1.2'], 2, 'ob done needs one id'],
      [['start', '1.1.1', '--nope'], 2, 'ob start --help'],
    ];
    for (const [args, code, says] of refused) {
      const r = ob(root, ...args);
      expect([r.code, r.out], args.join(' ')).toEqual([code, '']);
      expect(r.err, args.join(' ')).toContain(says);
    }
    expect(git(root, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('refuses an id two items share, pointing to ob validate --fix', () => {
    const root = project();
    writeFileSync(join(root, 'backlog', 'stories', 'todo', '1.1.1-copy.md'), '---\nid: 1.1.1\ntype: story\ntitle: Copy\nparent: 1.1\n---\n');
    expect(ob(root, 'start', '1.1.1')).toMatchObject({ code: 1, err: expect.stringContaining('run ob validate --fix first') });
  });

  it('--no-commit leaves the git mv staged, as a hand-run git mv does', () => {
    const root = project();
    expect(ob(root, 'start', '1.1.1', '--no-commit').out).toBe(`Moved 1.1.1 to doing: ${TODO} → ${DOING}\nNot committed (--no-commit).\n`);
    expect(git(root, 'status', '--porcelain')).toBe(`R  ${TODO} -> ${DOING}`);
    expect(git(root, 'log', '-1', '--format=%s')).toBe('start');
  });

  it('commits only the move, leaving other staged work alone', () => {
    const root = project();
    writeFileSync(join(root, 'README.md'), 'wip\n');
    git(root, 'add', 'README.md');
    ob(root, 'start', '1.1.1');
    expect(head(root)).toEqual(['ob: move 1.1.1 to doing', `R100\t${TODO}\t${DOING}`]);
    expect(git(root, 'status', '--porcelain')).toBe('A  README.md');
  });

  it('works outside git as a plain rename, without committing', () => {
    const root = project({ git: false });
    expect(ob(root, 'start', '1.1.1')).toEqual({ code: 0, err: '', out: `Moved 1.1.1 to doing: ${TODO} → ${DOING}\n` });
    expect(existsSync(join(root, DOING))).toBe(true);
    expect(existsSync(join(root, TODO))).toBe(false);
  });
});
