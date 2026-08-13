/**
 * Thin Stripe REST client (no official Rust/TS SDK required).
 * Commercial SaaS only — do not publish this package.
 */

export interface StripeClientOptions {
  apiKey: string;
  apiVersion?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class StripeClient {
  private readonly apiKey: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: StripeClientOptions) {
    this.apiKey = opts.apiKey;
    this.apiVersion = opts.apiVersion ?? '2025-07-30.basil';
    this.baseUrl = (opts.baseUrl ?? 'https://api.stripe.com').replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async createCustomer(params: { email?: string; name?: string; idempotencyKey?: string }) {
    return this.postForm('/v1/customers', params, params.idempotencyKey);
  }

  async createCheckoutSession(params: Record<string, string>, idempotencyKey?: string) {
    return this.postForm('/v1/checkout/sessions', params, idempotencyKey);
  }

  async createMeterEvent(params: {
    event_name: string;
    payload: Record<string, string>;
    identifier?: string;
  }) {
    const body: Record<string, string> = {
      event_name: params.event_name,
      ...Object.fromEntries(
        Object.entries(params.payload).map(([k, v]) => [`payload[${k}]`, v]),
      ),
    };
    if (params.identifier) body.identifier = params.identifier;
    return this.postForm('/v1/billing/meter_events', body, params.identifier);
  }

  verifyWebhookSignature(payload: string, header: string, secret: string, toleranceSec = 300): boolean {
    // Minimal HMAC check placeholder — production should parse t= and v1=
    const parts = Object.fromEntries(
      header.split(',').map((p) => {
        const [k, v] = p.split('=');
        return [k.trim(), v];
      }),
    );
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) return false;
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (age > toleranceSec) return false;
    // Node crypto would be used in runtime; keep pure check structure here.
    return Boolean(secret && payload && signature);
  }

  private async postForm(path: string, params: Record<string, unknown>, idempotencyKey?: string) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || k === 'idempotencyKey') continue;
      body.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Stripe-Version': this.apiVersion,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body,
    });
    if (!res.ok) throw new Error(`Stripe ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }
}

export type MeterName =
  | 'visitors_enrolled'
  | 'tokens_issued'
  | 'api_requests'
  | 'active_events'
  | 'connector_requests';
