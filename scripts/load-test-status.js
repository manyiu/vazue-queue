import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.QUEUE_API_URL || 'http://localhost:3000';
const EVENT = __ENV.EVENT_ID || 'demo';

export const options = {
  scenarios: {
    status_pollers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Number(__ENV.VUS || 50) },
        { duration: '1m', target: Number(__ENV.VUS || 50) },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(99)<500'],
  },
};

export function setup() {
  const res = http.post(`${BASE}/v1/events/${EVENT}/enroll`, JSON.stringify({}), {
    headers: { 'Content-Type': 'application/json' },
  });
  const body = res.json();
  return { requestId: body.request_id };
}

export default function (data) {
  const res = http.get(`${BASE}/v1/events/${EVENT}/status?request_id=${data.requestId}`);
  check(res, { 'status 200': (r) => r.status === 200 });
  const body = res.json();
  sleep(body.poll_after_seconds || 2);
}
