#!/usr/bin/env python3
"""Bake Screen Studio timeline speed + cursor into ask-terra.mp4."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

PROJECT = Path(
    "/Users/user/Screen Studio Projects/Area 2026-08-04 17:33:41.screenstudio"
)
REC = PROJECT / "recording"
SRC = REC / "channel-1-display-0.mp4"
OUT = Path(
    "/Users/user/projects/Terra/web/public/videos/landing/ask-terra.mp4"
)

VW, VH = 2330, 1390
OX, OY = 2500.0, 323.0
SCALE = 2.0
CURSOR_MUL = 2.0 * 1.037
PROCESS_START = 750.5237916484475
FPS = 30  # output fps — enough for pointer + smaller render


def src_sec(ms: float) -> float:
    """Recording ms → seconds in the source mp4."""
    return max(0.0, (ms - PROCESS_START) / 1000.0)


def main() -> None:
    project = json.loads((PROJECT / "project.json").read_text())["json"]
    scene = project["scenes"][0]
    slices = scene["slices"]
    moves = json.loads((REC / "mousemoves-0.json").read_text())
    cursors_meta = {
        c["id"]: c for c in json.loads((REC / "cursors.json").read_text())
    }
    zoom_ranges = [
        z for z in scene.get("zoomRanges", []) if not z.get("isDisabled")
    ]

    # --- 1) speed-adjusted concat from timeline slices ---
    filter_parts: list[str] = []
    concat_inputs: list[str] = []
    for i, sl in enumerate(slices):
        ss = src_sec(sl["sourceStartMs"])
        ee = src_sec(sl["sourceEndMs"])
        rate = float(sl["timeScale"]) or 1.0
        # timeScale < 1 = slow-mo → stretch PTS
        filter_parts.append(
            f"[0:v]trim=start={ss}:end={ee},setpts=(PTS-STARTPTS)/{rate}[v{i}]"
        )
        concat_inputs.append(f"[v{i}]")
    n = len(slices)
    filter_parts.append(
        f"{''.join(concat_inputs)}concat=n={n}:v=1:a=0[vspeed]"
    )
    speed_filter = ";".join(filter_parts)

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        speed_mp4 = td_path / "speed.mp4"
        cmd = [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(SRC),
            "-filter_complex",
            speed_filter,
            "-map",
            "[vspeed]",
            "-r",
            str(FPS),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            "16",
            "-preset",
            "fast",
            str(speed_mp4),
        ]
        print("rendering speed timeline…", flush=True)
        subprocess.run(cmd, check=True)

        # Probe output duration / frames
        probe = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=nb_frames,duration",
                "-of",
                "json",
                str(speed_mp4),
            ],
            text=True,
        )
        meta = json.loads(probe)["streams"][0]
        duration = float(meta.get("duration") or 0)
        nframes = int(meta.get("nb_frames") or round(duration * FPS))
        print(f"speed video: {duration:.2f}s, ~{nframes} frames", flush=True)

        # Map output time → source process time through slices
        # timeline_ms accumulates out_dur = src_dur / rate
        timeline_spans: list[tuple[float, float, float, float]] = []
        # (out_start_ms, out_end_ms, src_start_ms, rate)
        out_cursor = 0.0
        for sl in slices:
            src_dur = sl["sourceEndMs"] - sl["sourceStartMs"]
            rate = float(sl["timeScale"]) or 1.0
            out_dur = src_dur / rate
            timeline_spans.append(
                (out_cursor, out_cursor + out_dur, sl["sourceStartMs"], rate)
            )
            out_cursor += out_dur

        def out_ms_to_src_ms(out_ms: float) -> float:
            for o0, o1, s0, rate in timeline_spans:
                if out_ms <= o1 or o1 == timeline_spans[-1][1]:
                    return s0 + (out_ms - o0) * rate
            o0, o1, s0, rate = timeline_spans[-1]
            return s0 + (out_ms - o0) * rate

        # Preload cursors
        cursor_imgs: dict[str, dict] = {}
        for cid, info in cursors_meta.items():
            png = REC / "cursors" / f"{cid}.png"
            if not png.exists():
                continue
            im = Image.open(png).convert("RGBA")
            tw = max(1, int(round(info["standardSize"]["width"] * CURSOR_MUL)))
            th = max(1, int(round(info["standardSize"]["height"] * CURSOR_MUL)))
            cursor_imgs[cid] = {
                "im": im.resize((tw, th), Image.Resampling.LANCZOS),
                "hx": info["hotSpot"]["x"] * CURSOR_MUL,
                "hy": info["hotSpot"]["y"] * CURSOR_MUL,
            }
        default_c = (
            "arrow"
            if "arrow" in cursor_imgs
            else next(iter(cursor_imgs))
        )

        # Which slices hide the cursor?
        hide_ranges = [
            (sl["sourceStartMs"], sl["sourceEndMs"])
            for sl in slices
            if sl.get("hideCursor")
        ]

        def cursor_hidden(src_ms: float) -> bool:
            return any(a <= src_ms <= b for a, b in hide_ranges)

        def zoom_at(src_ms: float) -> float:
            for z in zoom_ranges:
                if z["startTime"] <= src_ms <= z["endTime"]:
                    return float(z["zoom"])
            return 1.0

        # Sample moves for each output frame
        mi = 0
        positions: list[tuple[float, float, str, bool, float, float]] = []
        for i in range(nframes):
            out_ms = (i / FPS) * 1000.0
            src_ms = out_ms_to_src_ms(out_ms)
            while mi + 1 < len(moves) and moves[mi + 1]["processTimeMs"] <= src_ms:
                mi += 1
            m = moves[mi]
            vx = (m["x"] - OX) * SCALE
            vy = (m["y"] - OY) * SCALE
            positions.append(
                (
                    vx,
                    vy,
                    m.get("cursorId") or default_c,
                    cursor_hidden(src_ms),
                    zoom_at(src_ms),
                    src_ms,
                )
            )

        print("compositing cursor + zoom…", flush=True)
        dec = subprocess.Popen(
            [
                "ffmpeg",
                "-v",
                "error",
                "-i",
                str(speed_mp4),
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "-s",
                f"{VW}x{VH}",
                "-",
            ],
            stdout=subprocess.PIPE,
        )
        enc = subprocess.Popen(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "-s",
                f"{VW}x{VH}",
                "-r",
                str(FPS),
                "-i",
                "-",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                "16",
                "-preset",
                "fast",
                "-movflags",
                "+faststart",
                str(OUT),
            ],
            stdin=subprocess.PIPE,
        )
        assert dec.stdout and enc.stdin
        frame_size = VW * VH * 4
        for i in range(nframes):
            raw = dec.stdout.read(frame_size)
            if len(raw) < frame_size:
                print("short frame", i, len(raw), flush=True)
                break
            frame = Image.frombytes("RGBA", (VW, VH), raw)
            vx, vy, cid, hidden, zoom, _src_ms = positions[i]

            # Timeline zoom — crop toward pointer, then scale back to frame.
            if zoom > 1.01:
                cw = max(2, int(VW / zoom))
                ch = max(2, int(VH / zoom))
                # Keep even dims for clean scale
                cw -= cw % 2
                ch -= ch % 2
                left = int(round(vx - cw / 2))
                top = int(round(vy - ch / 2))
                left = max(0, min(VW - cw, left))
                top = max(0, min(VH - ch, top))
                # Cursor coords after zoom
                vx = (vx - left) * (VW / cw)
                vy = (vy - top) * (VH / ch)
                frame = frame.crop((left, top, left + cw, top + ch)).resize(
                    (VW, VH), Image.Resampling.LANCZOS
                )

            if not hidden:
                cur = cursor_imgs.get(cid) or cursor_imgs.get(default_c)
                if cur:
                    x = int(round(vx - cur["hx"]))
                    y = int(round(vy - cur["hy"]))
                    frame.paste(cur["im"], (x, y), cur["im"])
            enc.stdin.write(frame.tobytes())
            if i % 200 == 0:
                print(f"  frame {i}/{nframes}", flush=True)
        enc.stdin.close()
        dec.wait()
        rc = enc.wait()
        if rc != 0:
            raise SystemExit(f"encode failed: {rc}")
        print("wrote", OUT, OUT.stat().st_size, flush=True)


if __name__ == "__main__":
    main()
