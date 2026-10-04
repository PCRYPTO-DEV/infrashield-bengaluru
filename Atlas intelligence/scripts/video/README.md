# City Atlas vision video

Two steps: take screenshots of a running City Atlas, then turn them into a captioned MP4
(about 90 seconds, 1920×1080, title card, 18 scenes, end card).

```bash
# 1. screenshots (Node + Playwright; PRO_PASSWORD is optional, without it the Pro scenes show the lock)
BASE=https://infrashield-bengaluru.onrender.com OUT=shots PRO_PASSWORD=... node scripts/video/capture.mjs

# 2. video (Python 3 + Pillow + ffmpeg)
python scripts/video/make_video.py shots city-atlas-vision.mp4 --fonts fonts/
```

- `capture.mjs` tries every scene on its own and writes `shots/capture.json` with what worked.
- `make_video.py` skips a scene whose screenshot is missing. `--fonts` points at a folder with
  `DMSans-Regular.ttf`, `DMSans-Medium.ttf`, `DMSans-Bold.ttf` (Google Fonts); without it DejaVu is used.
- Screenshots taken from the offline test server (`ATLAS_FIXTURES`) show made-up streets: build those
  with `--preview`, which stamps every frame "TEST DATA". Only screenshots of the live site go in a
  video shown to anyone.
- The captions are in `SCENES` at the top of `make_video.py`.

## Explainer (spoken, about 2½ minutes)

`explainer.py` makes a spoken explainer from the same screenshots: drawn diagrams for how City Atlas
knows things (sources, city memory, seen / worked out / predicted, Atlas Vision, Free · Plus · Pro),
app screens for the five stones, subtitles burned in and written to a `.srt` next to the video.

```bash
pip install piper-tts pillow
# voice: en-us-libritts-high from the Piper v0.0.2 release (LibriTTS, CC BY 4.0, credited on the end card)
python scripts/video/explainer.py shots city-atlas-explainer.mp4 \
  --voice en-us-libritts-high.onnx --speaker 0 --fonts fonts/ [--preview]
```

The narration is in `build_scenes()`; each sentence is spoken on its own, so pictures and subtitles
follow the voice. `--only hook,sources` renders a few scenes for a quick check.
