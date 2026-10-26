#!/bin/bash
# 生成适合直接 push 到 GitHub 的打包文件（解压后即仓库根目录）
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
D=$(date +%Y-%m-%d)
mkdir -p dist

# 清理运行期临时文件，避免混进仓库
rm -f data/_probe*.json data/_*.json
find . -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true

ZIP="dist/modelprice-github-$D.zip"
rm -f "$ZIP"

zip -q -r "$ZIP" \
  README.md LICENSE .gitignore \
  web/index.html web/data.json web/app.js web/parsers.js web/style.css web/template.html \
  data/official_prices.json data/official_auto.json \
  scripts/collect.py scripts/fetch_official.py scripts/build_site.py scripts/verify.py \
  scripts/run_daily.sh scripts/make_dist.sh scripts/make_github.sh \
  scripts/smoke.js scripts/test_parsers.js scripts/test_official_col.js \
  reports/latest.md \
  -x "*.DS_Store" "dist/*" "snapshots/*" "node_modules/*" \
  2>/dev/null || true

echo "=== GitHub 版打包完成 ==="
ls -lh "$ZIP" | awk '{print "  "$5"\t"$9}'
echo
echo "内容清单："
unzip -l "$ZIP" | awk 'NR>3 && NF>=4 {print "  "$4}' | grep -v '^  *$' | sed '/^  ----/d'
echo
echo "上传方式："
echo "  1) 在 GitHub 新建空仓库（不要勾 README / .gitignore / LICENSE）"
echo "  2) 解压本包，进入目录"
echo "  3) git init && git add . && git commit -m 'init' \\"
echo "     && git remote add origin <你的仓库地址> && git push -u origin main"
