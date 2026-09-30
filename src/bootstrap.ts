// Keep the original gallery as the homepage. Only an explicit selection opens
// the camera-only example without initializing the gallery's ML/WebGL scenes.
const experience = new URLSearchParams(window.location.search).get('experience')

if (experience === 'minecraft') {
  const { mountMinecraft } = await import('./minecraft')
  mountMinecraft(document.querySelector<HTMLDivElement>('#app')!)
} else {
  await import('./main')
  // Gallery scenes release their resources on pagehide. Reinitialize on Back.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload()
  })
}
