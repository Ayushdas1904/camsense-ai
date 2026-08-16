"""Downloads the model weights and demo video the AI service needs.

These files are intentionally NOT committed to git (they're large binaries),
so run this once after installing dependencies:

    python download_assets.py

It fetches:
  - ../models/yolov8n.pt      (YOLOv8n weights, ~6 MB, via ultralytics)
  - samples/vtest.avi         (OpenCV pedestrian demo video, ~8 MB)
"""
import os
import shutil
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.normpath(os.path.join(HERE, "..", "models"))
SAMPLES_DIR = os.path.join(HERE, "samples")

VIDEO_URL = "https://github.com/opencv/opencv/raw/master/samples/data/vtest.avi"


def fetch_weights() -> None:
    target = os.path.join(MODELS_DIR, "yolov8n.pt")
    if os.path.exists(target):
        print(f"✓ weights already present: {target}")
        return
    os.makedirs(MODELS_DIR, exist_ok=True)
    print("Downloading YOLOv8n weights via ultralytics …")
    from ultralytics import YOLO

    YOLO("yolov8n.pt")  # downloads into CWD
    downloaded = os.path.join(os.getcwd(), "yolov8n.pt")
    if os.path.exists(downloaded):
        shutil.move(downloaded, target)
    print(f"✓ weights ready: {target}")


def fetch_video() -> None:
    target = os.path.join(SAMPLES_DIR, "vtest.avi")
    if os.path.exists(target):
        print(f"✓ sample video already present: {target}")
        return
    os.makedirs(SAMPLES_DIR, exist_ok=True)
    print("Downloading sample pedestrian video …")
    urllib.request.urlretrieve(VIDEO_URL, target)
    print(f"✓ sample video ready: {target}")


if __name__ == "__main__":
    fetch_weights()
    fetch_video()
    print("\nAll AI assets ready. You can now start the service:")
    print("  uvicorn app.main:app --reload")
