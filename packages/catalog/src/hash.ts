import { createHash } from 'node:crypto';

export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Prefixed digest form used in verification blocks, e.g. `sha256:abc...`. */
export function sha256(content: string | Buffer): string {
  return `sha256:${sha256Hex(content)}`;
}
