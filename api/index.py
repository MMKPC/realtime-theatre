"""Vercel serverless entry point for the RealTime Theatre backend.

Vercel's Python runtime picks up the ASGI `app` exported below. We reuse
the exact same FastAPI app from `backend/` so local dev and production
share one codebase.
"""
from __future__ import annotations

import os
import sys

# Make the sibling `backend/` package importable from this serverless entry.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_ROOT, "backend"))

from api_server import app  # noqa: E402  (import after sys.path tweak)

# `app` is the ASGI application Vercel invokes.
