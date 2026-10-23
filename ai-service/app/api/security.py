"""Service-to-service authentication for the AI service's HTTP surface.

The AI service is an INTERNAL peer: the Node backend is its only legitimate
caller, and a browser never talks to it. Every route except ``/api/health``
therefore requires the same shared secret the backend already sends when it
posts detections and recognition results (``x-ai-secret`` ==
``settings.ingest_secret`` == the backend's ``AI_INGEST_SECRET``).

Why this exists (Review 2 security fix):

* ``POST /api/faces/register`` returns a raw 128-d face embedding — biometric
  data the backend protects with three independent mechanisms. Before this
  gate, any caller that could reach port 8000 could POST a photograph and
  receive that vector.
* ``POST /api/faces/cache/refresh`` is state-changing and could be used to
  drive repeated fetches at the backend's embeddings endpoint.
* The Review 1 stream-control routes were unauthenticated too. An inherited
  gap is a gap: they are gated here as well, with the backend's ``aiClient``
  updated to send the header on every call.

The gate VERIFIES a credential — it does not merely detect a header. The
comparison is constant-time, and it FAILS CLOSED: if no secret is configured
the service rejects every request rather than admitting everyone.
"""
from __future__ import annotations

import secrets

from fastapi import Header, HTTPException, status

from app.config import get_settings

_UNAUTHORIZED = "Invalid or missing internal service credentials"


def require_service_secret(x_ai_secret: str | None = Header(default=None)) -> None:
    """FastAPI dependency: require a valid ``x-ai-secret`` header.

    Raises 401 when the header is absent or wrong, and 503 when no secret is
    configured at all (fail closed — an unconfigured service is locked, never
    open). Add it with ``dependencies=[Depends(require_service_secret)]``.
    """
    expected = (get_settings().ingest_secret or "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "AI_SERVICE_INGEST_SECRET is not configured, so this service cannot "
                "authenticate its caller and refuses every request. Set it to the same "
                "value as the backend's AI_INGEST_SECRET and restart."
            ),
        )

    provided = x_ai_secret or ""
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_UNAUTHORIZED,
            headers={"WWW-Authenticate": "x-ai-secret"},
        )
