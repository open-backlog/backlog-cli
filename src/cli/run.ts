import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { SPEC_URL, SPEC_VERSION } from '../core/index.js';

/** Where ob writes: stdout and stderr, or a test's buffers. */
export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
}

const STD: Output = { out: t => process.stdout.write(t), err: t => process.stderr.write(t) };

/** The package's own version, from its package.json (two folders up from src/cli/ or dist/cli/). */
export function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

export function usage(): string {
  return `ob — Open Backlog ${packageVersion()} (spec ${SPEC_VERSION})

Usage: ob [--version] [--help]

A backlog is a folder of Markdown files in git: ${SPEC_URL}
Commands (init, new, validate, move, list, show) arrive with the CLI stories (2.3).
`;
}

/**
 * Runs ob with its arguments (without "node" and the script) and returns the exit code:
 * 0 done, 2 bad usage. Writes nothing to process directly, so tests can call it.
 */
export function run(args: string[], io: Output = STD): number {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { version: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    io.err(`ob: ${(e as Error).message}\nRun "ob --help" for usage.\n`);
    return 2;
  }
  if (parsed.values.version) {
    io.out(packageVersion() + '\n');
    return 0;
  }
  const [command] = parsed.positionals;
  if (parsed.values.help || command === undefined) {
    io.out(usage());
    return 0;
  }
  io.err(`ob: unknown command "${command}"\nRun "ob --help" for usage.\n`);
  return 2;
}
