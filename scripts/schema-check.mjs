#!/usr/bin/env node
/**
 * schema:check — validate bundled fixture documents against the executable
 * contracts. Malformed fixtures must fail; valid fixtures must pass.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const fixturesDir = join(repoRoot, 'tests', 'fixtures', 'catalog');
const SCHEMAS = new Set(['Skill', 'Plugin', 'Marketplace', 'Hook', 'RuleFragment']);
const API_VERSION = 'aitp.dev/v1alpha1';

let failures = 0;
function check(name, ok, detail) {
  if (!ok) {
    failures++;
    console.error(`FAIL ${name}: ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

if (existsSync(fixturesDir)) {
  for (const kind of SCHEMAS) {
    const dir = join(fixturesDir, kind.toLowerCase() + 's');
    const validDir = join(dir, 'valid');
    const invalidDir = join(dir, 'invalid');
    if (existsSync(validDir)) {
      for (const f of readdirSync(validDir)) {
        const text = readFileSync(join(validDir, f), 'utf8');
        const doc = parseYamlDoc(text);
        check(`${kind}/valid/${f}`, !!doc && doc.apiVersion === API_VERSION && doc.kind === kind, 'missing apiVersion or wrong kind');
      }
    }
    if (existsSync(invalidDir)) {
      for (const f of readdirSync(invalidDir)) {
        const text = readFileSync(join(invalidDir, f), 'utf8');
        const doc = parseYamlDoc(text);
        const isInvalid = !doc || doc.apiVersion !== API_VERSION || doc.kind !== kind || !doc.metadata?.id;
        check(`${kind}/invalid/${f}`, isInvalid, 'expected fixture to be invalid but it passed');
      }
    }
  }
} else {
  check('fixtures', false, `missing fixtures dir: ${fixturesDir}`);
}

function parseYamlDoc(text) {
  // Minimal key structure check without adding a YAML dep to the script.
  const m = /^apiVersion:\s*(.+)$/m.exec(text);
  const k = /^kind:\s*(.+)$/m.exec(text);
  if (!m || !k) return null;
  const id = /^id:\s*(.+)$/m.exec(text);
  return { apiVersion: m[1].trim(), kind: k[1].trim(), metadata: { id: id?.[1]?.trim() } };
}

if (failures > 0) {
  console.error(`schema:check: ${failures} failure(s)`);
  process.exit(1);
}
console.log('schema:check passed');
