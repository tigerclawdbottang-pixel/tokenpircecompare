#!/bin/bash
# 生成可分发包：单文件版 HTML + 完整项目 zip
# 用法: bash scripts/make_dist.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
D=$(date +%Y-%m-%d)
mkdir -p dist

# 清理探测临时文件
rm -f data/_probe*.json data/_*.json

# ---- 1. 单文件版：双击即开，零依赖 ----
cp web/index.html "dist/model价格比较-$D.html"

# ---- 2. 完整项目版：含采集脚本 / 数据库 / 说明，可自行跑每日更新 ----
ZIP="dist/modelprice-full-$D.zip"
rm -f "$ZIP"
zip -q -r "$ZIP" \
  README.md \
  web/index.html web/app.js web/parsers.js web/style.css web/template.html web/data.json \
  data/prices.db data/official_prices.json data/official_auto.json \
  scripts/collect.py scripts/fetch_official.py scripts/build_site.py scripts/verify.py \
  scripts/run_daily.sh scripts/smoke.js scripts/test_parsers.js scripts/test_official_col.js \
  reports/latest.md \
  -x "*.DS_Store" "__pycache__/*" \
  2>/dev/null || true

echo "=== 分发包已生成 ==="
ls -lh "dist/model价格比较-$D.html" "$ZIP" | awk '{print "  "$5"\t"$9}'
echo
echo "发给别人时："
echo "  只想看结果  → 发「model价格比较-$D.html」（单文件，双击/拖进浏览器即可）"
echo "  要自己跑更新 → 发「modelprice-full-$D.zip」（解压后 bash scripts/run_daily.sh）"
