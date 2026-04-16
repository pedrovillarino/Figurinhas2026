import { withSentryConfig } from '@sentry/nextjs'

/** @type {import('next').NextConfig} */

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // script-src: Next.js requires unsafe-inline/eval; Stripe, Google, Vercel Analytics
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://*.stripe.com https://js.stripe.com https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      // img-src: Supabase storage, Google avatars, data URIs, blobs (camera)
      "img-src 'self' data: blob: https://*.supabase.co https://api.completeai.com.br https://lh3.googleusercontent.com",
      "font-src 'self' data:",
      // connect-src: Supabase (custom domain + fallback), Google auth, Stripe, Gemini AI, Z-API (WhatsApp), Vercel Analytics, push subscriptions
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.completeai.com.br wss://api.completeai.com.br https://accounts.google.com https://api.stripe.com https://generativelanguage.googleapis.com https://api.z-api.io https://va.vercel-scripts.com https://vitals.vercel-insights.com https://*.ingest.sentry.io",
      // frame-src: Stripe checkout iframe, Google login popup
      "frame-src https://*.stripe.com https://accounts.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      // worker-src: service worker for push notifications
      "worker-src 'self'",
    ].join('; ')
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Sentry options
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,

  // Upload source maps for better stack traces
  widenClientFileUpload: true,

  // Hide source maps from users
  hideSourceMaps: true,

  // Tree-shake Sentry logger statements
  disableLogger: true,

  // Auto-instrument server functions
  automaticVercelMonitors: true,
});
