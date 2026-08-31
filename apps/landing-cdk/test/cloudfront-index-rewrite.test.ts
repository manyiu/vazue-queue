import { describe, expect, it } from 'vitest';
import { rewriteViewerUri } from '../lib/cloudfront-index-rewrite';

describe('CloudFront index rewrite', () => {
  it('maps directory paths to index.html', () => {
    expect(rewriteViewerUri('/docs/')).toBe('/docs/index.html');
    expect(rewriteViewerUri('/')).toBe('/index.html');
  });

  it('maps extensionless VitePress routes to *.html', () => {
    expect(rewriteViewerUri('/docs/concepts/architecture')).toBe(
      '/docs/concepts/architecture.html',
    );
    expect(rewriteViewerUri('/docs/introduction/why-vazue')).toBe(
      '/docs/introduction/why-vazue.html',
    );
    expect(rewriteViewerUri('/oss')).toBe('/oss.html');
  });

  it('maps /docs section root without trailing slash', () => {
    expect(rewriteViewerUri('/docs')).toBe('/docs/index.html');
  });

  it('leaves asset paths unchanged', () => {
    expect(rewriteViewerUri('/assets/app.BqosFHJa.js')).toBe('/assets/app.BqosFHJa.js');
    expect(rewriteViewerUri('/favicon.svg')).toBe('/favicon.svg');
  });
});
