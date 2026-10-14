export function greetingForTime(date = new Date()): string {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return 'Guten Morgen!'
  if (hour >= 12 && hour < 18) return 'Guten Tag!'
  if (hour >= 18 && hour < 22) return 'Guten Abend!'
  return 'Gute Nacht!'
}

export function mountGreeting(label: HTMLElement): () => void {
  let timer: number | undefined
  const refresh = () => {
    window.clearTimeout(timer)
    const now = new Date()
    const greeting = greetingForTime(now)
    if (label.textContent !== greeting) label.textContent = greeting
    // Read the device's local time each minute, including after sleep or
    // a timezone change. No server timezone or fixed UTC offset is used.
    if (!document.hidden) {
      timer = window.setTimeout(refresh, 60_000 - now.getSeconds() * 1000 - now.getMilliseconds())
    }
  }
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('focus', refresh)
  refresh()
  return () => {
    window.clearTimeout(timer)
    document.removeEventListener('visibilitychange', refresh)
    window.removeEventListener('focus', refresh)
  }
}
