"""Create evidence-based figures for the two illustrated articles.

All diagrams are original explanatory figures; screenshots are embedded unchanged.
The scientific chart reads the preserved experimental CSV rather than manual values.
"""

from pathlib import Path
import csv
import json
import math
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "word-build" / "figures"
EVIDENCE = ROOT.parent / "moleculenet-reproduction-20260918"
ASSETS.mkdir(parents=True, exist_ok=True)
REGULAR = "C:/Windows/Fonts/msyh.ttc"
BOLD = "C:/Windows/Fonts/msyhbd.ttc"
MONO = "C:/Windows/Fonts/consola.ttf"
INK = "#172534"
MUTED = "#526579"
TEAL = "#137B78"
BLUE = "#3F65A0"
ORANGE = "#B7652F"
PALE = "#F2F6F8"
EDGE = "#CDD8E0"


def font(size=30, bold=False, mono=False):
    return ImageFont.truetype(MONO if mono else BOLD if bold else REGULAR, size)


def canvas(height=700, width=1680):
    im = Image.new("RGB", (width, height), "white")
    return im, ImageDraw.Draw(im)


def text(draw, xy, content, size=30, fill=INK, bold=False, anchor=None, mono=False):
    draw.text(xy, content, font=font(size, bold, mono), fill=fill, anchor=anchor)


def lines(draw, xy, content, size=28, step=43, fill=MUTED, bold=False):
    for i, line in enumerate(content):
        text(draw, (xy[0], xy[1] + i * step), line, size, fill, bold)


def arrow(draw, start, end, color=MUTED, width=4):
    draw.line((start, end), fill=color, width=width)
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    tip = 14
    points = [end, (end[0] - tip * math.cos(angle - .45), end[1] - tip * math.sin(angle - .45)),
              (end[0] - tip * math.cos(angle + .45), end[1] - tip * math.sin(angle + .45))]
    draw.polygon(points, fill=color)


def box(draw, bounds, title, body, accent=BLUE, size=30):
    draw.rounded_rectangle(bounds, radius=18, fill=PALE, outline=EDGE, width=2)
    x0, y0, x1, y1 = bounds
    draw.line((x0 + 25, y0 + 25, x0 + 25, y1 - 25), fill=accent, width=5)
    text(draw, (x0 + 46, y0 + 24), title, size, INK, True)
    lines(draw, (x0 + 46, y0 + 79), body, size=26, step=39)


def save(im, name):
    path = ASSETS / f"{name}.png"
    im.save(path, dpi=(240, 240), optimize=True)
    return str(path)


def capabilities():
    im, d = canvas(680)
    text(d, (45, 24), "从论文材料到可检查的产物", 42, bold=True)
    text(d, (45, 91), "两类工具承担不同任务  科学实验还需要单独的代码与数据", 28, MUTED)
    box(d, (45, 175, 470, 370), "论文与补充材料", ["PDF  图表  结果文件", "来源快照与文件哈希"])
    box(d, (605, 175, 1030, 370), "Paper2Agent", ["本次使用 Paper2Skill", "提取  审查  严格验证"], TEAL)
    box(d, (1165, 175, 1635, 370), "论文阅读包", ["35 个文件", "30 张图片  1 个结果 CSV"], TEAL)
    arrow(d, (480, 272), (590, 272), TEAL)
    arrow(d, (1040, 272), (1150, 272), TEAL)
    box(d, (45, 435, 470, 630), "已核验的实验结果", ["DeepChem 等实际计算", "本次另行执行 48 次运行"], BLUE)
    box(d, (605, 435, 1030, 630), "Paper2Any", ["大纲与修订组件", "页面生成与原生导出"])
    box(d, (1165, 435, 1635, 630), "演示文稿", ["模型页面生成失败", "另一路原生导出 14 页"], ORANGE)
    arrow(d, (480, 532), (590, 532), BLUE)
    arrow(d, (1040, 532), (1150, 532), BLUE)
    return save(im, "01-tool-roles")


def stages():
    im, d = canvas(590)
    text(d, (45, 24), "生成链路与导出链路分开验收", 42, bold=True)
    text(d, (45, 93), "2026 年 9 月 18 日  原生模型生成", 29, BLUE, True)
    xs = [45, 470, 895, 1320]
    for i, (title, body, accent) in enumerate([
        ("大纲与修订", ["10 页大纲", "组件检查通过"], TEAL),
        ("20 次请求", ["全部 HTTP 200", "不等于内容完整"], BLUE),
        ("13 次截断", ["10 次主题", "3 次页面"], ORANGE),
        ("未进入导出", ["3 页模板替代", "整条链路判失败"], ORANGE),
    ]):
        box(d, (xs[i], 145, xs[i] + 320, 330), title, body, accent, 28)
        if i < 3:
            arrow(d, (xs[i] + 335, 236), (xs[i + 1] - 15, 236))
    text(d, (45, 380), "2026 年 9 月 19 日  主代理直接调用导出器", 29, TEAL, True)
    text(d, (45, 443), "主代理编写 Canvas", 34, bold=True)
    arrow(d, (430, 468), (560, 468), TEAL)
    text(d, (590, 443), "Paper2Any 原生导出", 34, bold=True)
    arrow(d, (1040, 468), (1150, 468), TEAL)
    text(d, (1180, 443), "14 页可编辑 PPTX", 34, bold=True)
    text(d, (45, 527), "未运行前一条外部模型生成服务  导出包的失效声明另行修复并保留记录", 27, MUTED)
    return save(im, "02-generation-vs-export")


def rmse():
    rows = list(csv.DictReader((EVIDENCE / "verification" / "summary.csv").open(encoding="utf-8-sig")))
    values = {(r["dataset"], r["model"]): r for r in rows if r["split"] == "random"}
    im, d = canvas(820)
    text(d, (45, 22), "三个数据集的测试集 RMSE", 42, bold=True)
    text(d, (45, 86), "点为均值  误差线为样本标准差  每种模型 n = 3  越低越好", 28, MUTED)
    panels = [("esol", "ESOL", "log10(mol/L)", 2.1, .5),
              ("freesolv", "FreeSolv", "kcal/mol", 3., 1.),
              ("lipophilicity", "Lipophilicity", "logD", 1., .25)]
    labels = {"rf": "RF", "krr": "KRR", "gc": "GraphConv"}
    colors = {"rf": BLUE, "krr": "#7F769F", "gc": TEAL}
    for idx, (dataset, title, unit, maximum, tick) in enumerate(panels):
        x0 = 50 + idx * 552
        text(d, (x0, 151), title, 37, bold=True)
        text(d, (x0, 207), unit, 26, MUTED)
        left, right, top, bottom = x0 + 26, x0 + 465, 280, 648
        for t in range(int(maximum / tick) + 1):
            value = t * tick
            y = bottom - value / maximum * (bottom - top)
            d.line((left, y, right, y), fill=EDGE, width=2)
            text(d, (left - 5, y - 32), f"{value:g}", 22, MUTED)
        for j, model in enumerate(("rf", "krr", "gc")):
            row = values[(dataset, model)]
            mean, sd = float(row["test_rmse_mean"]), float(row["test_rmse_sample_sd"])
            x = left + 90 + j * 139
            y = bottom - mean / maximum * (bottom - top)
            lo = bottom - (mean - sd) / maximum * (bottom - top)
            hi = bottom - (mean + sd) / maximum * (bottom - top)
            color = colors[model]
            d.line((x, lo, x, hi), fill=color, width=5)
            d.line((x - 13, lo, x + 13, lo), fill=color, width=4)
            d.line((x - 13, hi, x + 13, hi), fill=color, width=4)
            d.ellipse((x - 10, y - 10, x + 10, y + 10), fill=color)
            text(d, (x, hi - 16), f"{mean:.3f}", 26, color, True, "mb")
            text(d, (x, bottom + 24), labels[model], 25, INK, anchor="mt")
    text(d, (45, 733), "注意各面板单位与量程不同  不能跨数据集比较数值大小", 28, MUTED)
    text(d, (45, 779), "数据来源  本次实验 verification/summary.csv  random 分区", 24, MUTED)
    return save(im, "03-rmse-real-data")


def architecture():
    im, d = canvas(680)
    text(d, (45, 22), "一套 Pi 核心完成论文工具调用", 42, bold=True)
    text(d, (45, 85), "界面负责交互  Pi 编排工具  Python 执行转换", 28, MUTED)
    box(d, (45, 160, 515, 355), "Pi GUI", ["输入命令与选择模型", "工具回执与文件预览"])
    box(d, (605, 160, 1075, 355), "Electron 主进程", ["PiRpcRuntime", "启动现有 Pi RPC 入口"])
    box(d, (1165, 160, 1635, 355), "Pi 核心", ["加载 Paper2Agent", "调用 read 与 shell"], TEAL)
    arrow(d, (525, 255), (590, 255))
    arrow(d, (1085, 255), (1150, 255))
    arrow(d, (1400, 367), (1400, 430), TEAL)
    box(d, (1165, 440, 1635, 635), "本地 Python", ["uv 选择解释器", "paper_bundle.py"], TEAL)
    box(d, (605, 440, 1075, 635), "文件系统", ["阅读包与审查记录", "来源哈希与验证报告"], TEAL)
    box(d, (45, 440, 515, 635), "回到当前会话", ["显示真实工具结果", "识别路径后打开产物"])
    arrow(d, (1150, 535), (1085, 535), TEAL)
    arrow(d, (590, 535), (525, 535))
    return save(im, "04-pi-call-architecture")


def environments():
    im, d = canvas(560)
    text(d, (45, 20), "三个用途分别管理依赖", 42, bold=True)
    for i, (title, body, accent) in enumerate([
        ("论文转换", ["Python 3.12 + uv", "PyMuPDF 与 PDF 依赖", "读取脚本内依赖声明", "不需要 TensorFlow"], TEAL),
        ("科学实验", ["Python 3.10.11", "DeepChem 2.8.0", "TensorFlow 2.15.1", "RDKit 与 scikit-learn"], BLUE),
        ("Paper2Any 组件", ["Python 3.12.13", "独立虚拟环境", "大纲与页面生成依赖", "不覆盖科学环境"], "#7F769F"),
    ]):
        box(d, (45 + i * 550, 120, 545 + i * 550, 425), title, body, accent, 34)
    text(d, (45, 470), "这些是本次实际版本  不是所有论文的统一依赖清单", 29, MUTED)
    return save(im, "05-environments")


def review_flow():
    im, d = canvas(660)
    text(d, (45, 24), "Paper2Skill 的执行与审查路径", 42, bold=True)
    steps = [
        ("01  prepare", ["来源快照", "清点输入与文件哈希"]),
        ("02  extract", ["提取正文与页面", "生成审查材料"]),
        ("03  review-aid", ["联络图与待处理清单", "辅助定位问题"]),
        ("04  逐页审查", ["核对图表  公式  单位", "留下具体审查记录"]),
        ("05  build", ["--require-reviewed", "构建阅读包"]),
        ("06  verify", ["--strict", "查看状态与具体限制"]),
    ]
    for idx, (title, body) in enumerate(steps):
        row, col = divmod(idx, 3)
        col = col if row == 0 else 2 - col
        x, y = 45 + col * 565, 135 + row * 270
        box(d, (x, y, x + 460, y + 185), title, body, TEAL if idx >= 3 else BLUE, 31)
        if idx in (0, 1):
            arrow(d, (x + 475, y + 92), (x + 545, y + 92))
        elif idx == 2:
            arrow(d, (x + 230, y + 200), (x + 230, y + 250))
        elif idx in (3, 4):
            arrow(d, (x - 15, y + 92), (x - 85, y + 92), TEAL)
    text(d, (45, 614), "review-aid 不是已审查证明  退出码 0 仍可能是 reviewed_with_limitations", 27, MUTED)
    return save(im, "06-review-flow")


if __name__ == "__main__":
    outputs = [capabilities(), stages(), rmse(), architecture(), environments(), review_flow()]
    print(json.dumps({"figures": outputs}, ensure_ascii=False, indent=2))
