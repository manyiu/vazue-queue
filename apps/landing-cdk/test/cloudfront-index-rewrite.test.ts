import { describe, expect, it } from 'vitest';
import {
  CLOUDFRONT_INDEX_REWRITE_SOURCE,
  rewriteViewerUri,
  rewriteViewerUriFromCloudFrontSource,
} from '../lib/cloudfront-index-rewrite';

const rewriteCases = [
  '/docs/',
  '/',
  '/docs/concepts/architecture',
  '/docs/introduction/why-vazue',
  '/oss',
  '/docs',
  '/assets/app.BqosFHJa.js',
  '/favicon.svg',
];

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

  it('keeps deployed CloudFront source in sync with rewriteViewerUri', () => {
    expect(CLOUDFRONT_INDEX_REWRITE_SOURCE).toContain('function handler(event)');
    for (const uri of rewriteCases) {
      expect(rewriteViewerUriFromCloudFrontSource(uri)).toBe(rewriteViewerUri(uri));
    }
  });
});
