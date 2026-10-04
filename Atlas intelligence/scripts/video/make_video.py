"""
Build the City Atlas vision video from the screenshots that capture.mjs takes.

    python scripts/video/make_video.py SHOTS_DIR OUT.mp4 [--fonts DIR] [--preview]

Each screenshot becomes one scene: a slow zoom toward the part that matters, with a short caption
in simple English. A title card opens the video and an end card closes it. Scenes whose screenshot
is missing are skipped. --preview stamps every frame "TEST DATA" (use it when the screenshots come
from the offline test streets, not the live site).
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from collections import deque
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1920, 1080, 30
FADE_S = 0.6
INK = (32, 33, 36)
SOFT = (95, 99, 104)
BLUE = (15, 111, 255)
GREEN = (30, 142, 62)
ORANGE = (232, 113, 10)
RED = (217, 48, 37)
AMBER = (249, 171, 0)
PAPER = (250, 249, 246)


@dataclass
class Scene:
    shot: str
    kicker: str
    title: str
    line: str
    focus: tuple[float, float] = (0.5, 0.5)  # where the zoom heads, as a share of width and height
    zoom: float = 1.10
    seconds: float = 5.0
    caption_top: bool = False
    colour: tuple[int, int, int] = BLUE


SCENES = [
    Scene("01-map", "LOOK", "A living map of India", "Real streets from OpenStreetMap. Live traffic from TomTom. Nothing made up.", (0.5, 0.45), 1.08, 5.5),
    Scene("02-traffic", "LOOK", "Traffic in colours you already know", "Green moves, orange slows, red is stuck. Measured every minute.", (0.45, 0.4), 1.12),
    Scene("03-place", "LOOK", "Click any place. Understand it.", "A score with the reason for every part, and how sure we are.", (0.88, 0.4), 1.12),
    Scene("04-ask", "ASK", "Ask in plain words", "Ask Atlas answers only from measured facts, in English or Hindi.", (0.5, 0.72), 1.14),
    Scene("05-past", "TIME", "Go back in time", "The city keeps every reading. See what it looked like yesterday.", (0.5, 0.5), 1.06, caption_top=True),
    Scene("06-future", "TIME", "Look ahead", "A forecast from what each road usually does at this hour, marked as a forecast.", (0.5, 0.5), 1.06, caption_top=True),
    Scene("07-changed", "CHANGING?", "What changed today?", "Closures, unusual jams and new reports, ranked, each with its evidence.", (0.62, 0.3), 1.12, colour=ORANGE),
    Scene("08-route", "GO", "Go anywhere in India", "Routes with live traffic. The one with fewer reported incidents is marked.", (0.85, 0.35), 1.12, colour=GREEN),
    Scene("09-safe", "SAFE?", "Is it safe here?", "People report what they see. It says \"not verified\" until it is checked.", (0.85, 0.35), 1.12, colour=RED),
    Scene("10-ink", "SEE", "The city, drawn in ink", "Buildings in 3D as clean lines, ready to print or plot.", (0.4, 0.45), 1.10),
    Scene("11-vision", "ATLAS VISION", "Count, don't watch", "A phone camera counts people and vehicles as dots. No faces. Nothing stored.", (0.85, 0.3), 1.14),
    Scene("12-gentri", "CHANGING? · PRO", "Is this area changing?", "Two years of mapped shops, cafés and offices show which places are rising.", (0.85, 0.4), 1.12, colour=ORANGE),
    Scene("13-invest", "WORTH IT? · PRO", "Is it worth it?", "Yield, unused building rights, distress and new supply. Missing parts stay missing.", (0.88, 0.4), 1.12, colour=AMBER),
    Scene("14-sites", "PRO", "Find the right site", "Where should the next café, clinic or warehouse go?", (0.85, 0.35), 1.12),
    Scene("15-trackrecord", "TRUST", "Checked against what really happened", "We test our forecasts on past data and show the score, good or bad.", (0.85, 0.4), 1.12, colour=GREEN),
    Scene("16-status", "TRUST", "Every source: green or red", "If a feed is down, the app says so, and how to fix it.", (0.85, 0.4), 1.12, colour=GREEN),
    Scene("17-hindi", "FOR EVERYONE", "English or Hindi, one tap", "Simple words, so anyone can use it.", (0.5, 0.4), 1.08),
    Scene("18-night", "FOR EVERYONE", "Day or night", "The same city, easy on the eyes after dark.", (0.5, 0.45), 1.06),
]


class Fonts:
    def __init__(self, folder: Path | None):
        def load(names: list[str], size: int) -> ImageFont.FreeTypeFont:
            for n in names:
                for base in ([folder] if folder else []) + [Path("/usr/share/fonts/truetype/dejavu")]:
                    p = base / n
                    if p.exists():
                        return ImageFont.truetype(str(p), size)
            return ImageFont.load_default(size)
        bold, med, reg = ["DMSans-Bold.ttf", "DejaVuSans-Bold.ttf"], ["DMSans-Medium.ttf", "DejaVuSans.ttf"], ["DMSans-Regular.ttf", "DejaVuSans.ttf"]
        self.kicker = load(bold, 24)
        self.title = load(bold, 56)
        self.line = load(reg, 32)
        self.big = load(bold, 104)
        self.sub = load(med, 40)
        self.small = load(med, 26)


def rounded(draw: ImageDraw.ImageDraw, box, r, fill, outline=None, width=1):
    draw.rounded_rectangle(box, r, fill=fill, outline=outline, width=width)


def shadowed_card(base: Image.Image, box: tuple[int, int, int, int], radius: int = 28) -> None:
    x0, y0, x1, y1 = box
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x0, y0 + 10, x1, y1 + 10), radius, fill=(0, 0, 0, 70))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
    card = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle(box, radius, fill=(255, 255, 255, 246), outline=(218, 220, 224, 255), width=2)
    base.alpha_composite(card)


def caption_layer(s: Scene, f: Fonts) -> Image.Image:
    """The caption card for a scene, drawn once and laid over every frame of it."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    tw = max(d.textlength(s.title, font=f.title), d.textlength(s.line, font=f.line))
    cw, ch = int(tw + 112), 212
    x0 = 150
    y0 = 128 if s.caption_top else H - ch - 70
    shadowed_card(layer, (x0, y0, x0 + cw, y0 + ch))
    d = ImageDraw.Draw(layer)
    kw = d.textlength(s.kicker, font=f.kicker)
    rounded(d, (x0 + 52, y0 + 30, x0 + 52 + kw + 36, y0 + 72), 21, fill=s.colour)
    d.text((x0 + 70, y0 + 36), s.kicker, font=f.kicker, fill="white")
    d.text((x0 + 52, y0 + 84), s.title, font=f.title, fill=INK)
    d.text((x0 + 54, y0 + 154), s.line, font=f.line, fill=SOFT)
    return layer


def stamp_layer(f: Fonts, text: str) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    tw = d.textlength(text, font=f.small)
    rounded(d, (W - tw - 96, 92, W - 40, 142), 25, fill=(217, 48, 37, 235))
    d.text((W - tw - 68, 102), text, font=f.small, fill="white")
    return layer


def card_frame(f: Fonts, kicker: str, title: list[str], lines: list[str], foot: str) -> Image.Image:
    """Title and end cards: white paper, the five stone colours as a row of pebbles."""
    im = Image.new("RGBA", (W, H), PAPER + (255,))
    d = ImageDraw.Draw(im)
    for i, c in enumerate((BLUE, GREEN, RED, ORANGE, AMBER)):
        cx = 170 + i * 74
        d.ellipse((cx - 26, 200 - 26, cx + 26, 200 + 26), fill=c)
    d.text((140, 280), kicker, font=f.sub, fill=BLUE)
    y = 350
    for t in title:
        d.text((134, y), t, font=f.big, fill=INK); y += 124
    y += 30
    for ln in lines:
        d.text((140, y), ln, font=f.sub, fill=SOFT); y += 60
    d.text((140, H - 110), foot, font=f.small, fill=SOFT)
    return im


def scene_frames(img: Image.Image, s: Scene, overlay: Image.Image):
    n = int(s.seconds * FPS)
    fx, fy = s.focus
    for i in range(n):
        t = i / max(1, n - 1)
        e = t * t * (3 - 2 * t)  # ease in and out
        z = 1 + (s.zoom - 1) * e
        cw, ch = W / z, H / z
        cx = W / 2 + (fx * W - W / 2) * e
        cy = H / 2 + (fy * H - H / 2) * e
        x0 = min(max(0, cx - cw / 2), W - cw)
        y0 = min(max(0, cy - ch / 2), H - ch)
        fr = img.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch)).convert("RGBA")
        # the caption slides up and fades in over the first half second
        a = min(1.0, i / (0.5 * FPS))
        if a < 1:
            o = overlay.copy()
            o.putalpha(o.getchannel("A").point(lambda v: int(v * a)))
            off = int((1 - a) * 24)
            fr.alpha_composite(o, (0, off if not s.caption_top else -off))
        else:
            fr.alpha_composite(overlay)
        yield fr


def still_frames(img: Image.Image, seconds: float):
    for _ in range(int(seconds * FPS)):
        yield img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("shots", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--fonts", type=Path, default=None)
    ap.add_argument("--preview", action="store_true", help="stamp every frame TEST DATA")
    ap.add_argument("--url", default="infrashield-bengaluru.onrender.com")
    args = ap.parse_args()
    f = Fonts(args.fonts)
    stamp = stamp_layer(f, "TEST DATA PREVIEW · not real streets") if args.preview else None

    parts: list[tuple[str, object]] = []
    intro = card_frame(f, "CITY ATLAS · PRODUCT VISION", ["A living map of India", "that answers questions"],
                       ["Look. Go. Is it safe? Is it changing? Is it worth it?", "Real data only. Simple words. English and Hindi."], "October 2026")
    parts.append(("still", (intro, 4.5)))
    used = []
    for s in SCENES:
        p = args.shots / f"{s.shot}.png"
        if not p.exists():
            print("skip (no screenshot):", s.shot)
            continue
        img = Image.open(p).convert("RGB")
        if img.size != (W, H):
            img = img.resize((W, H), Image.LANCZOS)
        parts.append(("scene", (img, s, caption_layer(s, f))))
        used.append(s.shot)
    outro = card_frame(f, "CITY ATLAS", ["The intelligence layer", "for the physical world"],
                       ["A person understands their surroundings.", "A business understands its opportunities.", "A city understands itself."], args.url)
    parts.append(("still", (outro, 5.5)))

    def frames_of(kind, data):
        if kind == "still":
            return still_frames(*data)
        return scene_frames(*data)

    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(args.out)],
                          stdin=subprocess.PIPE)
    fade_n = int(FADE_S * FPS)
    tail: list[Image.Image] = []
    total = 0

    def emit(fr: Image.Image) -> None:
        nonlocal total
        if stamp is not None:
            fr = fr.copy(); fr.alpha_composite(stamp)
        ff.stdin.write(fr.convert("RGB").tobytes())
        total += 1

    for kind, data in parts:
        # crossfade: the previous part's last frames blend into this part's first ones; the
        # last few frames of this part are held back for the next blend (only those stay in memory)
        held: deque[Image.Image] = deque()
        for i, fr in enumerate(frames_of(kind, data)):
            if i < len(tail):
                fr = Image.blend(tail[i], fr, (i + 1) / (len(tail) + 1))
                emit(fr)
                continue
            held.append(fr)
            if len(held) > fade_n:
                emit(held.popleft())
        tail = list(held)
    for fr in tail:
        emit(fr)
    ff.stdin.close()
    if ff.wait() != 0:
        sys.exit("ffmpeg failed")
    print(f"wrote {args.out}: {total / FPS:.1f} s, {len(used)} scenes: {', '.join(used)}")


if __name__ == "__main__":
    main()
