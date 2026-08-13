import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { QueueClient, extractAdmitToken, verifyAdmitToken } from '../src/index.js';

function signHs256(payload: Record<string, unknown>, secret: string): string {
  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const h = enc({ alg: 'HS256', typ: 'JWT' });
  const p = enc(payload);
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

describe('QueueClient', () => {
  it('builds enroll URL', async () => {
    const calls: string[] = [];
    const client = new QueueClient({
      baseUrl: 'http://localhost:3000',
      fetch: async (input, init) => {
        calls.push(`${init?.method} ${String(input)}`);
        return new Response(
          JSON.stringify({
            request_id: 'r1',
            session_id: 's1',
            position: 1,
            status: 'waiting',
          }),
          { status: 201 },
        );
      },
    });
    const r = await client.enroll('demo', { return_url: 'https://example.com' });
    expect(r.position).toBe(1);
    expect(calls[0]).toContain('POST http://localhost:3000/v1/events/demo/enroll');
  });

  it('accepts 202 async enroll and soft-handles status 404', async () => {
    const client = new QueueClient({
      baseUrl: 'http://localhost:3000',
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('/enroll')) {
          return new Response(
            JSON.stringify({
              request_id: 'pending-1',
              session_id: 's1',
              position: 0,
              status: 'enrolled',
            }),
            { status: 202 },
          );
        }
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      },
    });
    const enrolled = await client.enroll('demo');
    expect(enrolled.request_id).toBe('pending-1');
    const s = await client.status('demo', enrolled.request_id);
    expect(s.status).toBe('enrolled');
    expect(s.poll_after_seconds).toBe(2);
  });
});

describe('verifyAdmitToken', () => {
  it('accepts valid HS256 and rejects expired or wrong secret', () => {
    const secret = 'origin-secret-16chars';
    const now = 1_700_000_000;
    const good = signHs256({ sub: 'req-1', exp: now + 60, event_id: 'demo' }, secret);
    expect(verifyAdmitToken(good, secret, now)?.event_id).toBe('demo');
    expect(verifyAdmitToken(good, 'wrong-secret!!!!!!', now)).toBeNull();
    const expired = signHs256({ sub: 'req-1', exp: now - 1 }, secret);
    expect(verifyAdmitToken(expired, secret, now)).toBeNull();
  });

  it('extracts token from cookie and query', () => {
    expect(extractAdmitToken({ cookieHeader: 'a=1; vazue_token=abc; b=2' })).toBe('abc');
    expect(extractAdmitToken({ query: new URLSearchParams('vazue_token=xyz') })).toBe('xyz');
  });
});
