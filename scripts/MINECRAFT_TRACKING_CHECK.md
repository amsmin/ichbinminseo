# Minecraft tracking regression — 2026-09-30

## Reproduced error (before runtime fix)

An isolated headless Chrome connected to the already-running HTTPS Vite server.
Chrome's synthetic camera was used; no real webcam/person was accessed.

```text
CAMERA { width: 1920, height: 1080, error: '' }
CONSOLE error 3D tracking failed hand:init Error ModuleFactory not set.
Error: ModuleFactory not set.
    at .../node_modules/.vite/deps/@mediapipe_tasks-vision.js:4310:52
    at async qh (.../@mediapipe_tasks-vision.js:4309:13)
    at async .../src/minecraft-pose.worker.ts:59:15
    at async configure (.../src/minecraft-pose.worker.ts:77:4)
```

The Pose task initialized first. The subsequent Hand task failed before its
model/inference could run. In installed tasks-vision 1.0.1 the graph runner
clears `self.ModuleFactory` after task creation. The ESM WASM loader sets that
global only when its module first executes. A second dynamic import is cached
and doesn't run the assignment again.

`minecraft-vision-runtime.ts` retains the actual loader's default export and
assigns it before each task creation. It passes an empty `wasmLoaderPath` to
skip the side-effect import, retaining the real WASM binary path. All task
creation is serialized because the runtime factory slot is shared. Real
initialization errors still propagate with their stage/message/stack.

## Two-hand grip

- The grip pivot (not the mesh centre) is placed at the midpoint of both wrists.
- The render rig aligns the calibrated handle axis with the wrist line, towards
  the upper hand. Local pivot compensation and one-time base rotation live in
  `minecraft-grip.ts`; existing geometry/scale and tracking calculations remain
  unchanged. World rotation is tracking rotation times model base rotation.
- Pose wrists 15/16 and finger landmarks are inferred from the same frame.
- When the torso is cropped, a pair of distinctly labelled Hand wrists is
  required. One hand alone does not drive the equipment.
- Both hands receive depth-only occlusion meshes when finger data is present.
- Position/quaternion interpolation and brief missing-detection grace remain.
- Camera/HUD assets, layout and helmet geometry were not modified.

## Verification

```sh
npm run build
node scripts/test-minecraft-runtime.mjs
node scripts/test-minecraft-equipment.mjs
node scripts/test-minecraft-grip.mjs
node scripts/test-minecraft-selection.mjs
node scripts/check-minecraft-browser.mjs
```

The browser check requires an **already running** server at
`https://localhost:5173` (or `MINECRAFT_TEST_ORIGIN`) and installed Chrome
(`CHROME_BIN` overrides the macOS default). It does not start a dev server.

After the fix: slots 2 -> 5 -> 3 -> 4 and rapid 6 -> 2 -> 5 -> 4 initialization
and inference succeeded without a tracking error. Synthetic two-hand data also
rendered non-transparent pixels for all three tools in real WebGL, with
`gl.getError() === 0`. Unit tests verify the exact midpoint/handle axis,
detection-order invariance, both-hand loss rules, rotation and smoothing.

These checks exercise real model initialization/inference with a colour-bar
camera and real rendering with synthetic landmarks. They do not certify
tracking accuracy/appearance on an actual person's hands or every platform.

The grip regression also checks left-upper, right-upper and tilted grips for
each tool in real WebGL. All nine cases had grip-point error 0, handle-axis
alignment dot product 1, visible pixels and no GL error. Unit tests include an
erroneous 90-degree tracking rotation and confirm geometry buffers and scale
are unchanged by the grip/pivot correction.
