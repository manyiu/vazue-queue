import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const openapiPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'openapi',
  'vazue-queue.yaml',
);

describe('openapi contract (post-SaaS cleanup)', () => {
  const spec = readFileSync(openapiPath, 'utf8');

  it('does not document removed invite-only fields', () => {
    expect(spec).not.toMatch(/invite_code:/);
    expect(spec).not.toMatch(/invite_only:/);
  });

  it('does not document deployment profile on /ready', () => {
    expect(spec).not.toMatch(/deployment:/);
  });
});
