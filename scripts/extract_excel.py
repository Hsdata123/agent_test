#!/usr/bin/env python3
"""Extract text from .xls/.xlsx/.xlsm files for the knowledge base.

Usage: python extract_excel.py <file_path>
Output: plain text on stdout, one section per sheet.
        Sheet header: <sheet name>
        Rows: cells joined with " | "
"""
import io
import os
import sys


def format_value(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value).strip()


def trim_trailing(cells):
    while cells and not cells[-1]:
        cells.pop()
    return cells


def extract_xlsx(path):
    try:
        from openpyxl import load_workbook
    except ImportError:
        sys.stderr.write("需要安装 openpyxl：pip install openpyxl\n")
        sys.exit(2)
    wb = load_workbook(path, data_only=True)
    sheet_names = list(wb.sheetnames)
    sys.stderr.write("[excel] 共发现 %d 个工作表：%s\n" % (len(sheet_names), "、".join(sheet_names)))
    sections = []
    for sheet_name in sheet_names:
        try:
            sheet = wb[sheet_name]
            rows = []
            for row in sheet.iter_rows(values_only=True):
                cells = trim_trailing([format_value(cell) for cell in row])
                if any(cells):
                    rows.append(" | ".join(cells))
            if rows:
                sections.append("=== Sheet: %s ===\n%s" % (sheet_name, "\n".join(rows)))
                sys.stderr.write("[excel] 工作表「%s」解析 %d 行\n" % (sheet_name, len(rows)))
            else:
                sys.stderr.write("[excel] 工作表「%s」为空，已跳过\n" % sheet_name)
        except Exception as e:
            sys.stderr.write("[excel] 工作表「%s」解析失败：%s\n" % (sheet_name, e))
    return "\n\n".join(sections)


def extract_xls(path):
    try:
        import xlrd
    except ImportError:
        sys.stderr.write("需要安装 xlrd==1.2.0：pip install 'xlrd==1.2.0'\n")
        sys.exit(2)
    version = tuple(int(x) for x in xlrd.__VERSION__.split(".")[:2] if x.isdigit())
    if version >= (2, 0):
        sys.stderr.write(
            "当前 xlrd 版本 %s 已不支持 .xls（2.0+ 仅支持 .xlsx）。\n"
            "请降级：pip install 'xlrd==1.2.0'\n" % xlrd.__VERSION__
        )
        sys.exit(2)
    wb = xlrd.open_workbook(path)
    sheet_names = [sheet.name for sheet in wb.sheets()]
    sys.stderr.write("[excel] 共发现 %d 个工作表：%s\n" % (len(sheet_names), "、".join(sheet_names)))
    sections = []
    for sheet in wb.sheets():
        try:
            rows = []
            for row_idx in range(sheet.nrows):
                row = sheet.row_values(row_idx)
                cells = []
                for raw in row:
                    if isinstance(raw, float) and raw == int(raw):
                        cells.append(str(int(raw)))
                    else:
                        cells.append(format_value(raw))
                trim_trailing(cells)
                if any(cells):
                    rows.append(" | ".join(cells))
            if rows:
                sections.append("=== Sheet: %s ===\n%s" % (sheet.name, "\n".join(rows)))
                sys.stderr.write("[excel] 工作表「%s」解析 %d 行\n" % (sheet.name, len(rows)))
            else:
                sys.stderr.write("[excel] 工作表「%s」为空，已跳过\n" % sheet.name)
        except Exception as e:
            sys.stderr.write("[excel] 工作表「%s」解析失败：%s\n" % (sheet.name, e))
    return "\n\n".join(sections)


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: python extract_excel.py <file_path>\n")
        sys.exit(1)
    path = sys.argv[1]
    if not os.path.exists(path):
        sys.stderr.write("文件不存在：%s\n" % path)
        sys.exit(1)
    ext = os.path.splitext(path)[1].lower()
    if ext in (".xlsx", ".xlsm"):
        output = extract_xlsx(path)
    elif ext == ".xls":
        output = extract_xls(path)
    else:
        sys.stderr.write("不支持的格式：%s\n" % ext)
        sys.exit(1)
    sys.stdout.write(output)


if __name__ == "__main__":
    # Force UTF-8 output on Windows
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")
    except Exception:
        pass
    main()
