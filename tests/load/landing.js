/**
 * Load test for completeai.com.br
 *
 * Run with: k6 run tests/load/landing.js
 * Install k6: brew install k6 (macOS) or https://k6.io/docs/get-started/installation/
 *
 * Stages:
 *   - Ramp up to 500 users over 2 min
 *   - Hold 5000 users for 5 min (stress)
 *   - Ramp down over 3 min
 *
 * Thresholds:
 *   - p95 response time < 2s
 *   - Error rate < 1%
 */

import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE_URL = __ENV.BASE_URL || 'https://www.completeai.com.br'

export const options = {
  stages: [
    { duration: '2m', target: 500 },
    { duration: '5m', target: 5000 },
    { duration: '3m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // p95 < 2s
    http_req_failed: ['rate<0.01'],     // error rate < 1%
  },
}

export default function () {
  // Landing page
  const landing = http.get(`${BASE_URL}/`)
  check(landing, {
    'landing status 200': (r) => r.status === 200,
    'landing < 2s': (r) => r.timings.duration < 2000,
  })

  sleep(1)

  // FAQ page
  const faq = http.get(`${BASE_URL}/faq`)
  check(faq, {
    'faq status 200': (r) => r.status === 200,
  })

  sleep(1)

  // Terms page
  const termos = http.get(`${BASE_URL}/termos`)
  check(termos, {
    'termos status 200': (r) => r.status === 200,
  })

  sleep(Math.random() * 3)
}
