/**
 * k6 Load Test — Sync endpoint under concurrent load
 *
 * Run: k6 run k6/sync-load.js
 *
 * Tests:
 * - Health endpoint throughput
 * - Session validation under load
 * - Sync endpoint concurrency
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    // Scenario 1: Health check throughput
    health_check: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
      exec: 'healthCheck',
    },
    // Scenario 2: Session validation under load
    session_validation: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 25 },
        { duration: '20s', target: 50 },
        { duration: '10s', target: 0 },
      ],
      exec: 'sessionCheck',
      startTime: '30s',
    },
    // Scenario 3: Sync concurrency (realistic: 50 users)
    sync_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 },
        { duration: '30s', target: 50 },
        { duration: '15s', target: 0 },
      ],
      exec: 'syncEndpoint',
      startTime: '70s',
    },
  },
  thresholds: {
    'http_req_duration{scenario:health_check}': ['p(95)<100'],
    'http_req_duration{scenario:session_validation}': ['p(95)<200'],
    'http_req_duration{scenario:sync_load}': ['p(95)<5000'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8787';

export function healthCheck() {
  const res = http.get(`${BASE_URL}/health`);
  check(res, {
    'health status 200': (r) => r.status === 200,
    'health response has ok': (r) => JSON.parse(r.body).ok === true,
  });
}

export function sessionCheck() {
  const res = http.get(`${BASE_URL}/auth/session/load-test-token-${__VU}`);
  check(res, {
    'session returns 401 for invalid token': (r) => r.status === 401,
    'session response has error': (r) => JSON.parse(r.body).ok === false,
  });
  sleep(0.5);
}

export function syncEndpoint() {
  const res = http.post(`${BASE_URL}/spotify/sync/load-test-user-${__VU}`);
  check(res, {
    'sync returns response': (r) => r.status >= 200,
  });
  sleep(1);
}
