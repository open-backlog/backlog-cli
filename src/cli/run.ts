import { readFileSync, realpathSync } from 'node:fs';
import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';

import { BacklogError, initBacklog, initDir, repoRoot, SPEC_URL, SPEC_VERSION } from '../core/index.js';

/** Where ob writes (stdout and stderr, or a test's buffers), and the folder it runs in. */
export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd?: string;
}

const STD: Output = { out: t => process.stdout.write(t), err: t => process.stderr.write(t) };

/** The package's own version, from its package.json (two folders up from src/cli/ or dist/cli/). */
export function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

type Values = Record<string, string | boolean | undefined>;

interface Command {
  /** One line for ob --help. */
  summary: string;
  /** The command's own --help. */
  help: string;
  options: NonNullable<ParseArgsConfig['options']>;
  run: (values: Values, positionals: string[], io: Output) => number;
}

const COMMANDS: Record<string, Command> = {
  init: {
    summary: 'create backlog/ with config.yml and its folders',
    help: `Usage: ob init [--name <name>] [--readme]

Creates backlog/ at the top of this git repository (or here, outside git): a config.yml with
spec and name, and epics/, features/ and stories/todo, doing and done/, each with a .gitkeep.
If backlog/config.yml is already there, nothing changes.

  --name <name>  the backlog's name: lowercase letters, digits and dashes
                 (default: the repository's folder name)
  --readme       also write backlog/README.md, explaining the folders
`,
    options: { name: { type: 'string' }, readme: { type: 'boolean' } },
    run: (values, positionals, io) => {
      if (positionals.length) return usageError(`init takes no arguments (got "${positionals.join(' ')}")`, 'init', io);
      // Real paths on both sides: git gives the repository's top through symlinks (macOS /var).
      const cwd = realpathSync(io.cwd ?? process.cwd());
      const dir = initDir(cwd);
      const shown = relative(cwd, dir) || '.';
      const r = initBacklog(dir, {
        ...(typeof values['name'] === 'string' ? { name: values['name'] } : {}),
        readme: values['readme'] === true,
      });
      if (r.existed) {
        io.out(`${shown}/ already exists${r.name ? ` (${r.name})` : ''}: nothing changed.\n`);
        return 0;
      }
      io.out(`Created the ${r.name} backlog in ${shown}/:\n${r.created.map(p => `  ${p}\n`).join('')}`);
      io.out(repoRoot(cwd)
        ? `Next: git add ${shown} && git commit -m "ob: init ${r.name} backlog"\n`
        : 'Not in a git repository: run git init here to give the backlog its history.\n');
      return 0;
    },
  },
};

export function usage(): string {
  const width = Math.max(...Object.keys(COMMANDS).map(c => c.length));
  return `ob — Open Backlog ${packageVersion()} (spec ${SPEC_VERSION})

Usage: ob <command> [options]
       ob [--version] [--help]

Commands:
${Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(width)}  ${c.summary}\n`).join('')}
Run "ob <command> --help" for its options. More commands (new, validate, move, list, show)
arrive with the CLI stories (2.3).

A backlog is a folder of Markdown files in git: ${SPEC_URL}
`;
}

function usageError(message: string, command: string | undefined, io: Output): number {
  io.err(`ob: ${message}\nRun "ob ${command ? `${command} ` : ''}--help" for usage.\n`);
  return 2;
}

/**
 * Runs ob with its arguments (without "node" and the script) and returns the exit code:
 * 0 done, 1 the command failed (a BacklogError, from report), 2 bad usage. Writes nothing to
 * process directly, so tests can call it.
 */
export function run(args: string[], io: Output = STD): number {
  const name = args[0] !== undefined && !args[0].startsWith('-') ? args[0] : undefined;
  if (name === undefined) {
    let parsed;
    try {
      parsed = parseArgs({ args, options: { version: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' } }, strict: true });
    } catch (e) {
      return usageError((e as Error).message, undefined, io);
    }
    if (parsed.values.version) io.out(packageVersion() + '\n');
    else io.out(usage());
    return 0;
  }
  const command = COMMANDS[name];
  if (!command) return usageError(`unknown command "${name}"`, undefined, io);
  let parsed;
  try {
    parsed = parseArgs({ args: args.slice(1), options: { ...command.options, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
  } catch (e) {
    return usageError((e as Error).message, name, io);
  }
  if (parsed.values['help']) {
    io.out(command.help);
    return 0;
  }
  try {
    return command.run(parsed.values as Values, parsed.positionals, io);
  } catch (e) {
    return report(e, io);
  }
}

/**
 * What ob prints for an error that escapes a command, and its exit code: a backlog that can't be
 * read (no config.yml, a file that isn't YAML) is one line naming the file, never a stack trace.
 * Anything else is a bug in ob, so it keeps its stack.
 */
export function report(e: unknown, io: Output = STD): number {
  if (e instanceof BacklogError) {
    io.err(`ob: ${e.message}\n`);
    return 1;
  }
  throw e;
}
