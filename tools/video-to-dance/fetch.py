#!/usr/bin/env python
"""Stage 1 — fetch video + extract loudness-normalised MP3.

Downloads a YouTube video with yt-dlp into tmp/<id>.mp4, then extracts the
audio and runs a two-pass EBU R128 loudnorm (I=-16, TP=-1.5, LRA=11) to
music/<id>.mp3 — matching every existing track in the project.

Usage:
  python fetch.py --url <youtube-url> --id hiphop \
      --tmp ../../tmp --music ../../music
"""
import argparse, json, os, re, shutil, subprocess, sys

def log(*a): print("[fetch]", *a, file=sys.stderr, flush=True)

def resolve_ffmpeg(explicit):
    if explicit and explicit != "ffmpeg":
        return explicit
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:                                   # bundled static build (no system install needed)
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        log("ffmpeg not found and imageio-ffmpeg missing; pip install imageio-ffmpeg")
        sys.exit(2)

def run(cmd, **kw):
    log("$", " ".join(cmd))
    return subprocess.run(cmd, **kw)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--tmp", default="tmp")
    ap.add_argument("--music", default="music")
    ap.add_argument("--ffmpeg", default="ffmpeg")
    args = ap.parse_args()
    ffmpeg = resolve_ffmpeg(args.ffmpeg)
    log("ffmpeg:", ffmpeg)

    os.makedirs(args.tmp, exist_ok=True)
    os.makedirs(args.music, exist_ok=True)
    video_out = os.path.join(args.tmp, f"{args.id}.mp4")
    mp3_out = os.path.join(args.music, f"{args.id}.mp3")

    # 1. download best video+audio, mux to mp4
    r = run([sys.executable, "-m", "yt_dlp",
             "-f", "bv*+ba/b",
             "--merge-output-format", "mp4",
             "--ffmpeg-location", ffmpeg,
             "--no-playlist",
             "-o", os.path.join(args.tmp, f"{args.id}.%(ext)s"),
             args.url])
    if r.returncode != 0 or not os.path.isfile(video_out):
        # yt-dlp may have produced .mkv/.webm; find it
        cand = [f for f in os.listdir(args.tmp)
                if f.startswith(args.id + ".") and not f.endswith(".part")]
        vids = [f for f in cand if os.path.splitext(f)[1] in (".mp4", ".mkv", ".webm")]
        if not vids:
            log("download failed"); sys.exit(2)
        video_out = os.path.join(args.tmp, vids[0])
    log("video:", video_out)

    # 2. measure loudness (pass 1)
    p1 = run([ffmpeg, "-hide_banner", "-i", video_out, "-vn",
              "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
              "-f", "null", "-"],
             capture_output=True, text=True)
    m = re.search(r"\{[^{}]*\"input_i\"[\s\S]*?\}", p1.stderr)
    if not m:
        log("loudnorm measure failed; falling back to single-pass")
        meas = None
    else:
        meas = json.loads(m.group(0))
        log("measured:", {k: meas[k] for k in ("input_i", "input_tp", "input_lra", "input_thresh")})

    # 3. apply (pass 2) -> mp3
    if meas:
        af = (f"loudnorm=I=-16:TP=-1.5:LRA=11:"
              f"measured_I={meas['input_i']}:measured_TP={meas['input_tp']}:"
              f"measured_LRA={meas['input_lra']}:measured_thresh={meas['input_thresh']}:"
              f"offset={meas.get('target_offset', 0)}:linear=true:print_format=summary")
    else:
        af = "loudnorm=I=-16:TP=-1.5:LRA=11"
    tmp_mp3 = mp3_out + ".tmp.mp3"
    r2 = run([ffmpeg, "-hide_banner", "-y", "-i", video_out, "-vn",
              "-af", af, "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k",
              tmp_mp3])
    if r2.returncode != 0 or not os.path.isfile(tmp_mp3):
        log("audio extract failed"); 
        if os.path.exists(tmp_mp3): os.remove(tmp_mp3)
        sys.exit(2)
    os.replace(tmp_mp3, mp3_out)
    log("wrote", mp3_out)
    # echo the resolved video path on stdout for the orchestrator
    print(os.path.abspath(video_out))

if __name__ == "__main__":
    main()
