export function tenantIdFromHost(host: string): string | undefined {
  const h = host.toLowerCase().split(':')[0];
  const m = h.match(/^([a-z0-9-]+)\.wait\.(?:dev\.|staging\.)?queue\.vazue\.com$/);
  return m?.[1];
}

export const RESERVED_TENANT_SLUGS = new Set([
  'api',
  'www',
  'admin',
  'app',
  'docs',
  'status',
  'cdn',
  'wait',
  'queue',
  'mail',
  'smtp',
]);
