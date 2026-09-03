/** CLI entry: start loopback server, print session URL (APP-001/APP-003). */
import { resolve } from 'node:path';
import { exec, spawn } from 'node:child_process';
import { createDefaultAdapters, startServer } from './main.js';

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const adapters = await createDefaultAdapters();
  const { server, port, sessionToken } = await startServer({ repoRoot: resolve(repoRoot), adapters });
  const url = `http://127.0.0.1:${port}/#session=${sessionToken}`;
  console.log(`AI Tools Panel listening:`);
  console.log(`  ${url}`);
  console.log(`Repo root: ${repoRoot}`);
  if (process.argv.includes('--open')) {
    if (process.platform === 'win32') {
      // `start` must run through cmd; the empty argument reserves the window
      // title slot so the URL is never mistaken for a title, and windowsHide
      // keeps the helper console from flashing (User report 2026-09-02).
      spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    } else {
      const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
      exec(`${openCmd} "${url}"`);
    }
  }
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('failed to start:', e);
  process.exit(1);
});
