// The image-based book is the default homepage. Existing experiments remain
// available when selected explicitly through their experience query.
const experience = new URLSearchParams(window.location.search).get('experience')
const page = new URLSearchParams(window.location.search).get('page')

if (page === 'guestbook') {
  await import('./guestbook')
} else if (!experience || experience === 'photobook') {
  await import('./photobook')
} else if (experience === 'berlin') {
  document.title = 'jaklarn'
  await import('../berlin/src/main')
} else if (experience === 'minecraft') {
  const { mountMinecraft } = await import('./minecraft')
  mountMinecraft(document.querySelector<HTMLDivElement>('#app')!)
} else {
  await import('./main')
  // Gallery scenes release their resources on pagehide. Reinitialize on Back.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload()
  })
}
