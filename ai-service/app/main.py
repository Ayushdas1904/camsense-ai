"""CamSense AI · AI service entry point (FastAPI).

Run: uvicorn app.main:app --reload  (or `python -m app.main`)

Performs all computer-vision work. The Node backend calls it; the React
frontend never talks to it directly. The YOLO model is loaded (and warmed) once
at startup and reused for every frame.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import get_settings
from app.detection.yolo_model import YoloModel
from app.services.pipeline import warmup


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Load + warm the model once on startup so the first frame isn't slow.
    model = YoloModel.instance()
    print(f"[startup] YOLO model loaded: {model.available}")
    if model.available:
        warmup()
        print("[startup] model warmed up")
    yield


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="CamSense AI · AI Service",
        version="1.0.0",
        description="Computer-vision detection service for CamSense AI (Review 1).",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router, prefix="/api")

    @app.get("/", tags=["system"])
    def root() -> dict:
        return {"service": "camsense-ai-service", "version": "1.0.0"}

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
