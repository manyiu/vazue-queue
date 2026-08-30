import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.QUEUE_API_URL || 'http://localhost:3000';
const EVENT = __ENV.EVENT_ID || 'demo';
const PROFILE = (__ENV.PROFILE || 'smoke').toLowerCase();
const VUS = Number(__ENV.VUS || (PROFILE === 'rc' ? 1000 : 50));
const POLL_AFTER_ENROLL = __ENV.POLL_AFTER_ENROLL === '1';
const PRESET = __ENV.PRESET_NAME || 'minimal';
const ENROLL_BUFFER = __ENV.ENROLL_BUFFER === '1';

/** Profiles:
 *  smoke — local gate (50 unique enrolls)
 *  stress — higher burst via VUS=
 *  rc — release-candidate enroll burst (default 1000 unique enrolls, all VUs start together)
 */
const profiles = {
  smoke: {
    executor: 'per-vu-iterations',
    vus: VUS,
    iterations: 1,
    maxDuration: '3m',
    thresholds: {
      'http_req_failed{endpoint:enroll}': ['rate<0.05'],
      'http_req_duration{endpoint:enroll}': ['p(99)<1000'],
    },
  },
  stress: {
    executor: 'per-vu-iterations',
    vus: VUS,
    iterations: 1,
    maxDuration: '10m',
    thresholds: {
      'http_req_failed{endpoint:enroll}': ['rate<0.02'],
      'http_req_duration{endpoint:enroll}': ['p(95)<500', 'p(99)<1000'],
    },
  },
  rc: {
    executor: 'per-vu-iterations',
    vus: VUS,
    iterations: 1,
    maxDuration: '10m',
    thresholds: {
      'http_req_failed{endpoint:enroll}': ['rate<0.01'],
      // Informational only — ensures k6 emits enroll POST percentiles in handleSummary.
      'http_req_duration{endpoint:enroll}': ['p(95)<10000'],
    },
  },
};

const selected = profiles[PROFILE] || profiles.smoke;

export const options = {
  scenarios: {
    enroll_burst: {
      executor: selected.executor,
      vus: selected.vus,
      iterations: selected.iterations,
      maxDuration: selected.maxDuration,
    },
  },
  thresholds: selected.thresholds,
};

export function setup() {
  const res = http.get(`${BASE}/health`);
  check(res, { 'health 200': (r) => r.status === 200 });
  return { profile: PROFILE, vus: VUS };
}

export default function () {
  const sessionId = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const res = http.post(
    `${BASE}/v1/events/${EVENT}/enroll`,
    JSON.stringify({ session_id: sessionId }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'enroll' },
    },
  );
  const ok = check(res, {
    'enroll 201/200/202': (r) => r.status === 201 || r.status === 200 || r.status === 202,
  });
  if (!ok || !POLL_AFTER_ENROLL) {
    return;
  }
  const body = res.json();
  const statusRes = http.get(
    `${BASE}/v1/events/${EVENT}/status?request_id=${body.request_id}`,
    { tags: { endpoint: 'status' } },
  );
  check(statusRes, { 'status 200': (r) => r.status === 200 });
}

export function handleSummary(data) {
  const enrollFailed = data.metrics['http_req_failed{endpoint:enroll}'];
  const enrollDuration = data.metrics['http_req_duration{endpoint:enroll}'];
  const statusFailed = data.metrics['http_req_failed{endpoint:status}'];
  const report = {
    profile: PROFILE,
    targetVus: VUS,
    workerId: __ENV.WORKER_ID || null,
    scenario: 'enroll_burst',
    preset: PRESET,
    enroll_buffer: ENROLL_BUFFER,
    poll_after_enroll: POLL_AFTER_ENROLL,
    http_req_failed_rate: enrollFailed ? enrollFailed.values.rate : null,
    http_req_duration_p50: enrollDuration ? enrollDuration.values['p(50)'] : null,
    http_req_duration_p90: enrollDuration ? enrollDuration.values['p(90)'] : null,
    http_req_duration_p95: enrollDuration ? enrollDuration.values['p(95)'] : null,
    http_req_duration_p99: enrollDuration ? enrollDuration.values['p(99)'] : null,
    status_poll_failed_rate: statusFailed ? statusFailed.values.rate : null,
    enrollments: data.metrics.iterations ? data.metrics.iterations.values.count : null,
    iterations: data.metrics.iterations ? data.metrics.iterations.values.count : null,
  };
  const fmt = (v) => (v == null ? '—' : v);
  const lines = [
    `profile=${PROFILE} targetVUs=${VUS} scenario=enroll_burst`,
    `enroll_fail_rate=${report.http_req_failed_rate}`,
    `enroll_p50=${fmt(report.http_req_duration_p50)} enroll_p90=${fmt(report.http_req_duration_p90)} enroll_p95=${fmt(report.http_req_duration_p95)} enroll_p99=${fmt(report.http_req_duration_p99)}`,
    `enrollments=${report.enrollments}`,
  ];
  return {
    stdout: `${lines.join('\n')}\n`,
    'load-test-report.json': JSON.stringify(report, null, 2),
  };
}
