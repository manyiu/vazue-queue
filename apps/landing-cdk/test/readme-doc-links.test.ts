import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rewriteViewerUri } from '../lib/cloudfront-index-rewrite';

const repoRoot = join(__dirname, '..', '..', '..');
const distRoot = join(repoRoot, 'apps', 'website', '.vitepress', 'dist');
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');

function collectQueueDocUrls(markdown: string): string[] {
  const matches = markdown.matchAll(/https:\/\/queue\.vazue\.com[^\s)"]+/g);
  return [...new Set([...matches].map((m) => new URL(m[0]).pathname))];
}

describe('README queue.vazue.com doc URLs', () => {
  const paths = collectQueueDocUrls(readme);

  it('lists expected README doc paths', () => {
    expect(paths).toContain('/docs/concepts/architecture');
    expect(paths.length).toBeGreaterThan(5);
  });

  it.each(paths)('rewrites %s to a built static asset', (pathname) => {
    const rewritten = rewriteViewerUri(pathname);
    const relative = rewritten.startsWith('/') ? rewritten.slice(1) : rewritten;
    expect(() => readFileSync(join(distRoot, relative))).not.toThrow();
  });
});
