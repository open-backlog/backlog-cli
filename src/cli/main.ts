#!/usr/bin/env node
// The ob command: everything is in run.ts, which tests call directly.
import { report, run } from './run.js';

try {
  process.exitCode = run(process.argv.slice(2));
} catch (e) {
  process.exitCode = report(e);
}
