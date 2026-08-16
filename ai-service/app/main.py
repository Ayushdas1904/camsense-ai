"""CamSense AI · AI service entry point (FastAPI).

Run: uvicorn app.main:app --reload  (or `python -m app.main`)

This service performs all computer-vision work. The Node backend calls it;
the React frontend never talks to it directly — that separation keeps AI
models decoupled from the UI.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="CamSense AI · AI Service",
        version="0.1.0",
        description="Computer-vision detection & recognition service for CamSense AI.",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # All routes mounted under /api to mirror the backend's convention.
    app.include_router(router, prefix="/api")

    @app.get("/", tags=["system"])
    def root() -> dict:
        return {"service": "camsense-ai-service", "version": "0.1.0"}

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
