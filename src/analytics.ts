export type AnalyticsValue = string | number | boolean
export type AnalyticsParams = Record<string, AnalyticsValue>

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

export function trackEvent(name: string, params: AnalyticsParams = {}) {
  if (typeof window.gtag !== 'function') return
  window.gtag('event', name, params)
}

export function startExperimentSession(experiment: string) {
  const startedAt = performance.now()
  let ended = false
  trackEvent('experiment_start', { experiment })
  trackEvent(`${experiment}_start`, { experiment })

  return {
    end(reason: 'pagehide' | 'switch' | 'unmount' = 'pagehide') {
      if (ended) return
      ended = true
      const params = {
        experiment,
        reason,
        duration_seconds: Math.max(0, Math.round((performance.now() - startedAt) / 1000)),
      }
      trackEvent('experiment_end', params)
      trackEvent(`${experiment}_end`, params)
    },
  }
}
