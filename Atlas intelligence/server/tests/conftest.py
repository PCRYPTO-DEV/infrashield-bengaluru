import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import re  # noqa: E402
import time  # noqa: E402
from email.utils import format_datetime, parsedate_to_datetime  # noqa: E402
from datetime import timedelta  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
# When the news fixtures were written. Their dates are moved forward by (now - this), so every story
# keeps its age (an hour, two days, forty days...) and the day / 30-day / 180-day windows never expire them.
NEWS_WRITTEN_AT = 1790992800  # 2026-10-03T02:00:00Z


def dated_fixtures(tmp_path: Path) -> Path:
    d = tmp_path / "fixtures"
    if d.exists():
        return d
    d.mkdir()
    shift = timedelta(seconds=time.time() - NEWS_WRITTEN_AT)
    for f in FIXTURES.iterdir():
        if f.name.startswith("news_") and f.suffix == ".xml":
            xml = re.sub(r"<pubDate>([^<]*)</pubDate>", lambda m: f"<pubDate>{format_datetime(parsedate_to_datetime(m.group(1)) + shift)}</pubDate>", f.read_text())
            (d / f.name).write_text(xml)
        else:
            (d / f.name).symlink_to(f)
    return d
