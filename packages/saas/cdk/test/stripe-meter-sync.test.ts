import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handler, verifyWebhookSignature } from '../lambda/stripe-meter-sync/index.js';

describe('stripe-meter-sync', () => {
  it('maps visitor.enrolled in dry-run', async () => {
    process.env.STRIPE_DRY_RUN = '1';
    const out = await handler({
      'detail-type': 'visitor.enrolled',
      detail: { tenant_id: 'acme', event_id: 'e1', quantity: 1 },
    });
    expect(out).toEqual({ ok: true });
  });

  it('skips unknown detail types', async () => {
    process.env.STRIPE_DRY_RUN = '1';
    const out = await handler({ 'detail-type': 'something.else', detail: {} });
    expect(out).toEqual({ ok: true });
  });

  it('verifies webhook HMAC', () => {
    const secret = 'whsec_test';
    const payload = '{}';
    const t = 1_700_000_000;
    const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
    expect(verifyWebhookSignature(payload, `t=${t},v1=${v1}`, secret, 300, t)).toBe(true);
  });
});
