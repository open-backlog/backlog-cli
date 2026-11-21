#!/usr/bin/env node
// The ob command: everything is in run.ts, which tests call directly.
import { run } from './run.js';

process.exitCode = run(process.argv.slice(2));
