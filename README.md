# backlog-cli

The `ob` command and the core library it is built on, published to npm as **`open-backlog`**.
[Open Backlog](https://openbacklog.org) keeps a backlog as Markdown files in git; the spec is
at [openbacklog.org/spec](https://openbacklog.org/spec).

**Status: core library done (2.2); commands arriving (2.3).** The core reads a backlog: `readBacklog()` finds `backlog/`
by walking up from the working directory and loads the config, every item with its status,
sprints and people (2.2.2). It writes without losing anything: `setFields()` and `updateItem()`
change only the characters of a value, so an unchanged file stays byte for byte the same and an
edit is a one-line diff, and `createItem()` writes new files in the recommended shape (2.2.3).
`buildTree()` links parents and children, `progressOf()` gives done of total (and by estimate)
for features, epics and capabilities, and `buildOrder()` orders by number at every level (2.2.4).
`validateDir()` checks every rule, each problem with a code, the file and how to fix it (2.2.5).
Git is the user's own (2.2.6): `moveItem()` does a `git mv` and commits only that move as
`ob: move 2.3.4 to doing`; `nextId()` never reuses a number, counting items deleted in git
history; outside a git repository everything but committing still works. The commands
arrive through 2.3; today `ob` has `init` (2.3.1), `new` (2.3.2), `validate` (2.3.3), `move`,
`start` and `done` (2.3.4) and `list` (2.3.5), with `show` and `tree` to come. Not on npm yet (`private` until 2.3.7).

## Commands

```sh
ob init --name my-app      # backlog/ at the top of this repository: config.yml and the folders
ob init --readme           # the same, plus backlog/README.md explaining the folders
ob new epic "Checkout"                      # the next epic: epics/1-checkout.md
ob new feature "Pay by card" --parent 1     # features/1.1-pay-by-card.md
ob new story "Card form" --parent 1.1       # stories/todo/1.1.1-card-form.md (or bug, spike, task)
ob new bug "Login fails"                    # no parent: this month's feature in epic 0 (0.1-2026-11)
ob validate                                 # every problem, with how to fix it; exit 1 on errors
ob validate --fix                           # renumber duplicate IDs after a merge, in one commit
ob validate --json                          # the same, for other tools
ob start 1.1.1                              # git mv to stories/doing/ and commit: ob: move 1.1.1 to doing
ob done 1.1.1                               # to stories/done/ (done/YYYY-MM/ with done-folders: month)
ob move 1.1.1 todo                          # any status: todo, doing or done
ob list                                     # stories, bugs, spikes, tasks by number; done from the last 30 days
ob list --status todo,doing --parent 1      # filter: --status --type --parent --repo --assignee --sprint
ob list --all --json                        # every done item too; JSON for other tools
ob <command> --help        # a command's options
```

`ob init` writes a two-line `config.yml` (`spec: 0.1`, `name: my-app`) and `epics/`,
`features/` and `stories/todo|doing|done/`, each with a `.gitkeep` so git keeps them. The name
defaults to the repository's folder name. It never overwrites a file: if `backlog/config.yml`
is there, it changes nothing and says so. It doesn't commit; it prints the `git add` and
`git commit` to run.

`ob new` takes the next number ever used under the parent (counting items removed in git
history), names the file from the title (`--slug` to choose), starts a story, bug, spike or
task from the template, and commits just that file: `ob: add 1.1.1 Card form`. The parent is
checked first (it must exist and be the right type), so a mistake writes nothing. A bug or task
with no `--parent` goes into this month's feature in epic 0, creating `0-unplanned.md` and
`0.N-YYYY-MM.md` if needed. `--edit` opens the file in `$VISUAL` or `$EDITOR` and commits what
you save; `--no-commit` leaves committing to you.

`ob move <id> <todo|doing|done>` (and `ob start`, `ob done`) is a `git mv` and a commit of just
that rename, the same commit a hand-run `git mv` and `git commit` make, so `git log --follow`
shows the item's history across moves. `--no-commit` leaves the `git mv` staged. Epics,
features and capabilities don't move: their status comes from their items.

`ob list` prints ID, status, repo (when the backlog lists repos) and title, plain text with no
colour; titles are cut to fit a terminal and never when piped. Done items show for 30 days after
the commit that moved them to done (a note on stderr says how many older ones are left out);
`--all` shows them all. Outside git there are no dates, so every done item shows.

`ob validate` exits 1 when there are errors (warnings alone exit 0), so it works in CI and as a
git hook. `--fix` repairs what a merge does when two branches each add the next number: of two
items with the same ID, the one added later in git history gets the next free number and its
file is renamed with `git mv`; children that came with it (added after it, on its side of the
merge) get the new parent. Nothing else changes, and it's one commit
(`ob: renumber 1.1.1 to 1.1.2`).

A pre-commit hook, `.git/hooks/pre-commit` (made executable with `chmod +x`), refuses a commit
that breaks the backlog:

```sh
#!/bin/sh
exec ob validate
```

In CI, such as a GitHub Actions step (once the package is on npm, 2.3.7):

```yaml
- run: npx --yes -p open-backlog ob validate
```

The hook checks the working tree, so a fix you haven't staged still counts.

## Layout

| Path | |
|---|---|
| `src/core/` | the library: `import { … } from 'open-backlog'`. Never imports the CLI (lint enforces it), so the board can use it on its own (D1) |
| `src/cli/` | the `ob` command, on top of the core. `main.ts` is the bin; `run.ts` does the work and is what tests call |
| `test/` | Vitest tests |
| `test/fixtures/` | backlog-spec's example backlogs, copied by `script/sync-spec.sh`; don't edit them here |
| `schema/` | backlog-spec's JSON Schema, copied by `script/sync-spec.sh` and shipped in the package; the validator checks single files with it |
| `script/smoke.mjs` | after a build: packs the package, installs it globally into a temporary folder, runs `ob --version`, `ob init`, `ob new`, `ob validate` (also as a pre-commit hook) `ob start` and `ob list`, imports `open-backlog` |

## Validation codes

Each rule in the spec has a code that never changes meaning. `ob validate` prints
`<file>: <code> [<rule>] <what is wrong>. Fix: <how>.`

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

Single-file rules use the spec's JSON Schema, so ob agrees with any tool that uses it.

## Develop

Node 22 or later (the LTS lines 22, 24 and 26 are tested).

```sh
npm install
npm run check        # lint, build, test, smoke: what CI runs on every push
npm test             # just the tests
npm run build        # dist/
npm install -g .     # ob on your PATH, from this checkout (needs a build first)
```

When backlog-spec's examples or schema change, run `script/sync-spec.sh` (backlog-spec must be
beside this repo) and commit `test/fixtures/` and `schema/`.

## License

MIT, see [LICENSE](LICENSE). The specification and whitepaper are CC BY 4.0, in backlog-spec.
