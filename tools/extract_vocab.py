# -*- coding: utf-8 -*-
"""从四级/六级词汇 PDF 中解析「序号 单词 音标 释义」为 JSON。"""
import json
import re
import sys
from pypdf import PdfReader

LINE_RE = re.compile(r"^(\d+)\s+(.+?)\s*/\s*(.+?)\s*/\s*(.*)$")
POS_RE = re.compile(r"^(vt\.|vi\.|v\.|n\.|adj\.|adv\.|prep\.|conj\.|pron\.|num\.|art\.|int\.|aux\.|abbr\.)\s*")

def extract(pdf_path, out_path):
    reader = PdfReader(pdf_path)
    entries = []
    seen = set()
    bad = []
    for page in reader.pages:
        text = page.extract_text() or ""
        for raw in text.split("\n"):
            line = raw.strip()
            if not line or line.startswith("序号"):
                continue
            m = LINE_RE.match(line)
            if not m:
                # 折行的释义续行：拼回上一个词条
                if entries and line and re.search(r"[A-Za-z\u4e00-\u9fff]", line):
                    entries[-1]["cn"] = (entries[-1]["cn"] + line).strip()
                    entries[-1]["_cont"] = entries[-1].get("_cont", 0) + 1
                continue
            idx, word, ph, cn = m.groups()
            word = word.strip()
            ph = "/" + ph.strip() + "/"
            cn = cn.strip()
            if not word or not re.match(r"^[A-Za-z]", word):
                continue
            if word.lower() in seen:
                continue
            seen.add(word.lower())
            pm = POS_RE.match(cn)
            if pm:
                pos = pm.group(1)
                cn_rest = cn[pm.end():].strip()
            else:
                pos = ""
                cn_rest = cn
            entries.append({"w": word, "p": ph, "pos": pos, "cn": cn_rest})
    for e in entries:
        e.pop("_cont", None)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False)
    print(f"{pdf_path.split(chr(92))[-1]}: {len(entries)} words -> {out_path}")
    print("  sample:", entries[0], "|", entries[len(entries)//2])
    return entries

if __name__ == "__main__":
    base = r"D:\study\English"
    e4 = extract(base + r"\01.大学英语四级词汇完整带音标-可打印-可编辑-正序版.pdf", "cet4.json")
    e6 = extract(base + r"\大学英语六级词汇完整带音标-可打印-可编辑-正序版.pdf", "cet6.json")
    set4 = {x["w"].lower() for x in e4}
    inc = [x for x in e6 if x["w"].lower() not in set4]
    print(f"CET-6 total: {len(e6)}, incremental (not in CET-4): {len(inc)}")
