# Contributing

`ob` and its core library are meant to stay small: every rule comes from the
[specification](https://github.com/open-backlog/backlog-spec), and every command does what you
could do by hand with a text editor and git. So most of the work is deciding what not to add.

1. **Open an issue** from its template: **bug** (something `ob` or the library does wrong) or
   **idea** (anything else). A change to the rules of the format belongs in the specification;
   a board bug in [backlog-board](https://github.com/open-backlog/backlog-board).
2. **Open a pull request** that links the issue and makes that one change, with tests.
   `npm run check` (lint, build, tests and the smoke test) must pass, as it does in CI.

The author (@brandon-castagna) approves every pull request. A change is accepted when it keeps
`ob` simple, follows the specification exactly, and leaves the files as a careful hand edit would.

Contributions are licensed under [MIT](LICENSE), like the code. The Open Backlog name and logo
are not part of that license.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
