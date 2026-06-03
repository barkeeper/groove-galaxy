#!/usr/bin/env python
"""Stage 2 — pose extraction.

Reads a video file frame-by-frame with OpenCV, runs MediaPipe PoseLandmarker
(Tasks API, VIDEO running mode) and emits the intermediate landmarks JSON
consumed by retarget.mjs.

JSON contract (see openspec/changes/video-to-dance/design.md):
{
  "id": str, "fps": float, "width": int, "height": int,
  "frames": [ { "t": sec, "world": [[x,y,z]*33], "vis": [v*33] }, ... ]
}

world landmarks are MediaPipe axes: +x = subject's right in image, +y = down,
+z = toward camera, origin = midpoint of hips, units = metres.

Usage:
  python pose.py --video tmp/hiphop.mp4 --id hiphop \
      --out out/hiphop.landmarks.json --model models/pose_landmarker_heavy.task
"""
import argparse, json, os, sys
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision


def log(*a):
    print("[pose]", *a, file=sys.stderr, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--max-fps", type=float, default=30.0,
                    help="cap sampling rate; frames beyond this are skipped")
    ap.add_argument("--min-conf", type=float, default=0.5)
    args = ap.parse_args()

    if not os.path.isfile(args.video):
        log("video not found:", args.video); sys.exit(2)
    if not os.path.isfile(args.model):
        log("model not found:", args.model); sys.exit(2)

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        log("cannot open video:", args.video); sys.exit(2)
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    log(f"src fps={src_fps:.3f} frames={n_frames} {width}x{height}")

    # decimate to <= max_fps
    stride = max(1, round(src_fps / args.max_fps)) if args.max_fps > 0 else 1
    out_fps = src_fps / stride
    log(f"stride={stride} out_fps={out_fps:.3f}")

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=args.model),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=args.min_conf,
        min_pose_presence_confidence=args.min_conf,
        min_tracking_confidence=args.min_conf,
        output_segmentation_masks=False,
    )
    landmarker = vision.PoseLandmarker.create_from_options(options)

    frames = []
    idx = 0
    kept = 0
    missed = 0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        if idx % stride != 0:
            idx += 1
            continue
        t = idx / src_fps
        ts_ms = int(round(t * 1000))
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        res = landmarker.detect_for_video(mp_img, ts_ms)
        if res.pose_world_landmarks and len(res.pose_world_landmarks) > 0:
            lms = res.pose_world_landmarks[0]
            world = [[lm.x, lm.y, lm.z] for lm in lms]
            vis = [getattr(lm, "visibility", 1.0) for lm in lms]
            # normalized image landmarks (0..1, y down) — used to recover global hip translation
            # (jumps / squats / sway) that the hip-centred world landmarks throw away.
            img = None
            if res.pose_landmarks and len(res.pose_landmarks) > 0:
                il = res.pose_landmarks[0]
                img = [[lm.x, lm.y, lm.z] for lm in il]
            frames.append({"t": round(t, 4), "world": world, "img": img, "vis": vis})
            kept += 1
        else:
            missed += 1
        idx += 1
        if kept and kept % 60 == 0:
            log(f"  {kept} poses ({missed} missed)…")

    cap.release()
    landmarker.close()
    log(f"done: {kept} poses, {missed} frames had no pose")

    if kept == 0:
        log("no poses detected — wrong video / no person?"); sys.exit(3)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({
            "id": args.id,
            "fps": round(out_fps, 4),
            "width": width, "height": height,
            "frames": frames,
        }, f)
    log("wrote", args.out, f"({kept} frames)")


if __name__ == "__main__":
    main()
