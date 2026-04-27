#!/usr/bin/env python3
"""Build static web data from AIagent_study_plan markdown files."""
from __future__ import annotations
import json
import pathlib
import re
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "web_assets" / "study_data.json"

WORD_RE = re.compile(r"^(\d+)\. \*\*(.+?)\*\* \((.+?)\) - (.+?) - (.+?) - (.+?) \((.+)\)$")
FRONT_RE = re.compile(r"^---\n(.*?)\n---\n", re.S)
LEVEL_RE = re.compile(r"###\s*(.+)")


def parse_frontmatter(text: str) -> dict:
    m = FRONT_RE.match(text)
    data = {}
    if not m:
        return data
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith(" "):
            k, v = line.split(":", 1)
            data[k.strip()] = v.strip()
    return data


def section(text: str, heading: str) -> str:
    # heading examples: New Words, Review Words, Review Story
    m = re.search(rf"^## {re.escape(heading)}(?: \([^)]*\))?\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    return m.group(1).strip() if m else ""


def parse_words(sec: str) -> list[dict]:
    words = []
    for line in sec.splitlines():
        line = line.strip()
        if not line or not re.match(r"^\d+\. \*\*", line):
            continue
        m = WORD_RE.match(line)
        if not m:
            # Keep malformed content visible rather than dropping it.
            words.append({"raw": line, "parse_error": True})
            continue
        number, word, pos, chinese, japanese, english_example, japanese_example = m.groups()
        words.append({
            "number": int(number),
            "word": word,
            "pos": pos,
            "chinese": chinese,
            "japanese": japanese,
            "englishExample": english_example,
            "japaneseExample": japanese_example,
        })
    return words


def clean_source_word(raw: str) -> str:
    return raw.strip().strip(".").strip()


def load_vocabulary_details() -> dict[str, dict]:
    details = ROOT / "vocabulary_details" / "all_vocabulary_details.json"
    if not details.exists():
        return {}
    items = json.loads(details.read_text(encoding="utf-8"))
    return {item["key"]: item for item in items}


def parse_source_vocabulary() -> list[dict]:
    source = ROOT / "7000words.txt"
    detail_by_key = load_vocabulary_details()
    if not source.exists():
        return []
    vocabulary = []
    seen = set()
    current_level = ""
    number = 0
    for line in source.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        level_match = LEVEL_RE.match(line)
        if level_match:
            current_level = level_match.group(1).strip()
            rest = line[level_match.end():].strip()
            if not rest:
                continue
            line = rest
        if line.startswith("###"):
            continue
        for part in re.split(r",\s*", line):
            word = clean_source_word(part)
            if not word:
                continue
            key = word.lower()
            if key in seen:
                continue
            seen.add(key)
            number += 1
            base_item = {
                "number": number,
                "word": word,
                "key": key,
                "level": current_level,
                "scheduled": False,
                "pos": "",
                "chinese": "",
                "japanese": "",
                "englishExample": "",
                "japaneseExample": "",
            }
            if key in detail_by_key:
                detail = detail_by_key[key]
                base_item.update({
                    "pos": detail.get("pos", ""),
                    "chinese": detail.get("chinese", ""),
                    "japanese": detail.get("japanese", ""),
                    "englishExample": detail.get("englishExample", ""),
                    "japaneseExample": detail.get("japaneseExample", ""),
                })
            vocabulary.append(base_item)
    return vocabulary


def parse_story(sec: str) -> dict:
    if not sec or sec.startswith("No review story"):
        return {"used": [], "english": "", "chinese": "", "japanese": ""}
    used = []
    m_used = re.search(r"\*\*Review words used:\*\*\s*(.+)", sec)
    if m_used:
        used = [w.strip() for w in m_used.group(1).split(",") if w.strip()]

    def grab(label: str, next_labels: list[str]) -> str:
        start = sec.find(label)
        if start < 0:
            return ""
        start += len(label)
        end = len(sec)
        for nl in next_labels:
            i = sec.find(nl, start)
            if i >= 0:
                end = min(end, i)
        return sec[start:end].strip()

    return {
        "used": used,
        "english": grab("**English:**", ["**中文：**", "**日本語：**"]),
        "chinese": grab("**中文：**", ["**日本語：**"]),
        "japanese": grab("**日本語：**", []),
    }


def main() -> None:
    weeks = []
    days = []
    for folder in sorted(ROOT.glob("week_*_*_to_*")):
        if not folder.is_dir():
            continue
        week_match = re.search(r"week_(\d+)_([0-9-]+)_to_([0-9-]+)", folder.name)
        week_no = int(week_match.group(1)) if week_match else len(weeks) + 1
        week = {
            "week": week_no,
            "folder": folder.name,
            "startDate": week_match.group(2) if week_match else "",
            "endDate": week_match.group(3) if week_match else "",
            "days": [],
        }
        for md in sorted(folder.glob("2026-*.md")):
            text = md.read_text(encoding="utf-8")
            fm = parse_frontmatter(text)
            new_words = parse_words(section(text, "New Words"))
            review_words = parse_words(section(text, "Review Words"))
            story = parse_story(section(text, "Review Story"))
            title_m = re.search(r"^#\s+(.+)$", text, re.M)
            day = {
                "date": fm.get("date", md.stem),
                "week": int(fm.get("week", week_no)),
                "title": title_m.group(1) if title_m else md.stem,
                "file": str(md.relative_to(ROOT)),
                "newWords": new_words,
                "reviewWords": review_words,
                "story": story,
            }
            week["days"].append(day)
            days.append(day)
        weeks.append(week)

    all_words = []
    seen = set()
    parse_errors = []
    scheduled_by_key = {}
    for day in days:
        for kind in ("newWords", "reviewWords"):
            for item in day[kind]:
                if item.get("parse_error"):
                    parse_errors.append({"date": day["date"], "section": kind, "raw": item.get("raw")})
                    continue
                word_key = item["word"].lower()
                key = (word_key, item["pos"], item["chinese"], item["japanese"])
                enriched = {**item, "key": word_key, "firstDate": day["date"], "firstWeek": day["week"]}
                if word_key not in scheduled_by_key:
                    scheduled_by_key[word_key] = enriched
                if key not in seen:
                    seen.add(key)
                    all_words.append(enriched)

    source_vocabulary = parse_source_vocabulary()
    complete_vocabulary = []
    for item in source_vocabulary:
        scheduled = scheduled_by_key.get(item["key"])
        if scheduled:
            complete_vocabulary.append({
                **item,
                **scheduled,
                "number": item["number"],
                "level": item["level"],
                "scheduled": True,
            })
        else:
            complete_vocabulary.append(item)

    payload = {
        "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "source": "AIagent_study_plan/week_*/*.md",
        "weeks": weeks,
        "stats": {
            "weeks": len(weeks),
            "days": len(days),
            "newWordEntries": sum(len(d["newWords"]) for d in days),
            "reviewWordEntries": sum(len(d["reviewWords"]) for d in days),
            "uniqueWordCards": len(all_words),
            "sourceVocabulary": len(source_vocabulary),
            "scheduledSourceVocabulary": sum(1 for item in complete_vocabulary if item.get("scheduled")),
            "parseErrors": len(parse_errors),
        },
        "allWords": all_words,
        "completeVocabulary": complete_vocabulary,
        "parseErrors": parse_errors,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(json.dumps(payload["stats"], ensure_ascii=False, indent=2))
    if parse_errors:
        raise SystemExit("Parse errors found; inspect web_assets/study_data.json")


if __name__ == "__main__":
    main()
