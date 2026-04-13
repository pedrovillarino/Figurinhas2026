/**
 * Lightweight performance logging for API routes.
 * Logs endpoint timing to console (Vercel captures these in logs).
 *
 * Usage:
 *   const perf = createPerfLogger('scan')
 *   perf.mark('auth')
 *   // ... do auth
 *   perf.mark('gemini')
 *   // ... call gemini
 *   perf.end() // logs: [perf:scan] auth:45ms gemini:1234ms total:1279ms
 */

export function createPerfLogger(endpoint: string) {
  const start = Date.now()
  const marks: Array<{ name: string; time: number }> = []
  let lastMark = start

  return {
    /** Mark a checkpoint (logs elapsed time since last mark) */
    mark(name: string) {
      const now = Date.now()
      marks.push({ name, time: now - lastMark })
      lastMark = now
    },

    /** End and log all timings */
    end(extra?: Record<string, string | number>) {
      const total = Date.now() - start
      const parts = marks.map((m) => `${m.name}:${m.time}ms`)
      parts.push(`total:${total}ms`)
      if (extra) {
        Object.entries(extra).forEach(([k, v]) => parts.push(`${k}=${v}`))
      }
      console.log(`[perf:${endpoint}] ${parts.join(' ')}`)
      return total
    },
  }
}
