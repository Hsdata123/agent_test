#!/usr/bin/env python3
"""Qianchuan import/export helper.

Subcommands:
  export <out.xlsx> [--advertiser-id ID]   Export anchors (+advertisers) to xlsx
  template <out.xlsx>                      Emit blank template with header rows
  preview <in.xlsx>                        Parse xlsx + diff against DB, no writes
  apply <in.xlsx>                          Apply xlsx to DB (add/update/delete)

Sheets:
  - "抖音号名册" (anchors): advertiserId, anchorId, anchorName, nickname
  - "广告主绑定" (advertisers): advertiserId, nickname, tokenAppId

Two-step import flow (admin only):
  1) preview -> JSON { anchorDiff: {add, update, delete}, advertiserDiff: {add, update, delete}, errors: [...] }
  2) apply   -> JSON { insertedAnchors, updatedAnchors, deletedAnchors,
                        insertedAdvertisers, updatedAdvertisers, deletedAdvertisers, errors: [...] }
"""
import argparse
import json
import sqlite3
import sys
from pathlib import Path

from openpyxl import Workbook, load_workbook


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "prisma" / "dev.db"

ANCHOR_HEADERS = ["advertiserId", "anchorId", "anchorName", "nickname"]
ADVERTISER_HEADERS = ["advertiserId", "nickname", "tokenAppId"]

ANCHOR_SHEET = "抖音号名册"
ADVERTISER_SHEET = "广告主绑定"


def connect_db():
    if not DB_PATH.exists():
        print(json.dumps({"error": f"db not found: {DB_PATH}"}), flush=True)
        sys.exit(2)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def write_header(ws, headers, widths=None):
    ws.append(headers)
    if widths:
        for col, w in enumerate(widths, 1):
            ws.column_dimensions[ws.cell(row=1, column=col).column_letter].width = w


def cmd_template(out_path: str):
    wb = Workbook()
    ws = wb.active
    ws.title = ANCHOR_SHEET
    write_header(ws, ANCHOR_HEADERS, [22, 22, 30, 24])
    for row_idx in range(2, 6):
        ws.cell(row=row_idx, column=1, value="1757724572785671")
        ws.cell(row=row_idx, column=2, value="2041152493068595")
        ws.cell(row=row_idx, column=3, value="弹动官方旗舰店")

    ws2 = wb.create_sheet(ADVERTISER_SHEET)
    write_header(ws2, ADVERTISER_HEADERS, [22, 24, 22])
    for row_idx in range(2, 4):
        ws2.cell(row=row_idx, column=1, value="1757724572785671")
        ws2.cell(row=row_idx, column=2, value="主账号")
        ws2.cell(row=row_idx, column=3, value="1868667833417799")

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)
    print(json.dumps({"ok": True, "path": out_path}), flush=True)


def cmd_export(out_path: str, advertiser_id: str | None):
    conn = connect_db()
    cur = conn.cursor()

    cur.execute(
        "SELECT advertiserId, anchorId, anchorName, nickname FROM QianchuanAnchor "
        "WHERE (? IS NULL OR advertiserId = ?) "
        "ORDER BY advertiserId, lastSeenAt DESC",
        (advertiser_id, advertiser_id),
    )
    anchors = cur.fetchall()

    cur.execute(
        "SELECT a.advertiserId, a.nickname, t.appId AS tokenAppId "
        "FROM QianchuanAdvertiser a JOIN QianchuanToken t ON a.tokenId = t.id "
        "WHERE (? IS NULL OR a.advertiserId = ?) "
        "ORDER BY a.advertiserId",
        (advertiser_id, advertiser_id),
    )
    advertisers = cur.fetchall()
    conn.close()

    wb = Workbook()
    ws = wb.active
    ws.title = ANCHOR_SHEET
    write_header(ws, ANCHOR_HEADERS, [22, 22, 30, 24])
    for r in anchors:
        ws.append([r["advertiserId"], r["anchorId"], r["anchorName"], r["nickname"] or ""])

    ws2 = wb.create_sheet(ADVERTISER_SHEET)
    write_header(ws2, ADVERTISER_HEADERS, [22, 24, 22])
    for r in advertisers:
        ws2.append([r["advertiserId"], r["nickname"] or "", r["tokenAppId"]])

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)
    print(
        json.dumps(
            {
                "ok": True,
                "path": out_path,
                "anchorCount": len(anchors),
                "advertiserCount": len(advertisers),
            }
        ),
        flush=True,
    )


def is_blank(v):
    return v is None or (isinstance(v, str) and v.strip() == "")


def str_value(v):
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, (int, float)):
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        return str(v)
    return str(v).strip()


def parse_anchor_rows(wb):
    """Returns (valid_rows, errors). valid_rows = list of dicts; errors = list of {row, error}."""
    valid = []
    errors = []
    if ANCHOR_SHEET not in wb.sheetnames:
        return valid, errors
    ws = wb[ANCHOR_SHEET]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    for idx, row in enumerate(rows, start=2):
        if not row or all(is_blank(v) for v in row):
            continue
        try:
            advertiser_id = str_value(row[0]) if len(row) > 0 else ""
            anchor_id = str_value(row[1]) if len(row) > 1 else ""
            anchor_name = str_value(row[2]) if len(row) > 2 else ""
            nickname = str_value(row[3]) if len(row) > 3 else ""
        except Exception as e:
            errors.append({"row": idx, "error": f"字段读取失败: {e}"})
            continue
        if is_blank(advertiser_id) or is_blank(anchor_id) or is_blank(anchor_name):
            errors.append({"row": idx, "error": "advertiserId/anchorId/anchorName 必填"})
            continue
        if not advertiser_id.isdigit() or not (6 <= len(advertiser_id) <= 30):
            errors.append({"row": idx, "error": f"advertiserId 非法: {advertiser_id}"})
            continue
        if not anchor_id.isdigit() or not (8 <= len(anchor_id) <= 24):
            errors.append({"row": idx, "error": f"anchorId 非法: {anchor_id}"})
            continue
        if len(anchor_name) > 50:
            errors.append({"row": idx, "error": "anchorName 长度超过 50"})
            continue
        valid.append(
            {
                "row": idx,
                "advertiserId": advertiser_id,
                "anchorId": anchor_id,
                "anchorName": anchor_name,
                "nickname": nickname or None,
            }
        )
    return valid, errors


def parse_advertiser_rows(wb):
    valid = []
    errors = []
    if ADVERTISER_SHEET not in wb.sheetnames:
        return valid, errors
    ws = wb[ADVERTISER_SHEET]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    for idx, row in enumerate(rows, start=2):
        if not row or all(is_blank(v) for v in row):
            continue
        try:
            advertiser_id = str_value(row[0]) if len(row) > 0 else ""
            nickname = str_value(row[1]) if len(row) > 1 else ""
            token_app_id = str_value(row[2]) if len(row) > 2 else ""
        except Exception as e:
            errors.append({"row": idx, "error": f"字段读取失败: {e}"})
            continue
        if is_blank(advertiser_id) or is_blank(token_app_id):
            errors.append({"row": idx, "error": "advertiserId/tokenAppId 必填"})
            continue
        if not advertiser_id.isdigit() or not (6 <= len(advertiser_id) <= 30):
            errors.append({"row": idx, "error": f"advertiserId 非法: {advertiser_id}"})
            continue
        valid.append(
            {
                "row": idx,
                "advertiserId": advertiser_id,
                "nickname": nickname or None,
                "tokenAppId": token_app_id,
            }
        )
    return valid, errors


def diff_anchors(cur, valid_rows, errors_out):
    """Categorize valid anchor rows vs DB. Append cross-reference errors to errors_out.

    Delete is scoped to advertisers touched by the xlsx only — anchors for other
    advertisers are left alone. If xlsx has zero valid rows, no delete is proposed.
    """
    add = []
    update = []
    seen_keys = set()
    scoped_advertisers = set()
    for r in valid_rows:
        cur.execute(
            "SELECT id FROM QianchuanAdvertiser WHERE advertiserId = ?",
            (r["advertiserId"],),
        )
        if not cur.fetchone():
            errors_out.append(
                {
                    "row": r["row"],
                    "error": f"advertiserId={r['advertiserId']} 未在系统中绑定，无法导入 anchor",
                }
            )
            continue
        cur.execute(
            "SELECT anchorName, nickname FROM QianchuanAnchor WHERE advertiserId = ? AND anchorId = ?",
            (r["advertiserId"], r["anchorId"]),
        )
        existing = cur.fetchone()
        seen_keys.add((r["advertiserId"], r["anchorId"]))
        scoped_advertisers.add(r["advertiserId"])
        if existing is None:
            add.append(r)
        else:
            old_name = existing["anchorName"] or ""
            old_nick = existing["nickname"] or None
            new_nick = r["nickname"]
            if old_name == r["anchorName"] and old_nick == new_nick:
                continue
            update.append(
                {
                    **r,
                    "before": {
                        "anchorName": old_name,
                        "nickname": old_nick,
                    },
                }
            )
    delete = []
    if scoped_advertisers:
        placeholders = ",".join("?" * len(scoped_advertisers))
        cur.execute(
            f"SELECT advertiserId, anchorId, anchorName, nickname FROM QianchuanAnchor "
            f"WHERE advertiserId IN ({placeholders})",
            tuple(scoped_advertisers),
        )
        for d in cur.fetchall():
            key = (d["advertiserId"], d["anchorId"])
            if key not in seen_keys:
                delete.append(
                    {
                        "advertiserId": d["advertiserId"],
                        "anchorId": d["anchorId"],
                        "anchorName": d["anchorName"],
                        "nickname": d["nickname"],
                    }
                )
    return add, update, delete


def diff_advertisers(cur, valid_rows, errors_out):
    add = []
    update = []
    seen_keys = set()
    scoped_advertisers = set()
    for r in valid_rows:
        cur.execute("SELECT id FROM QianchuanToken WHERE appId = ?", (r["tokenAppId"],))
        token = cur.fetchone()
        if not token:
            errors_out.append(
                {
                    "row": r["row"],
                    "error": f"tokenAppId={r['tokenAppId']} 在 QianchuanToken 中不存在",
                }
            )
            continue
        cur.execute(
            "SELECT id, nickname, tokenId FROM QianchuanAdvertiser WHERE tokenId = ? AND advertiserId = ?",
            (token["id"], r["advertiserId"]),
        )
        existing = cur.fetchone()
        seen_keys.add((token["id"], r["advertiserId"]))
        scoped_advertisers.add(r["advertiserId"])
        if existing is None:
            add.append({**r, "tokenId": token["id"]})
        else:
            old_nick = existing["nickname"] or None
            if old_nick == r["nickname"]:
                continue
            update.append({**r, "tokenId": token["id"], "before": {"nickname": old_nick}})
    delete = []
    if scoped_advertisers:
        placeholders = ",".join("?" * len(scoped_advertisers))
        cur.execute(
            f"SELECT a.advertiserId, a.nickname, t.appId AS tokenAppId "
            f"FROM QianchuanAdvertiser a JOIN QianchuanToken t ON a.tokenId = t.id "
            f"WHERE a.advertiserId IN ({placeholders})",
            tuple(scoped_advertisers),
        )
        for d in cur.fetchall():
            if d["advertiserId"] not in seen_keys or True:
                if (d["tokenAppId"], d["advertiserId"]) not in {(r["tokenAppId"], r["advertiserId"]) for r in valid_rows}:
                    delete.append(
                        {
                            "advertiserId": d["advertiserId"],
                            "nickname": d["nickname"],
                            "tokenAppId": d["tokenAppId"],
                        }
                    )
    return add, update, delete


def cmd_preview(in_path: str):
    in_p = Path(in_path)
    if not in_p.exists():
        print(json.dumps({"error": f"file not found: {in_path}"}), flush=True)
        sys.exit(2)
    wb = load_workbook(in_path, data_only=True)
    conn = connect_db()
    cur = conn.cursor()

    errors = []
    valid_anchors, anchor_errors = parse_anchor_rows(wb)
    errors.extend(anchor_errors)
    valid_advertisers, adv_errors = parse_advertiser_rows(wb)
    errors.extend(adv_errors)

    a_add, a_update, a_delete = diff_anchors(cur, valid_anchors, errors)
    d_add, d_update, d_delete = diff_advertisers(cur, valid_advertisers, errors)

    conn.close()
    print(
        json.dumps(
            {
                "ok": True,
                "anchorDiff": {
                    "add": a_add,
                    "update": a_update,
                    "delete": a_delete,
                },
                "advertiserDiff": {
                    "add": d_add,
                    "update": d_update,
                    "delete": d_delete,
                },
                "errors": errors[:50],
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


def cmd_apply(in_path: str):
    in_p = Path(in_path)
    if not in_p.exists():
        print(json.dumps({"error": f"file not found: {in_path}"}), flush=True)
        sys.exit(2)
    wb = load_workbook(in_path, data_only=True)
    conn = connect_db()
    cur = conn.cursor()

    errors = []
    valid_anchors, anchor_errors = parse_anchor_rows(wb)
    errors.extend(anchor_errors)
    valid_advertisers, adv_errors = parse_advertiser_rows(wb)
    errors.extend(adv_errors)

    a_add, a_update, a_delete = diff_anchors(cur, valid_anchors, errors)
    d_add, d_update, d_delete = diff_advertisers(cur, valid_advertisers, errors)

    inserted_anchors = updated_anchors = deleted_anchors = 0
    inserted_advertisers = updated_advertisers = deleted_advertisers = 0

    for r in a_add:
        try:
            cur.execute(
                "INSERT INTO QianchuanAnchor (id, advertiserId, anchorId, anchorName, nickname, lastSeenAt, createdAt, updatedAt) "
                "VALUES (lower(hex(randomblob(12))), ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))",
                (r["advertiserId"], r["anchorId"], r["anchorName"], r["nickname"]),
            )
            inserted_anchors += 1
        except sqlite3.Error as e:
            errors.append({"row": r["row"], "error": f"DB 写入失败: {e}"})

    for r in a_update:
        try:
            cur.execute(
                "UPDATE QianchuanAnchor SET anchorName = ?, nickname = ?, lastSeenAt = datetime('now') "
                "WHERE advertiserId = ? AND anchorId = ?",
                (r["anchorName"], r["nickname"], r["advertiserId"], r["anchorId"]),
            )
            updated_anchors += 1
        except sqlite3.Error as e:
            errors.append({"row": r["row"], "error": f"DB 写入失败: {e}"})

    for r in a_delete:
        try:
            cur.execute(
                "DELETE FROM QianchuanAnchor WHERE advertiserId = ? AND anchorId = ?",
                (r["advertiserId"], r["anchorId"]),
            )
            deleted_anchors += 1
        except sqlite3.Error as e:
            errors.append({"row": 0, "error": f"DB 删除失败: {e}"})

    for r in d_add:
        try:
            cur.execute(
                "INSERT INTO QianchuanAdvertiser (id, tokenId, advertiserId, nickname, createdAt) "
                "VALUES (lower(hex(randomblob(12))), ?, ?, ?, datetime('now'))",
                (r["tokenId"], r["advertiserId"], r["nickname"]),
            )
            inserted_advertisers += 1
        except sqlite3.Error as e:
            errors.append({"row": r["row"], "error": f"DB 写入失败: {e}"})

    for r in d_update:
        try:
            cur.execute(
                "UPDATE QianchuanAdvertiser SET nickname = ? WHERE id = ?",
                (r["nickname"], r["tokenId"]),
            )
            updated_advertisers += 1
        except sqlite3.Error as e:
            errors.append({"row": r["row"], "error": f"DB 写入失败: {e}"})

    for r in d_delete:
        try:
            cur.execute(
                "DELETE FROM QianchuanAdvertiser WHERE advertiserId = ? AND tokenId = (SELECT id FROM QianchuanToken WHERE appId = ?)",
                (r["advertiserId"], r["tokenAppId"]),
            )
            deleted_advertisers += 1
        except sqlite3.Error as e:
            errors.append({"row": 0, "error": f"DB 删除失败: {e}"})

    conn.commit()
    conn.close()
    print(
        json.dumps(
            {
                "ok": True,
                "insertedAnchors": inserted_anchors,
                "updatedAnchors": updated_anchors,
                "deletedAnchors": deleted_anchors,
                "insertedAdvertisers": inserted_advertisers,
                "updatedAdvertisers": updated_advertisers,
                "deletedAdvertisers": deleted_advertisers,
                "errors": errors[:50],
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("export")
    sp.add_argument("out")
    sp.add_argument("--advertiser-id", default=None)
    sp = sub.add_parser("template")
    sp.add_argument("out")
    sp = sub.add_parser("preview")
    sp.add_argument("in_")
    sp = sub.add_parser("apply")
    sp.add_argument("in_")
    args = p.parse_args()

    if args.cmd == "export":
        cmd_export(args.out, args.advertiser_id)
    elif args.cmd == "template":
        cmd_template(args.out)
    elif args.cmd == "preview":
        cmd_preview(args.in_)
    elif args.cmd == "apply":
        cmd_apply(args.in_)


if __name__ == "__main__":
    main()
