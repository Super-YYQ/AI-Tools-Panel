#!/usr/bin/env node
/** Start built local agent (cross-platform entry used by `npm start`). */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const startJs = join(here, '..', 'apps', 'local-agent', 'dist', 'start.js');
const child = spawn(process.execPath, [startJs, '--open'], { cwd: resolve(here, '..'), stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
