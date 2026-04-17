#!/usr/bin/env python3
"""Prompt-VFX backend.

Endpoints
---------
POST /api/scene
    Body: {"prompt": "...", "aspect_ratio": "16:9"}
    Returns: {
        "image": "data:image/png;base64,...",
        "scene": {
            "type": "waterfall" | "ocean" | "fire" | "forest" | "cosmic" | "rain" | "snow" | "city",
            "palette": [...],
            "tokens": [...],     # keywords extracted from prompt
            "time_of_day": "day" | "sunset" | "night" | "dawn",
            "mood": "calm" | "epic" | "eerie" | "warm"
        }
    }

The frontend uses `scene` to drive the procedural VFX overlay
(water sheets, mist, particles, fog, parallax, colour grading).
"""
from __future__ import annotations

import base64
import re
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from generate_image import generate_image


app = FastAPI(title="Prompt-VFX")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Scene analysis — the lightweight "Depth / layer / motion prior" stand-in.
# In the production stack this would be:
#     FLUX.1-dev  -> Depth-Anything-V2  -> layer extraction
# For an MVP we infer scene type + palette directly from the prompt so the
# browser VFX renderer can drive the right particle systems & shaders.
# ---------------------------------------------------------------------------

# Environment/place types are checked first — weather types only win if no
# place is detected. This keeps "cyberpunk Tokyo in heavy rain" classified as
# city (with rain as a modifier), not as a generic rain scene.
SCENE_KEYWORDS: dict[str, list[str]] = {
    "city":      ["city", "skyline", "neon", "cyberpunk", "metropolis", "tokyo", "street"],
    "waterfall": ["waterfall", "cascade", "falls", "rapids"],
    "ocean":     ["ocean", "sea", "waves", "surf", "beach", "tide"],
    "volcano":   ["volcano", "lava", "inferno", "eruption", "erupting", "magma"],
    "mountain":  ["alpine", "mountain", "mountains", "peak", "peaks", "summit", "ridge", "lake", "valley"],
    "forest":    ["forest", "jungle", "canopy", "woods", "trees", "rainforest", "pine"],
    "cosmic":    ["nebula", "galaxy", "cosmos", "cosmic", "stars", "space", "aurora", "stardust"],
    "desert":    ["desert", "dune", "sahara", "sandstorm"],
    "snow":      ["blizzard", "glacier", "tundra", "snowstorm"],
    "rain":      ["rainstorm", "downpour", "thunderstorm", "monsoon"],
    "fire":      ["fire", "flame", "ember"],
}

# Scene-type aliases: renderer-level remap.
SCENE_ALIAS = {"volcano": "fire", "mountain": "snow"}  # mountain scenes use snow/mist renderer

TOD_KEYWORDS = {
    "sunset": ["sunset", "dusk", "golden hour", "evening"],
    "night":  ["night", "midnight", "moonlit", "moonlight", "starlit"],
    "dawn":   ["dawn", "sunrise", "morning"],
    "day":    ["day", "afternoon", "noon"],
}

MOOD_KEYWORDS = {
    "epic":  ["epic", "massive", "colossal", "dramatic", "cinematic"],
    "eerie": ["eerie", "haunted", "dark", "creepy", "foggy"],
    "warm":  ["warm", "cozy", "golden", "soft"],
    "calm":  ["calm", "peaceful", "serene", "quiet"],
}


PALETTES: dict[tuple[str, str], list[str]] = {
    ("waterfall", "sunset"): ["#ffb26b", "#ff6e7f", "#8a5cff", "#2bd4c4", "#0d2a3a"],
    ("waterfall", "night"):  ["#0a1b2f", "#123a5c", "#2bd4c4", "#c6f6ff", "#e9f7ff"],
    ("waterfall", "dawn"):   ["#ffd7a8", "#f7a8c9", "#6ec6ff", "#7affd4", "#0f2338"],
    ("waterfall", "day"):    ["#7ec8e3", "#bde4f4", "#2bd4c4", "#c0f2d8", "#22425a"],
    ("ocean",     "sunset"): ["#ff9a6b", "#ff4d7a", "#6d3bd1", "#1ac8d8", "#07223a"],
    ("ocean",     "night"):  ["#050a1a", "#10264a", "#2bd4c4", "#aee3ff", "#f0f7ff"],
    ("fire",      "night"):  ["#0b0407", "#3d0a12", "#ff3d2e", "#ffb347", "#fff4c6"],
    ("forest",    "day"):    ["#6cbf4a", "#2c7d3a", "#b8e994", "#f9f5a7", "#1f3921"],
    ("forest",    "night"):  ["#0a1a12", "#12382a", "#5ecf77", "#a6f0c1", "#e9fff4"],
    ("rain",      "night"):  ["#07121f", "#123a5c", "#6ec6ff", "#c6e9ff", "#f0f8ff"],
    ("snow",      "day"):    ["#e6f3ff", "#b9d4ec", "#7fa9cf", "#2a5174", "#0f2238"],
    ("cosmic",    "night"):  ["#06021a", "#2b0a55", "#6e3bff", "#ff6ec7", "#fff4c6"],
    ("city",      "night"):  ["#060914", "#1a1147", "#ff3df2", "#1affd5", "#fff6b3"],
    ("desert",    "sunset"): ["#2b0d1a", "#b13a3a", "#ff8a3d", "#ffcf6e", "#fff1c2"],
}

DEFAULT_PALETTE = ["#0a1b2f", "#164a6e", "#2bd4c4", "#e6faff", "#ffcf6e"]


def _match_first(words: list[str], table: dict[str, list[str]]) -> str | None:
    for key, kws in table.items():
        for kw in kws:
            if kw in words:
                return key
    return None


def classify_scene(prompt: str) -> dict[str, Any]:
    p = prompt.lower()
    tokens = re.findall(r"[a-zA-Z']+", p)
    word_set = set(tokens)

    scene_type = _match_first(list(word_set), SCENE_KEYWORDS) or "waterfall"
    scene_type = SCENE_ALIAS.get(scene_type, scene_type)
    time_of_day = _match_first(list(word_set), TOD_KEYWORDS) or "day"
    mood = _match_first(list(word_set), MOOD_KEYWORDS) or "calm"

    palette = PALETTES.get((scene_type, time_of_day)) or PALETTES.get(
        (scene_type, "day")
    ) or DEFAULT_PALETTE

    # Secondary modifiers — weather / atmospheric layers on top of place.
    modifiers = []
    weather_kw = {
        "rain": ["rain", "rainy", "rainstorm", "downpour", "thunderstorm", "monsoon", "raining"],
        "snow": ["snow", "snowy", "snowfall", "snowstorm", "flurries", "snowing"],
        "mist": ["fog", "foggy", "mist", "misty", "haze", "hazy"],
        "fire": ["fire", "flame", "ember", "burning"],
    }
    for mod, kws in weather_kw.items():
        if any(k in word_set for k in kws) and mod != scene_type:
            modifiers.append(mod)
    # "storm" is ambiguous — only treat as rain when no other weather mod applies
    if "storm" in word_set and "rain" not in modifiers and "snow" not in modifiers and scene_type not in ("snow", "rain"):
        modifiers.append("rain")

    return {
        "type": scene_type,
        "palette": palette,
        "tokens": tokens[:24],
        "time_of_day": time_of_day,
        "mood": mood,
        "modifiers": modifiers,
    }


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

class SceneRequest(BaseModel):
    prompt: str
    aspect_ratio: str = "16:9"


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/scene")
async def scene(req: SceneRequest) -> dict[str, Any]:
    analysis = classify_scene(req.prompt)

    # We enrich the user prompt with atmosphere tokens so the base-plate image
    # matches the VFX overlay. This is exactly where FLUX.1-dev would go in
    # the production pipeline.
    enriched = (
        f"{req.prompt.strip()}, cinematic composition, volumetric lighting, "
        f"rich atmospheric depth, painterly detail, ultra high quality, "
        f"mood: {analysis['mood']}, time: {analysis['time_of_day']}"
    )

    try:
        image_bytes = await generate_image(
            enriched,
            aspect_ratio=req.aspect_ratio if req.aspect_ratio in {"16:9", "9:16", "1:1", "4:3", "3:4"} else "16:9",
        )
        b64 = base64.b64encode(image_bytes).decode()
        image_url = f"data:image/png;base64,{b64}"
    except Exception as exc:  # pragma: no cover - surfaced to the UI
        return {
            "error": str(exc),
            "scene": analysis,
            "image": None,
        }

    return {
        "image": image_url,
        "scene": analysis,
        "prompt": req.prompt,
        "enriched_prompt": enriched,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
