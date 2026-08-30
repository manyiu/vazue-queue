import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.QUEUE_API_URL || 'http://localhost:3000';
/** When set, status polls use this base (e.g. CloudFront) while enroll stays on QUEUE_API_URL. */
const POLL_BASE = __ENV.POLL_BASE_URL || BASE;
const EVENT = __ENV.EVENT_ID || 'demo';
const PROFILE = (__ENV.PROFILE || 'smoke').toLowerCase();
const VUS = Number(__ENV.VUS || (PROFILE === 'rc' ? 1000 : 50));

/** Profiles:
 *  smoke — default local (50 VUs)
 *  stress — higher VUs via VUS=
 *  rc — release-candidate gate (default 1000 VUs;
 *       set VUS=100000 on distributed k6 / AWS DLTS for full 100K)
 */
const profiles = {
  smoke: {
    stages: [
      { duration: '20s', target: VUS },
      { duration: '40s', target: VUS },
      { duration: '20s', target: 0 },
    ],
    thresholds: {
      http_req_failed: ['rate<0.05'],
      http_req_duration: ['p(99)<500'],
    },
  },
  stress: {
    stages: [
      { duration: '1m', target: VUS },
      { duration: '3m', target: VUS },
      { duration: '1m', target: 0 },
    ],
    thresholds: {
      http_req_failed: ['rate<0.02'],
      http_req_duration: ['p(95)<300', 'p(99)<800'],
    },
  },
  rc: {
    stages: [
      { duration: '2m', target: Math.floor(VUS / 2) },
      { duration: '5m', target: VUS },
      { duration: '2m', target: 0 },
    ],
    thresholds: {
      http_req_failed: ['rate<0.01'],
      http_req_duration: ['p(95)<250', 'p(99)<500'],
    },
  },
};

const selected = profiles[PROFILE] || profiles.smoke;

export const options = {
  scenarios: {
    status_pollers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: selected.stages,
    },
  },
  thresholds: selected.thresholds,
};

export function setup() {
  const res = http.post(`${BASE}/v1/events/${EVENT}/enroll`, JSON.stringify({}), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'enroll 201/200': (r) => r.status === 201 || r.status === 200 });
  const body = res.json();
  return { requestId: body.request_id, profile: PROFILE, vus: VUS };
}

export default function (data) {
  const res = http.get(`${POLL_BASE}/v1/events/${EVENT}/status?request_id=${data.requestId}`);
  check(res, { 'status 200': (r) => r.status === 200 });
  const body = res.json();
  sleep(Math.min(body.poll_after_seconds || 2, 5));
}

export function handleSummary(data) {
  const failed = data.metrics.http_req_failed;
  const duration = data.metrics.http_req_duration;
  const workerId = __ENV.WORKER_ID || null;
  const report = {
    profile: PROFILE,
    targetVus: VUS,
    workerId,
    pollBase: POLL_BASE !== BASE ? POLL_BASE : null,
    http_req_failed_rate: failed ? failed.values.rate : null,
    http_req_duration_p50: duration ? duration.values['p(50)'] : null,
    http_req_duration_p90: duration ? duration.values['p(90)'] : null,
    http_req_duration_p95: duration ? duration.values['p(95)'] : null,
    http_req_duration_p99: duration ? duration.values['p(99)'] : null,
    iterations: data.metrics.iterations ? data.metrics.iterations.values.count : null,
  };
  const lines = [
    `profile=${PROFILE} targetVUs=${VUS}`,
    `fail_rate=${report.http_req_failed_rate}`,
    `p50=${report.http_req_duration_p50} p90=${report.http_req_duration_p90} p95=${report.http_req_duration_p95} p99=${report.http_req_duration_p99}`,
    `iterations=${report.iterations}`,
  ];
  return {
    stdout: `${lines.join('\n')}\n`,
    'load-test-report.json': JSON.stringify(report, null, 2),
  };
}
