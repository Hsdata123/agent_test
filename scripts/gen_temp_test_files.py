#!/usr/bin/env python3
"""生成 tempTestFile/ 测试样本 (按指定格式 × 尺寸 矩阵).

格式 (不含图片): txt, md, csv, docx, pdf, pptx, xlsx
尺寸: 1M, 10M, 100M (允许 ±10% 误差)
内容: 每文件独立主题, 让 AI 对话能根据查询主题区分命中

依赖:
    pip install fpdf2 python-docx python-pptx openpyxl Pillow

用法:
    python scripts/gen_temp_test_files.py
    python scripts/gen_temp_test_files.py --only txt --sizes 1m
    python scripts/gen_temp_test_files.py --out custom_dir
"""

import argparse
import csv
import os
import random
import sys
import time
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="生成 tempTestFile 测试样本")
    p.add_argument("--out", default="tempTestFile", help="输出目录")
    p.add_argument("--only", default="",
                   help="逗号分隔的格式 (txt,md,csv,docx,pdf,pptx,xlsx), 空=全部")
    p.add_argument("--sizes", default="1m,10m,100m",
                   help="逗号分隔的尺寸 (1m/10m/100m)")
    p.add_argument("--seed", type=int, default=42)
    return p.parse_args()


# ============ 主题池: 每文件独立主题, 让 AI 能区分 ============

THEMES = {
    # format -> { size -> theme }
    ("txt", "1m"): {
        "title": "鱼子酱面膜小红书种草文案",
        "keywords": "鱼子酱 抗老 紧致 小红书 种草 文案",
        "body": (
            "鱼子酱抗老紧致面膜, 28 天见证年轻光感. 主推小红书与抖音双平台.\n"
            "适用人群: 25-40 岁轻熟肌, 熬夜党, 化妆频繁.\n"
            "卖点拆解:\n"
            "  - 鱼子酱精粹: 抗老成分扛把子, 激活胶原蛋白\n"
            "  - 玻尿酸深透: 72h 长效保湿\n"
            "  - 烟酰胺亮肤: 均匀肤色淡化色斑\n"
            "618 价格策略: 买 2 送 1, 直播间专享 199 元 3 盒.\n"
            "小红书爆文公式: 痛点引入 → 成分拆解 → 效果对比 → 限时优惠.\n"
            "推荐 KOL: 美妆垂类 / 成分党 / 学生党."
        ),
    },
    ("txt", "10m"): {
        "title": "美妆品牌全年营销日历",
        "keywords": "美妆 营销日历 全年 节点 排期",
        "body_seed": "marketing_calendar_2026",
        "padding_topic": "电商营销节点 + 排期表",
    },
    ("txt", "100m"): {
        "title": "电商运营百科全书",
        "keywords": "电商 运营 百科 选品 投放 复盘",
        "body_seed": "ecommerce_ops_wiki",
        "padding_topic": "电商运营全链路知识",
    },

    ("md", "1m"): {
        "title": "AI 客服话术 SOP",
        "keywords": "AI 客服 话术 SOP 售后",
        "body": (
            "# AI 客服话术 SOP\n\n"
            "## 售前咨询\n"
            "- 询问肤质 / 年龄 / 痛点 → 推荐对应产品线\n"
            "- 报价格 → 强调性价比 + 满减\n\n"
            "## 售后问题\n"
            "- 过敏 → 7 天无理由退换 + 客服跟进\n"
            "- 物流 → 24h 内发货 + 顺丰包邮\n\n"
            "## 催付话术\n"
            "限时优惠倒计时 3-2-1, 制造紧迫感."
        ),
    },
    ("md", "10m"): {
        "title": "产品成分科普长文",
        "keywords": "成分 科普 烟酰胺 玻尿酸 视黄醇",
        "body_seed": "skincare_ingredients_2026",
        "padding_topic": "护肤成分详解",
    },
    ("md", "100m"): {
        "title": "团队管理手册",
        "keywords": "团队 管理 OKR 复盘 流程",
        "body_seed": "team_management_handbook",
        "padding_topic": "团队管理与组织效率",
    },

    ("csv", "1m"): {
        "title": "KOL 投放名单",
        "headers": ["KOL ID", "平台", "粉丝量", "领域", "报价", "联系方式"],
        "rows": 5000,
    },
    ("csv", "10m"): {
        "title": "用户行为埋点日志",
        "headers": ["timestamp", "user_id", "event", "page", "duration_ms", "device"],
        "rows": 80_000,
    },
    ("csv", "100m"): {
        "title": "订单全量日志",
        "headers": ["order_id", "user_id", "sku", "qty", "price", "status", "channel", "city", "created_at"],
        "rows": 1_200_000,
    },

    ("docx", "1m"): {
        "title": "618 大促整体策划案",
        "keywords": "618 大促 策划 节奏 投放",
        "body_seed": "promotion_618_plan",
        "padding_topic": "618 大促全流程策划",
    },
    ("docx", "10m"): {
        "title": "鱼子酱面膜产品白皮书",
        "keywords": "鱼子酱 白皮书 产品 卖点 临床",
        "body_seed": "caviar_whitepaper",
        "padding_topic": "鱼子酱产品深度技术白皮书",
    },
    ("docx", "100m"): {
        "title": "公司年度战略报告",
        "keywords": "年度 战略 OKR 复盘 增长",
        "body_seed": "annual_strategy_2026",
        "padding_topic": "公司年度战略与运营复盘",
    },

    ("pdf", "1m"): {
        "title": "产品手册 2026 版",
        "keywords": "产品手册 卖点 适用人群 价格",
        "body_seed": "product_brochure_2026",
        "padding_topic": "产品综合介绍手册",
    },
    ("pdf", "10m"): {
        "title": "市场调研报告",
        "keywords": "市场调研 竞品 趋势 用户画像",
        "body_seed": "market_research_report",
        "padding_topic": "美妆行业市场深度调研",
    },
    ("pdf", "100m"): {
        "title": "财务审计底稿",
        "keywords": "财务 审计 底稿 合规",
        "body_seed": "financial_audit_papers",
        "padding_topic": "财务审计全量底稿归档",
    },

    ("pptx", "1m"): {
        "title": "618 主图文案方案",
        "keywords": "主图 文案 排版 卖点",
        "body_seed": "618_main_image_ppt",
        "padding_topic": "618 主图视觉方案",
    },
    ("pptx", "10m"): {
        "title": "品牌视觉规范手册",
        "keywords": "品牌 视觉 VI 规范 配色",
        "body_seed": "brand_visual_guideline",
        "padding_topic": "品牌视觉识别规范",
    },
    ("pptx", "100m"): {
        "title": "年度汇报材料",
        "keywords": "年度 汇报 KPI 增长 规划",
        "body_seed": "annual_review_ppt",
        "padding_topic": "公司年度总结与规划",
    },

    ("xlsx", "1m"): {
        "title": "投放排期表",
        "headers": ["日期", "渠道", "素材", "出价", "预算", "负责人"],
        "rows": 15_000,
    },
    ("xlsx", "10m"): {
        "title": "用户标签画像",
        "headers": ["user_id", "age", "gender", "city", "tag", "lifecycle", "ltv", "churn_risk"],
        "rows": 100_000,
    },
    ("xlsx", "100m"): {
        "title": "全量交易明细",
        "headers": ["order_id", "user_id", "sku_id", "qty", "unit_price", "discount", "final_price", "channel", "city", "created_at", "paid_at", "status"],
        "rows": 800_000,
    },
}


SIZE_TARGETS = {"1m": 1 * 1024 * 1024, "10m": 10 * 1024 * 1024, "100m": 100 * 1024 * 1024}


# ============ 内容生成辅助 ============

def _para_unit(theme: dict) -> str:
    title = theme["title"]
    keywords = theme.get("keywords", "")
    padding_topic = theme.get("padding_topic", title)
    return (
        f"## 章节 {{n}}\n"
        f"本节讨论主题 '{padding_topic}' 的细分内容, 章节序号 {{n}}.\n"
        f"要点 {{n}}.1: 围绕核心关键词 [{keywords}] 展开, "
        f"涉及业务场景 (主题: {padding_topic}) 的关键指标和实施步骤.\n"
        f"要点 {{n}}.2: 实操环节, 包括准备 / 执行 / 复盘三个阶段. "
        f"每个阶段产出物明确, 责任到人.\n"
        f"要点 {{n}}.3: 风险点识别, 重点关注合规与数据一致性. "
        f"对应到 '{padding_topic}' 的业务约束.\n\n"
    )


def _header(theme: dict) -> list[str]:
    title = theme["title"]
    keywords = theme.get("keywords", "")
    padding_topic = theme.get("padding_topic", title)
    head = [
        f"# {title}",
        "",
        f"关键词: {keywords}",
        "",
        f"## 概述",
        f"本文档主题: {padding_topic}. 用于检索验证 (主题: {title}).",
        "",
    ]
    if "body" in theme:
        head.append(theme["body"])
        head.append("")
    return head


def _para_size(p: str) -> int:
    return len(p.encode("utf-8"))


def gen_paragraphs(theme: dict, target_bytes: int, max_paras: int = 2_000_000) -> list[str]:
    """生成多段话, 主题相关且总字节数接近 target."""
    lines = _header(theme)
    unit = _para_unit(theme)
    total = sum(_para_size(p) for p in lines)
    n = 0
    while total < target_bytes and n < max_paras:
        n += 1
        para = unit.format(n=n)
        lines.append(para)
        total += _para_size(para)
    return lines


def gen_csv_rows(theme: dict, target_bytes: int):
    """生成 CSV 数据."""
    headers = theme["headers"]
    rows = theme.get("rows", 10_000)
    # 每行大约 80-200 字节, 用目标反推行数
    avg_row = 120
    needed = max(rows, target_bytes // avg_row)
    return headers, needed


# ============ 各格式生成器 ============

def gen_txt(out: Path, size: str, theme: dict) -> Path:
    target = SIZE_TARGETS[size]
    safe_name = theme["title"].replace("/", "-").replace(":", "-")
    p = out / f"sample-{safe_name}-{size}.txt"
    with p.open("w", encoding="utf-8") as f:
        # 写头部
        for line in _header(theme):
            f.write(line + "\n")
        # 流式写段落, 写一段算一次字节
        unit = _para_unit(theme)
        written = sum(_para_size(line) for line in _header(theme))
        n = 0
        while written < target:
            n += 1
            para = unit.format(n=n)
            f.write(para)
            written += _para_size(para)
    return p


def gen_md(out: Path, size: str, theme: dict) -> Path:
    target = SIZE_TARGETS[size]
    safe_name = theme["title"].replace("/", "-").replace(":", "-")
    p = out / f"sample-{safe_name}-{size}.md"
    with p.open("w", encoding="utf-8") as f:
        for line in _header(theme):
            f.write(line + "\n")
        unit = _para_unit(theme)
        written = sum(_para_size(line) for line in _header(theme))
        n = 0
        while written < target:
            n += 1
            para = unit.format(n=n)
            f.write(para)
            written += _para_size(para)
    return p


def gen_csv(out: Path, size: str, theme: dict) -> Path:
    target = SIZE_TARGETS[size]
    headers, rows = gen_csv_rows(theme, target)
    safe_name = theme["title"].replace("/", "-").replace(":", "-")
    p = out / f"sample-{safe_name}-{size}.csv"
    rng = random.Random(theme.get("body_seed", theme["title"]))
    with p.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(headers)
        for i in range(rows):
            row = [
                i,
                f"user_{rng.randint(1, 1_000_000)}",
                theme["title"][:10],
                rng.randint(1, 99),
                round(rng.uniform(10, 999), 2),
                rng.choice(["paid", "pending", "refunded", "shipped"]),
                rng.choice(["app", "h5", "miniprogram", "web"]),
                rng.choice(["北京", "上海", "广州", "深圳", "杭州"]),
                f"2026-{rng.randint(1,12):02d}-{rng.randint(1,28):02d}",
            ]
            w.writerow(row)
    return p


def gen_docx(out: Path, size: str, theme: dict) -> Path:
    """DOCX 是 ZIP+FlateDecode 强压缩, 实际产物远小于源文本. 设段数上限避免几小时等待."""
    from docx import Document
    target = SIZE_TARGETS[size]
    cap = {"1m": 20_000, "10m": 50_000, "100m": 200_000}[size]
    safe_name = theme["title"].replace("/", "-").replace(":", "-")
    p = out / f"sample-{safe_name}-{size}.docx"
    doc = Document()
    # 头部
    title_seen = False
    for line in _header(theme):
        if line.startswith("# "):
            doc.add_heading(line.lstrip("# ").strip(), level=1)
            title_seen = True
        elif line.startswith("## "):
            doc.add_heading(line.lstrip("# ").strip(), level=2)
        elif line.strip():
            doc.add_paragraph(line)
    # 流式填充
    unit = _para_unit(theme)
    n = 0
    for n in range(1, cap + 1):
        para = unit.format(n=n)
        doc.add_paragraph(para)
        # 写盘检查 (避免 docx 内部膨胀)
        if n % 2000 == 0:
            doc.save(str(p))
            if p.stat().st_size >= target:
                break
    else:
        doc.save(str(p))
    return p


def gen_pdf(out: Path, size: str, theme: dict) -> Path:
    from fpdf import FPDF
    target = SIZE_TARGETS[size]
    cap = {"1m": 50_000, "10m": 200_000, "100m": 1_500_000}[size]
    safe_name = theme["title"].replace("/", "-").replace(":", "-")
    p = out / f"sample-{safe_name}-{size}.pdf"

    font_path = None
    candidates = [
        "C:/Windows/Fonts/NotoSansSC-VF.ttf",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
    ]
    for c in candidates:
        if Path(c).exists():
            font_path = c
            break

    pdf = FPDF()
    if font_path:
        pdf.add_font("CJK", "", font_path)
        pdf.add_font("CJK", "B", font_path)
        font_name = "CJK"
    else:
        font_name = "Helvetica"

    pdf.add_page()
    pdf.set_font(font_name, size=10)
    line_count = 0

    def emit_para(text: str):
        nonlocal line_count
        for line in text.split("\n"):
            line_count += 1
            if not line.strip():
                pdf.ln(4)
                continue
            if line.startswith("# "):
                pdf.set_font(font_name, "B", 14)
                pdf.cell(0, 8, line.lstrip("# ").strip(), new_x="LMARGIN", new_y="NEXT")
                pdf.set_font(font_name, size=10)
            elif line.startswith("## "):
                pdf.set_font(font_name, "B", 12)
                pdf.cell(0, 6, line.lstrip("# ").strip(), new_x="LMARGIN", new_y="NEXT")
                pdf.set_font(font_name, size=10)
            else:
                chunks = [line[i:i+60] for i in range(0, len(line), 60)]
                for ch in chunks:
                    pdf.cell(0, 5, ch, new_x="LMARGIN", new_y="NEXT")
        if line_count > 50:
            pdf.add_page()
            line_count = 0

    for line in _header(theme):
        emit_para(line)
    unit = _para_unit(theme)
    for n in range(1, cap + 1):
        emit_para(unit.format(n=n))
        # PDF 不易估算 in-memory 大小, 写到 cap 为止

    pdf.output(str(p))
    return p


def gen_pptx(out: Path, size: str, theme: dict) -> Path:
    from pptx import Presentation
    from pptx.util import Pt
    target = SIZE_TARGETS[size]
    # PPTX 也是 ZIP, 段数上限防 100M 卡死
    cap = {"1m": 10_000, "10m": 50_000, "100m": 200_000}[size]
    safe_name = theme["title"].replace("/", "-").replace(":", "-")
    p = out / f"sample-{safe_name}-{size}.pptx"
    prs = Presentation()
    chunk_size = 30

    # 流式生成 slide, 用 n 索引替代预先生成 paras
    for i in range(0, cap, chunk_size):
        slide = prs.slides.add_slide(prs.slide_layouts[1])
        slide.shapes.title.text = theme["title"]
        body = slide.placeholders[1]
        tf = body.text_frame
        tf.text = ""
        for j in range(chunk_size):
            n = i + j + 1
            if n > cap:
                break
            para = _para_unit(theme).format(n=n)
            if j == 0:
                p_obj = tf.paragraphs[0]
            else:
                p_obj = tf.add_paragraph()
            p_obj.text = para[:120]
            p_obj.font.size = Pt(10)

        # 每 100 张幻灯片存盘检查
        if (i // chunk_size) % 100 == 0 and i > 0:
            prs.save(str(p))
            if p.stat().st_size >= target:
                break

    prs.save(str(p))
    return p


def gen_xlsx(out: Path, size: str, theme: dict) -> Path:
    from openpyxl import Workbook
    target = SIZE_TARGETS[size]
    # XLSX 也是 ZIP, 设行数上限避免 100M 目标耗时过长
    row_cap = {"1m": 30_000, "10m": 200_000, "100m": 1_500_000}[size]
    headers, rows = gen_csv_rows(theme, target * 3)
    rows = min(rows, row_cap)

    wb = Workbook()
    ws = wb.active
    ws.title = theme["title"][:20]
    ws.append(headers)

    rng = random.Random(theme.get("body_seed", theme["title"]))
    safe_name = theme["title"].replace("/", "-").replace(":", "-")
    p = out / f"sample-{safe_name}-{size}.xlsx"

    for i in range(rows):
        row = [
            i,
            f"user_{rng.randint(1, 1_000_000)}",
            theme["title"][:10],
            rng.randint(1, 99),
            round(rng.uniform(10, 999), 2),
            rng.choice(["paid", "pending", "refunded"]),
            rng.choice(["app", "h5", "web"]),
            rng.choice(["北京", "上海", "广州", "深圳"]),
            f"2026-{rng.randint(1,12):02d}-{rng.randint(1,28):02d}",
            f"x" * rng.randint(50, 200),
            round(rng.uniform(0, 1), 2),
        ]
        ws.append(row)
        if i > 0 and i % 5_000 == 0:
            wb.save(str(p))
            if p.stat().st_size >= target:
                break
    wb.save(str(p))
    return p


GENERATORS = {
    "txt": gen_txt,
    "md": gen_md,
    "csv": gen_csv,
    "docx": gen_docx,
    "pdf": gen_pdf,
    "pptx": gen_pptx,
    "xlsx": gen_xlsx,
}


# ============ 主流程 ============

def main() -> int:
    args = parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    sizes = [s.strip() for s in args.sizes.split(",") if s.strip()]
    formats = [f.strip() for f in args.only.split(",") if f.strip()] or list(GENERATORS.keys())

    random.seed(args.seed)

    total_bytes = 0
    print(f"[gen] 输出目录: {out.resolve()}")
    print(f"[gen] 格式: {formats}, 尺寸: {sizes}")

    for fmt in formats:
        for size in sizes:
            theme = THEMES.get((fmt, size))
            if not theme:
                print(f"  [SKIP] {fmt}-{size}: 无主题配置")
                continue
            t0 = time.time()
            try:
                p = GENERATORS[fmt](out, size, theme)
                elapsed = time.time() - t0
                size_bytes = p.stat().st_size
                size_mb = size_bytes / 1024 / 1024
                target_mb = SIZE_TARGETS[size] / 1024 / 1024
                hit = "✓" if size_bytes >= SIZE_TARGETS[size] * 0.8 else "≈"
                total_bytes += size_bytes
                print(f"  [OK] {p.name} ({size_mb:.2f} MB / 目标 {target_mb:.0f} MB {hit}, {elapsed:.1f}s)")
            except Exception as e:
                print(f"  [FAIL] {fmt}-{size}: {e}", file=sys.stderr)
                import traceback; traceback.print_exc()
                return 1

    print(f"\n[gen] 共 {len(formats) * len(sizes)} 个文件, "
          f"总大小 {total_bytes / 1024 / 1024:.1f} MB")
    print(f"[gen] 下一步: 上传到知识库后用对话验证检索 (按主题/关键词)")
    return 0


if __name__ == "__main__":
    sys.exit(main())