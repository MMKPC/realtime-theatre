"""Image provider shim.

The default implementation returns a 1x1 transparent PNG so the API server
runs out-of-the-box. Swap one of the provider blocks below in, or point at
your own Diffusers / ComfyUI worker.

The production stack:

    from diffusers import FluxPipeline
    import torch

    _pipe = FluxPipeline.from_pretrained(
        "black-forest-labs/FLUX.1-dev",
        torch_dtype=torch.bfloat16,
    ).to("cuda")

    async def generate_image(prompt: str, aspect_ratio: str = "16:9") -> bytes:
        w, h = _wh_for(aspect_ratio)
        image = _pipe(prompt, width=w, height=h, guidance_scale=3.5,
                      num_inference_steps=28).images[0]
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()

See docs/ARCHITECTURE.md for the full swap-in guide.
"""
from __future__ import annotations

import base64
import io
import os


# 1x1 transparent PNG (falls back when no provider is configured)
_PLACEHOLDER_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg=="
)


def _wh_for(aspect_ratio: str) -> tuple[int, int]:
    table = {
        "16:9": (1280, 720),
        "9:16": (720, 1280),
        "1:1":  (1024, 1024),
        "4:3":  (1152, 864),
        "3:4":  (864, 1152),
    }
    return table.get(aspect_ratio, (1280, 720))


async def generate_image(prompt: str, aspect_ratio: str = "16:9") -> bytes:
    """Generate a backdrop image for `prompt`.

    Returns raw PNG bytes. Swap this function's body with your provider of
    choice. The rest of the app only assumes bytes-in-PNG-format.

    Providers with 1-line swaps:

      * Replicate   (HTTP)  — https://replicate.com/black-forest-labs/flux-dev
      * Modal       (HTTP)  — spin up a Diffusers FluxPipeline behind @modal.web_endpoint
      * Fal.ai      (HTTP)  — https://fal.ai/models/fal-ai/flux/dev
      * Hugging Face Inference Endpoints — dedicated FLUX.1-dev endpoint
      * Local       — `FluxPipeline.from_pretrained("black-forest-labs/FLUX.1-dev")`

    Environment variables checked (optional):
      REPLICATE_API_TOKEN, FAL_KEY, HF_TOKEN, MODAL_ENDPOINT_URL
    """
    # --- Example: Replicate ------------------------------------------------
    # import httpx
    # token = os.environ["REPLICATE_API_TOKEN"]
    # w, h = _wh_for(aspect_ratio)
    # async with httpx.AsyncClient(timeout=120) as client:
    #     r = await client.post(
    #         "https://api.replicate.com/v1/predictions",
    #         headers={"Authorization": f"Bearer {token}"},
    #         json={
    #             "version": "<flux-dev-version-hash>",
    #             "input": {"prompt": prompt, "width": w, "height": h},
    #         },
    #     )
    #     r.raise_for_status()
    #     image_url = _poll_for_image(r.json())
    #     img = await client.get(image_url)
    #     return img.content
    # ----------------------------------------------------------------------

    return _PLACEHOLDER_PNG
