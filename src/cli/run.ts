import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';

import { addComment, addItem, BacklogError, installHook, planHook, buildTree, commit, findBacklog, fixDuplicates, formatProblem, initBacklog, initDir, isStoryLevel, ITEM_TYPES, listItems, loadBacklog, message, moveItem, progressOf, recentlyDone, reposOf, repoRoot, showItem, SPEC_URL, SPEC_VERSION, validateDir } from '../core/index.js';
import type { Node, Progress, Renumbered, Status } from '../core/index.js';
import { boardLaunch, runBoard } from './serve.js';
import type { Launch } from './serve.js';

/** Where ob writes (stdout and stderr, or a test's buffers), and what it runs with; tests set them. */
export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** The terminal's width when writing to one; undefined when piped, so nothing is cut. */
  columns?: number;
  /** ob serve: runs the board and returns its exit code (default: in this terminal, runBoard). */
  board?: (launch: Launch) => number;
}

const STD: Output = {
  out: t => process.stdout.write(t),
  err: t => process.stderr.write(t),
  ...(process.stdout.isTTY ? { columns: process.stdout.columns || 80 } : {}),
};

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
    help: `Usage: ob init [--name <name>] [--readme] [--hook]

Creates backlog/ at the top of this git repository (or here, outside git): a config.yml with
spec and name, and epics/, features/ and stories/todo, doing and done/, each with a .gitkeep.
If backlog/config.yml is already there, nothing changes.

  --name <name>  the backlog's name: lowercase letters, digits and dashes
                 (default: the repository's folder name)
  --readme       also write backlog/README.md, explaining the folders
  --hook         also install a git pre-commit hook that runs ob validate, so a commit
                 that breaks the backlog is refused; run it in each clone (git doesn't
                 share hooks), also on a backlog that already exists
`,
    options: { name: { type: 'string' }, readme: { type: 'boolean' }, hook: { type: 'boolean' } },
    run: (values, positionals, io) => {
      if (positionals.length) return usageError(`init takes no arguments (got "${positionals.join(' ')}")`, 'init', io);
      // Real paths on both sides: git gives the repository's top through symlinks (macOS /var).
      const cwd = realpathSync(io.cwd ?? process.cwd());
      const dir = initDir(cwd);
      const shown = relative(cwd, dir) || '.';
      // The hook is checked before anything is written: an existing hook of its own stops it all.
      const hook = values['hook'] === true ? planHook(cwd) : null;
      const r = initBacklog(dir, {
        ...(typeof values['name'] === 'string' ? { name: values['name'] } : {}),
        readme: values['readme'] === true,
      });
      if (r.existed) io.out(`${shown}/ already exists${r.name ? ` (${r.name})` : ''}: ${hook ? 'kept as it is' : 'nothing changed'}.\n`);
      else {
        io.out(`Created the ${r.name} backlog in ${shown}/:\n${r.created.map(p => `  ${p}\n`).join('')}`);
        io.out(repoRoot(cwd)
          ? `Next: git add ${shown} && git commit -m "ob: init ${r.name} backlog"\n`
          : 'Not in a git repository: run git init here to give the backlog its history.\n');
      }
      if (hook) {
        const h = installHook(cwd, packageVersion());
        const where = relative(cwd, h.path);
        io.out(h.written
          ? `Installed the pre-commit hook ${where}: ob validate runs before each commit, and a commit that breaks the backlog is refused.\n`
          : `The pre-commit hook ${where} already runs ob validate: nothing changed.\n`);
      } else if (!r.existed && repoRoot(cwd)) io.out('To check the backlog before every commit: ob init --hook\n');
      return 0;
    },
  },
  new: {
    summary: 'add an item with the next free ID, from the template',
    help: `Usage: ob new <type> <title> [--parent <id>] [--repo <name>] [--slug <slug>] [--edit] [--no-commit]

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
  --repo <name>  the repository it's built in, from repos: in config.yml; several
                 joined by commas (--repo shop-api,shop-web)
  --slug <slug>  the file name's words (default: from the title)
  --edit         open the new file in $VISUAL or $EDITOR before committing
  --no-commit    write the file, leave committing to you
`,
    options: { parent: { type: 'string', short: 'p' }, repo: { type: 'string' }, slug: { type: 'string' }, edit: { type: 'boolean', short: 'e' }, 'no-commit': { type: 'boolean' } },
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
        ...(typeof values['repo'] === 'string' ? { repo: values['repo'].split(',') } : {}),
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
  move: {
    summary: 'move a story, bug, spike or task to todo, doing or done',
    help: `Usage: ob move <id> <todo|doing|done> [--no-commit]
       ob start <id>      (the same as ob move <id> doing)
       ob done <id>       (the same as ob move <id> done)

Moves the item's file to stories/<status>/ with git mv and commits only that move:
"ob: move 2.3.4 to doing". With done-folders: month in config.yml, done files into
stories/done/YYYY-MM/. Epics, features and capabilities don't move: their status comes from
their items.

  --no-commit  stage the move (git mv), leave committing to you
`,
    options: { 'no-commit': { type: 'boolean' } },
    run: (values, positionals, io) => {
      const [id, status, ...extra] = positionals;
      if (id === undefined || status === undefined || extra.length) return usageError('ob move needs an id and a status, such as: ob move 2.3.4 doing', 'move', io);
      return moveCommand(id, status, values, io, 'move');
    },
  },
  start: {
    summary: 'ob move <id> doing',
    help: 'Usage: ob start <id> [--no-commit]\n\nThe same as ob move <id> doing: see ob move --help.\n',
    options: { 'no-commit': { type: 'boolean' } },
    run: (values, positionals, io) => {
      const [id, ...extra] = positionals;
      if (id === undefined || extra.length) return usageError('ob start needs one id, such as: ob start 2.3.4', 'start', io);
      return moveCommand(id, 'doing', values, io, 'start');
    },
  },
  done: {
    summary: 'ob move <id> done',
    help: 'Usage: ob done <id> [--no-commit]\n\nThe same as ob move <id> done: see ob move --help.\n',
    options: { 'no-commit': { type: 'boolean' } },
    run: (values, positionals, io) => {
      const [id, ...extra] = positionals;
      if (id === undefined || extra.length) return usageError('ob done needs one id, such as: ob done 2.3.4', 'done', io);
      return moveCommand(id, 'done', values, io, 'done');
    },
  },
  comment: {
    summary: 'add a dated, signed comment to an item, in one commit',
    help: `Usage: ob comment <id> <text> [--as <handle>] [--no-commit]

Adds "- YYYY-MM-DD @handle: text" under the item's ## Comments (making the section at the end if
there is none), the same line you would add by hand, and commits that file alone:
"ob: comment on 2.3.4". Any item: a story, bug, spike or task in any folder, a feature, an
epic or a capability.

  ob comment 2.3.4 "Started; testing on beta"

The handle is from git config ob.handle (set it once: git config --global ob.handle jo-smith),
never your git email, so no email address is written to the file.

  --as <handle>  sign it with this handle instead
  --no-commit    write the line, leave committing to you
`,
    options: { as: { type: 'string' }, 'no-commit': { type: 'boolean' } },
    run: (values, positionals, io) => {
      const [id, ...words] = positionals;
      if (id === undefined || !words.length) return usageError('ob comment needs an id and the text, such as: ob comment 2.3.4 "Started"', 'comment', io);
      const cwd = realpathSync(io.cwd ?? process.cwd());
      const b = loadBacklog(findBacklog(cwd));
      const r = addComment(b, id, {
        text: words.join(' '),
        ...(typeof values['as'] === 'string' ? { handle: values['as'] } : {}),
        commit: values['no-commit'] !== true,
        ...(io.now ? { day: io.now } : {}),
      });
      io.out(`Commented on ${id}: ${relative(cwd, join(b.dir, r.path))}\n${r.line}\n`);
      if (r.committed) io.out(`Committed: ${message.comment(id)}\n`);
      else if (values['no-commit'] === true) io.out('Not committed (--no-commit).\n');
      return 0;
    },
  },
  list: {
    summary: 'list stories, bugs, spikes and tasks in build order, filtered',
    help: `Usage: ob list [filters] [--all] [--json]

Lists stories, bugs, spikes and tasks in build order (by number): ID, status, repo and title.
Done items show for 30 days after they were moved to done (from git history); --all shows
every one. Plain text, no colour; titles are cut to fit a terminal, never when piped.

  --status <s>     todo, doing or done
  --type <t>       story, bug, spike or task
  --parent <id>    under this epic, feature or capability
  --repo <name>    with this repo (T3)
  --assignee <h>   assigned to this handle
  --sprint <name>  in this sprint
  --all            done items of any age
  --json           the same items, as JSON, for other tools

Each filter takes one value or several joined by commas (--status todo,doing).
`,
    options: {
      status: { type: 'string', multiple: true }, type: { type: 'string', multiple: true }, parent: { type: 'string', multiple: true },
      repo: { type: 'string', multiple: true }, assignee: { type: 'string', multiple: true }, sprint: { type: 'string', multiple: true },
      all: { type: 'boolean' }, json: { type: 'boolean' },
    },
    run: (values, positionals, io) => {
      if (positionals.length) return usageError(`list takes no arguments (got "${positionals.join(' ')}"); filter with --status, --type, --parent …`, 'list', io);
      const cwd = realpathSync(io.cwd ?? process.cwd());
      const b = loadBacklog(findBacklog(cwd));
      const list = (k: string) => {
        const v = values[k] as unknown;
        return Array.isArray(v) ? (v as string[]).flatMap(x => x.split(',')).map(x => x.trim()).filter(Boolean) : undefined;
      };
      const filters = Object.fromEntries(['status', 'type', 'parent', 'repo', 'assignee', 'sprint'].map(k => [k, list(k)]).filter(([, v]) => v !== undefined));
      let listed;
      try {
        listed = listItems(b, filters, { all: values['all'] === true, ...(io.now ? { now: io.now } : {}) });
      } catch (e) {
        if (e instanceof BacklogError && /is not a (status|type)/.test(e.message)) return usageError(e.message, 'list', io);
        throw e;
      }
      if (values['json'] === true) {
        io.out(JSON.stringify(listed.items.map(i => ({
          id: i.id, type: i.type, status: i.status ?? null, title: i.title, parent: i.parent ?? null, repo: reposOf(i),
          assignee: i.fields['assignee'] ?? null, sprint: i.fields['sprint'] ?? null, path: i.path,
        })), null, 2) + '\n');
        return 0;
      }
      const rows = listed.items.map(i => ({ id: i.id, status: i.status ?? '', repo: reposOf(i).join(','), title: i.title }));
      const w = (f: (r: typeof rows[number]) => string) => Math.max(0, ...rows.map(r => f(r).length));
      const idW = w(r => r.id), stW = w(r => r.status), repoW = w(r => r.repo);
      for (const r of rows) {
        const line = [r.id.padEnd(idW), r.status.padEnd(stW), ...(repoW ? [r.repo.padEnd(repoW)] : []), r.title].join('  ');
        io.out(fit(line, io.columns) + '\n');
      }
      if (listed.hiddenDone) io.err(`ob: ${listed.hiddenDone} done ${listed.hiddenDone === 1 ? 'item' : 'items'} finished over 30 days ago not shown; --all shows them\n`);
      return 0;
    },
  },
  show: {
    summary: 'show an item: where it sits, its file, children, progress and history',
    help: `Usage: ob show <id> [--json]

Prints the item's place in the plan (2-build › 2.3-cli › 2.3.4-ob-move), its file, how many
comments it has, its file's text (comments included), its children (with progress, for a
capability, epic or feature) and the commits that touched it. An ID pruned with git rm is found in git history: its last version, marked deleted.

  --json  the same, as JSON, for other tools
`,
    options: { json: { type: 'boolean' } },
    run: (values, positionals, io) => {
      const [id, ...extra] = positionals;
      if (id === undefined || extra.length) return usageError('ob show needs one id, such as: ob show 2.3.4', 'show', io);
      const cwd = realpathSync(io.cwd ?? process.cwd());
      const b = loadBacklog(findBacklog(cwd));
      const s = showItem(b, id);
      if (values['json'] === true) {
        io.out(JSON.stringify(s, null, 2) + '\n');
        return 0;
      }
      const shown = relative(cwd, join(b.dir, s.path));
      const lines = [s.breadcrumb.join(' › ')];
      lines.push(s.deleted ? `${shown} (deleted)` : `${shown}${s.status ? `  ${s.status}` : ''}`);
      if (s.deleted) lines.push(`Deleted in ${s.deleted.hash} on ${s.deleted.date} by ${s.deleted.author}: ${s.deleted.subject}. Its last version:`);
      if (s.progress) lines.push(`Progress: ${progressText(s.progress)}, ${s.progress.doing} doing, ${s.progress.todo} todo`);
      if (s.sameId.length) lines.push(`Also id ${id}: ${s.sameId.join(', ')} (run ob validate --fix)`);
      const lastComment = s.comments[s.comments.length - 1];
      if (lastComment) lines.push(`Comments: ${s.comments.length}, the last on ${lastComment.date} by @${lastComment.handle}`);
      lines.push('', s.text.trimEnd());
      if (s.children.length) {
        const w = Math.max(...s.children.map(c => c.id.length));
        lines.push('', 'Children:', ...s.children.map(c => `  ${c.id.padEnd(w)}  ${(c.status ?? c.type).padEnd(7)}  ${c.title}`));
      }
      if (s.history.length) lines.push('', 'History:', ...s.history.map(h => `  ${h.date}  ${h.hash}  ${h.author}  ${h.subject}`));
      io.out(lines.join('\n') + '\n');
      return 0;
    },
  },
  tree: {
    summary: 'the plan as a tree: capabilities, epics, features with progress, and their items',
    help: `Usage: ob tree [--depth <n>] [--all] [--json]

Prints capabilities, epics and features with their status and progress (done of total, worked
out from their stories, bugs, spikes and tasks), and the items under them, in build order. Done
items show for 30 days, as in ob list; the progress counts every item.

  --depth <n>  show n levels (1: the top items only)
  --all        done items of any age
  --json       the same tree, as JSON
`,
    options: { depth: { type: 'string' }, all: { type: 'boolean' }, json: { type: 'boolean' } },
    run: (values, positionals, io) => {
      if (positionals.length) return usageError(`tree takes no arguments (got "${positionals.join(' ')}")`, 'tree', io);
      const depthArg = values['depth'];
      const maxDepth = depthArg === undefined ? Infinity : Number(depthArg);
      if (depthArg !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 1)) return usageError(`--depth takes a whole number from 1 (got "${String(depthArg)}")`, 'tree', io);
      const cwd = realpathSync(io.cwd ?? process.cwd());
      const b = loadBacklog(findBacklog(cwd));
      const now = io.now ?? new Date();
      const recent = values['all'] === true ? null : recentlyDone(b, new Date(now.getTime() - 30 * 86_400_000));
      let hidden = 0;
      const visible = (n: Node) => {
        const ok = n.item.status !== 'done' || !recent || recent.has(n.item.path);
        if (!ok) hidden++;
        return ok;
      };
      type Out = { id: string; type: string; title: string; status: Status | null; path: string; progress: Progress | null; children: Out[] };
      const toOut = (n: Node, depth: number): Out => {
        const story = isStoryLevel(n.item);
        const p = story ? null : progressOf(n);
        return {
          id: n.item.id, type: n.item.type, title: n.item.title, status: story ? n.item.status ?? null : p?.status ?? null, path: n.item.path, progress: p,
          children: depth + 1 < maxDepth ? n.children.filter(visible).map(c => toOut(c, depth + 1)) : [],
        };
      };
      const roots = buildTree(b.items).roots.filter(visible).map(r => toOut(r, 0));
      if (values['json'] === true) io.out(JSON.stringify(roots, null, 2) + '\n');
      else {
        const print = (o: Out, depth: number) => {
          const head = `${'  '.repeat(depth)}${o.id}  ${(o.status ?? '-').padEnd(5)}`;
          io.out(fit(`${head}  ${o.progress ? `${progressText(o.progress)}  ` : ''}${o.title}`, io.columns) + '\n');
          o.children.forEach(c => print(c, depth + 1));
        };
        roots.forEach(r => print(r, 0));
      }
      if (hidden) io.err(`ob: ${hidden} done ${hidden === 1 ? 'item' : 'items'} finished over 30 days ago not shown; --all shows them\n`);
      return 0;
    },
  },
  serve: {
    summary: 'start the board for this backlog and open it in your browser',
    help: `Usage: ob serve [--port <n>] [--no-open]

Starts the board (open-backlog-board) for the backlog here, on this computer only, at
http://127.0.0.1:4310/ (or the next free port), and opens it in your browser. Each change you
make on the board is one commit; nothing is shared until you click Sync. Stop it with Ctrl-C.

It uses an installed open-backlog-board when it is the one for this ob (same major and minor
version); otherwise it runs that version from npm with npx, downloaded the first time.

  --port <n>  listen on this port
  --no-open   don't open the browser; ob prints the address
`,
    options: { port: { type: 'string' }, 'no-open': { type: 'boolean' } },
    run: (values, positionals, io) => {
      if (positionals.length) return usageError(`serve takes no arguments (got "${positionals.join(' ')}"); run it in the backlog's repository`, 'serve', io);
      const port = values['port'];
      if (typeof port === 'string' && !/^\d{1,5}$/.test(port)) return usageError(`--port ${port} is not a port number`, 'serve', io);
      const cwd = realpathSync(io.cwd ?? process.cwd());
      findBacklog(cwd);
      const launch = boardLaunch({
        folder: cwd, version: packageVersion(), from: [cwd, fileURLToPath(new URL('../..', import.meta.url))],
        ...(typeof port === 'string' ? { port } : {}), open: values['no-open'] !== true,
      });
      io.err(`${launch.note}\n`);
      return (io.board ?? runBoard)(launch);
    },
  },
};

/** "3/9 done (33%)". */
function progressText(p: Progress): string {
  return `${p.done}/${p.total} done (${p.percent}%)`;
}

/** A line cut to a terminal's width with "…" (whole characters); unchanged when piped. */
function fit(line: string, columns: number | undefined): string {
  const chars = [...line];
  if (columns === undefined || chars.length <= columns) return line;
  return chars.slice(0, Math.max(1, columns - 1)).join('').trimEnd() + '…';
}

const STATUSES: readonly Status[] = ['todo', 'doing', 'done'];

/** ob move, start and done: checks the item and status, then one git mv and one commit. */
function moveCommand(id: string, status: string, values: Values, io: Output, command: string): number {
  if (!STATUSES.includes(status as Status)) return usageError(`"${status}" is not a status: use todo, doing or done`, command, io);
  const cwd = realpathSync(io.cwd ?? process.cwd());
  const b = loadBacklog(findBacklog(cwd));
  const found = b.items.filter(i => i.id === id);
  const item = found[0];
  if (!item) throw new BacklogError(`no item ${id} in this backlog`);
  if (found.length > 1) throw new BacklogError(`${found.length} items have id ${id} (${found.map(i => i.path).join(', ')}); run ob validate --fix first`);
  if (!isStoryLevel(item)) {
    const t = `${/^[aeiou]/.test(item.type) ? 'an' : 'a'} ${item.type}`;
    throw new BacklogError(`${id} is ${t}, which doesn't move: only stories, bugs, spikes and tasks do. ${t[0]?.toUpperCase()}${t.slice(1)} is done when all its items are done`);
  }
  const shown = (p: string) => relative(cwd, join(b.dir, p));
  if (item.status === status) {
    io.out(`${id} is already in ${status}: ${shown(item.path)}; nothing changed.\n`);
    return 0;
  }
  const r = moveItem(b, item, status as Status, { commit: values['no-commit'] !== true, ...(io.now ? { day: io.now } : {}) });
  io.out(`Moved ${id} to ${status}: ${shown(item.path)} → ${shown(r.path)}\n`);
  if (r.committed) io.out(`Committed: ${message.move(id, status as Status)}\n`);
  else if (values['no-commit'] === true) io.out('Not committed (--no-commit).\n');
  return 0;
}

export function usage(): string {
  const width = Math.max(...Object.keys(COMMANDS).map(c => c.length));
  return `ob — Open Backlog ${packageVersion()} (spec ${SPEC_VERSION})

Usage: ob <command> [options]
       ob [--version] [--help]

Commands:
${Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(width)}  ${c.summary}\n`).join('')}
Run "ob <command> --help" for its options.

A backlog is a folder of Markdown files in git: ${SPEC_URL}
`;
}

/** Every command with its long options, in --help order (the README documents each one). */
export function commandOptions(): Record<string, string[]> {
  return Object.fromEntries(Object.entries(COMMANDS).map(([name, c]) => [name, Object.keys(c.options).filter(o => o !== 'help')]));
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
