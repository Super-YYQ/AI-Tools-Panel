#!/usr/bin/env node
/**
 * sbom:generate — produce a CycloneDX 1.5 SBOM (M7-01).
 * Components come from the lockfile-resolved dependency tree; build artifact
 * checksums are recorded as metadata.properties, replacing the former
 * standalone checksum manifest. Output: sbom.cyclonedx.json (gitignored,
 * regenerated in CI).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

function npmLs() {
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return JSON.parse(
    execFileSync(cmd, ['ls', '--all', '--json', '--long'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
    }),
  );
}

const components = new Map();
function walk(node) {
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    if (!components.has(name)) {
      const version = info.version ?? '0.0.0';
      const licenses = Array.isArray(info.licenses)
        ? info.licenses.map((id) => ({ license: { id } }))
        : info.licenses
          ? [{ license: { id: info.licenses } }]
          : [];
      components.set(name, {
        type: 'library',
        'bom-ref': `pkg:npm/${name}@${version}`,
        name,
        version,
        purl: `pkg:npm/${name}@${version}`,
        ...(licenses.length > 0 ? { licenses } : {}),
      });
    }
    if (info.dependencies) walk(info);
  }
}
try {
  walk(npmLs());
} catch (e) {
  console.error('sbom:generate: npm ls failed:', String(e).slice(0, 200));
  process.exit(1);
}

// Artifact checksums as properties (replaces artifact-manifest.json).
const properties = [];
const distRoots = ['apps/local-agent/dist', 'apps/panel/dist'].filter((d) => existsSync(join(repoRoot, d)));
function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}
for (const root of distRoots) {
  for (const file of listFiles(join(repoRoot, root))) {
    const rel = relative(repoRoot, file).split('\\').join('/');
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    properties.push({ name: `aitp:artifact:sha256:${rel}`, value: hash });
  }
}

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: 'aitp', name: 'sbom-generate', version: '1.0.0' }],
    component: {
      type: 'application',
      'bom-ref': `pkg:npm/${pkg.name}@${pkg.version}`,
      name: pkg.name,
      version: pkg.version,
      purl: `pkg:npm/${pkg.name}@${pkg.version}`,
    },
    ...(properties.length > 0 ? { properties } : {}),
  },
  components: [...components.values()].sort((a, b) => a.name.localeCompare(b.name)),
};

const outPath = join(repoRoot, 'sbom.cyclonedx.json');
writeFileSync(outPath, JSON.stringify(sbom, null, 2));
console.log(`sbom:generate: wrote ${outPath} (${sbom.components.length} components, ${properties.length} artifact hashes)`);
