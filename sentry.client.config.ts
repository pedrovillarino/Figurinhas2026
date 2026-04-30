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
    // In-app browser hooks (Instagram/Facebook iOS WebKit + Android FB bridge)
    'window.webkit.messageHandlers',
    'webkit.messageHandlers',
    'enableDidUserTypeOnKeyboardLogging',
    'Java object is gone',
    // Supabase auth lock contention — happens when multiple client components
    // (AuthRefresh, LaunchPromoModal, NotificationBell, etc) call
    // supabase.auth.getUser() concurrently on mount. The lock is acquired by
    // the second call and the first request reports "stolen". Both still
    // succeed — no user-visible impact, just noisy. Filed upstream:
    // https://github.com/supabase/auth-js/issues (intermittent, no fix yet)
    'lock:sb-',
    'was released because another request stole it',
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
    /^app:\/\//,
  ],

  beforeSend(event) {
    // Drop errors whose stacktrace contains only injected/synthetic frames —
    // <anonymous> (eval'd third-party code) or app:/// (in-app browser hooks
    // from Instagram/Facebook). These are never our code.
    const frames = event.exception?.values?.[0]?.stacktrace?.frames
    if (
      frames &&
      frames.length > 0 &&
      frames.every((f) => f.filename === '<anonymous>' || f.filename?.startsWith('app:///'))
    ) {
      return null
    }
    return event
  },
})
