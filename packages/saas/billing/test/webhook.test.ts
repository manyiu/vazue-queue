import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { StripeClient } from '../src/index.js';

describe('StripeClient.verifyWebhookSignature', () => {
  it('accepts a valid t/v1 signature', () => {
    const secret = 'whsec_test';
    const payload = '{"id":"evt_1"}';
    const t = 1_700_000_000;
    const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
    const client = new StripeClient({ apiKey: 'sk_test' });
    expect(client.verifyWebhookSignature(payload, `t=${t},v1=${v1}`, secret, 300, t)).toBe(true);
    expect(client.verifyWebhookSignature(payload, `t=${t},v1=deadbeef`, secret, 300, t)).toBe(false);
  });
});
