import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';

import { addItem, BacklogError, commit, findBacklog, fixDuplicates, formatProblem, initBacklog, initDir, ITEM_TYPES, loadBacklog, message, repoRoot, SPEC_URL, SPEC_VERSION, validateDir } from '../core/index.js';
import type { Renumbered } from '../core/index.js';

/** Where ob writes (stdout and stderr, or a test's buffers), and what it runs with; tests set them. */
export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
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
  new: {
    summary: 'add an item with the next free ID, from the template',
    help: `Usage: ob new <type> <title> [--parent <id>] [--slug <slug>] [--edit] [--no-commit]

Adds an item with the next free number under its parent, in a file named <id>-<slug>.md
(stories, bugs, spikes and tasks in stories/todo/), and commits it: "ob: add 2.3.5 Title".

  ob new epic "Checkout"
  ob new feature "Pay by card" --parent 1
  ob new story "Card form" --parent 1.2      (or bug, spike, task)
  ob new bug "Login fails on Safari"         a bug or task with no parent goes into this
                                             month's feature in epic 0 (0.1-2026-11),
                                             made if needed
  ob new capability "Identity"

  --parent <id>  the item it is filed under: an epic for a feature, a feature for a story,
                 bug, spike or task; a capability for an epic (optional)
  --slug <slug>  the file name's words (default: from the title)
  --edit         open the new file in $VISUAL or $EDITOR before committing
  --no-commit    write the file, leave committing to you
`,
    options: { parent: { type: 'string', short: 'p' }, slug: { type: 'string' }, edit: { type: 'boolean', short: 'e' }, 'no-commit': { type: 'boolean' } },
    run: (values, positionals, io) => {
      const [type, ...words] = positionals;
      if (type === undefined || !words.length) return usageError('ob new needs a type and a title, such as: ob new story "Card form" --parent 1.2', 'new', io);
      if (!ITEM_TYPES.includes(type as never)) return usageError(`"${type}" is not a type: use ${ITEM_TYPES.join(', ')}`, 'new', io);
      const env = io.env ?? process.env;
      const editor = env['VISUAL'] || env['EDITOR'];
      const edit = values['edit'] === true;
      if (edit && !editor) throw new BacklogError('--edit needs an editor: set $EDITOR (or $VISUAL), such as EDITOR=nano');
      const cwd = realpathSync(io.cwd ?? process.cwd());
      const b = loadBacklog(findBacklog(cwd));
      const title = words.join(' ');
      const noCommit = values['no-commit'] === true;
      const added = addItem(b, {
        type, title,
        ...(typeof values['parent'] === 'string' ? { parent: values['parent'] } : {}),
        ...(typeof values['slug'] === 'string' ? { slug: values['slug'] } : {}),
        commit: !noCommit && !edit,
        ...(io.now ? { day: io.now } : {}),
      });
      const shown = (p: string) => relative(cwd, join(b.dir, p));
      for (const c of added.created) io.out(`Created ${c.id} ${shown(c.path)}\n`);
      let committed = added.committed;
      if (edit && editor) {
        // As git runs an editor: through the shell, so "code --wait" works, with the file as $1.
        const r = spawnSync('sh', ['-c', `${editor} "$1"`, editor, join(b.dir, added.path)], { stdio: 'inherit', env });
        if (r.status !== 0) {
          throw new BacklogError(`the editor (${editor}) exited with ${r.status ?? r.signal ?? r.error?.message}; ${shown(added.path)} is written but not committed`);
        }
        if (!noCommit) committed = commit(added.created.map(c => join(b.dir, c.path)), message.add(added.id, title.trim()));
      }
      if (committed) io.out(`Committed: ${message.add(added.id, title.trim())}\n`);
      else if (noCommit) io.out('Not committed (--no-commit).\n');
      return 0;
    },
  },
  validate: {
    summary: 'check the backlog against the spec; exit 1 on errors',
    help: `Usage: ob validate [--fix] [--no-commit] [--json]

Checks every file in the backlog against the spec and prints each problem with its code, the
file and how to fix it. Exits 1 if there are errors (warnings alone exit 0), so it can run in CI
or as a git pre-commit hook.

  --fix        renumber duplicate IDs (two branches each added the next number): the one added
               later in git history gets the next free number and its file is renamed, and
               children that came with it get the new parent; all in one commit
  --no-commit  with --fix, leave committing to you
  --json       print { backlog, valid, errors, warnings, problems, renumbered } for other tools
`,
    options: { fix: { type: 'boolean' }, 'no-commit': { type: 'boolean' }, json: { type: 'boolean' } },
    run: (values, positionals, io) => {
      if (positionals.length) return usageError(`validate takes no arguments (got "${positionals.join(' ')}")`, 'validate', io);
      const cwd = realpathSync(io.cwd ?? process.cwd());
      const dir = findBacklog(cwd);
      const json = values['json'] === true;
      let renumbered: Renumbered[] = [];
      let committed = false;
      // A config.yml that can't be read is reported below, not fixed.
      if (values['fix'] === true && validateDir(dir).backlog) ({ renumbered, committed } = fixDuplicates(dir, { commit: values['no-commit'] !== true }));
      const { backlog, problems } = validateDir(dir);
      const errors = problems.filter(p => p.severity === 'error').length;
      const warnings = problems.length - errors;
      if (json) {
        io.out(JSON.stringify({ backlog: dir, valid: errors === 0, errors, warnings, problems, renumbered, committed }, null, 2) + '\n');
        return errors ? 1 : 0;
      }
      const shown = (p: string) => relative(cwd, join(dir, p));
      for (const r of renumbered) {
        io.out(`Renumbered ${r.from} to ${r.to}: ${shown(r.path)} → ${shown(r.newPath)}\n`);
        for (const c of r.children) io.out(`  parent ${r.from} → ${r.to}: ${shown(c.path)}\n`);
      }
      if (committed) io.out(`Committed: ${message.renumber(renumbered)}\n`);
      for (const p of problems) io.out(formatProblem({ ...p, path: shown(p.path) }) + '\n');
      const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
      const items = backlog ? `, ${count(backlog.items.length, 'item')}` : '';
      io.out(problems.length
        ? `${shown('') || '.'}/: ${count(errors, 'error')}, ${count(warnings, 'warning')}${items}\n`
        : `${shown('') || '.'}/ is valid${items}\n`);
      return errors ? 1 : 0;
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
Run "ob <command> --help" for its options. More commands (move, list, show)
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
