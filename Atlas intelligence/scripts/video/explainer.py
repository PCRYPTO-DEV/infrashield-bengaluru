"""
City Atlas explainer video: a spoken walk-through (about two and a half minutes) with subtitles,
drawn diagrams of how City Atlas knows things, and app screens for the five stones.

    python scripts/video/explainer.py SHOTS_DIR OUT.mp4 --voice VOICE.onnx [--piper PIPER] [--fonts DIR] [--preview]

SHOTS_DIR holds the screenshots from capture.mjs. The voice is a Piper TTS model; the default
speaker of en-us-libritts-high (LibriTTS, CC BY 4.0) is credited on the end card. Every sentence is
spoken separately so the subtitles and the pictures follow the voice exactly. --preview marks the
app screens "TEST DATA" (use it when the screenshots come from the offline test streets).
"""
from __future__ import annotations

import argparse
import array
import math
import subprocess
import sys
import tempfile
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1920, 1080, 30
SR = 22050
GAP_S = 0.28        # pause between sentences
TAIL_S = 0.7        # pause at the end of a scene
FADE_S = 0.45
PAPER = (250, 249, 246)
INK = (32, 33, 36)
SOFT = (95, 99, 104)
HAIR = (218, 220, 224)
BLUE, GREEN, RED, ORANGE, AMBER, GREY = (15, 111, 255), (30, 142, 62), (217, 48, 37), (232, 113, 10), (249, 171, 0), (154, 160, 166)
STONES = [("look", "Look", BLUE), ("go", "Go", GREEN), ("safe", "Safe?", RED), ("change", "Changing?", ORANGE), ("worth", "Worth it?", AMBER)]


# ---------------------------------------------------------------- drawing helpers

class Fonts:
    def __init__(self, folder: Path | None):
        def load(names, size):
            for n in names:
                for base in ([folder] if folder else []) + [Path("/usr/share/fonts/truetype/dejavu")]:
                    if (base / n).exists():
                        return ImageFont.truetype(str(base / n), size)
            return ImageFont.load_default(size)
        self.bold = lambda s: load(["DMSans-Bold.ttf", "DejaVuSans-Bold.ttf"], s)
        self.med = lambda s: load(["DMSans-Medium.ttf", "DejaVuSans.ttf"], s)
        self.reg = lambda s: load(["DMSans-Regular.ttf", "DejaVuSans.ttf"], s)


F: Fonts


def ease(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def back(t: float) -> float:
    """Ease out with a small overshoot, for things that pop in."""
    t = min(1.0, max(0.0, t))
    c = 1.70158
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2


def sprite(w: int, h: int, draw: Callable[[ImageDraw.ImageDraw, int], None]) -> Image.Image:
    """Draw at twice the size and shrink, so edges are smooth."""
    big = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
    draw(ImageDraw.Draw(big), 2)
    return big.resize((w, h), Image.LANCZOS)


def put(frame: Image.Image, spr: Image.Image, cx: float, cy: float, alpha: float = 1.0, scale: float = 1.0) -> None:
    """Paste a sprite centred at (cx, cy) with an opacity and a scale."""
    if alpha <= 0.01 or scale <= 0.01:
        return
    s = spr
    if abs(scale - 1) > 0.01:
        s = spr.resize((max(1, int(spr.width * scale)), max(1, int(spr.height * scale))), Image.BILINEAR)
    if alpha < 0.99:
        s = s.copy()
        s.putalpha(s.getchannel("A").point(lambda v: int(v * alpha)))
    frame.alpha_composite(s, (int(cx - s.width / 2), int(cy - s.height / 2)))


def shadow_card(w: int, h: int, r: int = 28, fill=(255, 255, 255), outline=HAIR, pad: int = 40) -> Image.Image:
    im = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((pad, pad + 10, pad + w, pad + h + 10), r, fill=(0, 0, 0, 60))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(16)))
    card = sprite(w, h, lambda d, k: d.rounded_rectangle((0, 0, w * k - 1, h * k - 1), r * k, fill=fill + (255,), outline=outline + (255,), width=2 * k))
    im.alpha_composite(card, (pad, pad))
    return im


def text_sprite(text: str, font: ImageFont.FreeTypeFont, fill=INK) -> Image.Image:
    box = font.getbbox(text)
    im = Image.new("RGBA", (box[2] + 8, box[3] + 12), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((4, 0), text, font=font, fill=fill)
    return im


def stone_sprite(kind: str, colour, size: int = 140) -> Image.Image:
    """The five stones: a coloured pebble with a white sign, as in the app's dock."""
    def draw(d: ImageDraw.ImageDraw, k: int):
        s = size * k
        d.ellipse((0, 0, s - 1, s - 1), fill=colour + (255,))
        c, u = s / 2, s / 100
        wcol = (255, 255, 255, 255)
        if kind == "look":
            for r in (30, 18):
                d.ellipse((c - r * u, c - r * u, c + r * u, c + r * u), outline=wcol, width=int(7 * u))
            d.ellipse((c - 6 * u, c - 6 * u, c + 6 * u, c + 6 * u), fill=wcol)
        elif kind == "go":
            pts = [(c - 24 * u, c + 22 * u), (c - 24 * u, c + 4 * u), (c + 22 * u, c + 4 * u), (c + 22 * u, c - 20 * u)]
            d.line(pts, fill=wcol, width=int(10 * u), joint="curve")
            for p in (pts[0], pts[-1]):
                d.ellipse((p[0] - 9 * u, p[1] - 9 * u, p[0] + 9 * u, p[1] + 9 * u), fill=wcol)
        elif kind == "safe":
            hexa = [(c + 30 * u * math.cos(math.radians(60 * i - 90)), c + 30 * u * math.sin(math.radians(60 * i - 90))) for i in range(6)]
            d.polygon(hexa, outline=wcol, width=int(8 * u))
            d.ellipse((c - 8 * u, c - 8 * u, c + 8 * u, c + 8 * u), fill=wcol)
        elif kind == "change":
            for i, (dx, dy, r) in enumerate([(-18, 14, 11), (2, -2, 13), (20, -20, 15)]):
                d.rounded_rectangle((c + (dx - r) * u, c + (dy - r) * u, c + (dx + r) * u, c + (dy + r) * u), 3 * u, fill=wcol)
        elif kind == "worth":
            for i, hgt in enumerate((18, 32, 46)):
                x = c - 26 * u + i * 20 * u
                d.rounded_rectangle((x, c + 24 * u - hgt * u, x + 13 * u, c + 24 * u), 3 * u, fill=wcol)
    return sprite(size, size, draw)


def chip_sprite(text: str, colour, font=None, dashed=False) -> Image.Image:
    font = font or F.bold(30)
    tw = font.getlength(text)
    w, h = int(tw + 56), 60
    def draw(d, k):
        if dashed:
            d.rounded_rectangle((0, 0, w * k - 1, h * k - 1), 30 * k, fill=(255, 255, 255, 255), outline=GREY + (255,), width=3 * k)
        else:
            d.rounded_rectangle((0, 0, w * k - 1, h * k - 1), 30 * k, fill=colour + (255,))
        d.text((28 * k, 10 * k), text, font=font.font_variant(size=font.size * k), fill=(GREY if dashed else (255, 255, 255)) + (255,))
    return sprite(w, h, draw)


_masks: dict[tuple[int, int], Image.Image] = {}


def screen_frame(shot: Image.Image, t: float, focus=(0.5, 0.5), zoom=1.12, box=(1500, 844), preview=False) -> Image.Image:
    """An app screen in a rounded window, slowly zooming toward the part that matters."""
    bw, bh = box
    e = ease(t)
    z = 1 + (zoom - 1) * e
    sw, sh = shot.size
    cw, ch = sw / z, sh / z
    cx = sw / 2 + (focus[0] * sw - sw / 2) * e
    cy = sh / 2 + (focus[1] * sh - sh / 2) * e
    x0 = min(max(0, cx - cw / 2), sw - cw)
    y0 = min(max(0, cy - ch / 2), sh - ch)
    inner = shot.resize((bw, bh), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch)).convert("RGBA")
    if box not in _masks:
        _masks[box] = sprite(bw, bh, lambda d, k: d.rounded_rectangle((0, 0, bw * k - 1, bh * k - 1), 22 * k, fill=(255, 255, 255, 255))).getchannel("A")
    inner.putalpha(_masks[box])
    if preview:
        d = ImageDraw.Draw(inner)
        f = F.bold(22)
        txt = "TEST DATA · made-up streets"
        tw = f.getlength(txt)
        d.rounded_rectangle((bw - tw - 60, 18, bw - 18, 60), 21, fill=RED + (235,))
        d.text((bw - tw - 39, 25), txt, font=f, fill="white")
    return inner


def wrap(text: str, font, width: int) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        nxt = (cur + " " + word).strip()
        if font.getlength(nxt) <= width:
            cur = nxt
        else:
            lines.append(cur); cur = word
    if cur:
        lines.append(cur)
    return lines


_sub_cache: dict[str, Image.Image] = {}


def subtitle(text: str) -> Image.Image:
    if text in _sub_cache:
        return _sub_cache[text]
    f = F.med(36)
    lines = wrap(text, f, 1400)
    lh = 50
    w = int(max(f.getlength(ln) for ln in lines) + 64)
    h = lh * len(lines) + 30
    def draw(d, k):
        d.rounded_rectangle((0, 0, w * k - 1, h * k - 1), 18 * k, fill=(32, 33, 36, 215))
        for i, ln in enumerate(lines):
            d.text((32 * k, (12 + i * lh) * k), ln, font=f.font_variant(size=36 * k), fill=(255, 255, 255, 255))
    _sub_cache[text] = sprite(w, h, draw)
    return _sub_cache[text]


def paper() -> Image.Image:
    im = Image.new("RGBA", (W, H), PAPER + (255,))
    d = ImageDraw.Draw(im)
    for x in range(40, W, 48):
        for y in range(40, H, 48):
            d.point((x, y), fill=(226, 224, 218, 255))
    return im


PAPER_BG: Image.Image


# ---------------------------------------------------------------- scenes

@dataclass
class Scene:
    name: str
    lines: list[str]
    draw: Callable[["Ctx"], Image.Image]
    starts: list[float] = field(default_factory=list)   # when each sentence starts, seconds into the scene
    ends: list[float] = field(default_factory=list)
    dur: float = 0.0


@dataclass
class Ctx:
    t: float            # seconds into the scene
    scene: Scene
    shots: dict[str, Image.Image]
    preview: bool

    def at(self, i: int) -> float:
        """Seconds since sentence i started (negative before it)."""
        return self.t - self.scene.starts[min(i, len(self.scene.starts) - 1)]

    @property
    def p(self) -> float:
        return self.t / max(0.01, self.scene.dur)


_cache: dict[str, Image.Image] = {}


def cached(key: str, make: Callable[[], Image.Image]) -> Image.Image:
    if key not in _cache:
        _cache[key] = make()
    return _cache[key]


def heading(fr: Image.Image, text: str, c: Ctx, y: int = 120, colour=INK, size: int = 64) -> None:
    s = cached(f"h:{text}:{size}", lambda: text_sprite(text, F.bold(size), colour))
    a = ease(c.t / 0.5)
    put(fr, s, W / 2, y + (1 - a) * 20, a)


def draw_hook(c: Ctx) -> Image.Image:
    fr = PAPER_BG.copy()
    # a plain map pin in the middle, questions popping around it
    pin = cached("pin", lambda: sprite(160, 220, lambda d, k: (d.ellipse((10 * k, 0, 150 * k, 140 * k), fill=RED + (255,)), d.polygon([(22 * k, 100 * k), (138 * k, 100 * k), (80 * k, 215 * k)], fill=RED + (255,)), d.ellipse((50 * k, 40 * k, 110 * k, 100 * k), fill=(255, 255, 255, 255)))))
    put(fr, pin, W / 2, 520, ease(c.t / 0.6), back(c.t / 0.7))
    qs = [("How bad is the traffic?", 520, 300, 1), ("Is it safe?", 1420, 320, 1), ("Is this area getting better?", 470, 760, 2), ("Is it worth it?", 1430, 740, 2)]
    for j, (q, x, y, i) in enumerate(qs):
        tt = c.at(i) - 0.35 * (j % 2)
        if tt > 0:
            s = cached(f"q:{q}", lambda q=q: _bubble(q))
            put(fr, s, x, y, ease(tt / 0.4), back(tt / 0.5))
    tt = c.at(3)
    if tt > 0:  # "a normal map shows where things are" — the bubbles grey out
        veil = Image.new("RGBA", (W, H), PAPER + (int(238 * ease(tt / 0.6)),))
        fr.alpha_composite(veil)
        put(fr, cached("where", lambda: text_sprite("A map shows where.", F.bold(72), SOFT)), W / 2, 470, ease(tt / 0.5))
    tt = c.at(4)
    if tt > 0:
        put(fr, cached("means", lambda: text_sprite("Not what it means.", F.bold(72), RED)), W / 2, 580, ease(tt / 0.5))
    return fr


def _bubble(q: str) -> Image.Image:
    f = F.bold(40)
    w, h = int(f.getlength(q) + 80), 96
    im = shadow_card(w, h, 48, outline=BLUE)
    ImageDraw.Draw(im).text((80, 62), q, font=f, fill=INK)
    return im


def draw_meet(c: Ctx) -> Image.Image:
    fr = PAPER_BG.copy()
    shift = ease((c.at(1) - 0.2) / 0.9)   # the title rises, the app slides in under it
    for i, (k, _, col) in enumerate(STONES):
        tt = c.t - 0.12 * i
        # the stones and the title shrink into one row at the top while the app slides in below
        x = (W / 2 - 230 + i * 115) * (1 - shift) + (640 + i * 60) * shift
        put(fr, cached(f"stone:{k}:90", lambda k=k, col=col: stone_sprite(k, col, 90)), x, 300 - 190 * shift, ease(tt / 0.4), back(tt / 0.5) * (1 - 0.4 * shift))
    put(fr, cached("ttl", lambda: text_sprite("City Atlas", F.bold(110))), W / 2 + 230 * shift, 450 - 340 * shift, ease(c.t / 0.6), 1 - 0.35 * shift)
    put(fr, cached("sub", lambda: text_sprite("A living map of India that answers your questions", F.med(44), SOFT)), W / 2, 560 - 330 * shift, ease((c.t - 0.4) / 0.6) * (1 - shift))
    if shift > 0 and "01-map" in c.shots:
        win = screen_frame(c.shots["01-map"], (c.t - c.scene.starts[1]) / max(1, c.scene.dur - c.scene.starts[1]), (0.5, 0.45), 1.06, (1400, 788), c.preview)
        put(fr, cached("win1400", lambda: shadow_card(1400, 788, 22)), W / 2, 600 + (1 - shift) * 300, shift)
        put(fr, win, W / 2, 600 + (1 - shift) * 300, shift)
    return fr


SOURCES = [("OpenStreetMap", "streets and places", GREEN), ("TomTom", "live traffic", RED), ("Open-Meteo", "weather and air", BLUE), ("News headlines", "what is reported", ORANGE), ("People", "reports from the street", AMBER)]


def _source_card(name: str, what: str, col) -> Image.Image:
    im = shadow_card(500, 120, 24)
    d = ImageDraw.Draw(im)
    d.ellipse((70, 82, 106, 118), fill=col)
    d.text((128, 66), name, font=F.bold(38), fill=INK)
    d.text((128, 112), what, font=F.reg(28), fill=SOFT)
    return im


def _hub() -> Image.Image:
    def draw(d, k):
        s = 380 * k
        d.ellipse((0, 0, s - 1, s - 1), fill=(255, 255, 255, 255), outline=BLUE + (255,), width=6 * k)
        f = F.bold(48 * k)
        tw = f.getlength("City Atlas")
        d.text(((s - tw) / 2, 150 * k), "City Atlas", font=f, fill=INK + (255,))
        for i, (_, _, col) in enumerate(STONES):
            x = s / 2 - 100 * k + i * 50 * k
            d.ellipse((x - 16 * k, 240 * k, x + 16 * k, 272 * k), fill=col + (255,))
    return sprite(380, 380, draw)


def draw_sources(c: Ctx) -> Image.Image:
    fr = PAPER_BG.copy()
    hub_x, hub_y = 1380, 540
    put(fr, cached("hub", _hub), hub_x, hub_y, ease(c.t / 0.5), back(c.t / 0.6))
    d = ImageDraw.Draw(fr)
    for i, (name, what, col) in enumerate(SOURCES):
        # OpenStreetMap, TomTom, Open-Meteo appear with their sentences; news and people share one
        tt = c.at(i + 1) if i < 4 else c.at(4) - 1.6
        y = 140 + i * 168
        if tt <= 0:
            continue
        a = ease(tt / 0.4)
        # the line from the source to the city grows, then a dot travels along it
        g = ease((tt - 0.2) / 0.6)
        x0, x1 = 620, hub_x - 190
        if g > 0:
            xe = x0 + (x1 - x0) * g
            ye = y + (hub_y - y) * g
            d.line([(x0, y), (xe, ye)], fill=col, width=5)
            dot = (c.t * 0.6 + i * 0.17) % 1
            if g >= 1:
                px, py = x0 + (x1 - x0) * dot, y + (hub_y - y) * dot
                d.ellipse((px - 9, py - 9, px + 9, py + 9), fill=col)
        put(fr, cached(f"src:{name}", lambda n=name, w=what, cc=col: _source_card(n, w, cc)), 360 - (1 - a) * 40, y, a)
    tt = c.at(5)
    if tt > 0:
        put(fr, cached("nothing", lambda: chip_sprite("Nothing made up", GREEN)), hub_x, 790, ease(tt / 0.4), back(tt / 0.5))
    tt = c.at(6)
    if tt > 0:
        put(fr, cached("nodata", lambda: chip_sprite("no data", GREY, dashed=True)), hub_x, 870, ease(tt / 0.4), back(tt / 0.5))
    return fr


def draw_memory(c: Ctx) -> Image.Image:
    fr = PAPER_BG.copy()
    heading(fr, "City memory", c)
    # four past Mondays at nine (grey dots in a row) make "usual"; today stands apart
    labels = ["Mon 9:00", "Mon 9:00", "Mon 9:00", "Mon 9:00"]
    for i, lb in enumerate(labels):
        tt = c.t - 0.3 - 0.35 * i
        x = 360 + i * 240
        put(fr, cached("cal", lambda: _calendar(GREY)), x, 470, ease(tt / 0.4), back(tt / 0.5))
        put(fr, cached(f"lb:{lb}", lambda lb=lb: text_sprite(lb, F.med(30), SOFT)), x, 600, ease(tt / 0.4))
    tt = c.at(1)
    if tt > 0:
        d = ImageDraw.Draw(fr)
        a = ease(tt / 0.6)
        d.rounded_rectangle((250, 660, 250 + int(940 * a), 676), 8, fill=GREY)
        put(fr, cached("usual", lambda: text_sprite("what is usual", F.bold(40), SOFT)), 720, 730, a)
    tt = c.at(2)
    if tt > 0:
        put(fr, cached("cal-today", lambda: _calendar(RED)), 1560, 470, ease(tt / 0.4), back(tt / 0.5))
        put(fr, cached("today", lambda: text_sprite("Today 9:00", F.bold(32), RED)), 1560, 600, ease(tt / 0.4))
        put(fr, cached("diff", lambda: chip_sprite("Different from usual", RED)), 1560, 720, ease((tt - 0.5) / 0.4), back((tt - 0.5) / 0.5))
    return fr


def _calendar(col) -> Image.Image:
    def draw(d, k):
        d.rounded_rectangle((0, 20 * k, 150 * k, 170 * k), 18 * k, fill=(255, 255, 255, 255), outline=col + (255,), width=5 * k)
        d.rounded_rectangle((0, 20 * k, 150 * k, 62 * k), 18 * k, fill=col + (255,))
        d.rectangle((0, 44 * k, 150 * k, 62 * k), fill=col + (255,))
        for x in (40, 110):
            d.rounded_rectangle(((x - 6) * k, 4 * k, (x + 6) * k, 38 * k), 5 * k, fill=INK + (255,))
        d.ellipse((50 * k, 86 * k, 100 * k, 136 * k), outline=col + (255,), width=5 * k)
        d.line([(75 * k, 96 * k), (75 * k, 112 * k), (88 * k, 120 * k)], fill=col + (255,), width=5 * k)
    return sprite(150, 172, draw)


TRUTH = [("SEEN", "measured right now", GREEN), ("WORKED OUT", "calculated from what was seen", BLUE), ("PREDICTED", "a forecast, with how sure we are", ORANGE)]


def draw_truth(c: Ctx) -> Image.Image:
    fr = PAPER_BG.copy()
    heading(fr, "Every number says how it knows", c)
    for i, (name, what, col) in enumerate(TRUTH):
        tt = c.at(i + 1)
        if tt <= 0:
            continue
        x = 360 + i * 600
        card = cached(f"truth:{name}", lambda n=name, w=what, cc=col: _truth_card(n, w, cc))
        put(fr, card, x, 560, ease(tt / 0.4), back(tt / 0.5))
    return fr


def _truth_card(name, what, col) -> Image.Image:
    im = shadow_card(520, 380, 30)
    d = ImageDraw.Draw(im)
    chip = chip_sprite(name, col, F.bold(40))
    im.alpha_composite(chip, ((im.width - chip.width) // 2, 120))
    for j, ln in enumerate(wrap(what, F.med(36), 420)):
        tw = F.med(36).getlength(ln)
        d.text(((im.width - tw) / 2, 230 + j * 50), ln, font=F.med(36), fill=SOFT)
    return im


def draw_stones(c: Ctx) -> Image.Image:
    fr = PAPER_BG.copy()
    heading(fr, "Five stones", c, 170)
    for i, (k, label, col) in enumerate(STONES):
        tt = c.at(1) - 0.25 * i
        x = W / 2 - 600 + i * 300
        put(fr, cached(f"stone:{k}:200", lambda k=k, col=col: stone_sprite(k, col, 200)), x, 520, ease(tt / 0.4), back(tt / 0.5))
        put(fr, cached(f"sl:{label}", lambda label=label: text_sprite(label, F.bold(48))), x, 690, ease((tt - 0.2) / 0.4))
    return fr


def make_screen_scene(shot: str, kind: str | None, label: str, focus, zoom=1.14, shot2: str | None = None) -> Callable[[Ctx], Image.Image]:
    def draw(c: Ctx) -> Image.Image:
        fr = PAPER_BG.copy()
        switch = c.scene.starts[1] + (c.scene.ends[1] - c.scene.starts[1]) * 0.45 if shot2 else c.scene.dur
        key = shot2 if shot2 and c.t >= switch and shot2 in c.shots else shot
        if key in c.shots:
            local_t = c.t - switch if key == shot2 else c.t
            span = (c.scene.dur - switch) if key == shot2 else switch
            win = screen_frame(c.shots[key], local_t / max(1, span), focus, zoom, (1480, 833), c.preview)
            a = ease(c.t / 0.5)
            put(fr, cached("win1480", lambda: shadow_card(1480, 833, 22)), W / 2 + 110, 500, a)
            put(fr, win, W / 2 + 110, 500, a)
        if kind:
            stone = cached(f"stone:{kind}:150", lambda: stone_sprite(kind, dict((k, col) for k, _, col in STONES)[kind], 150))
            put(fr, stone, 130, 200, ease(c.t / 0.4), back(c.t / 0.5))
        lab = cached(f"lab:{label}", lambda: _label(label))
        put(fr, lab, 130 + lab.width / 2 - 70, 330, ease((c.t - 0.2) / 0.4))
        return fr
    return draw


def _label(text: str) -> Image.Image:
    f = F.bold(40)
    w = int(f.getlength(text) + 48)
    im = shadow_card(w, 70, 35)
    ImageDraw.Draw(im).text((64, 50), text, font=f, fill=INK)
    return im


def draw_vision(c: Ctx) -> Image.Image:
    fr = PAPER_BG.copy()
    heading(fr, "Atlas Vision: count, don't watch", c)
    # a phone frame showing boxes (no people drawn, only shapes) → dots on a map
    phone = cached("phone", _phone)
    put(fr, phone, 480, 590, ease(c.t / 0.5), back(c.t / 0.6))
    d = ImageDraw.Draw(fr)
    boxes = [(370, 520, 70, 150, GREEN), (470, 560, 60, 130, GREEN), (515, 650, 130, 80, BLUE)]
    tt = c.at(1)
    for j, (x, y, w, h, col) in enumerate(boxes):
        if tt - 0.3 * j > 0:
            d.rounded_rectangle((x, y, x + w, y + h), 8, outline=col, width=5)
            d.ellipse((x + w / 2 - 8, y + h - 8, x + w / 2 + 8, y + h + 8), fill=col)
    if tt > 0.4:
        g = ease((tt - 0.4) / 0.8)
        d.line([(760, 590), (760 + 300 * g, 590)], fill=SOFT, width=6)
        if g >= 1:
            d.polygon([(1080, 590), (1050, 572), (1050, 608)], fill=SOFT)
        put(fr, cached("map", _mini_map), 1430, 590, ease((tt - 0.6) / 0.5))
        dots = [(1340, 520, GREEN), (1400, 610, GREEN), (1500, 560, BLUE)]
        for j, (x, y, col) in enumerate(dots):
            k = ease((tt - 1.0 - 0.2 * j) / 0.4)
            if k > 0:
                dx = math.sin(c.t * 1.3 + j) * 10
                d.ellipse((x + dx - 14 * k, y - 14 * k, x + dx + 14 * k, y + 14 * k), fill=col)
    tt = c.at(2)
    if tt > 0:
        put(fr, cached("noface", lambda: chip_sprite("No faces", RED)), 760, 900, ease(tt / 0.4), back(tt / 0.5))
        put(fr, cached("nostore", lambda: chip_sprite("Nothing stored", RED)), 1100, 900, ease((tt - 0.5) / 0.4), back((tt - 0.5) / 0.5))
    return fr


def _phone() -> Image.Image:
    def draw(d, k):
        d.rounded_rectangle((0, 0, 420 * k, 560 * k), 46 * k, fill=INK + (255,))
        d.rounded_rectangle((22 * k, 40 * k, 398 * k, 520 * k), 22 * k, fill=(236, 239, 243, 255))
        d.rounded_rectangle((160 * k, 14 * k, 260 * k, 26 * k), 6 * k, fill=(80, 80, 80, 255))
    return sprite(420, 560, draw)


def _mini_map() -> Image.Image:
    def draw(d, k):
        d.rounded_rectangle((0, 0, 460 * k, 360 * k), 26 * k, fill=(255, 255, 255, 255), outline=HAIR + (255,), width=3 * k)
        for x in (110, 250, 380):
            d.line([(x * k, 0), (x * k, 360 * k)], fill=(205, 208, 212, 255), width=10 * k)
        for y in (90, 210, 300):
            d.line([(0, y * k), (460 * k, y * k)], fill=(205, 208, 212, 255), width=10 * k)
        d.line([(0, 210 * k), (460 * k, 210 * k)], fill=AMBER + (255,), width=8 * k)
        d.line([(250 * k, 0), (250 * k, 360 * k)], fill=GREEN + (255,), width=8 * k)
    return sprite(460, 360, draw)


TIERS = [("Free", "for everyone", ["Look, Go, Safe?", "Ask Atlas", "What changed"], GREEN),
         ("Plus", "for your own city", ["Alerts", "Compare places", "Watchlists"], BLUE),
         ("Pro", "for land and project teams", ["Site finder", "Scenario lab", "Gentrification and invest score"], ORANGE)]


def draw_tiers(c: Ctx) -> Image.Image:
    fr = PAPER_BG.copy()
    heading(fr, "Free · Plus · Pro", c)
    for i, (name, who, items, col) in enumerate(TIERS):
        tt = c.at(i)
        if tt <= 0:
            continue
        put(fr, cached(f"tier:{name}", lambda n=name, w=who, it=items, cc=col: _tier_card(n, w, it, cc)), 380 + i * 580, 580, ease(tt / 0.4), back(tt / 0.5))
    return fr


def _tier_card(name, who, items, col) -> Image.Image:
    im = shadow_card(520, 520, 30)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((40, 40, 560, 64), 12, fill=col)
    d.rectangle((40, 52, 560, 64), fill=(255, 255, 255))
    d.text((80, 100), name, font=F.bold(64), fill=col)
    d.text((82, 184), who, font=F.med(32), fill=SOFT)
    for j, it in enumerate(items):
        y = 270 + j * 72
        d.ellipse((84, y + 12, 104, y + 32), fill=col)
        for k2, ln in enumerate(wrap(it, F.med(34), 400)):
            d.text((124, y + k2 * 40), ln, font=F.med(34), fill=INK)
    return im


def draw_trust(c: Ctx) -> Image.Image:
    fr = PAPER_BG.copy()
    heading(fr, "It checks itself", c)
    for i, (shot, lab, foc) in enumerate([("15-trackrecord", "Track record", (0.86, 0.45)), ("16-status", "Status: green or red", (0.86, 0.45))]):
        tt = c.at(i + 1)
        if tt <= 0 or shot not in c.shots:
            continue
        win = screen_frame(c.shots[shot], min(1, tt / 6), foc, 1.5, (820, 461), c.preview)
        x = 500 + i * 920
        a = ease(tt / 0.5)
        put(fr, cached("win820", lambda: shadow_card(820, 461, 22)), x, 560, a)
        put(fr, win, x, 560, a)
        put(fr, cached(f"lab:{lab}", lambda lab=lab: _label(lab)), x, 860, a)
    return fr


def draw_close(c: Ctx) -> Image.Image:
    fr = PAPER_BG.copy()
    for i, (k, label, col) in enumerate(STONES):
        tt = c.t - 0.45 * i
        x = W / 2 - 600 + i * 300
        put(fr, cached(f"stone:{k}:170", lambda k=k, col=col: stone_sprite(k, col, 170)), x, 400, ease(tt / 0.4), back(tt / 0.5))
        put(fr, cached(f"sl:{label}", lambda label=label: text_sprite(label, F.bold(48))), x, 550, ease((tt - 0.2) / 0.4))
    tt = c.at(len(c.scene.lines) - 1)
    if tt > 0:
        put(fr, cached("closeline", lambda: text_sprite("A living map that answers.", F.bold(72))), W / 2, 690, ease(tt / 0.5))
        put(fr, cached("url", lambda: text_sprite(URL, F.med(36), BLUE)), W / 2, 785, ease((tt - 0.4) / 0.5))
    put(fr, cached("credit", lambda: text_sprite("Voice: Piper TTS with the LibriTTS voice (CC BY 4.0). Map data © OpenStreetMap contributors.", F.reg(24), SOFT)), W / 2, 885, ease((c.t - 1) / 0.5))
    return fr


URL = "infrashield-bengaluru.onrender.com"


def build_scenes() -> list[Scene]:
    return [
        Scene("hook", ["Before you go out, rent a home, or open a shop, you have questions.",
                       "How bad is the traffic? Is it safe?",
                       "Is this area getting better? Is it worth it?",
                       "A normal map shows you where things are.",
                       "It does not tell you what they mean."], draw_hook),
        Scene("meet", ["Meet City Atlas.",
                       "A living map of India that answers your questions, in simple English or Hindi."], draw_meet),
        Scene("sources", ["City Atlas only uses real sources.",
                          "Streets and places come from OpenStreetMap.",
                          "Live traffic comes from TomTom.",
                          "Weather and air come from Open-Meteo.",
                          "It also reads news headlines, and reports from people like you.",
                          "Nothing is made up.",
                          "When something is missing, it simply says: no data."], draw_sources),
        Scene("memory", ["Every reading is kept.",
                         "So City Atlas learns what each road is usually like, for example on a Monday at nine.",
                         "When today is different, it notices, and tells you what changed."], draw_memory),
        Scene("truth", ["Every answer tells you how it knows.",
                        "Seen means measured right now.",
                        "Worked out means calculated from what was seen.",
                        "Predicted means a forecast, and it always says how sure it is."], draw_truth),
        Scene("stones", ["Using it is simple.", "There are five buttons, like five stones."], draw_stones),
        Scene("look", ["Look.", "Click any place to see what it is like: traffic, air, safety, parks and transport, each with the reason."],
              make_screen_scene("03-place", "look", "Look", (0.86, 0.42))),
        Scene("go", ["Go.", "Get a route anywhere in India, with live traffic."],
              make_screen_scene("08-route", "go", "Go", (0.86, 0.35))),
        Scene("safe", ["Is it safe?", "See what people have reported nearby, or report something yourself."],
              make_screen_scene("09-safe", "safe", "Is it safe?", (0.86, 0.35))),
        Scene("change", ["Is it changing?", "See what changed today. Professionals can also see whether an area is on the rise."],
              make_screen_scene("07-changed", "change", "Is it changing?", (0.62, 0.3), 1.14, shot2="12-gentri")),
        Scene("worth", ["Is it worth it?", "An investment check for any place, using real signals, with missing parts shown as missing."],
              make_screen_scene("13-invest", "worth", "Is it worth it?", (0.88, 0.4))),
        Scene("ask", ["And you can always just ask, in your own words."],
              make_screen_scene("04-ask", None, "Ask Atlas", (0.5, 0.75), 1.25)),
        Scene("vision", ["Atlas Vision turns a phone camera into a counter.",
                         "It counts people and vehicles as moving dots on the map.",
                         "It never looks for faces, and nothing is stored."], draw_vision),
        Scene("tiers", ["City Atlas is free for everyone.",
                        "Plus adds alerts and comparisons.",
                        "Pro is for land and project teams, with a site finder, a scenario lab, and gentrification and investment checks."], draw_tiers),
        Scene("trust", ["And it checks itself.",
                        "City Atlas tests its own forecasts against what really happened.",
                        "And a status page shows which sources are working right now."], draw_trust),
        Scene("close", ["Look. Go. Is it safe? Is it changing? Is it worth it?",
                        "City Atlas. A living map that answers."], draw_close),
    ]


# ---------------------------------------------------------------- voice and assembly

def speak(piper: str, voice: str, text: str, out: Path, speaker: int | None) -> list[int]:
    cmd = [piper, "-m", voice, "-f", str(out)]
    if speaker is not None:
        cmd += ["-s", str(speaker)]
    subprocess.run(cmd, input=text.encode(), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with wave.open(str(out)) as w:
        global SR
        SR = w.getframerate()
        return list(memoryview(w.readframes(w.getnframes())).cast("h"))


def main() -> None:
    global F, PAPER_BG
    ap = argparse.ArgumentParser()
    ap.add_argument("shots", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--voice", required=True)
    ap.add_argument("--speaker", type=int, default=None)
    ap.add_argument("--piper", default="piper")
    ap.add_argument("--fonts", type=Path, default=None)
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--only", default=None, help="comma-separated scene names, for quick checks")
    args = ap.parse_args()
    F = Fonts(args.fonts)
    PAPER_BG = paper()
    shots = {p.stem: Image.open(p).convert("RGB") for p in sorted(args.shots.glob("*.png"))}
    scenes = build_scenes()
    if args.only:
        keep = set(args.only.split(","))
        scenes = [s for s in scenes if s.name in keep]

    tmp = Path(tempfile.mkdtemp(prefix="atlas-voice-"))
    audio: list[int] = []
    srt: list[str] = []
    t0 = 0.0
    for si, s in enumerate(scenes):
        t = 0.35 if si else 0.6
        pcms: list[list[int]] = []
        for li, line in enumerate(s.lines):
            pcm = speak(args.piper, args.voice, line, tmp / f"{s.name}-{li}.wav", args.speaker)
            pcms.append(pcm)
            s.starts.append(t)
            d = len(pcm) / SR
            s.ends.append(t + d)
            srt.append(f"{len(srt) + 1}\n{_ts(t0 + t)} --> {_ts(t0 + t + d)}\n{line}\n")
            t += d + GAP_S
        s.dur = t - GAP_S + TAIL_S
        # the scene's audio: silence where there is no voice
        track = [0] * int(s.dur * SR)
        for li, pcm in enumerate(pcms):
            a = int(s.starts[li] * SR)
            track[a:a + len(pcm)] = pcm
        audio += track
        t0 += s.dur
        print(f"{s.name}: {s.dur:.1f} s")
    total_s = t0
    voice_wav = tmp / "voice.wav"
    with wave.open(str(voice_wav), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(array.array("h", audio).tobytes())
    args.out.with_suffix(".srt").write_text("\n".join(srt))

    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error",
                           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-i", str(voice_wav),
                           "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "160k",
                           "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
                           "-movflags", "+faststart", "-shortest", str(args.out)], stdin=subprocess.PIPE)
    fade = int(FADE_S * FPS)
    prev_last: Image.Image | None = None
    n_out = 0
    for s in scenes:
        n = int(round(s.dur * FPS))
        for i in range(n):
            t = i / FPS
            fr = s.draw(Ctx(t, s, shots, args.preview))
            # subtitle of the sentence being spoken
            for li in range(len(s.lines)):
                if s.starts[li] - 0.05 <= t <= s.ends[li] + GAP_S * 0.8:
                    sub = subtitle(s.lines[li])
                    put(fr, sub, W / 2, H - 70 - sub.height / 2 + 20)
                    break
            if prev_last is not None and i < fade:   # dissolve from where the previous scene ended
                fr = Image.blend(prev_last, fr, (i + 1) / (fade + 1))
            ff.stdin.write(fr.convert("RGB").tobytes())
            n_out += 1
        prev_last = fr
    ff.stdin.close()
    if ff.wait() != 0:
        sys.exit("ffmpeg failed")
    print(f"wrote {args.out}: {total_s:.1f} s of voice, {n_out / FPS:.1f} s of video, {len(scenes)} scenes; subtitles in {args.out.with_suffix('.srt')}")


def _ts(s: float) -> str:
    ms = int(round(s * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


if __name__ == "__main__":
    main()
