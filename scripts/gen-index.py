#!/usr/bin/env python3
"""Regenerate blog/index.json from content/*.md front matter.

Usage: python3 scripts/gen-index.py
Run after adding/editing posts. The JSON must stay static in the repo because
Jekyll's site.content does not exist here — the Cloudflare worker reads this file.
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
OUT = ROOT / "blog" / "index.json"

def parse_fm(text: str) -> dict:
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    fm: dict = {}
    if not m:
        return fm
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        k = k.strip()
        v = v.strip()
        if v.startswith("[") and v.endswith("]"):
            items = [i.strip().strip("'\"") for i in v[1:-1].split(",") if i.strip()]
            fm[k] = items
        else:
            fm[k] = v.strip('"')
    return fm

def main() -> int:
    posts = []
    for md in sorted(CONTENT.glob("*.md")):
        text = md.read_text(encoding="utf-8")
        fm = parse_fm(text)
        if str(fm.get("published", "false")).lower() != "true":
            continue
        body = re.sub(r"^---\n.*?\n---\n", "", text, flags=re.S)
        posts.append({
            "slug": md.stem,
            "title": fm.get("title", md.stem),
            "tldr": fm.get("tldr", ""),
            "date": str(fm.get("date", ""))[:10],
            "tags": fm.get("tags", []) if isinstance(fm.get("tags"), list) else [],
            "words": len(body.split()),
            "source": "content/" + md.name,
        })
    posts.sort(key=lambda p: p["date"], reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({
            "generated": date.today().isoformat(),
            "note": "regenerate with: python3 scripts/gen-index.py",
            "posts": posts,
        }, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)} with {len(posts)} posts")
    return 0

if __name__ == "__main__":
    sys.exit(main())
