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
});
