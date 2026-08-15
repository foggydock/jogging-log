#!/usr/bin/env python3
"""Notion「ジョギング記録」CSV → アプリ取り込み用 JSON

使い方:
    python3 tools/convert_notion.py notion_export/out_1.csv jogging_import.json

出力の JSON はアプリの「設定 > 取り込み」から読み込む。
実データなのでリポジトリにはコミットしない（.gitignore 済み）。
"""
import csv
import json
import re
import sys


def parse_date(*candidates):
    """'2026年2月7日' / '2026-06-14' のどちらでも YYYY-MM-DD にする"""
    for s in candidates:
        if not s:
            continue
        m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", s) or \
            re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
        if m:
            y, mo, d = map(int, m.groups())
            return f"{y:04d}-{mo:02d}-{d:02d}"
    return None


def parse_duration(s):
    """'0:25:39' や '25:39' を秒に。取れなければ None"""
    if not s:
        return None
    parts = [p for p in s.strip().split(":") if p != ""]
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return None
    if len(nums) == 3:
        h, m, sec = nums
    elif len(nums) == 2:
        h, m, sec = 0, nums[0], nums[1]
    else:
        return None
    return h * 3600 + m * 60 + sec


def clean_title(name, date_str):
    """Name から日付部分を取り除いて『朝ジョギング』だけにする"""
    t = re.sub(r"\d{4}年\d{1,2}月\d{1,2}日", "", name)
    t = re.sub(r"\d{4}-\d{1,2}-\d{1,2}", "", t)
    t = t.strip()
    return t or "ジョギング"


def main():
    src, dst = sys.argv[1], sys.argv[2]
    out, skipped = [], []

    with open(src, encoding="utf-8-sig") as f:
        for i, row in enumerate(csv.DictReader(f), start=2):
            name = (row.get("Name") or "").strip()
            date = parse_date(row.get("日付"), name)
            if not date:
                skipped.append((i, name, "日付が読めない"))
                continue

            sec = parse_duration(row.get("ワークアウト時間"))
            if sec is None:
                # 「ワークアウト時間(分)」から復元を試みる
                try:
                    sec = round(float(row["ワークアウト時間(分)"]) * 60)
                except (KeyError, ValueError, TypeError):
                    sec = None

            try:
                km = round(float(row.get("距離(km)")), 2)
            except (TypeError, ValueError):
                km = None

            if sec is None and km is None:
                skipped.append((i, name, "時間も距離も無い"))
                continue

            out.append({
                "ran_on": date,
                "title": clean_title(name, date),
                "duration_sec": sec,
                "distance_km": km,
                "source": "notion",
            })

    out.sort(key=lambda r: r["ran_on"])
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "runs": out}, f, ensure_ascii=False, indent=1)

    print(f"変換 {len(out)} 件 → {dst}")
    if skipped:
        print(f"スキップ {len(skipped)} 件:")
        for line, name, why in skipped:
            print(f"  {line}行目 {name!r}: {why}")
    else:
        print("スキップ 0 件（全件そのまま取り込めます）")

    # 検算
    total_km = sum(r["distance_km"] or 0 for r in out)
    total_h = sum(r["duration_sec"] or 0 for r in out) / 3600
    print(f"期間 {out[0]['ran_on']} 〜 {out[-1]['ran_on']}")
    print(f"累計 {total_km:,.1f} km / {total_h:,.1f} 時間")


if __name__ == "__main__":
    main()
