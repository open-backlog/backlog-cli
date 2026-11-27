import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { run } from '../src/cli/run.js';
import { stripAnsi } from '../src/cli/style.js';
import { buildTree, loadBacklog, newItemText, progressOf, showItem, walk } from '../src/core/index.js';

const tmps: string[] = [];
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }); });

const NOW = new Date('2026-11-21T12:00:00Z');
const daysAgo = (n: number) => Math.floor(NOW.getTime() / 1000) - n * 86_400;
function git(cwd: string, args: string[], at = daysAgo(60)): string {
  const env = { ...process.env, GIT_AUTHOR_DATE: `@${at} +0000`, GIT_COMMITTER_DATE: `@${at} +0000` };
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}
const fm = (f: string) => `---\n${f}\n---\n`;
const item = (id: string, type: string, title: string, parent?: string, fields?: Record<string, number>) =>
  newItemText({ id, type, title, ...(parent ? { parent } : {}), ...(fields ? { fields } : {}) });

/**
 * C1 › epic 2 › feature 2.3 with stories done (5 days ago), doing and todo, two near-identical
 * todo stories, and 2.3.9, pruned; epic 1 › 1.1 with one story done 40 days ago.
 */
function project(inGit = true): string {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'ob-show-'))), 'shop');
  tmps.push(join(root, '..'));
  const write = (p: string, t: string) => { mkdirSync(join(root, 'backlog', p, '..'), { recursive: true }); writeFileSync(join(root, 'backlog', p), t); };
  write('config.yml', 'spec: 0.1\nname: shop\n');
  for (const f of ['todo', 'doing', 'done']) write(`stories/${f}/.gitkeep`, '');
  write('capabilities/C1-identity.md', item('C1', 'capability', 'Identity'));
  write('epics/1-launch.md', item('1', 'epic', 'Launch'));
  write('features/1.1-site.md', item('1.1', 'feature', 'Site', '1'));
  write('stories/todo/1.1.1-page.md', item('1.1.1', 'story', 'Page', '1.1'));
  write('epics/2-build.md', fm('id: 2\ntype: epic\ntitle: Build\nparent: C1'));
  write('features/2.3-cli.md', item('2.3', 'feature', 'CLI', '2'));
  write('stories/todo/2.3.1-ob-init.md', item('2.3.1', 'story', 'ob init', '2.3', { estimate: 2 }));
  write('stories/todo/2.3.2-ob-new.md', item('2.3.2', 'story', 'ob new', '2.3', { estimate: 3 }));
  write('stories/todo/2.3.3-ob-validate.md', item('2.3.3', 'story', 'ob validate', '2.3'));
  write('stories/todo/2.3.5-same.md', item('2.3.5', 'story', 'Same', '2.3'));
  write('stories/todo/2.3.6-same.md', item('2.3.6', 'story', 'Same', '2.3'));
  write('stories/todo/2.3.9-dropped.md', item('2.3.9', 'story', 'Dropped', '2.3'));
  if (!inGit) return root;
  git(join(root, '..'), ['init', '-q', '-b', 'main', 'shop']);
  git(root, ['config', 'user.name', 'Ana Silva']);
  git(root, ['config', 'user.email', 'ana@example.com']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'plan']);
  const mv = (from: string, to: string, msg: string, at: number) => { git(root, ['mv', `backlog/${from}`, `backlog/${to}`]); git(root, ['commit', '-qm', msg], at); };
  mv('stories/todo/1.1.1-page.md', 'stories/done/', 'ob: move 1.1.1 to done', daysAgo(40));
  mv('stories/todo/2.3.9-dropped.md', 'stories/doing/', 'ob: move 2.3.9 to doing', daysAgo(20));
  writeFileSync(join(root, 'backlog/stories/doing/2.3.9-dropped.md'), readFileSync(join(root, 'backlog/stories/doing/2.3.9-dropped.md'), 'utf8') + '- 2026-11-01 @ana: not needed after all\n');
  git(root, ['commit', '-qam', 'ob: edit 2.3.9 comment'], daysAgo(19));
  git(root, ['rm', '-q', 'backlog/stories/doing/2.3.9-dropped.md']);
  git(root, ['commit', '-qm', 'prune 2.3.9'], daysAgo(18));
  mv('stories/todo/2.3.1-ob-init.md', 'stories/done/', 'ob: move 2.3.1 to done', daysAgo(5));
  mv('stories/todo/2.3.2-ob-new.md', 'stories/doing/', 'ob: move 2.3.2 to doing', daysAgo(4));
  mv('stories/todo/2.3.6-same.md', 'stories/doing/', 'ob: move 2.3.6 to doing', daysAgo(3));
  return root;
}

function ob(root: string, args: string[], columns?: number, color?: boolean) {
  let out = '', err = '';
  const code = run(args, { out: t => { out += t; }, err: t => { err += t; }, cwd: root, now: NOW, ...(columns ? { columns } : {}), ...(color ? { color } : {}) });
  return { code, out, err };
}

describe('ob show', () => {
  it('prints where the item sits, its file, its text and its history across moves', () => {
    const root = project();
    const r = ob(root, ['show', '2.3.2']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(new RegExp([
      '^C1-identity › 2-build › 2\\.3-cli › 2\\.3\\.2-ob-new',
      'backlog/stories/doing/2\\.3\\.2-ob-new\\.md  doing',
      '',
      '---\nid: 2\\.3\\.2\ntype: story\ntitle: ob new\nparent: 2\\.3\nestimate: 3\n---[\\s\\S]*## Comments',
      '',
      'History:',
      '  2026-11-17  [0-9a-f]+  Ana Silva  ob: move 2\\.3\\.2 to doing',
      '  2026-09-22  [0-9a-f]+  Ana Silva  plan\n$'].join('\n')));
  });

  it('history is exact: a near-identical story\'s commits are not mixed in', () => {
    const root = project();
    expect(readFileSync(join(root, 'backlog/stories/todo/2.3.5-same.md'), 'utf8').replace('2.3.5', '2.3.6'))
      .toBe(readFileSync(join(root, 'backlog/stories/doing/2.3.6-same.md'), 'utf8'));
    expect(showItem(loadBacklog(join(root, 'backlog')), '2.3.5').history.map(h => h.subject)).toEqual(['plan']);
    expect(showItem(loadBacklog(join(root, 'backlog')), '2.3.6').history.map(h => h.subject)).toEqual(['ob: move 2.3.6 to doing', 'plan']);
  });

  it('a feature shows its progress (as the core works it out) and its children', () => {
    const root = project();
    const r = ob(root, ['show', '2.3']);
    expect(r.out).toContain('C1-identity › 2-build › 2.3-cli\nbacklog/features/2.3-cli.md\nProgress: 1/5 done (20%), 2 doing, 2 todo\n');
    expect(r.out).toContain('Children:\n  2.3.1  done     ob init\n  2.3.2  doing    ob new\n  2.3.3  todo     ob validate\n  2.3.5  todo     Same\n  2.3.6  doing    Same\n');
    const b = loadBacklog(join(root, 'backlog'));
    const node = buildTree(b.items).byId.get('2.3');
    expect(node && showItem(b, '2.3').progress).toEqual(node && progressOf(node));
  });

  it('a pruned ID shows its last version from git history, marked deleted, with its history', () => {
    const root = project();
    const r = ob(root, ['show', '2.3.9']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^C1-identity › 2-build › 2\.3-cli › 2\.3\.9-dropped\nbacklog\/stories\/doing\/2\.3\.9-dropped\.md \(deleted\)\nDeleted in [0-9a-f]+ on 2026-11-03 by Ana Silva: prune 2\.3\.9\. Its last version:\n/);
    expect(r.out).toContain('- 2026-11-01 @ana: not needed after all');
    expect(r.out).toContain('History:\n');
    expect(r.out).toMatch(/prune 2\.3\.9\n.*ob: edit 2\.3\.9 comment\n.*ob: move 2\.3\.9 to doing\n.*plan\n$/);
    const j = JSON.parse(ob(root, ['show', '2.3.9', '--json']).out);
    expect(j).toMatchObject({ id: '2.3.9', type: 'story', title: 'Dropped', status: 'doing', deleted: { subject: 'prune 2.3.9', date: '2026-11-03' }, fields: { parent: '2.3' } });
  });

  it('--json gives the same for other tools', () => {
    const j = JSON.parse(ob(project(), ['show', '2.3.1', '--json']).out);
    expect(j).toMatchObject({ id: '2.3.1', type: 'story', title: 'ob init', status: 'done', path: 'stories/done/2.3.1-ob-init.md',
      breadcrumb: ['C1-identity', '2-build', '2.3-cli', '2.3.1-ob-init'], progress: null, children: [], deleted: null, fields: { estimate: 2 } });
    expect(j.history.map((h: { subject: string }) => h.subject)).toEqual(['ob: move 2.3.1 to done', 'plan']);
    expect(j.text).toContain('id: 2.3.1');
  });

  it('an ID never used is an error; bad usage exits 2; outside git there is no history', () => {
    const root = project();
    expect(ob(root, ['show', '7.7'])).toMatchObject({ code: 1, err: 'ob: no item 7.7 in this backlog, now or in its git history\n' });
    expect(ob(root, ['show']).code).toBe(2);
    expect(ob(root, ['show', '1', '2']).code).toBe(2);
    const plain = project(false);
    const r = ob(plain, ['show', '2.3.2']);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('History:');
    expect(ob(plain, ['show', '9.9.9']).code).toBe(1);
  });
});

describe('ob tree', () => {
  it('prints the plan with each container\'s status and progress, items underneath; old done left out', () => {
    const root = project();
    const r = ob(root, ['tree']);
    expect(r.out).toBe([
      'C1  doing  1/5 done (20%)  Identity',
      '  2  doing  1/5 done (20%)  Build',
      '    2.3  doing  1/5 done (20%)  CLI',
      '      2.3.1  done   ob init',
      '      2.3.2  doing  ob new',
      '      2.3.3  todo   ob validate',
      '      2.3.5  todo   Same',
      '      2.3.6  doing  Same',
      '1  done   1/1 done (100%)  Launch',
      '  1.1  done   1/1 done (100%)  Site',
      ''].join('\n'));
    expect(r.err).toBe('ob: 1 done item finished over 30 days ago not shown; --all shows them\n');
    expect(ob(root, ['tree', '--all']).out).toContain('  1.1  done   1/1 done (100%)  Site\n    1.1.1  done   Page\n');
  });

  it('every progress number matches the core library (2.2.4)', () => {
    const root = project();
    const b = loadBacklog(join(root, 'backlog'));
    const core = new Map(walk(buildTree(b.items)).map(({ node }) => [node.item.id, node]));
    type J = { id: string; progress: unknown; children: J[] };
    const check = (j: J) => {
      const n = core.get(j.id);
      if (n && j.progress !== null) expect(j.progress, j.id).toEqual(progressOf(n));
      j.children.forEach(check);
    };
    const tree = JSON.parse(ob(root, ['tree', '--all', '--json']).out) as J[];
    tree.forEach(check);
    expect(tree.map(t => t.id)).toEqual(['C1', '1']);
  });

  it('--depth limits the levels; --json is the same tree', () => {
    const root = project();
    expect(ob(root, ['tree', '--depth', '1']).out).toBe('C1  doing  1/5 done (20%)  Identity\n1  done   1/1 done (100%)  Launch\n');
    expect(ob(root, ['tree', '--depth', '3']).out.split('\n').filter(Boolean).map(l => l.trim().split(' ')[0])).toEqual(['C1', '2', '2.3', '1', '1.1']);
    const j = JSON.parse(ob(root, ['tree', '--depth', '2', '--json']).out);
    expect(j[0]).toMatchObject({ id: 'C1', type: 'capability', status: 'doing', children: [{ id: '2', children: [] }] });
    expect(ob(root, ['tree', '--depth', '0']).code).toBe(2);
    expect(ob(root, ['tree', '--depth', 'x']).code).toBe(2);
  });

  it('fits a terminal and pipes uncut', () => {
    const root = project();
    for (const l of ob(root, ['tree'], 30).out.split('\n').filter(Boolean)) expect([...l].length, l).toBeLessThanOrEqual(30);
    expect(ob(root, ['tree']).out).toContain('  2  doing  1/5 done (20%)  Build');
  });
});

describe('ob tree by level (4.2.1)', () => {
  const lines = (out: string) => out.split('\n').filter(Boolean);
  const ids = (out: string) => lines(out).map(l => l.trim().split(' ')[0]);

  it('epic, feature and capability stop below that type, in every branch', () => {
    const root = project();
    expect(ob(root, ['tree', 'epic'])).toEqual({ code: 0, err: '', out: 'C1  doing  1/5 done (20%)  Identity\n  2  doing  1/5 done (20%)  Build\n1  done   1/1 done (100%)  Launch\n' });
    const feature = ob(root, ['tree', 'feature']).out;
    expect(ids(feature)).toEqual(['C1', '2', '2.3', '1', '1.1']);
    expect(lines(feature)).toContain('    2.3  doing  1/5 done (20%)  CLI');
    expect(lines(feature)).toContain('  1.1  done   1/1 done (100%)  Site');
    expect(ids(ob(root, ['tree', 'capability']).out)).toEqual(['C1', '1']);
  });

  it('story, its plural and no level are everything; numbers, --depth and any case agree', () => {
    const root = project();
    const all = ob(root, ['tree']).out;
    for (const l of ['story', 'stories', 'bug', 'Tasks']) expect(ob(root, ['tree', l]).out, l).toBe(all);
    expect(ob(root, ['tree', '2']).out).toBe(ob(root, ['tree', '--depth', '2']).out);
    expect(ob(root, ['tree', '--depth', 'feature']).out).toBe(ob(root, ['tree', 'feature']).out);
    expect(ob(root, ['tree', 'EPIC']).out).toBe(ob(root, ['tree', 'epic']).out);
    expect(ob(root, ['tree', 'Features']).out).toBe(ob(root, ['tree', 'feature']).out);
  });

  it('--json follows the level, and progress still counts everything', () => {
    const root = project();
    type J = { id: string; progress: unknown; children: J[] };
    const tree = JSON.parse(ob(root, ['tree', 'feature', '--json']).out) as J[];
    const flat = (n: J): J[] => [n, ...n.children.flatMap(flat)];
    const byId = new Map(tree.flatMap(flat).map(n => [n.id, n]));
    expect([...byId.keys()]).toEqual(['C1', '2', '2.3', '1', '1.1']);
    expect(byId.get('2.3')?.children).toEqual([]);
    expect(byId.get('1.1')?.children).toEqual([]);
    const core = buildTree(loadBacklog(join(root, 'backlog')).items).byId;
    for (const [id, n] of byId) {
      const node = core.get(id);
      expect(node && n.progress, id).toEqual(node && progressOf(node));
    }
  });

  it('refuses a level it does not know, or the level given twice (exit 2)', () => {
    const root = project();
    for (const args of [['0'], ['sprint'], ['feature', '--depth', '2'], ['epic', 'feature'], ['--depth', 'x']]) {
      const r = ob(root, ['tree', ...args]);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.out, args.join(' ')).toBe('');
    }
    expect(ob(root, ['tree', 'sprint']).err).toContain('"sprint" is not a level: use a number from 1, or capability, epic, feature or story');
    expect(ob(root, ['tree', 'feature', '--depth', '2']).err).toContain('give the level once: ob tree feature or ob tree --depth feature');
  });
});

describe('in color (4.1.3)', () => {
  it('ob tree paints statuses, bold IDs and dim progress; otherwise the same text, also cut', () => {
    const root = project();
    const plain = ob(root, ['tree']).out, colored = ob(root, ['tree'], undefined, true).out;
    expect(plain).not.toContain('\x1b');
    expect(stripAnsi(colored)).toBe(plain);
    expect(colored).toContain('    \x1b[1m2.3.2\x1b[0m  \x1b[34mdoing\x1b[0m  ob new');
    expect(colored).toContain('\x1b[2m1/5 done (20%)\x1b[0m  Build');
    expect(colored).toContain('\x1b[32mdone\x1b[0m');
    expect(colored).toContain('\x1b[90mtodo\x1b[0m');
    const cut = ob(root, ['tree'], 30).out.split('\n'), cutColored = ob(root, ['tree'], 30, true).out.split('\n');
    expect(cutColored.map(stripAnsi)).toEqual(cut);
    expect(cut.some(l => l.endsWith('…'))).toBe(true);
  });

  it('ob show paints its status, labels, children and hashes, never the file text', () => {
    const root = project();
    for (const id of ['2.3.2', '2.3']) {
      const plain = ob(root, ['show', id]).out, colored = ob(root, ['show', id], undefined, true).out;
      expect(stripAnsi(colored), id).toBe(plain);
      const text = showItem(loadBacklog(join(root, 'backlog')), id).text.trimEnd();
      expect(colored, id).toContain(`\n\n${text}\n`);
    }
    const story = ob(root, ['show', '2.3.2'], undefined, true).out;
    expect(story.startsWith('\x1b[2mC1-identity › 2-build › 2.3-cli › 2.3.2-ob-new\x1b[0m\n')).toBe(true);
    expect(story).toContain('2.3.2-ob-new.md  \x1b[34mdoing\x1b[0m\n');
    expect(story).toContain('\x1b[1mHistory:\x1b[0m');
    // eslint-disable-next-line no-control-regex -- matching an escape code
    expect(story).toMatch(/ {2}2026-11-17 {2}\x1b\[2m[0-9a-f]+\x1b\[0m {2}Ana Silva/);
    const feature = ob(root, ['show', '2.3'], undefined, true).out;
    expect(feature).toContain('\x1b[1mChildren:\x1b[0m\n  \x1b[1m2.3.1\x1b[0m  \x1b[32mdone\x1b[0m     ob init\n');
    expect(feature).toContain('\x1b[1mProgress:\x1b[0m 1/5 done (20%)');
    expect(ob(root, ['show', '2.3.9'], undefined, true).out).toContain('\x1b[31m(deleted)\x1b[0m');
  });

  it('--json is never painted', () => {
    const root = project();
    expect(ob(root, ['tree', '--json'], undefined, true).out).not.toContain('\x1b');
    expect(ob(root, ['show', '2.3', '--json'], undefined, true).out).not.toContain('\x1b');
  });
});
