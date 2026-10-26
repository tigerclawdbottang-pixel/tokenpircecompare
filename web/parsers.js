/* 文件解析与智能识别模块（零依赖，纯函数，可独立测试）
   - unzip: 最小 zip 读取器（xlsx/docx 本质是 zip）
   - parseXlsx / parseDocx / parseDelim: 表格提取
   - guessModel / guessPrice: 无固定格式的智能列识别
   说明：仅浏览器环境使用（依赖 DecompressionStream / Blob / Response）
*/
async function inflate(raw) {
  const ds = new DecompressionStream('deflate-raw');
  const ab = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(ab);
}
async function unzip(buf) {
  const u8 = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip / Office 文件');
  const n = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const entries = [];
  // 阶段一：同步收集所有条目元数据与原始字节
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true);
    const elen = dv.getUint16(off + 30, true);
    const clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nlen));
    const dstart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    entries.push({ name, method, raw: u8.slice(dstart, dstart + csize) });
    off += 46 + nlen + elen + clen;
  }
  // 阶段二：按需解压
  const files = {};
  for (const e of entries) {
    if (e.method === 0) files[e.name] = dec.decode(e.raw);
    else if (e.method === 8) files[e.name] = dec.decode(await inflate(e.raw));
    else throw new Error('不支持的压缩方式 ' + e.method);
  }
  return files;
}

function xmlRows(xml) {
  const out = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const row = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cm;
    while ((cm = cellRe.exec(rm[1] || ''))) {
      const attrs = cm[1] || cm[3] || '';
      const inner = cm[2] || '';
      const t = (/t="([^"]*)"/.exec(attrs) || [])[1] || 'n';
      const vm = /<v>([\s\S]*?)<\/v>/.exec(inner) || /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
      let v = vm ? vm[1] : '';
      v = v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      row.push({ v, t });
    }
    if (row.length) out.push(row);
  }
  return out;
}

function parseXlsx(files) {
  let shared = [];
  if (files['xl/sharedStrings.xml']) {
    const re = /<si>([\s\S]*?)<\/si>/g; let m;
    while ((m = re.exec(files['xl/sharedStrings.xml']))) {
      shared.push(m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    }
  }
  const sheets = Object.keys(files).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => (parseInt(a.match(/\d+/)[0]) || 0) - (parseInt(b.match(/\d+/)[0]) || 0));
  const rows = [];
  for (const sh of sheets) {
    for (const r of xmlRows(files[sh]))
      rows.push(r.map(c => c.t === 's' ? (shared[+c.v] ?? c.v) : c.v));
    if (rows.length > 5000) break;
  }
  return rows;
}

function parseDocx(files) {
  const xml = files['word/document.xml'] || '';
  const rows = [];
  const trRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g; let tm;
  while ((tm = trRe.exec(xml))) {
    const cells = [];
    const tcRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g; let cm;
    while ((cm = tcRe.exec(tm[1]))) {
      const txt = [...cm[1].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(x => x[1]).join('');
      cells.push(txt.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function parseDelim(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const seps = ['\t', ',', ';', '|'];
  let best = '\t', bestN = 0;
  for (const s of seps) { const c = lines[0].split(s).length; if (c > bestN) { bestN = c; best = s; } }
  return lines.map(l => l.split(best).map(x => x.trim().replace(/^"|"$/g, '')));
}

/* ---- 智能识别：不依赖固定表头 ---- */
function LOOSE(s) {
  return String(s).toLowerCase().replace(/(\d)p(\d)/g, '$1.$2').replace(/[^a-z0-9]/g, '');
}
function guessModel(cell, models) {
  const k = LOOSE(cell);
  if (!k || k.length < 3 || /^\d+$/.test(k)) return null;
  const exact = models.find(x => x.loose === k);
  if (exact) return exact;
  const hits = models.filter(x => x.loose.length >= 5 && (k.includes(x.loose) || x.loose.includes(k)));
  if (!hits.length) return null;
  hits.sort((a, b) => b.loose.length - a.loose.length);   // 取最长命中，避免误判
  return hits[0];
}
function guessPrice(cell) {
  let s = String(cell).replace(/[$¥\s]/g, '').replace(/^\$/, '');
  // 千分位 1,234.56 -> 去掉逗号；欧陆小数点 0,28 -> 转为 0.28
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const v = parseFloat(s);
  if (!isFinite(v) || v <= 0) return null;
  if (v <= 2000) return v;        // USD / 1M token 合理区间
  return null;                    // 更大的数字视作 token 数，忽略
}
if (typeof module !== 'undefined') module.exports = { unzip, parseXlsx, parseDocx, parseDelim, xmlRows, LOOSE, guessModel, guessPrice };
