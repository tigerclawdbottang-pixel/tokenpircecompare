#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Agent A - 模型价格采集器
从 4 个源抓取全量模型价格，归一化后写入 SQLite 并保存每日快照。
统一单位：USD / 1M tokens
"""
import json, re, sqlite3, sys, time, os, hashlib
from datetime import datetime, timezone, date
import urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB   = os.path.join(ROOT, "data", "prices.db")
RAW  = os.path.join(ROOT, "snapshots")
os.makedirs(RAW, exist_ok=True)

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

SOURCES = ["openrouter", "fireworks", "wokey", "cheaperinference"]


# ---------------------------------------------------------------- http
def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/json,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="ignore")


# ------------------------------------------------------------ normalize
PROVIDER_PREFIX = re.compile(
    r"^(accounts/fireworks/models/|"
    r"anthropic/|openai/|google/|deepseek/|moonshotai/|z-ai/|qwen/|alibaba/|"
    r"minimax/|minimaxai/|meta-llama/|mistralai/|x-ai/|tencent/|bytedance/|"
    r"baidu/|01-ai/|nvidia/|microsoft/|cohere/|ai21/|perplexity/|"
    r"openrouter/|inception/|liquid/|nousresearch/|sao10k/|arcee-ai/|"
    r"fireworks/|zai-org/|upstage/|lgai-exaone/|reka/|relace/|switchpoint/|"
    r"aion-labs/|inflection/|morph/|neversleep/|allenai/|scb10x/|"
    r"thedrummer/|cognitivecomputations/|eleutherai/|together/|qwen3/)")
DATE_SUFFIX = re.compile(r"[-_](20\d{6}|\d{4}[-]?\d{2}[-]?\d{2}|\d{4})$")


def strip_provider(mid: str) -> str:
    s = mid.strip().lower()
    prev = None
    while prev != s:                       # 可能有双重前缀
        prev = s
        s = PROVIDER_PREFIX.sub("", s)
    return s


def split_version(base: str):
    """返回 (family, version)。如 kimi-k3.1-pro-20261023 -> (kimi-k3.1-pro, 20261023)"""
    m = DATE_SUFFIX.search(base)
    if m:
        return base[:m.start()].strip("-_"), m.group(1).replace("-", "")
    return base, ""


def canonical(mid: str):
    """原始 model_id -> (family, version)"""
    b = strip_provider(mid)
    b = re.sub(r"[/:]+", "-", b)
    b = re.sub(r"[^a-z0-9._\-]+", "-", b).strip("-")
    return split_version(b)


def loose_key(family: str) -> str:
    """
    跨源模糊匹配键。不同源写法差异：
      claude-fable-5-1 / claude-fable-5.1   -> claudefable51
      minimax-m3p1-flash / minimax-m3.1-flash -> minimaxm31flash
      glm-5.3 / glm-5-3                      -> glm53
    规则：数字间的 p 视为小数点，然后抹掉所有非字母数字。
    """
    s = family.lower()
    s = re.sub(r"(\d)p(\d)", r"\1.\2", s)          # 3p1 -> 3.1
    s = re.sub(r"[^a-z0-9]", "", s)                 # 去掉 . - _ 等
    return s


VARIANT_RULES = [
    ("batch",      re.compile(r"(?:^|[:_-])batch$")),
    ("free",       re.compile(r"(?:^|[:_-])free$")),
    ("highspeed",  re.compile(r"[-_]highspeed$")),
    ("lightning",  re.compile(r"[-_]lightning$")),
    ("fast",       re.compile(r"[-_]fast$")),
    ("e2ee",       re.compile(r"^e2ee[-_]")),
    ("uncensored", re.compile(r"[-_]uncensored$")),
    ("heretic",    re.compile(r"[-_]heretic$")),
]
# 这些变体不计入主价格对比（计费模式/特殊路由，会污染最低价）
EXCLUDE_VARIANTS = {"batch", "free"}


def detect_variant(model_id: str, family: str):
    s = model_id.lower()
    for name, rx in VARIANT_RULES:
        if rx.search(s):
            return name
    return ""


def f(x):
    """安全转 float；None/''/'-1'/非数字 -> None"""
    if x is None:
        return None
    if isinstance(x, (int, float)):
        v = float(x)
        return None if v < 0 else v
    s = str(x).strip().replace("$", "").replace(",", "")
    if s in ("", "-", "N/A", "None", "null"):
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return None if v < 0 else v


def pct_discount(final_price, list_price):
    if final_price is None or list_price in (None, 0):
        return None
    if final_price >= list_price:
        return 0.0
    return round((1 - final_price / list_price) * 100, 2)


# ------------------------------------------------------------ 1. OpenRouter
# pricing 单位是 USD/token, 需 *1e6
def collect_openrouter():
    raw = fetch("https://openrouter.ai/api/v1/models")
    data = json.loads(raw)["data"]
    out = []
    for m in data:
        p = m.get("pricing") or {}
        inp = f(p.get("prompt")); outp = f(p.get("completion"))
        if inp is not None:  inp *= 1_000_000
        if outp is not None: outp *= 1_000_000
        cr = f(p.get("input_cache_read"));  cw = f(p.get("input_cache_write"))
        if cr is not None: cr *= 1_000_000
        if cw is not None: cw *= 1_000_000
        if inp is None and outp is None:
            continue
        fam, ver = canonical(m.get("id", ""))
        out.append(dict(
            source="openrouter", model_id=m.get("id", ""),
            model_name=m.get("name") or m.get("id", ""),
            family=fam, version=ver,
            provider=(m.get("id", "").split("/")[0] if "/" in m.get("id", "") else ""),
            input=inp, output=outp, cache_read=cr, cache_write=cw,
            list_input=inp, list_output=outp,
            discount=None,
            context=(m.get("context_length") or None),
            modality=(m.get("architecture") or {}).get("modality", ""),
        ))
    return out, len(data)


# ------------------------------------------------------------ 2. Fireworks
# cost 已经是 USD/1M
def collect_fireworks():
    raw = fetch("https://app.fireworks.ai/api/models")
    data = json.loads(raw)
    out = []
    for m in data:
        c = m.get("cost") or {}
        inp = f(c.get("inputTokenPrice")) or f(c.get("inputTokenUncachedPrice"))
        outp = f(c.get("outputTokenPrice"))
        if inp is None and outp is None:
            continue
        mid = m.get("id") or (m.get("name", "").split("/")[-1])
        fam, ver = canonical(mid)
        out.append(dict(
            source="fireworks", model_id=mid,
            model_name=m.get("title") or mid,
            family=fam, version=ver,
            provider=(m.get("provider") or {}).get("name", ""),
            input=inp, output=outp,
            cache_read=f(c.get("inputTokenCachedPrice")), cache_write=None,
            list_input=inp, list_output=outp,
            discount=None,
            context=m.get("contextLength"),
            modality=m.get("type", ""),
        ))
    return out, len(data)


# ------------------------------------------------------------ 3. Wokey
# 页面内嵌 <script id="wokey-models-page-data" type="application/json">
def collect_wokey():
    html = fetch("https://wokey.ai/models")
    m = re.search(r'<script id="wokey-models-page-data"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise RuntimeError("wokey: 未找到内嵌数据块")
    data = json.loads(m.group(1))["data"]
    out = []
    for mdl in data:
        skus = {s.get("meter"): s for s in (mdl.get("pricing_skus") or [])}
        def get(meter, key="price_usd"):
            s = skus.get(meter)
            return f((s or {}).get(key))
        inp, outp = get("input_tokens"), get("output_tokens")
        if inp is None and outp is None:
            continue
        li, lo = get("input_tokens", "reference_price_usd"), get("output_tokens", "reference_price_usd")
        fam, ver = canonical(mdl.get("id", ""))
        out.append(dict(
            source="wokey", model_id=mdl.get("id", ""),
            model_name=mdl.get("name") or mdl.get("id", ""),
            family=fam, version=ver,
            provider=mdl.get("owned_by", ""),
            input=inp, output=outp,
            cache_read=get("cache_read_tokens"),
            cache_write=get("cache_write_tokens") or get("cache_write_5m_tokens"),
            list_input=li, list_output=lo,
            discount=pct_discount(inp, li),
            context=(mdl.get("architecture") or {}).get("context_length") or None,
            modality=(mdl.get("architecture") or {}).get("modality", ""),
        ))
    return out, len(data)


# ------------------------------------------------------------ 4. CheaperInference
# Next.js flight payload 里含全量 models 数组
def _extract_json_array(s, start):
    """从 start(指向'[') 开始按括号平衡提取 JSON 数组"""
    depth, i, n = 0, start, len(s)
    in_str, esc = False, False
    while i < n:
        ch = s[i]
        if in_str:
            if esc:          esc = False
            elif ch == "\\":  esc = True
            elif ch == '"':   in_str = False
        else:
            if ch == '"':                 in_str = True
            elif ch in "[{":              depth += 1
            elif ch in "]}":
                depth -= 1
                if depth == 0:
                    return s[start:i + 1]
        i += 1
    return None


def collect_cheaperinference():
    html = fetch("https://platform.cheaperinference.com/markets")
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.S)
    blob = ""
    for c in chunks:
        try:   blob += json.loads('"' + c + '"')
        except Exception: blob += c
    idx = blob.find('"models":[')
    if idx < 0:
        raise RuntimeError("cheaperinference: 未找到 models 数组")
    arr = _extract_json_array(blob, idx + len('"models":') )
    data = json.loads(arr)
    out = []
    for m in data:
        inp, outp = f(m.get("ourInputPerM")), f(m.get("ourOutputPerM"))
        li, lo = f(m.get("listInputPerM")), f(m.get("listOutputPerM"))
        if inp is None and outp is None:
            continue
        cr_mult = f(m.get("cacheReadInputMultiplier"))
        cw_mult = f(m.get("cacheWriteInputMultiplier"))
        fam, ver = canonical(m.get("id", ""))
        if m.get("listPriceKnown") is False:
            li = lo = None
        out.append(dict(
            source="cheaperinference", model_id=m.get("id", ""),
            model_name=m.get("label") or m.get("id", ""),
            family=fam, version=ver,
            provider=m.get("providerLabel") or "",
            input=inp, output=outp,
            cache_read=(round(inp * cr_mult, 6) if (inp is not None and cr_mult is not None) else None),
            cache_write=(round(inp * cw_mult, 6) if (inp is not None and cw_mult is not None) else None),
            list_input=li, list_output=lo,
            discount=f(m.get("discountPercent")),
            context=m.get("contextLength"),
            modality=f"{m.get('type','')}/{m.get('group','')}",
        ))
    return out, len(data)


COLLECTORS = {
    "openrouter": collect_openrouter,
    "fireworks": collect_fireworks,
    "wokey": collect_wokey,
    "cheaperinference": collect_cheaperinference,
}


# ---------------------------------------------------------------- DB
SCHEMA = """
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,
  source TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_name TEXT,
  family TEXT NOT NULL,
  loose TEXT NOT NULL,
  variant TEXT,
  version TEXT,
  provider TEXT,
  input REAL, output REAL,
  cache_read REAL, cache_write REAL,
  list_input REAL, list_output REAL,
  discount REAL,
  context INTEGER,
  modality TEXT,
  UNIQUE(snapshot_date, source, model_id)
);
CREATE INDEX IF NOT EXISTS ix_prices_family ON prices(family);
CREATE INDEX IF NOT EXISTS ix_prices_loose  ON prices(loose);
CREATE INDEX IF NOT EXISTS ix_prices_date   ON prices(snapshot_date);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT, snapshot_date TEXT, source TEXT,
  status TEXT, raw_count INTEGER, kept INTEGER, message TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  detected_at TEXT, snapshot_date TEXT,
  source TEXT, family TEXT, model_id TEXT, field TEXT,
  old_value REAL, new_value REAL, delta_pct REAL, severity TEXT, note TEXT
);
"""


def init_db():
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    return con


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    today = date.today().isoformat()
    con = init_db()
    os.makedirs(os.path.join(RAW, today), exist_ok=True)

    all_rows, summary = [], []
    for src in SOURCES:
        if only and src != only:
            continue
        t0 = time.time()
        try:
            rows, raw_n = COLLECTORS[src]()
            kept = []
            for r in rows:
                r["snapshot_date"] = today
                r["loose"] = loose_key(r["family"])
                r["variant"] = detect_variant(r["model_id"], r["family"])
                if r["variant"] in EXCLUDE_VARIANTS:
                    continue          # batch/free 是不同计费模式，不参与比价
                kept.append(r)
            rows = kept
            all_rows += rows
            status, msg = "ok", ""
        except Exception as e:
            rows, raw_n = [], 0
            status, msg = "fail", f"{type(e).__name__}: {e}"
            print(f"[FAIL] {src}: {msg}", file=sys.stderr)
        con.execute(
            "INSERT INTO runs(run_at,snapshot_date,source,status,raw_count,kept,message) VALUES(?,?,?,?,?,?,?)",
            (datetime.now(timezone.utc).isoformat(), today, src, status, raw_n, len(rows), msg))
        summary.append(dict(source=src, status=status, raw=raw_n, kept=len(rows),
                            seconds=round(time.time() - t0, 1), message=msg))
        print(f"[{status.upper():4}] {src:18} raw={raw_n:5} kept={len(rows):5} {time.time()-t0:.1f}s {msg}")

    # 写库（同日重复运行覆盖）
    for r in all_rows:
        con.execute("""INSERT OR REPLACE INTO prices
          (snapshot_date,source,model_id,model_name,family,loose,variant,version,provider,
           input,output,cache_read,cache_write,list_input,list_output,discount,context,modality)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
          (r["snapshot_date"], r["source"], r["model_id"], r["model_name"], r["family"],
           r["loose"], r["variant"], r["version"], r["provider"], r["input"], r["output"],
           r["cache_read"], r["cache_write"], r["list_input"], r["list_output"],
           r["discount"], r["context"], r["modality"]))
    con.commit()

    # 原始快照留档
    with open(os.path.join(RAW, today, "rows.json"), "w") as fh:
        json.dump(all_rows, fh, ensure_ascii=False)
    with open(os.path.join(RAW, today, "summary.json"), "w") as fh:
        json.dump(dict(date=today, rows=len(all_rows), sources=summary), fh, ensure_ascii=False, indent=2)

    print(f"\n合计写入 {len(all_rows)} 条 -> {DB}")
    con.close()
    return 0 if all(s["status"] == "ok" for s in summary) else 1


if __name__ == "__main__":
    sys.exit(main())
