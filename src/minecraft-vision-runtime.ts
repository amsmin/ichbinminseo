import { FilesetResolver } from '@mediapipe/tasks-vision'

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>
type Runtime = { files: WasmFileset; factory: unknown }
let runtime: Promise<Runtime> | null = null
let initialization: Promise<void> = Promise.resolve()

async function getRuntime(status: (stage: string) => void): Promise<Runtime> {
  runtime ??= (async () => {
    status('wasm:resolve')
    const files = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm', true)
    status('wasm:module')
    const module = await import(/* @vite-ignore */ files.wasmLoaderPath)
    if (typeof module.default !== 'function') throw new Error('MediaPipe WASM module has no default factory export')
    return { files: { ...files, wasmLoaderPath: '' }, factory: module.default }
  })()
  return runtime
}

export function createVisionTask<T>(stage: string, create: (files: WasmFileset) => Promise<T>, status: (stage: string) => void): Promise<T> {
  // tasks-vision 1.0.1 clears self.ModuleFactory after each task creation.
  // ES-module imports are cached: re-importing the loader does NOT rerun its
  // global assignment. Rebind its actual default export for EVERY task and
  // skip the package's side-effect loader. No inference/CPU fallback is used.
  // Serialize creation because Pose, Hand and Face share that global slot.
  const task = initialization.then(async () => {
    const loaded = await getRuntime(status)
    status(stage)
    const scope = globalThis as typeof globalThis & { ModuleFactory?: unknown }
    scope.ModuleFactory = loaded.factory
    return create(loaded.files)
  })
  initialization = task.then(() => undefined, () => undefined)
  return task // The original rejection reaches the worker's error reporter.
}
