import { afterAll, describe, expect, it } from 'vitest';
import { QueueClient, verifyAdmitToken } from '../src/index.js';

const INTEGRATION = process.env.SDK_INTEGRATION === '1';
const BASE = process.env.QUEUE_API_URL ?? 'http://127.0.0.1:3000';
const ADMIN = process.env.ADMIN_API_URL ?? 'http://127.0.0.1:3001';
const EVENT = 'demo';
/** Same secret as `local-server` (`AppState::local` in queue-api). */
const LOCAL_SECRET = 'local-dev-hmac-secret-change-me';

describe.skipIf(!INTEGRATION)('local-server integration', () => {
  afterAll(async () => {
    await fetch(`${ADMIN}/v1/events/${EVENT}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emergency_open: false }),
    }).catch(() => undefined);
  });

  it('enrolls, receives admit token, and verifies at origin', async () => {
    const prep = await fetch(`${ADMIN}/v1/events/${EVENT}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emergency_open: true }),
    });
    expect(prep.ok).toBe(true);

    const client = new QueueClient({ baseUrl: BASE });
    const enrolled = await client.enroll(EVENT, {
      return_url: 'https://example.com/checkout',
    });
    expect(enrolled.request_id).toBeTruthy();

    const status = await client.status(EVENT, enrolled.request_id);
    expect(status.admitted).toBe(true);
    expect(status.admit_token).toBeTruthy();

    const claims = verifyAdmitToken(status.admit_token!, LOCAL_SECRET);
    expect(claims?.event_id ?? claims?.sub).toBeTruthy();
  });
});
