# backlog-cli

The `ob` command and the core library it is built on, published to npm as **`open-backlog`**.
[Open Backlog](https://openbacklog.org) keeps a backlog as Markdown files in git; the spec is
at [openbacklog.org/spec](https://openbacklog.org/spec).

**Status: core in progress (2.2).** The core reads a backlog: `readBacklog()` finds `backlog/`
by walking up from the working directory and loads the config, every item with its status,
sprints and people (2.2.2). It writes without losing anything: `setFields()` and `updateItem()`
change only the characters of a value, so an unchanged file stays byte for byte the same and an
edit is a one-line diff, and `createItem()` writes new files in the recommended shape (2.2.3).
`buildTree()` links parents and children, `progressOf()` gives done of total (and by estimate)
for features, epics and capabilities, and `buildOrder()` orders by number at every level (2.2.4).
Validation and git follow through 2.2, and the
commands through 2.3 (`ob init`, `new`, `validate`, `move`, `list`, `show`); today `ob` has
`--version` and `--help`. Not on npm yet (`private` until 2.3.7).

## Layout

| Path | |
|---|---|
| `src/core/` | the library: `import { … } from 'open-backlog'`. Never imports the CLI (lint enforces it), so the board can use it on its own (D1) |
| `src/cli/` | the `ob` command, on top of the core. `main.ts` is the bin; `run.ts` does the work and is what tests call |
| `test/` | Vitest tests |
| `test/fixtures/` | backlog-spec's example backlogs, copied by `script/sync-fixtures.sh`; don't edit them here |
| `script/smoke.mjs` | after a build: packs the package, installs it globally into a temporary folder, runs `ob --version`, imports `open-backlog` |

## Develop

Node 22 or later (the LTS lines 22, 24 and 26 are tested).

```sh
npm install
npm run check        # lint, build, test, smoke: what CI runs on every push
npm test             # just the tests
npm run build        # dist/
npm install -g .     # ob on your PATH, from this checkout (needs a build first)
```

When backlog-spec's examples change, run `script/sync-fixtures.sh` (backlog-spec must be beside
this repo) and commit `test/fixtures/`.

## License

MIT, see [LICENSE](LICENSE). The specification and whitepaper are CC BY 4.0, in backlog-spec.
