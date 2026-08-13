import { describe, expect, it } from 'vitest';
import { QueueClient } from '../src/index.js';

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
