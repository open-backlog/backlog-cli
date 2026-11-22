import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../src/cli/run.js';
import { addItem, commentsOf, initBacklog, loadBacklog, validateDir, withComment } from '../src/core/index.js';

const tmps: string[] = [];
const saved = { ...process.env };
// git's global and system config are left out, so a handle set on this machine can't leak in.
beforeEach(() => {
  const empty = join(realpathSync(mkdtempSync(join(tmpdir(), 'ob-gitconfig-'))), 'config');
  tmps.push(join(empty, '..'));
  writeFileSync(empty, '');
  process.env['GIT_CONFIG_GLOBAL'] = empty;
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
});
afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
  for (const k of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) if (saved[k] === undefined) Reflect.deleteProperty(process.env, k); else process.env[k] = saved[k];
});
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const NOV = new Date(2026, 10, 21);

/** Epic 1, feature 1.1, story 1.1.1 in todo, committed; ob.handle ana unless `handle` is null. */
function project(opts: { git?: boolean; handle?: string | null; config?: string } = {}): string {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'ob-comment-'))), 'shop');
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
    if (opts.handle !== null) git(root, 'config', 'ob.handle', opts.handle ?? 'ana');
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

const STORY = 'backlog/stories/todo/1.1.1-add-to-cart.md';
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');
const head = (root: string) => git(root, 'show', '--name-status', '--format=%s', 'HEAD').split('\n').filter(Boolean);
const status = (root: string) => execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).replace(/\n$/, '');

describe('ob comment', () => {
  it('adds the same line you would add by hand, and commits that file alone', () => {
    const root = project();
    const byHand = join(root, '..', 'by-hand.md');
    copyFileSync(join(root, STORY), byHand);
    appendFileSync(byHand, '- 2026-11-21 @ana: Started; testing on beta\n');

    expect(ob(root, 'comment', '1.1.1', 'Started; testing on beta')).toEqual({
      code: 0, err: '',
      out: `Commented on 1.1.1: ${STORY}\n- 2026-11-21 @ana: Started; testing on beta\nCommitted: ob: comment on 1.1.1\n`,
    });
    expect(read(root, STORY)).toBe(readFileSync(byHand, 'utf8'));
    expect(head(root)).toEqual(['ob: comment on 1.1.1', `M\t${STORY}`]);
    expect(git(root, 'show', '--format=', '-U0', 'HEAD').split('\n').filter(l => /^[+-](?![+-]{2})/.test(l))).toEqual(['+- 2026-11-21 @ana: Started; testing on beta']);
    expect(status(root)).toBe('');
    expect(validateDir(join(root, 'backlog')).problems).toEqual([]);
  });

  it('works on epics and features (adding ## Comments) and on stories in any folder', () => {
    const root = project({ config: 'spec: 0.1\nname: shop\ndone-folders: month\n' });
    const epic = read(root, 'backlog/epics/1-checkout.md');
    expect(ob(root, 'comment', '1', 'Scope agreed').code).toBe(0);
    expect(read(root, 'backlog/epics/1-checkout.md')).toBe(`${epic}\n## Comments\n- 2026-11-21 @ana: Scope agreed\n`);
    expect(ob(root, 'comment', '1.1', 'Two stories').code).toBe(0);
    expect(read(root, 'backlog/features/1.1-cart.md')).toMatch(/\n\n## Comments\n- 2026-11-21 @ana: Two stories\n$/);
    for (const step of ['start', 'done']) {
      expect(ob(root, step, '1.1.1').code).toBe(0);
      expect(ob(root, 'comment', '1.1.1', `In ${step}`).out).toContain('Committed: ob: comment on 1.1.1');
    }
    const done = 'backlog/stories/done/2026-11/1.1.1-add-to-cart.md';
    expect(commentsOf(read(root, done)).map(c => c.text)).toEqual(['In start', 'In done']);
    expect(validateDir(join(root, 'backlog')).problems).toEqual([]);
    expect(git(root, 'log', '--format=%s').split('\n').slice(0, 6)).toEqual([
      'ob: comment on 1.1.1', 'ob: move 1.1.1 to done', 'ob: comment on 1.1.1', 'ob: move 1.1.1 to doing', 'ob: comment on 1.1', 'ob: comment on 1',
    ]);
  });

  it('signs with git config ob.handle or --as, never the git email or name', () => {
    const root = project({ handle: null });
    const before = read(root, STORY);
    const none = ob(root, 'comment', '1.1.1', 'Hello');
    expect(none.code).toBe(1);
    expect(none.err).toContain('git config --global ob.handle');
    expect(read(root, STORY)).toBe(before);
    expect(ob(root, 'comment', '1.1.1', 'From --as', '--as', 'jo-smith').code).toBe(0);
    expect(ob(root, 'comment', '1.1.1', 'At sign', '--as', '@jo-smith').code).toBe(0);
    git(root, 'config', 'ob.handle', 'ana');
    expect(ob(root, 'comment', '1.1.1', 'From config').code).toBe(0);
    expect(ob(root, 'comment', '1.1.1', 'Bad', '--as', 'Ana Silva').err).toContain('"Ana Silva" is not a handle');
    expect(ob(root, 'comment', '1.1.1', 'Bad', '--as', 'ana@example.com').code).toBe(1);
    const text = read(root, STORY);
    expect(commentsOf(text).map(c => `${c.handle}: ${c.text}`)).toEqual(['jo-smith: From --as', 'jo-smith: At sign', 'ana: From config']);
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('Ana Silva');
  });

  it('refuses an email address in the text, writing nothing', () => {
    const root = project();
    const r = ob(root, 'comment', '1.1.1', 'Ask', 'jo@example.com', 'about it');
    expect(r.code).toBe(1);
    expect(r.err).toContain('no-email');
    expect(status(root)).toBe('');
  });

  it('--no-commit writes the line only; uncommitted changes to the file are refused without it', () => {
    const root = project();
    expect(ob(root, 'comment', '1.1.1', 'Draft', '--no-commit').out).toContain('Not committed (--no-commit).');
    expect(status(root)).toBe(` M ${STORY}`);
    const edited = read(root, STORY);
    const r = ob(root, 'comment', '1.1.1', 'Another');
    expect(r.code).toBe(1);
    expect(r.err).toContain("has changes that aren't committed");
    expect(read(root, STORY)).toBe(edited);
  });

  it('keeps the rest of the file: a later heading, blank lines, CRLF line endings, text over several lines', () => {
    expect(withComment('---\nid: 1\n---\n\n## Comments\n- 2026-11-01 @jo: first\n  more\n\n## Notes\nkept\n', { date: '2026-11-21', handle: 'ana', text: 'second' }))
      .toBe('---\nid: 1\n---\n\n## Comments\n- 2026-11-01 @jo: first\n  more\n- 2026-11-21 @ana: second\n\n## Notes\nkept\n');
    expect(withComment('---\r\nid: 1\r\n---\r\n\r\n## Comments\r\n', { date: '2026-11-21', handle: 'ana', text: 'one\ntwo' }))
      .toBe('---\r\nid: 1\r\n---\r\n\r\n## Comments\r\n- 2026-11-21 @ana: one\r\n  two\r\n');
    expect(withComment('---\nid: 1\n---\nBody', { date: '2026-11-21', handle: 'ana', text: 'x' })).toBe('---\nid: 1\n---\nBody\n\n## Comments\n- 2026-11-21 @ana: x\n');
    expect(withComment('---\nid: 1\n---\n\n## Comments', { date: '2026-11-21', handle: 'ana', text: 'x' })).toBe('---\nid: 1\n---\n\n## Comments\n- 2026-11-21 @ana: x');
    expect(commentsOf('## Comments\n- 2026-11-01 @jo: first\n  more\n- not a comment\n  stray\n- 2026-11-02 @ana: second\n## Next\n- 2026-11-03 @x: no'))
      .toEqual([{ date: '2026-11-01', handle: 'jo', text: 'first\nmore' }, { date: '2026-11-02', handle: 'ana', text: 'second' }]);
  });

  it('ob show counts the comments and --json lists them, and they follow the story through its moves', () => {
    const root = project();
    ob(root, 'comment', '1.1.1', 'Started');
    ob(root, 'start', '1.1.1');
    ob(root, 'comment', '1.1.1', 'Halfway', '--as', 'jo-smith');
    const shown = ob(root, 'show', '1.1.1').out.split('\n');
    expect(shown.slice(0, 3)).toEqual(['1-checkout › 1.1-cart › 1.1.1-add-to-cart', 'backlog/stories/doing/1.1.1-add-to-cart.md  doing', 'Comments: 2, the last on 2026-11-21 by @jo-smith']);
    expect(shown).toContain('- 2026-11-21 @ana: Started');
    const json = JSON.parse(ob(root, 'show', '1.1.1', '--json').out) as { comments: unknown };
    expect(json.comments).toEqual([{ date: '2026-11-21', handle: 'ana', text: 'Started' }, { date: '2026-11-21', handle: 'jo-smith', text: 'Halfway' }]);
    expect(ob(root, 'show', '1.1').out).not.toContain('Comments:');
  });

  it('usage, unknown IDs, and outside git (written, nothing to commit)', () => {
    const root = project();
    expect(ob(root, 'comment', '1.1.1').code).toBe(2);
    expect(ob(root, 'comment').code).toBe(2);
    expect(ob(root, 'comment', '9.9.9', 'x').err).toContain('no item 9.9.9');
    expect(ob(root, 'comment', '1.1.1', '   ').err).toContain('needs some text');
    const plain = project({ git: false });
    expect(ob(plain, 'comment', '1.1.1', 'Offline', '--as', 'ana')).toEqual({ code: 0, err: '', out: `Commented on 1.1.1: ${STORY}\n- 2026-11-21 @ana: Offline\n` });
  });
});
