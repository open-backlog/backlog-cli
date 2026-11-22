import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { packageVersion, run } from '../src/cli/run.js';
import { boardLaunch, installedBoard, runBoard, versionLine } from '../src/cli/serve.js';
import type { Launch } from '../src/cli/serve.js';
import { BacklogError } from '../src/core/index.js';

/** ob serve (2.4.8): which board it runs, and how. The board itself is tested in backlog-board. */
const T1 = fileURLToPath(new URL('fixtures/t1-minimal/backlog/', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string; dependencies: Record<string, string>; files: string[] };
const LINE = versionLine(pkg.version);
const tmps: string[] = [];
afterEach(() => { for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true }); });
const tmp = () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'ob-serve-')));
  tmps.push(d);
  return d;
};

/** A folder with node_modules/open-backlog-board at this version, as npm installs it. */
function withBoard(version: string): string {
  const dir = tmp();
  const board = join(dir, 'node_modules', 'open-backlog-board');
  mkdirSync(join(board, 'dist', 'server'), { recursive: true });
  writeFileSync(join(board, 'package.json'), JSON.stringify({ name: 'open-backlog-board', version, bin: { 'open-backlog-board': 'dist/server/main.js' }, exports: { './package.json': './package.json' } }));
  writeFileSync(join(board, 'dist', 'server', 'main.js'), '');
  return dir;
}

/** A repository folder with a backlog in it. */
function repo(): string {
  const dir = tmp();
  cpSync(T1, join(dir, 'backlog'), { recursive: true });
  mkdirSync(join(dir, 'src'));
  return dir;
}

function serve(cwd: string, ...args: string[]) {
  let out = '', err = '';
  const launches: Launch[] = [];
  const code = run(['serve', ...args], { out: t => { out += t; }, err: t => { err += t; }, cwd, board: l => { launches.push(l); return 0; } });
  return { code, out, err, launch: launches[0] };
}

describe('ob serve', () => {
  it('goes with the board of the same major and minor version, which this package does not carry', () => {
    expect(versionLine('0.3.1')).toBe('0.3');
    expect(versionLine('1.12.0')).toBe('1.12');
    expect(pkg.dependencies['open-backlog-board']).toBeUndefined();
    expect(pkg.files).not.toContain('open-backlog-board');
  });

  it('finds an installed board as Node would: in the folder or one above it', () => {
    const dir = withBoard(`${LINE}.4`);
    mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
    expect(installedBoard([join(dir, 'src', 'deep')])).toEqual({ version: `${LINE}.4`, bin: join(dir, 'node_modules', 'open-backlog-board', 'dist', 'server', 'main.js') });
    expect(installedBoard([tmp()])).toBeNull();
  });

  it('runs an installed board of its line with node, else that line from npm with npx', () => {
    const mine = withBoard(`${LINE}.9`);
    expect(boardLaunch({ folder: '/work/shop', version: `${LINE}.0`, from: [tmp(), mine], open: true })).toEqual({
      command: process.execPath, args: [join(mine, 'node_modules', 'open-backlog-board', 'dist', 'server', 'main.js'), '/work/shop', '--open'], shell: false,
      note: `Starting open-backlog-board ${LINE}.9…`,
    });

    const none = boardLaunch({ folder: '/work/shop', version: '0.3.2', from: [tmp()], port: '4400', open: false, platform: 'linux' });
    expect(none).toEqual({ command: 'npx', args: ['--yes', 'open-backlog-board@0.3', '/work/shop', '--port', '4400'], shell: false, note: 'Running open-backlog-board@0.3 from npm (the first time, npm downloads it)…' });

    const old = boardLaunch({ folder: '/work/shop', version: '0.3.0', from: [withBoard('0.1.0')], open: true, platform: 'darwin' });
    expect(old.args).toEqual(['--yes', 'open-backlog-board@0.3', '/work/shop', '--open']);
    expect(old.note).toBe('The installed open-backlog-board is 0.1.0; ob 0.3.0 goes with 0.3.x. Running open-backlog-board@0.3 from npm (the first time, npm downloads it)…');

    const win = boardLaunch({ folder: 'C:\\My Work\\shop', version: '0.3.0', from: [], open: true, platform: 'win32' });
    expect(win).toMatchObject({ command: 'npx.cmd', shell: true, args: ['--yes', 'open-backlog-board@0.3', '"C:\\My Work\\shop"', '--open'] });
  });

  it('starts the board for the repository it is run in, opening the browser unless --no-open', () => {
    const dir = repo();
    const r = serve(join(dir, 'src'));
    expect(r.code).toBe(0);
    expect(r.launch?.args.slice(-2)).toEqual([join(dir, 'src'), '--open']);
    expect(r.err).toMatch(/^(Starting|Running) open-backlog-board/);
    expect(serve(dir, '--no-open', '--port', '4400').launch?.args.slice(-3)).toEqual([dir, '--port', '4400']);
    expect(packageVersion()).toBe(pkg.version);
  });

  it('says what is wrong before fetching anything: no backlog, a bad port, an argument', () => {
    const none = serve(tmp());
    expect(none).toMatchObject({ code: 1, launch: undefined });
    expect(none.err).toMatch(/^ob: no backlog here: no backlog\/config\.yml in /);
    expect(serve(repo(), '--port', 'web')).toMatchObject({ code: 2, launch: undefined, err: 'ob: --port web is not a port number\nRun "ob serve --help" for usage.\n' });
    expect(serve(repo(), 'backlog')).toMatchObject({ code: 2, launch: undefined });
  });

  it('returns the board’s exit code, and says so when npx is missing', () => {
    expect(runBoard({ command: process.execPath, args: ['-e', 'process.exit(3)'], shell: false, note: '' })).toBe(3);
    expect(() => runBoard({ command: 'ob-no-such-npx', args: [], shell: false, note: '' })).toThrow(BacklogError);
    expect(() => runBoard({ command: 'ob-no-such-npx', args: [], shell: false, note: '' })).toThrow(/can't run ob-no-such-npx: it comes with Node\.js and npm/);
  });
});
