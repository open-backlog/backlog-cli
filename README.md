# Open Backlog

`ob` keeps your backlog as Markdown files in git, next to your code. Every epic, feature and
story is a file. A story's folder (`todo/`, `doing/`, `done/`) is its status, and git history is
its timeline. You need no server and no account, and any editor, script or AI agent can read it.

This package, `open-backlog`, is the `ob` command and the library it is built on. It follows the
[Open Backlog spec](https://openbacklog.org/spec) **version 0.1**.

## Install

You need Node.js 22 or later, and git.

```sh
npm i -g open-backlog
ob --version
```

To run it once without installing: `npx -p open-backlog ob <command>`. `ob serve` starts the
board in your browser, and fetches it the first time you use it.

## A five-minute start

In a git repository, create the backlog and commit it:

```sh
$ ob init --name shop
Created the shop backlog in backlog/:
  config.yml
  epics/.gitkeep
  features/.gitkeep
  stories/todo/.gitkeep
  stories/doing/.gitkeep
  stories/done/.gitkeep
Next: git add backlog && git commit -m "ob: init shop backlog"
To check the backlog before every commit: ob init --hook
$ git add backlog && git commit -m "ob: init shop backlog"
```

Add an epic, a feature under it and two stories. Each `ob new` takes the next free number and
commits only that file:

```sh
$ ob new epic "Checkout"
Created 1 backlog/epics/1-checkout.md
Committed: ob: add 1 Checkout
$ ob new feature "Pay by card" --parent 1
$ ob new story "Card form" --parent 1.1
$ ob new story "Save the card" --parent 1.1
```

A bug or task that fits no plan needs no parent. It goes into this month's feature in epic 0,
"Unplanned work":

```sh
$ ob new bug "Total rounds wrong"
Created 0 backlog/epics/0-unplanned.md
Created 0.1 backlog/features/0.1-2026-11.md
Created 0.1.1 backlog/stories/todo/0.1.1-total-rounds-wrong.md
Committed: ob: add 0.1.1 Total rounds wrong
```

Start a story, finish it and look at the plan:

```sh
$ ob start 1.1.1
Moved 1.1.1 to doing: backlog/stories/todo/1.1.1-card-form.md → backlog/stories/doing/1.1.1-card-form.md
Committed: ob: move 1.1.1 to doing
$ ob list
0.1.1  todo   Total rounds wrong
1.1.1  doing  Card form
1.1.2  todo   Save the card
$ ob done 1.1.1
$ ob tree
0  todo   0/1 done (0%)  Unplanned work
  0.1  todo   0/1 done (0%)  Unplanned, 2026-11
    0.1.1  todo   Total rounds wrong
1  doing  1/2 done (50%)  Checkout
  1.1  doing  1/2 done (50%)  Pay by card
    1.1.1  done   Card form
    1.1.2  todo   Save the card
$ ob validate
backlog/ is valid, 7 items
```

Leave a comment on it. `ob` signs it with your handle, which you set once in git; it never
writes your email:

```sh
$ git config --global ob.handle ana
$ ob comment 1.1.1 "Card form done; tested on Safari"
Commented on 1.1.1: backlog/stories/done/1.1.1-card-form.md
- 2026-11-21 @ana: Card form done; tested on Safari
Committed: ob: comment on 1.1.1
```

Open `backlog/stories/todo/1.1.2-save-the-card.md` in any editor to write the story. `ob show
1.1.2` prints it with where it sits in the plan and its history. Push, and your team has the
backlog with the code.

## What a backlog looks like

```
backlog/
  config.yml                        spec: 0.1, name: shop
  epics/1-checkout.md
  features/1.1-pay-by-card.md       feature 1 of epic 1
  stories/
    todo/1.1.2-save-the-card.md     stories, bugs, spikes and tasks
    doing/
    done/1.1.1-card-form.md
```

Each file starts with front matter: `id`, `type`, `title` and `parent`, plus optional
fields such as `repo`, `assignee`, `sprint` and `estimate`. The rest is Markdown. The
[spec](https://openbacklog.org/spec) gives every field and rule.

## Commands

Every command takes `--help`. `ob --help` lists them all.

### ob init

```sh
ob init [--name <name>] [--readme] [--hook]
```

This creates `backlog/` at the top of the git repository (or in the current folder, outside git).
It writes a two-line `config.yml` (`spec: 0.1`, `name: …`) and the folders `epics/`, `features/`
and `stories/todo|doing|done/`, each with a `.gitkeep`. It doesn't commit; it prints the
command to run.

- `--name <name>`: the backlog's name, made of lowercase letters, digits and dashes. It
  defaults to the repository's folder name.
- `--readme`: also write `backlog/README.md`, which explains the folders.
- `--hook`: also install a git pre-commit hook that runs `ob validate`, so a commit that breaks
  the backlog is refused. Git doesn't share hooks, so run `ob init --hook` once in each clone; on
  a backlog that already exists it adds just the hook. The hook uses `ob` if it's installed,
  otherwise the same version from npm with `npx`. An existing pre-commit hook is left alone, and
  `ob` says what line to add to it.

It never overwrites a file. If `backlog/config.yml` exists, it changes nothing and says so.

### ob new

```sh
ob new <type> <title> [--parent <id>] [--repo <name>] [--slug <slug>] [--edit] [--no-commit]
```

This adds a `capability`, `epic`, `feature`, `story`, `bug`, `spike` or `task`. It takes the
next number ever used under the parent, counting items removed in git history, so a number is
never reused. It writes the file from the template (stories, bugs, spikes and tasks go in
`stories/todo/`) and commits just that file: `ob: add 1.1.1 Card form`. The parent is checked
first, so a mistake writes nothing.

- `--parent <id>`: the item it's filed under. A feature needs an epic, and a story, bug, spike
  or task needs a feature. An epic may have a capability. A bug or task with no parent goes into
  this month's feature in epic 0, which is created if needed.
- `--repo <name>`: the repository it's built in, for a backlog that lists its repositories under
  `repos:` in `config.yml`. The name must be one of them. Join several with commas
  (`--repo shop-api,shop-web`), written as a list.
- `--slug <slug>`: the words in the file name (by default, taken from the title).
- `--edit`: open the new file in `$VISUAL` or `$EDITOR`, then commit what you save.
- `--no-commit`: write the file and leave committing to you.

### ob move, ob start, ob done

```sh
ob move <id> <todo|doing|done> [--no-commit]
ob start <id> [--no-commit]          # ob move <id> doing
ob done <id> [--no-commit]           # ob move <id> done
```

This moves a story, bug, spike or task with `git mv` and commits only that move:
`ob: move 1.1.1 to doing`. That's the same commit a hand-run `git mv` and `git commit` would
make, so `git log --follow` shows the item's history across moves. With `done-folders: month` in
`config.yml`, done items go into `stories/done/YYYY-MM/`. Epics, features and capabilities don't
move: their status comes from their items.

- `--no-commit`: stage the `git mv` and leave committing to you.

### ob comment

```sh
ob comment <id> <text> [--as <handle>] [--no-commit]
```

This adds `- YYYY-MM-DD @handle: text` under the item's `## Comments`, making the section at the
end if there is none. It's the same line you would add by hand, and nothing else in the file
changes. It commits that file alone: `ob: comment on 1.1.1`. It works on any item: a story, bug,
spike or task in any folder, a feature, an epic or a capability. Comments live in the file, so
they move with the story.

The handle comes from `git config ob.handle`; set it once with
`git config --global ob.handle <handle>`. `ob` never uses your git email or name, so no email
address is written to the file, and it refuses a comment whose text holds one.

- `--as <handle>`: sign it with this handle instead.
- `--no-commit`: write the line and leave committing to you. Without it, `ob comment` refuses a
  file that already has uncommitted changes, so the commit holds only the comment.

### ob list

```sh
ob list [--status <s>] [--type <t>] [--parent <id>] [--repo <name>] [--assignee <h>] [--sprint <name>] [--all] [--json]
```

This lists stories, bugs, spikes and tasks in build order (1.1.2 before 1.1.10). Each row has
the ID, status, repo (when the backlog lists repos) and title. Output is plain text with no
colour, and titles are cut to fit a terminal but never when piped. Done items show for 30 days
after the commit that moved them to done, and a note on stderr counts the older ones. Outside
git there are no dates, so every done item shows.

- `--status <s>`: `todo`, `doing` or `done`.
- `--type <t>`: `story`, `bug`, `spike` or `task`.
- `--parent <id>`: anything under this epic, feature or capability.
- `--repo <name>`, `--assignee <h>`, `--sprint <name>`: items with that repo, assignee or sprint.
- `--all`: done items of any age.
- `--json`: the same items with their fields, for other tools.

Each filter takes one value or several joined by commas (`--status todo,doing`), and filters
combine.

### ob show

```sh
ob show <id> [--json]
```

This prints an item's place in the plan (`1-checkout › 1.1-pay-by-card › 1.1.1-card-form`), its
file's path and status, how many comments it has, and the file itself, comments included. Then come its children, with a progress line for a
capability, epic or feature ("1/2 done (50%), 0 doing, 1 todo"), and every commit that touched
it. An ID removed with `git rm` is found in git history and shown as its last version, marked
deleted, with the commit that removed it.

- `--json`: the same, as JSON, with the comments as a list (date, handle, text).

### ob tree

```sh
ob tree [--depth <n>] [--all] [--json]
```

This prints the plan: capabilities, epics and features with their status and `done/total
(percent)`, and the items under them, in build order. Done items older than 30 days are left
out, as in `ob list`, but the counts include them.

- `--depth <n>`: show `n` levels (1 shows the top items only).
- `--all`: done items of any age.
- `--json`: the same tree, nested, as JSON.

### ob validate

```sh
ob validate [--fix] [--no-commit] [--json]
```

This checks every file against the spec and prints each problem as
`<file>: <code> [<rule>] <what is wrong>. Fix: <how>.` It exits 1 when there are errors
(warnings alone exit 0), so it works in CI and as a git hook.

- `--fix`: renumber duplicate IDs. When two branches each add the next number, the item added
  later in git history gets the next free number and its file is renamed with `git mv`. Children
  that came with it get the new parent. It's one commit: `ob: renumber 1.1.1 to 1.1.2`.
- `--no-commit`: with `--fix`, leave committing to you.
- `--json`: `{ backlog, valid, errors, warnings, problems, renumbered }`, for other tools.

### ob serve

```sh
ob serve [--port <n>] [--no-open]
```

This starts the board for the backlog you're in and opens it in your browser: drag cards between
todo, doing and done, edit items, comment, see the plan's progress, and Sync with your team. It
runs on your computer only, at `http://127.0.0.1:4310/` (or the next free port). Each change on
the board is one commit, as with `ob`, and nothing is shared until you click Sync. Stop it with
Ctrl-C; stopping changes nothing in the repository.

The board is its own package,
[open-backlog-board](https://www.npmjs.com/package/open-backlog-board), so `open-backlog` stays
small. `ob serve` runs the board that goes with your `ob`, the one with the same major and minor
version (`ob` 0.3.x runs board 0.3.x). If that board is installed, in the project or globally,
it runs it. Otherwise it runs it from npm with `npx`, which downloads it the first time. You
don't need to install anything else.

- `--port <n>`: listen on this port.
- `--no-open`: don't open the browser; `ob serve` prints the address.

## Checking the backlog in a hook and in CI

To refuse a commit that breaks the backlog, install the pre-commit hook in each clone:

```sh
ob init --hook
```

It checks the working tree, so a fix you haven't staged still counts. To add it to a hook you
already have, add the line `ob validate || exit 1`. In CI, such as a
GitHub Actions step:

```yaml
- run: npx --yes -p open-backlog ob validate
```

## Validation codes

Each rule in the spec has a code that never changes meaning.

| Code | Rule | | Code | Rule |
|---|---|---|---|---|
| OB001 | parent | | OB010 | not-stored |
| OB002 | parent-exists | | OB011 | no-email |
| OB003 | id-form | | OB012 | comment-line |
| OB004 | id-unique | | OB013 | sprints |
| OB005 | epic-zero | | OB014 | people |
| OB006 | filename | | OB015 | item-folder |
| OB007 | front-matter | | OB016 | config |
| OB008 | fields | | OB017 | local-clones (a warning) |
| OB009 | repo-listed | | | |

Single-file rules use the spec's JSON Schema, which ships in this package under `schema/0.1/`, so
`ob` agrees with any other tool that uses it.

## Color

In a terminal, `ob list` shows each status in its own color (todo gray, doing blue, done green,
as on the board) and IDs in bold. `ob validate` shows errors in red and warnings in yellow, each
fix dimmed, and ends in a green `is valid` or a red count of errors. Piped or saved output, and `--json`, are plain text, exactly as
before. `NO_COLOR=1` turns color off ([no-color.org](https://no-color.org)); `FORCE_COLOR=1`
turns it on even when piped.

## Git

`ob` runs your own `git`, so your identity, keys, hooks and settings all apply, and it needs no
token. Each command commits only the files it changed, never anything else you have staged.
`ob` never writes your git email or name into the backlog; comments are signed with a handle.
Outside a git repository, everything except committing still works.

## The library

The same core that `ob` uses can be imported for scripts and other tools:

```js
import { readBacklog, validateDir, buildTree, progressOf } from 'open-backlog';

const backlog = readBacklog();              // finds backlog/ from the working directory up
const { problems } = validateDir(backlog.dir);
```

It also covers writing items without reformatting them (`setFields`, `updateItem`,
`createItem`), ordering (`buildOrder`), git (`moveItem`, `nextId`, `history`) and the commands'
own functions (`initBacklog`, `addItem`, `addComment`, `listItems`, `showItem`, `fixDuplicates`). It ships
TypeScript types.

## Develop

To work on `ob` itself, from a clone of [backlog-cli](https://github.com/open-backlog/backlog-cli):

```sh
npm install
npm run check        # lint, build, test and smoke test: what CI runs on every push
npm test             # just the tests
npm install -g .     # ob on your PATH, from this checkout (after npm run build)
```

| Path | |
|---|---|
| `src/core/` | the library. It never imports the CLI (lint enforces this), so other tools can use it on its own |
| `src/cli/` | the `ob` command, on top of the core. `main.ts` is the bin, and `run.ts` does the work and is what tests call |
| `test/` | Vitest tests. `test/fixtures/` holds backlog-spec's example backlogs, copied by `script/sync-spec.sh` |
| `schema/` | backlog-spec's JSON Schema, copied by `script/sync-spec.sh` |
| `script/smoke.mjs` | packs the package, checks its file list, installs it globally into a temporary folder and runs the commands |

To release, change `version` in `package.json` (`npm version patch --no-git-tag-version`),
commit and push to `main`. The publish workflow sees a version that isn't on npm yet, runs the
full check, publishes it through npm trusted publishing with provenance, and tags the commit
`v<version>`. Any other push publishes nothing.

## Contributing

Report a bug or suggest an idea as a [GitHub issue](https://github.com/open-backlog/backlog-cli/issues/new/choose),
then send a pull request: [CONTRIBUTING.md](https://github.com/open-backlog/backlog-cli/blob/main/CONTRIBUTING.md).
A change to the rules belongs in the [specification](https://github.com/open-backlog/backlog-spec),
and a board bug in [backlog-board](https://github.com/open-backlog/backlog-board). Everyone taking
part follows the [code of conduct](https://github.com/open-backlog/backlog-cli/blob/main/CODE_OF_CONDUCT.md).

## License

The code is [MIT](https://github.com/open-backlog/backlog-cli/blob/main/LICENSE). The Open
Backlog name and logo are not covered by the MIT license: you may use them to refer to the
project, but not to brand your own product or a fork. The specification is CC BY 4.0.
