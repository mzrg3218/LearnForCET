# -*- coding: utf-8 -*-
"""
从词汇 JSON + 真题文本生成网站词库 JS 文件。
- js/words-1.js  CET-4 全量（词汇表 + 真题例句）
- js/words-2.js  CET-6 增量（词汇表 + 真题例句）
- js/words-3.js  考研 + 托福/雅思（手写词条 + 追加真题例句）
数据格式：{ w, p, pos, cn, en?, exs: [{s, c?}, ...], lv }
"""
import json
import os
import re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CJK = re.compile(r"[\u4e00-\u9fff]")
TOKEN = re.compile(r"[A-Za-z]+(?:['’\-][A-Za-z]+)*")
BAD_START = re.compile(r"^(?:\(?\s*[A-Za-z]\s*[\).]|\d|Directions\b|Questions?\s+\d|Section\s+[A-D]\b|Part\s+[IVX]+\b|Answers?\b|【|答案|本解析|解析)", re.I)

def bad_sentence(s):
    # 截断句、乱码残句、换行断词（如 "drinki ng"）
    if s[-1] in ",;:":
        return True
    if re.search(r"\sJJ\s", s):
        return True
    if re.search(r"\b[a-z]{3,} [a-z]{1,2}\b\s*[,;]", s):
        return True
    if re.search(r"\b[a-z]{2,} ng\b", s):
        return True
    if re.search(r"(?<![\d.,$])\s\d{1,2}\s(?![\d%,.])", s):  # 选词填空题号（孤立 1-2 位数字）
        return True
    return False

def load_json(p):
    with open(os.path.join(HERE, p), encoding="utf-8") as f:
        return json.load(f)

# ---------------- 1. 词汇表 ----------------
cet4 = load_json("cet4.json")
cet6_all = load_json("cet6.json")
set4 = {x["w"].lower() for x in cet4}
cet6 = [x for x in cet6_all if x["w"].lower() not in set4]
print(f"vocab: CET4={len(cet4)} CET6(inc)={len(cet6)}")

def clean_ph(p):
    return "/" + re.sub(r"\s+", "", p.strip("/ ")) + "/"

NAME_TAIL = re.compile(r"n\.?\s*[\(（]\s*[A-Z][A-Za-z]*.*$")  # 词典型的「n. (Name)人名…」尾巴
POS_LEAD = re.compile(r"^(vt\.|vi\.|v\.|n\.|adj\.|adv\.|prep\.|conj\.|pron\.|num\.|art\.|int\.|aux\.|abbr\.)\s*")

def split_pos(pos, cn):
    """PDF 里释义换行拼接的词条，cn 可能仍以词性开头，这里补剥离。"""
    m = POS_LEAD.match(cn)
    if m:
        pos = pos or m.group(1)
        cn = cn[m.end():].strip()
    return pos, cn

def clean_cn(cn):
    s = cn.strip()
    s = NAME_TAIL.sub("", s).strip(" ；;")
    if not s:  # 清洗失败则退回原文截断
        s = cn.strip()[:80]
    if len(s) > 90:
        s = s[:90].rstrip("；;，, ") + "…"
    return s or "—"

# ---------------- 2. 手写词条（tools/hand_words.json，含 en / 手写例句兜底 / 考研托福全量） ----------------
with open(os.path.join(HERE, "hand_words.json"), encoding="utf-8") as f:
    hand = json.load(f)
print(f"hand entries: {len(hand)}（仅用于四六级词条的英文释义/兜底例句合并）")

# ---------------- 3. 真题句子（带来源标注） ----------------
def src_label(r):
    parts = []
    if r["y"]:
        t = f'{r["y"]}年'
        if r["m"]:
            t += f'{r["m"]}月'
        if r["s"]:
            t += f'·第{r["s"]}套'
        parts.append(t)
    else:
        parts.append(f'{r["lv"]}真题')
    if r["part"]:
        p = r["part"]
        if r["q"]:
            qa, qb = r["q"]
            p += f"第{qa}-{qb}题" if qa != qb else f"第{qa}题"
        elif p == "阅读" and r["sec"] == "B":
            p += "(第36-45题)"
        parts.append(p)
    elif r["q"]:
        qa, qb = r["q"]
        parts.append(f'第{qa}-{qb}题' if qa != qb else f'第{qa}题')
    return "·".join(parts)

def load_sentences():
    """按 (卷, 题型, 题号) 分段拼段落 → 切句 → 过滤，返回 [{s, src}]"""
    recs = load_json("exam_lines.json")
    blocks, keys = [], []
    for r in recs:
        key = (r["lv"], r["y"], r["m"], r["s"], r["part"], r["sec"], tuple(r["q"] or []))
        if blocks and keys[-1] == key:
            blocks[-1].append(r)
        else:
            blocks.append([r])
            keys.append(key)
    sents, seen = [], set()
    for blk in blocks:
        meta = blk[0]
        text = " ".join(x["t"] for x in blk)
        text = re.sub(r"([A-Za-z])-\s*\n?\s*([A-Za-z])", r"\1\2", text)
        for s in re.split(r"(?<=[.!?])[\"')\]]?\s+", text):
            s = re.sub(r"\s+", " ", s).strip(" \u2022\"'“”|")
            if not (25 <= len(s) <= 220):
                continue
            if CJK.search(s) or "\ufffd" in s:
                continue
            if BAD_START.search(s) or bad_sentence(s):
                continue
            letters = len(re.findall(r"[A-Za-z]", s))
            if letters / len(s) < 0.55:
                continue
            if sum(1 for c in s if c.isupper()) / max(letters, 1) > 0.3:
                continue
            key = s.lower()
            if key in seen:
                continue
            seen.add(key)
            sents.append({"s": s, "src": src_label(meta)})
    return sents

sentences = load_sentences()
print(f"total sentences: {len(sentences)}")

# ---------------- 4. 词干索引匹配 ----------------
def bases(tok):
    out = {tok}
    for suf in ("s", "es", "ed", "d", "ing", "ly"):
        if tok.endswith(suf):
            b = tok[: -len(suf)]
            if len(b) >= 3:
                out.add(b)
                if len(b) >= 4 and b[-1] == b[-2] and b[-1] not in "aeioulsz":
                    out.add(b[:-1])
                if suf == "ing":
                    out.add(b + "e")
    return out

targets = {}
for x in cet4 + cet6:
    targets.setdefault(x["w"].lower(), x["w"])

index = defaultdict(list)
for rec in sentences:
    s = rec["s"]
    cand = set()
    for t in TOKEN.findall(s.lower()):
        t = t.replace("’", "'")
        for b in bases(t):
            w = targets.get(b)
            if w:
                cand.add(w)
    for w in cand:
        index[w.lower()].append(rec)

def pick_examples(word, k=2):
    lst = index.get(word.lower(), [])
    if not lst:
        return []
    lst = sorted(lst, key=lambda r: abs(len(r["s"]) - 95))
    out = []
    for r in lst:
        if all(r["s"][:40].lower() != o["s"][:40].lower() for o in out):
            item = {"s": r["s"]}
            if r.get("src"):
                item["src"] = r["src"]
            out.append(item)
        if len(out) >= k:
            break
    return out

# ---------------- 5. 生成词条 ----------------
def build(entries, lv, merge_hand):
    out = []
    for x in entries:
        w = x["w"]
        h = hand.get(w.lower()) if merge_hand else None
        exs = pick_examples(w)
        if h and h["ex"] and len(exs) < 2:
            exs.append({"s": h["ex"], "c": h["exc"]})
        pos, cn = split_pos(x["pos"], x["cn"])
        e = {"w": w, "p": clean_ph(x["p"]), "pos": pos, "cn": clean_cn(cn), "lv": lv}
        if h and h["en"]:
            e["en"] = h["en"]
        if exs:
            e["exs"] = exs
        out.append(e)
    return out

data4 = build(cet4, "CET-4", True)
data6 = build(cet6, "CET-6", True)

# ---------------- 6. 写出 JS ----------------
def dump_js(data, path, comment):
    js = "/* %s — 由 tools/build_data.py 自动生成，请勿手工编辑 */\n" % comment
    js += "window.WORD_BANK = (window.WORD_BANK || []).concat(%s);\n" % json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with open(path, "w", encoding="utf-8") as f:
        f.write(js)
    size = os.path.getsize(path) / 1024
    withex = sum(1 for d in data if d.get("exs"))
    two = sum(1 for d in data if len(d.get("exs", [])) >= 2)
    print(f"{os.path.basename(path)}: {len(data)} words, 真题例句覆盖 {withex} ({withex*100//len(data)}%), 两条例句 {two}, {size:.0f} KB")

dump_js(data4, os.path.join(ROOT, "js", "words-1.js"), "CET-4 全量词库（4423 词，真题原句带来源标注）")
dump_js(data6, os.path.join(ROOT, "js", "words-2.js"), "CET-6 拓展词库（1090 词，真题原句带来源标注）")

# 真题句库：供「我的词书」导入时给自建词自动匹配例句（按需懒加载）
sent_js = "/* 真题句库（%d 句，带来源标注）— 由 tools/build_data.py 自动生成 */\n" % len(sentences)
sent_js += "window.EXAM_SENTENCES = %s;\n" % json.dumps(sentences, ensure_ascii=False, separators=(",", ":"))
with open(os.path.join(ROOT, "js", "exam-sentences.js"), "w", encoding="utf-8") as f:
    f.write(sent_js)
print(f"exam-sentences.js: {len(sentences)} sentences, {os.path.getsize(os.path.join(ROOT, 'js', 'exam-sentences.js'))/1024:.0f} KB")

total = len(data4) + len(data6)
print(f"TOTAL words: {total}")
