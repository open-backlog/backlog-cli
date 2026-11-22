// ob serve (2.4.8): runs the board, open-backlog-board, for the backlog here (D6). The board
// depends on this package's core, so this package can't depend on the board: ob uses one that is
// installed (in the project, or globally beside ob), or runs it from npm with npx. Either way it
// is the board line that goes with this ob: open-backlog-board 0.3.x for open-backlog 0.3.x.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { BacklogError } from '../core/index.js';

export const BOARD = 'open-backlog-board';

/** "0.3" for "0.3.1": a board goes with the ob whose version has the same major and minor. */
export function versionLine(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

export interface InstalledBoard { version: string; bin: string }

/** The open-backlog-board that Node finds from these folders, as `import` would, or null. */
export function installedBoard(from: readonly string[]): InstalledBoard | null {
  for (const dir of from) {
    let file: string;
    try {
      file = createRequire(join(dir, 'ob-serve.js')).resolve(`${BOARD}/package.json`);
    } catch {
      continue;
    }
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version?: string; bin?: string | Record<string, string> };
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[BOARD];
    if (pkg.version && bin) return { version: pkg.version, bin: join(dirname(file), bin) };
  }
  return null;
}

/** What ob serve runs: a command, its arguments, and a line saying which board. */
export interface Launch { command: string; args: string[]; shell: boolean; note: string }

export interface LaunchOptions {
  /** The folder the board serves (it finds backlog/ from there, as ob does). */
  folder: string;
  /** This ob's version. */
  version: string;
  /** Where to look for an installed board: the working folder, then ob's own package. */
  from: readonly string[];
  port?: string;
  open: boolean;
  platform?: NodeJS.Platform;
}

export function boardLaunch(o: LaunchOptions): Launch {
  const win = (o.platform ?? process.platform) === 'win32';
  const boardArgs = [o.folder, ...(o.port === undefined ? [] : ['--port', o.port]), ...(o.open ? ['--open'] : [])];
  const line = versionLine(o.version);
  const found = installedBoard(o.from);
  if (found && versionLine(found.version) === line) {
    return { command: process.execPath, args: [found.bin, ...boardArgs], shell: false, note: `Starting ${BOARD} ${found.version}…` };
  }
  const spec = `${BOARD}@${line}`;
  const other = found ? `The installed ${BOARD} is ${found.version}; ob ${o.version} goes with ${line}.x. ` : '';
  // On Windows npx is npx.cmd, which runs only through a shell; quote what may hold spaces.
  const args = ['--yes', spec, ...boardArgs].map(a => (win && /\s/.test(a) ? `"${a}"` : a));
  return { command: win ? 'npx.cmd' : 'npx', args, shell: win, note: `${other}Running ${spec} from npm (the first time, npm downloads it)…` };
}

/**
 * Runs the board in this terminal until it stops, and returns its exit code. Ctrl-C reaches the
 * board as well as ob: ob waits for the board to close, then exits with it.
 */
export function runBoard(l: Launch): number {
  const wait = () => undefined;
  process.on('SIGINT', wait);
  try {
    const r = spawnSync(l.command, l.args, { stdio: 'inherit', shell: l.shell });
    if (r.error) {
      const missing = (r.error as NodeJS.ErrnoException).code === 'ENOENT';
      throw new BacklogError(missing ? `can't run ${l.command}: it comes with Node.js and npm; check that ${l.command} --version works` : `can't run the board: ${r.error.message}`);
    }
    return r.status ?? (r.signal === 'SIGINT' ? 0 : 1);
  } finally {
    process.off('SIGINT', wait);
  }
}
