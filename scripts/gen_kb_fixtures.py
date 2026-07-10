#!/usr/bin/env python3
"""知识库测试样本生成器.

依赖 (一次性安装):
    pip install fpdf2 python-docx python-pptx openpyxl "xlrd==1.2.0" Pillow

生成所有 KB 端到端测试需要的样本文件到 test/fixtures/kb/.

用法:
    python scripts/gen_kb_fixtures.py            # 生成全部
    python scripts/gen_kb_fixtures.py --only pdf # 仅生成 PDF
    python scripts/gen_kb_fixtures.py --out test/fixtures/kb  # 自定义输出目录
    python scripts/gen_kb_fixtures.py --clean   # 先清空输出目录
"""

import argparse
import os
import random
import struct
import sys
from pathlib import Path
from typing import Iterable

# 第三方库 (按需 import, 失败时给出明确错误)
try:
    from fpdf import FPDF
except ImportError:
    print("缺少 fpdf2: pip install fpdf2", file=sys.stderr)
    raise

try:
    from docx import Document as DocxDocument
except ImportError:
    print("缺少 python-docx: pip install python-docx", file=sys.stderr)
    raise

try:
    from pptx import Presentation
    from pptx.util import Inches, Pt
except ImportError:
    print("缺少 python-pptx: pip install python-pptx", file=sys.stderr)
    raise

try:
    from openpyxl import Workbook
except ImportError:
    print("缺少 openpyxl: pip install openpyxl", file=sys.stderr)
    raise

try:
    from PIL import Image
except ImportError:
    print("缺少 Pillow: pip install Pillow", file=sys.stderr)
    raise

# 写 .xls 用 xlrd 1.2.0 (read only, 我们要写文件所以这里用 openpyxl 转 xls 不行)
# xlrd 2.x 不支持 .xls. 1.2.0 支持. 但 xlrd 1.2.0 写入也很麻烦,
# 简单做法: 把 .xlsx 直接复制成 .xls (Excel 通常能识别),或者用 struct 手写最小 .xls 文件.
# 这里走第三条路: 用 xlwt (只写,版本独立), 如果没装就用最小手工 .xls.
try:
    import xlwt  # type: ignore
    HAS_XLWT = True
except ImportError:
    HAS_XLWT = False


# 中英文混排文案池, 让抽取后的文字能被检索测试命中关键词
SAMPLE_TEXT = "鱼子酱面膜抗老紧致618种草文案小红书抖音"
SAMPLE_LONG = ("鱼子酱面膜 抗老紧致 618 主图 推荐话术 "
               + " ".join(["小红书 抖音 种草 卖点"] * 200))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="生成 KB 测试样本")
    p.add_argument("--out", default="test/fixtures/kb", help="输出目录")
    p.add_argument("--only", choices=["pdf", "docx", "pptx", "excel", "image", "txt", "edge"],
                   help="只生成某类样本")
    p.add_argument("--clean", action="store_true", help="先清空输出目录")
    p.add_argument("--seed", type=int, default=42, help="随机种子 (保证样本可复现)")
    return p.parse_args()


def ensure_clean(out: Path, clean: bool) -> None:
    out.mkdir(parents=True, exist_ok=True)
    if clean:
        for f in out.iterdir():
            if f.is_file():
                f.unlink()
            elif f.is_dir():
                import shutil
                shutil.rmtree(f)


# ============ TXT (prompt / document) ============

def gen_txt_samples(out: Path) -> list[Path]:
    written = []

    # F-TXT-1: prompt, 1KB
    p = out / "F-TXT-1-prompt.txt"
    p.write_text(f"# 提示词: 鱼子酱面膜种草文案\n\n{SAMPLE_TEXT}\n\n要求: 200字以内, emoji 丰富.\n",
                 encoding="utf-8")
    # 补到 1KB
    with p.open("a", encoding="utf-8") as f:
        f.write(("参考品牌话术: " + SAMPLE_TEXT + "\n") * 15)
    written.append(p)

    # F-TXT-2: document, 1KB
    p = out / "F-TXT-2-document.txt"
    p.write_text(f"# 品牌话术模板\n\n## 主推卖点\n- {SAMPLE_TEXT}\n- 抗老紧致 28 天\n",
                 encoding="utf-8")
    written.append(p)

    # F-EMPTY: 0B
    p = out / "F-EMPTY.txt"
    p.write_text("", encoding="utf-8")
    written.append(p)

    return written


# ============ PDF (custom FlateDecode) ============

def find_cjk_font() -> str | None:
    """在 Windows / Linux / macOS 上找一个支持 CJK 的 TTF/TTC."""
    candidates = [
        "C:/Windows/Fonts/NotoSansSC-VF.ttf",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None


def gen_pdf_samples(out: Path) -> list[Path]:
    written = []
    font_path = find_cjk_font()
    if not font_path:
        print("[warn] 未找到 CJK 字体, PDF 用纯英文 + 中文 unicode 码点对照表 (内容能检索但渲染可能异常)",
              file=sys.stderr)
        font_path = None

    def make_pdf(target_size_kb: int, pages: int) -> FPDF:
        pdf = FPDF()
        if font_path:
            pdf.add_font("CJK", "", font_path)
            pdf.add_font("CJK", "B", font_path)
            font_name = "CJK"
        else:
            font_name = "Helvetica"
        for page in range(pages):
            pdf.add_page()
            pdf.set_font(font_name, size=10)
            for i in range(40):
                text = f"Page {page + 1} Line {i:03d}: {SAMPLE_TEXT}"
                pdf.cell(0, 5, text, new_x="LMARGIN", new_y="NEXT")
        return pdf

    # F-PDF-1: 500KB, 单页纯文字
    pdf = make_pdf(target_size_kb=500, pages=12)
    p = out / "F-PDF-1-single-page.pdf"
    pdf.output(str(p))
    written.append(p)

    # F-PDF-2: 8MB, 50 页 (FlateDecode 压缩)
    pdf = make_pdf(target_size_kb=8_000, pages=80)
    p = out / "F-PDF-2-multipage-large.pdf"
    pdf.output(str(p))
    written.append(p)

    # F-PDF-3: 损坏文件 (截断字节)
    pdf = make_pdf(target_size_kb=50, pages=2)
    p = out / "F-PDF-3-corrupted.pdf"
    pdf.output(str(p))
    raw = p.read_bytes()
    p.write_bytes(raw[: len(raw) // 3])
    written.append(p)

    return written


# ============ DOCX (ZIP-based OOXML) ============

def gen_docx_samples(out: Path) -> list[Path]:
    written = []

    # F-DOC-1: 100KB, 含图 + 表 + 中英文混排
    doc = DocxDocument()
    doc.add_heading("鱼子酱面膜 主推资料", level=1)
    for i in range(20):
        doc.add_heading(f"卖点 {i + 1}", level=2)
        doc.add_paragraph(f"{SAMPLE_TEXT} - {SAMPLE_LONG[:200]}")
        # 加一个表格
        table = doc.add_table(rows=3, cols=2)
        table.cell(0, 0).text = "维度"
        table.cell(0, 1).text = "卖点"
        table.cell(1, 0).text = "抗老"
        table.cell(1, 1).text = "28 天紧致"
        table.cell(2, 0).text = "保湿"
        table.cell(2, 1).text = "72h 持续"
    p = out / "F-DOC-1-mixed.docx"
    doc.save(str(p))
    written.append(p)

    # F-DOC-2: 5MB, 大量重复段落 (性能基准)
    doc = DocxDocument()
    doc.add_heading("性能测试样本", level=1)
    long_para = (SAMPLE_LONG + " ") * 50  # 约 13KB
    for i in range(400):
        doc.add_paragraph(f"#{i:04d} {long_para}")
    p = out / "F-DOC-2-large.docx"
    doc.save(str(p))
    written.append(p)

    return written


# ============ PPTX (ZIP-based OOXML) ============

def gen_pptx_samples(out: Path) -> list[Path]:
    written = []

    # F-PPT-1: 2MB, 20 页含文本框
    prs = Presentation()
    for page in range(20):
        slide = prs.slides.add_slide(prs.slide_layouts[1])
        slide.shapes.title.text = f"主图卖点 {page + 1}"
        slide.placeholders[1].text = f"{SAMPLE_TEXT}\n抗老紧致 28 天\n618 推荐"
    p = out / "F-PPT-1-multipage.pptx"
    prs.save(str(p))
    written.append(p)

    # F-PPT-2: 5MB .ppt (旧二进制) — 用 .pptx 内容直接复制, 上传时会被识别为 document 占位
    # 因为 extractor 对 .ppt 返回占位, 这里只是验证占位路径
    src = out / "F-PPT-2-legacy.ppt"
    prs2 = Presentation()
    for page in range(60):
        slide = prs2.slides.add_slide(prs2.slide_layouts[1])
        slide.shapes.title.text = f"Legacy {page + 1}"
        slide.placeholders[1].text = SAMPLE_TEXT * 30
    # 先存为 pptx, 再改后缀
    tmp = out / "_F-PPT-2-tmp.pptx"
    prs2.save(str(tmp))
    raw = tmp.read_bytes()
    src.write_bytes(raw)
    tmp.unlink()
    written.append(src)

    return written


# ============ Excel (xlsx / xls) ============

def gen_excel_samples(out: Path) -> list[Path]:
    written = []

    # F-EXCEL-1: 50KB, 3 sheet / 100 行 / 中文表头
    wb = Workbook()
    ws = wb.active
    ws.title = "主推话术"
    ws.append(["产品名", "卖点", "目标人群", "渠道"])
    for i in range(100):
        ws.append([f"鱼子酱面膜-{i}", SAMPLE_TEXT, "25-35 女性", "小红书/抖音"])
    # 加几个 sheet
    for name in ["618 排期", "KOL 名册"]:
        s = wb.create_sheet(title=name)
        for i in range(50):
            s.append([f"row{i}", SAMPLE_TEXT])
    p = out / "F-EXCEL-1-multi-sheet.xlsx"
    wb.save(str(p))
    written.append(p)

    # F-EXCEL-2: 10MB, 10 sheet / 10 万行
    wb = Workbook()
    ws = wb.active
    ws.title = "主数据"
    ws.append(["ID", "名称", "卖点", "备注"])
    for i in range(10_000):
        ws.append([i, f"鱼子酱面膜-{i}", SAMPLE_TEXT, "x" * 200])
    for n in range(9):
        s = wb.create_sheet(title=f"sheet{n + 1}")
        for i in range(11_000):
            s.append([i, SAMPLE_TEXT, "x" * 100])
    p = out / "F-EXCEL-2-large.xlsx"
    wb.save(str(p))
    written.append(p)

    # F-EXCEL-3: 1MB .xls (二进制, xlrd 1.2.0 才能读)
    if HAS_XLWT:
        book = xlwt.Workbook(encoding="utf-8")
        for s in range(5):
            sheet = book.add_sheet(f"sheet{s + 1}")
            sheet.write(0, 0, "产品")
            sheet.write(0, 1, "卖点")
            for i in range(2000):
                sheet.write(i + 1, 0, f"鱼子酱面膜-{i}")
                sheet.write(i + 1, 1, SAMPLE_TEXT)
        p = out / "F-EXCEL-3-legacy.xls"
        book.save(str(p))
        written.append(p)
    else:
        print("[warn] xlwt 未装, 跳过 F-EXCEL-3 (pip install xlwt)", file=sys.stderr)

    return written


# ============ Images ============

def gen_image_samples(out: Path) -> list[Path]:
    written = []

    # F-IMG-1: 2MB PNG 白底图
    p = out / "F-IMG-1-product.png"
    img = Image.new("RGB", (1920, 1920), (255, 255, 255))
    img.save(str(p), optimize=False)
    written.append(p)

    # F-IMG-2: 8MB JPG 4K 人像
    p = out / "F-IMG-2-portrait.jpg"
    img = Image.new("RGB", (3840, 2160), (245, 240, 235))
    img.save(str(p), quality=95)
    written.append(p)

    # F-IMG-3: 50MB PSD (伪造 header)
    p = out / "F-IMG-3-template.psd"
    # PSD 文件头: 8BPS + 版本(2) + reserved(6) + channels(2) + height(4) + width(4) + ...
    header = b"8BPS" + struct.pack(">H", 1) + b"\x00" * 6
    header += struct.pack(">H", 4)  # 4 通道 (RGBA)
    header += struct.pack(">I", 4096)  # height
    header += struct.pack(">I", 4096)  # width
    header += struct.pack(">H", 8)  # depth
    header += struct.pack(">H", 3)  # color mode = RGB
    header += b"\x00" * 4 + struct.pack(">I", 0)  # mode data
    padding = b"\x00" * (50 * 1024 * 1024)
    p.write_bytes(header + padding)
    written.append(p)

    return written


# ============ Edge cases ============

def gen_edge_samples(out: Path) -> list[Path]:
    written = []

    # F-LONG-NAME: 200 字符含 CJK + emoji
    base = "鱼子酱-抗老-紧致-种草-"
    long_name = (base * 10)[:200]
    p = out / f"F-LONG-NAME-{long_name}.txt"
    p.write_text(SAMPLE_TEXT, encoding="utf-8")
    written.append(p)

    # F-BAD-EXT: 不支持的扩展名
    p = out / "F-BAD-EXT-data.xyz"
    p.write_text(SAMPLE_TEXT, encoding="utf-8")
    written.append(p)

    return written


# ============ 主流程 ============

GENERATORS = {
    "txt": gen_txt_samples,
    "pdf": gen_pdf_samples,
    "docx": gen_docx_samples,
    "pptx": gen_pptx_samples,
    "excel": gen_excel_samples,
    "image": gen_image_samples,
    "edge": gen_edge_samples,
}


def main() -> int:
    args = parse_args()
    out = Path(args.out)
    random.seed(args.seed)

    ensure_clean(out, args.clean)

    print(f"[fixtures] 输出目录: {out.resolve()}")
    if args.only:
        targets = {args.only}
    else:
        targets = set(GENERATORS.keys())

    all_written: list[Path] = []
    for name in sorted(targets):
        gen = GENERATORS[name]
        try:
            written = gen(out)
            for p in written:
                size_kb = p.stat().st_size / 1024
                print(f"  [OK] {p.name} ({size_kb:.1f} KB)")
            all_written.extend(written)
        except Exception as e:
            print(f"  [FAIL] {name}: {e}", file=sys.stderr)
            return 1

    print(f"\n[fixtures] 共生成 {len(all_written)} 个文件, 总大小 "
          f"{sum(p.stat().st_size for p in all_written) / (1024 * 1024):.1f} MB")
    print(f"[fixtures] 下一步: bash scripts/run_kb_e2e.sh --server http://localhost:3000")
    return 0


if __name__ == "__main__":
    sys.exit(main())