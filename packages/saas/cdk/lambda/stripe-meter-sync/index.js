/**
 * Stripe Billing Meter sync — EventBridge usage → Stripe meter events.
 * Bundled by aws-lambda-nodejs (NodejsFunction) for SaaS deploys.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

const DETAIL_TO_METER = {
  'visitor.enrolled': 'visitors_enrolled',
  'token.issued': 'tokens_issued',
  'api.request': 'api_requests',
};

let cachedKey;

async function resolveStripeKey() {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;
  if (cachedKey) return cachedKey;
  const arn = process.env.STRIPE_SECRET_ARN;
  if (!arn) throw new Error('STRIPE_SECRET_ARN or STRIPE_SECRET_KEY required');
  const sm = new SecretsManagerClient({});
  const out = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
  const raw =
    out.SecretString ||
    Buffer.from(out.SecretBinary || []).toString('utf8');
  try {
    const parsed = JSON.parse(raw);
    cachedKey = parsed.apiKey || parsed.stripeSecretKey || raw;
  } catch {
    cachedKey = raw;
  }
  return cachedKey;
}

async function createMeterEvent(apiKey, params) {
  const body = new URLSearchParams();
  body.set('event_name', params.event_name);
  body.set('payload[stripe_customer_id]', params.tenantId);
  body.set('payload[value]', String(params.quantity ?? 1));
  if (params.identifier) body.set('identifier', params.identifier);
  const res = await fetch('https://api.stripe.com/v1/billing/meter_events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Stripe-Version': '2025-07-30.basil',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Stripe meter_events failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export function verifyWebhookSignature(
  payload,
  header,
  secret,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000),
) {
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, ...rest] = p.split('=');
      return [k.trim(), rest.join('=')];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const age = Math.abs(nowSec - Number(timestamp));
  if (Number.isNaN(age) || age > toleranceSec) return false;
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function handler(event) {
  const detailType = event['detail-type'] || (event.detail && event.detail.detail_type) || '';
  const meter = DETAIL_TO_METER[detailType] || (event.detail && event.detail.meter);
  if (!meter) {
    console.log(JSON.stringify({ skipped: true, detailType }));
    return { ok: true };
  }
  const detail = event.detail || {};
  const tenantId = detail.tenant_id || detail.tenantId || 'unknown';
  const quantity = detail.quantity || 1;
  const identifier = [detailType, tenantId, detail.event_id || '', String(quantity)]
    .join(':')
    .slice(0, 100);

  if (process.env.STRIPE_DRY_RUN === '1') {
    console.log(JSON.stringify({ dryRun: true, meter, tenantId, quantity, identifier }));
    return { ok: true };
  }

  const apiKey = await resolveStripeKey();
  await createMeterEvent(apiKey, {
    event_name: meter,
    tenantId,
    quantity,
    identifier,
  });
  return { ok: true };
}
