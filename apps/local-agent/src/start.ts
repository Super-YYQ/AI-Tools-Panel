/** CLI entry: start loopback server, print session URL (APP-001/APP-003). */
import { resolve } from 'node:path';
import { exec } from 'node:child_process';
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
    const openCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${openCmd} "${url}"`);
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
