import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { run } from '../src/cli/run.js';
import { stripAnsi } from '../src/cli/style.js';
import { listItems, loadBacklog, validateDir } from '../src/core/index.js';

const tmps: string[] = [];
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }); });

const NOW = new Date('2026-11-21T12:00:00Z');
const daysAgo = (n: number) => Math.floor(NOW.getTime() / 1000) - n * 86_400;
function git(cwd: string, args: string[], at?: number): string {
  const env = { ...process.env, ...(at ? { GIT_AUTHOR_DATE: `@${at} +0000`, GIT_COMMITTER_DATE: `@${at} +0000` } : {}) };
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}
const fm = (f: string) => `---\n${f}\n---\n`;
const story = (id: string, title: string, parent: string, extra = '', type = 'story') => fm(`id: ${id}\ntype: ${type}\ntitle: ${title}\nparent: ${parent}${extra ? `\n${extra}` : ''}`);

/**
 * A T3 backlog in git: epics 1 and 2, features 1.1, 1.2 and 2.1, items in todo and doing, one
 * moved to done 5 days ago and one 40 days ago.
 */
function project(inGit = true): string {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'ob-list-'))), 'shop');
  tmps.push(join(root, '..'));
  const files: Record<string, string> = {
    'config.yml': 'spec: 0.1\nname: shop\nrepos:\n  shop-api: git@example.com:shop-api.git\n  shop-web: git@example.com:shop-web.git\n',
    'sprints/2026-S24.md': fm('start: 2026-11-16\nend: 2026-11-27'),
    'epics/1-checkout.md': fm('id: 1\ntype: epic\ntitle: Checkout'),
    'epics/2-accounts.md': fm('id: 2\ntype: epic\ntitle: Accounts'),
    'features/1.1-cart.md': fm('id: 1.1\ntype: feature\ntitle: Cart\nparent: 1'),
    'features/1.2-pay.md': fm('id: 1.2\ntype: feature\ntitle: Pay\nparent: 1'),
    'features/2.1-sign-in.md': fm('id: 2.1\ntype: feature\ntitle: Sign in\nparent: 2'),
    'stories/todo/1.1.10-ten.md': story('1.1.10', 'Ten comes after two', '1.1', 'repo: shop-web'),
    'stories/todo/1.1.2-two.md': story('1.1.2', 'Two', '1.1', 'repo: [shop-api, shop-web]\nassignee: ana\nsprint: 2026-S24'),
    'stories/doing/1.2.1-card.md': story('1.2.1', 'Card form', '1.2', 'repo: shop-web\nassignee: jo\nsprint: 2026-S24'),
    'stories/todo/2.1.1-crash.md': story('2.1.1', 'Crash on sign in', '2.1', 'repo: shop-api', 'bug'),
    'stories/todo/1.1.1-old.md': story('1.1.1', 'Finished long ago', '1.1', 'repo: shop-api'),
    'stories/todo/1.2.2-new.md': story('1.2.2', 'Finished this week', '1.2', 'repo: shop-api\nassignee: ana'),
  };
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(join(root, 'backlog', p, '..'), { recursive: true });
    writeFileSync(join(root, 'backlog', p), t);
  }
  mkdirSync(join(root, 'backlog', 'stories', 'done'), { recursive: true });
  if (inGit) {
    git(join(root, '..'), ['init', '-q', '-b', 'main', 'shop']);
    git(root, ['config', 'user.name', 'Ana Silva']);
    git(root, ['config', 'user.email', 'ana@example.com']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'start'], daysAgo(60));
    git(root, ['mv', 'backlog/stories/todo/1.1.1-old.md', 'backlog/stories/done/']);
    git(root, ['commit', '-qm', 'old done'], daysAgo(40));
    git(root, ['mv', 'backlog/stories/todo/1.2.2-new.md', 'backlog/stories/done/']);
    git(root, ['commit', '-qm', 'new done'], daysAgo(5));
  } else {
    for (const n of ['1.1.1-old.md', '1.2.2-new.md']) {
      execFileSync('mv', [join(root, 'backlog', 'stories', 'todo', n), join(root, 'backlog', 'stories', 'done', n)]);
    }
  }
  return root;
}

function ob(root: string, args: string[], columns?: number, color?: boolean) {
  let out = '', err = '';
  const code = run(['list', ...args], { out: t => { out += t; }, err: t => { err += t; }, cwd: root, now: NOW, ...(columns ? { columns } : {}), ...(color ? { color } : {}) });
  return { code, out, err };
}
const ids = (out: string) => out.split('\n').filter(Boolean).map(l => l.split(' ')[0]);
const jsonIds = (root: string, args: string[]) => (JSON.parse(ob(root, [...args, '--json']).out) as { id: string }[]).map(i => i.id);

describe('ob list', () => {
  it('lists story-level items in build order: ID, status, repo, title; old done work left out, said on stderr', () => {
    const root = project();
    expect(validateDir(join(root, 'backlog')).problems).toEqual([]);
    const r = ob(root, []);
    expect(r.code).toBe(0);
    expect(r.out).toBe([
      '1.1.2   todo   shop-api,shop-web  Two',
      '1.1.10  todo   shop-web           Ten comes after two',
      '1.2.1   doing  shop-web           Card form',
      '1.2.2   done   shop-api           Finished this week',
      '2.1.1   todo   shop-api           Crash on sign in',
      ''].join('\n'));
    expect(r.err).toBe('ob: 1 done item finished over 30 days ago not shown; --all shows them\n');
    expect(ids(ob(root, ['--all']).out)).toEqual(['1.1.1', '1.1.2', '1.1.10', '1.2.1', '1.2.2', '2.1.1']);
    expect(ob(root, ['--all']).err).toBe('');
  });

  it('filters by status, type, parent (epic or feature), repo, assignee and sprint, alone, with commas, and together', () => {
    const root = project();
    const cases: [string[], string[]][] = [
      [['--status', 'todo'], ['1.1.2', '1.1.10', '2.1.1']],
      [['--status', 'todo,doing'], ['1.1.2', '1.1.10', '1.2.1', '2.1.1']],
      [['--status', 'done'], ['1.2.2']],
      [['--status', 'done', '--all'], ['1.1.1', '1.2.2']],
      [['--type', 'bug'], ['2.1.1']],
      [['--parent', '1'], ['1.1.2', '1.1.10', '1.2.1', '1.2.2']],
      [['--parent', '1.2'], ['1.2.1', '1.2.2']],
      [['--parent', '1.2', '--parent', '2.1'], ['1.2.1', '1.2.2', '2.1.1']],
      [['--repo', 'shop-api'], ['1.1.2', '1.2.2', '2.1.1']],
      [['--assignee', 'ana'], ['1.1.2', '1.2.2']],
      [['--assignee', '@jo'], ['1.2.1']],
      [['--sprint', '2026-S24'], ['1.1.2', '1.2.1']],
      [['--repo', 'shop-web', '--status', 'todo', '--parent', '1.1'], ['1.1.2', '1.1.10']],
      [['--assignee', 'nobody'], []],
    ];
    for (const [args, want] of cases) {
      const r = ob(root, args);
      expect(ids(r.out), args.join(' ')).toEqual(want);
      // --json gives the same items.
      expect(jsonIds(root, args), `${args.join(' ')} --json`).toEqual(want);
    }
  });

  it('--json gives each item\'s fields for other tools', () => {
    const root = project();
    const j = JSON.parse(ob(root, ['--json', '--parent', '1.1']).out);
    expect(j[0]).toEqual({ id: '1.1.2', type: 'story', status: 'todo', title: 'Two', parent: '1.1', repo: ['shop-api', 'shop-web'],
      assignee: 'ana', sprint: '2026-S24', path: 'stories/todo/1.1.2-two.md' });
    expect(j[1]).toMatchObject({ id: '1.1.10', assignee: null, sprint: null, repo: ['shop-web'] });
  });

  it('fits an 80-column terminal, and pipes cleanly: no colour, nothing cut, nothing but the rows on stdout', () => {
    const root = project();
    const long = 'A very long title that goes on and on well past the edge of any ordinary terminal window';
    writeFileSync(join(root, 'backlog', 'stories', 'todo', '1.1.3-long.md'), story('1.1.3', long, '1.1', 'repo: shop-api'));
    const tty = ob(root, [], 80).out.split('\n').filter(Boolean);
    for (const l of tty) expect([...l].length, l).toBeLessThanOrEqual(80);
    expect(tty.find(l => l.startsWith('1.1.3'))).toMatch(/^1\.1\.3 {3}todo {3}shop-api {11}A very long title .+…$/);
    const piped = ob(root, []).out;
    expect(piped).toContain(long);
    expect(piped.includes(String.fromCharCode(27))).toBe(false); // no ANSI escape (colour)
    expect(ob(root, [], 20).out.split('\n').filter(Boolean).every(l => [...l].length <= 20)).toBe(true);
  });

  it('a big done/ never floods the list: only the last 30 days show', () => {
    const root = project();
    for (let n = 3; n < 203; n++) writeFileSync(join(root, 'backlog', 'stories', 'done', `2.1.${n}-old-${n}.md`), story(`2.1.${n}`, `Old ${n}`, '2.1'));
    git(root, ['add', '-A']);
    // Committed after the recent move but dated 90 days ago (as a rebase can leave it): the
    // recent one must still show.
    git(root, ['commit', '-qm', 'history'], daysAgo(90));
    const r = ob(root, []);
    expect(ids(r.out)).toEqual(['1.1.2', '1.1.10', '1.2.1', '1.2.2', '2.1.1']);
    expect(r.err).toBe('ob: 201 done items finished over 30 days ago not shown; --all shows them\n');
    expect(ids(ob(root, ['--all']).out)).toHaveLength(206);
  });

  it('counts a move to done not yet committed as recent', () => {
    const root = project();
    git(root, ['mv', 'backlog/stories/todo/2.1.1-crash.md', 'backlog/stories/done/']);
    expect(ids(ob(root, ['--status', 'done']).out)).toEqual(['1.2.2', '2.1.1']);
  });

  it('outside git there are no dates, so every done item shows', () => {
    const root = project(false);
    expect(ob(root, ['--status', 'done'])).toEqual({ code: 0, err: '', out: '1.1.1  done  shop-api  Finished long ago\n1.2.2  done  shop-api  Finished this week\n' });
  });

  it('a backlog without repos has no repo column', () => {
    const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'ob-list-'))), 'notes');
    tmps.push(join(root, '..'));
    const files = { 'config.yml': 'spec: 0.1\nname: notes\n', 'epics/1-a.md': fm('id: 1\ntype: epic\ntitle: A'), 'features/1.1-b.md': fm('id: 1.1\ntype: feature\ntitle: B\nparent: 1'),
      'stories/doing/1.1.1-c.md': story('1.1.1', 'C', '1.1') };
    for (const [p, t] of Object.entries(files)) { mkdirSync(join(root, 'backlog', p, '..'), { recursive: true }); writeFileSync(join(root, 'backlog', p), t); }
    expect(ob(root, []).out).toBe('1.1.1  doing  C\n');
  });

  it('refuses a status or type it does not know (exit 2) and an unknown parent (exit 1)', () => {
    const root = project();
    expect(ob(root, ['--status', 'finished'])).toMatchObject({ code: 2, out: '', err: expect.stringContaining('"finished" is not a status') });
    expect(ob(root, ['--type', 'epic'])).toMatchObject({ code: 2, err: expect.stringContaining('use story, bug, spike or task') });
    expect(ob(root, ['--parent', '9'])).toMatchObject({ code: 1, err: 'ob: no item 9 in this backlog\n' });
    expect(ob(root, ['todo']).code).toBe(2);
  });

  it('is in the core for the board: listItems gives the items and how many done were left out', () => {
    const root = project();
    const l = listItems(loadBacklog(join(root, 'backlog')), { status: ['done'] }, { now: NOW });
    expect([l.items.map(i => i.id), l.hiddenDone]).toEqual([['1.2.2'], 1]);
    expect(listItems(loadBacklog(join(root, 'backlog')), {}, { now: NOW, days: 50 }).hiddenDone).toBe(0);
  });

  describe('in color (4.1.1)', () => {
    it('paints statuses and bold IDs, and is otherwise the same text', () => {
      const root = project();
      const plain = ob(root, []).out, colored = ob(root, [], undefined, true).out;
      expect(plain).not.toContain('\x1b');
      expect(stripAnsi(colored)).toBe(plain);
      const doing = colored.split('\n').find(l => l.includes('Card form')) ?? '';
      expect(doing).toContain('\x1b[34mdoing\x1b[0m');
      expect(doing.startsWith('\x1b[1m1.2.1\x1b[0m')).toBe(true);
      expect(colored).toContain('\x1b[90mtodo\x1b[0m');
      expect(colored).toContain('\x1b[32mdone\x1b[0m');
      expect(colored).toContain('\x1b[36mshop-web\x1b[0m');
    });

    it('cuts to the terminal as the plain text is cut, closing every color before the …', () => {
      const root = project();
      const plain = ob(root, [], 20).out.split('\n').filter(Boolean);
      const colored = ob(root, [], 20, true).out.split('\n').filter(Boolean);
      expect(colored.map(stripAnsi)).toEqual(plain);
      for (const line of colored) {
        expect(line.endsWith('…')).toBe(true);
        const body = line.slice(0, -1);
        // eslint-disable-next-line no-control-regex -- counting escape codes
        expect(body.match(/\x1b\[[0-9;]*m/g)?.filter(c => c !== '\x1b[0m').length).toBe(body.match(/\x1b\[0m/g)?.length);
      }
    });

    it('never paints --json', () => {
      expect(ob(project(), ['--json'], undefined, true).out).not.toContain('\x1b');
    });
  });
});
