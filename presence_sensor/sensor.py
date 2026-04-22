import json
import logging
import os
import time
from datetime import datetime, timezone

import cv2
import redis

PRESENCE_HEARTBEAT_CACHE_KEY = "memory_engine_presence_heartbeat"
PRESENCE_STATE_CACHE_KEY = "memory_engine_presence_state"
HEALTH_FILE_PATH = "/tmp/presence_sensor.last"


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    return int(value.strip())


def env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    return float(value.strip())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def touch_health_file() -> None:
    with open(HEALTH_FILE_PATH, "w", encoding="utf-8") as handle:
        handle.write(now_iso())


def resolve_camera_source(raw_device: str):
    trimmed = str(raw_device or "").strip()
    if not trimmed:
        return 0
    if trimmed.isdigit():
        return int(trimmed)
    return trimmed


def publish_presence_state(
    client: redis.Redis,
    *,
    ttl_seconds: int,
    present: bool,
    confidence: float,
    motion_score: float,
    sensor_error: str = "",
    publish_heartbeat: bool,
    update_health_file: bool,
) -> None:
    payload = {
        "captured_at": now_iso(),
        "source": "opencv-motion",
        "present": bool(present),
        "confidence": round(max(0.0, min(1.0, float(confidence))), 3),
        "motion_score": round(max(0.0, float(motion_score)), 6),
    }
    if sensor_error:
        payload["sensor_error"] = str(sensor_error).strip()[:240]

    client.set(PRESENCE_STATE_CACHE_KEY, json.dumps(payload), ex=ttl_seconds)
    if publish_heartbeat:
        client.set(PRESENCE_HEARTBEAT_CACHE_KEY, payload["captured_at"], ex=ttl_seconds)
    if update_health_file:
        touch_health_file()


def connect_redis(redis_url: str) -> redis.Redis:
    while True:
        try:
            client = redis.Redis.from_url(redis_url, decode_responses=True)
            client.ping()
            return client
        except Exception as exc:  # pragma: no cover - connectivity is environment-specific
            logging.warning("Redis is not ready for presence sensor: %s", exc)
            time.sleep(2.0)


def run_sensor_loop() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="[presence_sensor] %(asctime)s %(levelname)s: %(message)s",
    )

    if not env_bool("PRESENCE_SENSING_ENABLED", False):
        logging.info("Presence sensing is disabled by PRESENCE_SENSING_ENABLED=0")
        while True:
            touch_health_file()
            time.sleep(10.0)

    redis_url = str(os.getenv("REDIS_URL", "")).strip()
    if not redis_url:
        raise RuntimeError("REDIS_URL must be set for presence sensing.")

    heartbeat_max_age_seconds = max(5, env_int("OPS_PRESENCE_HEARTBEAT_MAX_AGE_SECONDS", 20))
    state_ttl_seconds = max(60, heartbeat_max_age_seconds * 4)
    frame_width = max(64, env_int("PRESENCE_FRAME_WIDTH", 640))
    frame_height = max(64, env_int("PRESENCE_FRAME_HEIGHT", 360))
    frame_interval_seconds = max(0.05, env_int("PRESENCE_FRAME_INTERVAL_MS", 500) / 1000.0)
    motion_ratio_threshold = max(0.0001, env_float("PRESENCE_MOTION_PIXEL_RATIO_THRESHOLD", 0.008))
    min_contour_area = max(0, env_int("PRESENCE_MOTION_MIN_CONTOUR_AREA", 1200))
    camera_source = resolve_camera_source(os.getenv("PRESENCE_CAMERA_DEVICE", "/dev/video0"))

    logging.info(
        "Presence sensor enabled (camera=%s width=%s height=%s threshold=%s interval=%.3fs)",
        camera_source,
        frame_width,
        frame_height,
        motion_ratio_threshold,
        frame_interval_seconds,
    )

    client = connect_redis(redis_url)

    while True:
        camera = cv2.VideoCapture(camera_source)
        if not camera.isOpened():
            logging.warning("Could not open camera source: %s", camera_source)
            try:
                publish_presence_state(
                    client,
                    ttl_seconds=state_ttl_seconds,
                    present=False,
                    confidence=0.0,
                    motion_score=0.0,
                    sensor_error="camera_unavailable",
                    publish_heartbeat=False,
                    update_health_file=False,
                )
            except Exception as exc:
                logging.warning("Failed publishing camera_unavailable state: %s", exc)
            time.sleep(2.0)
            continue

        logging.info("Camera stream opened.")
        previous_gray = None
        try:
            while True:
                ok, frame = camera.read()
                if not ok:
                    logging.warning("Camera frame read failed; reopening stream.")
                    break

                if frame_width > 0 and frame_height > 0:
                    frame = cv2.resize(frame, (frame_width, frame_height), interpolation=cv2.INTER_AREA)

                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                gray = cv2.GaussianBlur(gray, (21, 21), 0)
                if previous_gray is None:
                    previous_gray = gray
                    publish_presence_state(
                        client,
                        ttl_seconds=state_ttl_seconds,
                        present=False,
                        confidence=0.0,
                        motion_score=0.0,
                        publish_heartbeat=True,
                        update_health_file=True,
                    )
                    time.sleep(frame_interval_seconds)
                    continue

                diff = cv2.absdiff(previous_gray, gray)
                _, threshold_mask = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
                threshold_mask = cv2.dilate(threshold_mask, None, iterations=2)
                contours, _ = cv2.findContours(
                    threshold_mask,
                    cv2.RETR_EXTERNAL,
                    cv2.CHAIN_APPROX_SIMPLE,
                )

                moving_area = 0.0
                for contour in contours:
                    area = float(cv2.contourArea(contour))
                    if area >= min_contour_area:
                        moving_area += area

                total_area = float(gray.shape[0] * gray.shape[1]) or 1.0
                motion_score = moving_area / total_area
                present = motion_score >= motion_ratio_threshold
                confidence = min(1.0, motion_score / motion_ratio_threshold)

                publish_presence_state(
                    client,
                    ttl_seconds=state_ttl_seconds,
                    present=present,
                    confidence=confidence,
                    motion_score=motion_score,
                    publish_heartbeat=True,
                    update_health_file=True,
                )

                previous_gray = gray
                time.sleep(frame_interval_seconds)
        except Exception as exc:  # pragma: no cover - runtime hardware loop
            logging.exception("Presence sensor loop error: %s", exc)
            time.sleep(1.0)
        finally:
            camera.release()


if __name__ == "__main__":
    run_sensor_loop()
