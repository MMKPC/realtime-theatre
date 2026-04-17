# Architecture

RealTime Theatre is a five-layer pipeline. This doc spells out what's real in
this repo's MVP, what's stubbed, and how to swap each stub for a production
worker.

## Layers

### 1. Prompt
The client POSTs `{ prompt, aspect_ratio }` to `/api/scene`.

### 2. Backdrop (text-to-image)
- **Repo:** `backend/generate_image.py`
- **MVP:** returns a placeholder 1x1 PNG unless you wire a provider.
- **Production:**
  - Local Diffusers: `FluxPipeline.from_pretrained("black-forest-labs/FLUX.1-dev")`
  - Hosted: Replicate `black-forest-labs/flux-dev`, Fal.ai `fal-ai/flux/dev`,
    HF Inference Endpoints, or Modal.
- **Swap point:** replace the body of `generate_image()`.

### 3. Scene read (depth / structure)
- **Repo:** `backend/api_server.py` → `classify_scene()`
- **MVP:** keyword classifier extracting `type`, `time_of_day`, `mood`, `palette`,
  and `modifiers`.
- **Production:** two stages:
  1. **Depth-Anything-V2** for a depth map + three parallax planes + a mid-ground
     mask (for particle occlusion).
     ```python
     from transformers import pipeline
     depth = pipeline("depth-estimation",
                      model="depth-anything/Depth-Anything-V2-Large-hf")
     depth_map = depth(image)["depth"]
     ```
  2. **CLIP or an LLM** to produce scene metadata (type, mood, palette) as
     structured JSON.
- **Swap point:** extend the `/api/scene` response with `depth_url` and a
  `layers: [foreground, midground, background]` array.

### 4. Live stage (browser VFX)
- **Repo:** `frontend/app.js`
- **MVP:** hand-written 2D canvas particle engine with scene-matched systems
  (waterfall, rain, snow, fire, forest, cosmic, city, ocean, desert).
- **Production:** port to WebGPU / Three.js TSL for fluid sim, volumetric fog,
  cube-map sky, and per-layer depth compositing.

### 5. Host avatar
- **Repo:** `frontend/index.html` (inline SVG) + `frontend/app.js` (animation).
- **MVP:** idle breathing, blink, wave, arm sway, speech bubble, lipsync'd
  mouth oscillation when speaking.
- **Production upgrade paths:**
  - Vector rig swap (Rive / Lottie)
  - Live2D / VTube-Studio bridge
  - 3D avatar (Ready Player Me / VRM) rendered over the canvas
  - Voice input → ASR → LLM reply → TTS with phoneme-driven lipsync

## API

### `POST /api/scene`

**Request**
```json
{ "prompt": "A waterfall at sunset", "aspect_ratio": "16:9" }
```

**Response**
```json
{
  "image": "data:image/png;base64,...",
  "scene": {
    "type": "waterfall",
    "palette": ["#ffb26b", "#ff6e7f", "#8a5cff", "#2bd4c4", "#0d2a3a"],
    "tokens": ["a","waterfall","at","sunset",...],
    "time_of_day": "sunset",
    "mood": "warm",
    "modifiers": ["mist"]
  },
  "prompt": "...",
  "enriched_prompt": "..."
}
```

The frontend uses `scene` to pick particle systems and drive the CSS
color-grade layer. Add `depth_url`, `layers`, and `audio_url` fields as you
scale up.

## Scaling sketch

```
Cloudflare / CDN
      │
      ▼
┌──────────────┐           ┌─────────────────┐
│  Frontend    │──JSON────▶│  API gateway    │
│  (static S3) │           │  FastAPI on Fly │
└──────────────┘           └────────┬────────┘
                                    │
            ┌───────────────────────┼─────────────────────────┐
            ▼                       ▼                         ▼
    ┌───────────────┐       ┌───────────────┐        ┌────────────────┐
    │ FLUX worker   │       │ Depth worker  │        │ Video worker   │
    │ (Modal/Replic)│       │ (Depth-Any V2)│        │ (CogVideoX-5B) │
    └───────────────┘       └───────────────┘        └────────────────┘
```

## Known limitations (MVP)

- The classifier is keyword-based and will mis-tag ambiguous prompts.
- The host is a single rig; no voice or wardrobe control yet.
- Particle system is 2D canvas; no real depth compositing until Depth-Anything
  is wired up.

## Design principles

- **Browser-first.** Everything that *can* run in the tab *does*. The server
  only does inference that requires a GPU.
- **Swappable providers.** No layer assumes a specific image model.
- **Graceful degradation.** The stage animates even if the backdrop fails.
- **Honest labels.** The README and this doc mark what's real vs. stubbed.
