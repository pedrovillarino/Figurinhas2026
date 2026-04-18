import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable in production
  enabled: process.env.NODE_ENV === 'production',

  // Performance monitoring — sample 5% of transactions (reduced for scale)
  tracesSampleRate: 0.05,

  // Session replay — capture 1% of sessions, 100% of error sessions
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Filter noisy errors that aren't actionable
  ignoreErrors: [
    'ResizeObserver loop',
    'Non-Error promise rejection',
    'Load failed',
    'ChunkLoadError',
    // Third-party scripts (Google Ads, gtag, Facebook Pixel, browser extensions)
    'data.forEach is not a function',
    'data.map is not a function',
    "Can't find variable: gtag",
    "Can't find variable: fbq",
    'Script error',
  ],

  // Drop errors that originate from known third-party domains
  denyUrls: [
    /accounts\.google\.com/,
    /apis\.google\.com/,
    /connect\.facebook\.net/,
    /www\.google-analytics\.com/,
    /www\.googletagmanager\.com/,
    /googleads\.g\.doubleclick\.net/,
    /pagead2\.googlesyndication\.com/,
    /^chrome-extension:\/\//,
    /^moz-extension:\/\//,
    /^safari-extension:\/\//,
  ],

  beforeSend(event) {
    // Drop pure-anonymous errors (typically eval'd third-party code with no
    // useful stacktrace — Google Ads tag, ad blockers injecting code, etc).
    const frames = event.exception?.values?.[0]?.stacktrace?.frames
    if (frames && frames.length > 0 && frames.every((f) => f.filename === '<anonymous>')) {
      return null
    }
    return event
  },
})
