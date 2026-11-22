#!/usr/bin/env node
// The ob command: everything is in run.ts, which tests call directly.
import { report, run } from './run.js';

// A reader that stops early (ob list | head) closes the pipe: not an error, so ob stops quietly
// with its own exit code instead of printing a stack trace.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EPIPE') throw e;
    process.exit();
  });
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (e) {
  process.exitCode = report(e);
}
