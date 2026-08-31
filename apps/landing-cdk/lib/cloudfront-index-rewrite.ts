/**
 * CloudFront viewer-request rewrite for VitePress static output (`cleanUrls: false`).
 * - `/docs/` → `/docs/index.html`
 * - `/docs` → `/docs/index.html` (section root; no `docs.html` in build)
 * - `/docs/concepts/architecture` → `/docs/concepts/architecture.html`
 * - `/assets/app.js` → unchanged
 */
export const CLOUDFRONT_INDEX_REWRITE_SOURCE = `
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri += 'index.html';
  } else if (!uri.includes('.')) {
    if (uri === '/docs') {
      request.uri = '/docs/index.html';
    } else {
      request.uri += '.html';
    }
  }
  return request;
}
`.trim();

export function rewriteViewerUri(uri: string): string {
  if (uri.endsWith('/')) {
    return `${uri}index.html`;
  }
  if (!uri.includes('.')) {
    if (uri === '/docs') {
      return '/docs/index.html';
    }
    return `${uri}.html`;
  }
  return uri;
}

/** Execute the deployed CloudFront Function source (kept in sync via unit tests). */
export function rewriteViewerUriFromCloudFrontSource(uri: string): string {
  const event = { request: { uri } };
  const run = new Function('event', `${CLOUDFRONT_INDEX_REWRITE_SOURCE}; return handler(event);`) as (
    e: typeof event,
  ) => { uri: string };
  return run(event).uri;
}
