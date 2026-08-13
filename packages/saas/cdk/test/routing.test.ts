import { describe, expect, it } from 'vitest';
import { tenantIdFromHost, RESERVED_TENANT_SLUGS } from '../lib/routing.js';

describe('saas routing', () => {
  it('parses tenant host', () => {
    expect(tenantIdFromHost('acme.wait.queue.vazue.com')).toBe('acme');
    expect(tenantIdFromHost('acme.wait.dev.queue.vazue.com')).toBe('acme');
  });
  it('reserves slugs', () => {
    expect(RESERVED_TENANT_SLUGS.has('api')).toBe(true);
  });
});
