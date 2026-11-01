# -*- coding: utf-8 -*-
"""
提取三份真题 PDF，输出带来源上下文的行记录 exam_lines.json。
每行记录：{lv, y(年), m(月), s(套), part(题型), sec(Section), q(题号范围), t(文本行)}
来源锚定：每页依次尝试 卷头 → 页脚 → 乱码卷头兜底，更新当前卷信息。
"""
import json
import os
import re
from pypdf import PdfReader

HERE = os.path.dirname(os.path.abspath(__file__))

CN_NUM = {"一": "1", "二": "2", "三": "3", "四": "4", "五": "5"}
SET_PAT = r"(?:第\s*([0-9一二三四五])\s*套|[（(]\s*([0-9一二三四五])\s*[)）]|全\s*([0-9一二三四五])\s*套)"
HEADER = re.compile(r"(20\d{2})\s*年\s*(\d{1,2})\s*月[^\n]{0,32}?(?:真\s*题|试\s*题|试\s*卷)[^\n]{0,16}?" + SET_PAT)
FOOTER = re.compile(r"(20\d{2})\s*年\s*(\d{1,2})\s*月[^\n第（(]{0,26}" + SET_PAT)
PART = re.compile(r"^Part\s+\S{1,6}\s*[•·.]?\s*(Writing|Listening|Reading|Translation)", re.I)
SECTION = re.compile(r"^Section\s+([A-D])\b", re.I)
QGROUP = re.compile(r"^Questions?\s+(\d+)\s+to\s+(\d+)")
QNUM = re.compile(r"^(\d{1,2})\s*[.)]\s")
PART_NAME = {"writing": "写作", "listening": "听力", "reading": "阅读", "translation": "翻译"}

def norm_set(groups):
    for g in groups:
        if g:
            return CN_NUM.get(g, g)
    return None

def garbled_header(ln):
    """乱码卷头兜底：年份一定可读才用；月份优先 6/12/3；套号取行尾独立 1-3。"""
    if "\ufffd" not in ln or len(ln) > 70:
        return None
    ym = re.search(r"(20\d{2})", ln)
    if not ym:
        return None
    y = ym.group(1)
    nums = [n for n in re.findall(r"(?<!\d)(\d{1,2})(?!\d)", ln) if n != y]
    month = None
    for pref in ("6", "12", "3"):
        if pref in nums:
            month = pref
            break
    if not month and len(set(nums)) == 1 and nums:
        month = nums[0]
    s = None
    m = re.search(r"([1-3])\s*$", ln.strip())
    if m:
        s = m.group(1)
    return (y, month, s)

FILES = [
    (r"D:\study\English\四级真题\四级真题\赠：四级真题【一键打印版】\四级真题2016-2020一键打印版.pdf", "四级"),
    (r"D:\study\English\四级真题\四级真题\赠：四级真题【一键打印版】\四级真题2021-2026年6月一键打印版.pdf", "四级"),
    (r"D:\study\English\六级真题\六级真题\赠：六级真题【一键打印版】\【一键打印版】2019-2025.12六级真题.pdf", "六级"),
]

out = []
stats = {}
for path, level in FILES:
    reader = PdfReader(path)
    cur = {"y": None, "m": None, "s": None}
    part, sec, q = "", "", None
    read_c = 0
    n_pages = len(reader.pages)
    for i, page in enumerate(reader.pages):
        try:
            lines = (page.extract_text() or "").split("\n")
        except Exception:
            lines = []
        # 1) 卷头 / 页脚（清晰文本）
        new = None
        for ln in lines:
            mm = HEADER.search(ln) or FOOTER.search(ln)
            if mm:
                new = {"y": mm.group(1), "m": str(int(mm.group(2))), "s": norm_set(mm.groups()[2:])}
                break
        # 2) 乱码卷头兜底
        if not new:
            for ln in lines:
                g = garbled_header(ln)
                if g:
                    new = {"y": g[0], "m": g[1], "s": g[2]}
                    break
        if new and new != cur:
            cur = new
            read_c = 0  # 换卷重置
            stats[f'{level}{cur["y"]}年{cur["m"]}月第{cur["s"]}套'] = i + 1
        for ln in lines:
            t = ln.strip()
            pm = PART.match(t)
            if pm:
                part = PART_NAME[pm.group(1).lower()]
                sec, q = "", None
                read_c = 0
            elif SECTION.match(t):
                sm = SECTION.match(t)
                sec, q = sm.group(1).upper(), None
                read_c = 0
            else:
                qm = QGROUP.match(t)
                if qm:
                    # 题干特征词比 Part 行更可靠（Part 行常被印乱），据此自动纠正题型
                    if re.search(r"just heard", t, re.I):
                        part, sec, read_c = "听力", "", 0
                        q = [qm.group(1), qm.group(2)]
                    elif re.search(r"following passage", t, re.I):
                        part = "阅读"
                        if qm.group(1) == "26":
                            sec, read_c = "A", 0
                            q = ["26", "35"]        # 选词填空固定 26-35
                        else:
                            sec = "C"
                            read_c += 1              # 仔细阅读固定两篇 46-50 / 51-55
                            q = ["46", "50"] if read_c == 1 else ["51", "55"]
                            if qm.group(2) == "55":
                                q = ["51", "55"]
                    elif part in ("写作", "翻译"):
                        # 写作/翻译下不可能出现题组，必是 Part 行印乱导致的误挂
                        if int(qm.group(1)) >= 26:
                            part, sec = "阅读", "C"
                            read_c += 1
                            q = ["46", "50"] if read_c == 1 else ["51", "55"]
                            if qm.group(2) == "55":
                                q = ["51", "55"]
                        else:
                            part, sec, read_c = "听力", "", 0
                            q = [qm.group(1), qm.group(2)]
                    elif part == "阅读" and sec == "A":
                        q = ["26", "35"]
                    elif part == "阅读" and sec == "C":
                        read_c += 1
                        q = ["46", "50"] if read_c == 1 else ["51", "55"]
                    else:
                        q = [qm.group(1), qm.group(2)]
                else:
                    nm = QNUM.match(t)
                    if nm:
                        n = int(nm.group(1))
                        if 36 <= n <= 45:
                            part, sec = "阅读", "B"   # 信息匹配题干固定 36-45，听力不可能到 36
                            q = [nm.group(1), nm.group(1)]
                        elif part in ("写作", "翻译") and n <= 30:
                            part, sec = "听力", ""
                            q = [nm.group(1), nm.group(1)]
                        elif part in ("听力", "阅读"):
                            q = [nm.group(1), nm.group(1)]
            out.append({"lv": level, "y": cur["y"], "m": cur["m"], "s": cur["s"],
                        "part": part, "sec": sec, "q": q, "t": t})
        if (i + 1) % 150 == 0:
            print(f"{level}: {i+1}/{n_pages} pages", flush=True)
    print(f"{level}: DONE {n_pages} pages", flush=True)

with open(os.path.join(HERE, "exam_lines.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)

print(f"total lines: {len(out)}")
print(f"识别到的试卷（{len(stats)} 个卷信息变化点）:")
for k, v in stats.items():
    print(f"  {k}  (page {v})")
no_year = sum(1 for r in out if not r["y"])
print(f"未定位到试卷信息的行: {no_year} ({no_year*100//max(len(out),1)}%)")
