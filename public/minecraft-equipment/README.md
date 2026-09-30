# Minecraft equipment assets

The original `public/fire.JPG`, `mond.JPG`, `dia.JPG`, and `helmet.JPG` are preserved. These sibling transparent PNGs were prepared with the built-in imagegen tool (background-extraction), not the CLI. Helmet extraction removes the reference character and background, keeping only the wearable helmet. These are reference-derived cutouts, not byte-identical crops.

No camera or hotbar layout/asset changes are part of equipment tracking.

## Final prompts

### torch.png

Use case: background-extraction. Asset type: transparent PNG equipment sprite for a camera AR overlay. Input Image 1 is the edit target. Keep the exact upright narrow pixel torch, its yellow/orange top and brown shaft unchanged. Keep original composition, orientation, pixel block shapes and palette. Remove only white background. Output exactly one isolated item on a genuinely transparent alpha background, NOT a checkerboard illustration. No added shadows, outline, glow, flames, text, icons or other objects. Preserve reference design, do not restyle. This is a cutout, not a new design.

### pickaxe.png

Use case: background-extraction. Asset type: transparent PNG equipment sprite for a camera AR overlay. Input Image 1 is the edit target. Keep the exact diagonal diamond pickaxe pointing upper-right, brown handle running bottom-left to upper-right, teal head unchanged. Keep original composition, silhouette, pixel block shapes and palette. Remove only white background. Output exactly one isolated item on a genuinely transparent alpha background, NOT a checkerboard illustration. No added shadows, outline, glow, flames, text, icons or other objects. Preserve reference design, do not restyle. This is a cutout, not a new design.

### sword.png

Use case: background-extraction. Asset type: transparent PNG equipment sprite for a camera AR overlay. Input Image 1 is the edit target. Keep exact diagonal diamond sword pointing upper-right, handle at bottom-left, unchanged. Keep original composition, silhouette, pixel block shapes and palette. Remove only white background. Output exactly one isolated item on a genuinely transparent alpha background, NOT a checkerboard illustration. No added shadows, outline, glow, flames, text, icons or other objects. Preserve reference design, do not restyle. This is a cutout, not a new design.

### helmet.png

Use case: background-extraction. Asset type: transparent PNG equipment sprite for a camera AR overlay. Input Image 1 is the edit target. Extract ONLY the cyan diamond HELMET from the character's head: preserve its square crown, darker turquoise forehead band, side guards and central nose guard. Remove the entire character face, eyes, hair, body, armor, legs, ground and background. The face opening beneath the forehead band and between side guards must be transparent. Keep the helmet's existing frontal/slightly top-down orientation, proportions and pixelated texture. Center just helmet in the output with tight even transparent padding, large enough for wearable AR sprite. Output exactly one isolated item on a genuinely transparent alpha background, NOT a checkerboard illustration. No added shadows, outline, glow, flames, text, icons or other objects. Preserve reference design, do not restyle. This is a cutout, not a new design.

## Tracking reference

MediaPipe Pose VIDEO inference runs in a worker: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js
Right elbow/wrist indices: 14/16. Eye centers: 2/5. Ears: 7/8.
