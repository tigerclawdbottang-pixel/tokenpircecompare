/* Model Price Compare — Agent B 前端
   零依赖：自绘 SVG 图表 + 内置 xlsx/docx/csv 解析器（离线可用） */
'use strict';
const D = JSON.parse(document.getElementById('DATA').textContent);
const SRC = D.sources;
const SRCIDS = SRC.map(s => s.id);
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 3) => v == null ? '—' : Number(v).toFixed(d).replace(/\.?0+$/, m => m.includes('.') ? '' : m);
const money = v => v == null ? '—' : '$' + Number(v).toFixed(v < 1 ? 4 : 3).replace(/0+$/, '').replace(/\.$/, '');

const S = {
  tab: 'compare', metric: 'input', q: '', srcs: new Set(SRCIDS),
  region: 'all', kind: '文本', minSrc: 2, sort: { k: 'watch', dir: -1 },
  sel: null, chartModel: null, trendSrc: SRCIDS[0], trendModels: [],
  uploadRows: [], uploadMap: []
};

/* ============================== 工具 ============================== */
function metricLabel(m) {
  return { input: '输入 Input', output: '输出 Output', cache_read: '缓存命中 Cache Read',
    cache_write: '缓存写入 Cache Write', discount: '折扣 %' }[m] || m;
}
function pass(m) {
  if (S.region !== 'all' && m.region !== S.region) return false;
  if (S.kind !== 'all' && m.kind !== S.kind) return false;
  if (m.n_src < S.minSrc) return false;
  if (S.q) {
    const q = S.q.toLowerCase();
    if (!(m.name.toLowerCase().includes(q) || m.loose.includes(q) ||
        m.vendor.toLowerCase().includes(q))) return false;
  }
  return true;
}
function visibleModels() { return D.models.filter(pass); }
function valOf(m, sid, metric) {
  const p = m.prices[sid]; if (!p) return null;
  if (metric === 'discount') return p.discount ?? null;
  return p[metric] ?? null;
}
function activeVals(m, metric) {
  const out = [];
  for (const sid of S.srcs) { const v = valOf(m, sid, metric); if (v != null) out.push(v); }
  return out;
}
function srcColor(id) { return (SRC.find(s => s.id === id) || {}).color || '#888'; }
function srcLabel(id) { return (SRC.find(s => s.id === id) || {}).label || id; }

/* 模型官网价格：official=厂商官方定价，openrouter=未检索到官网价时的兜底 */
function offVal(m, metric) {
  const o = m.official;
  if (!o || metric === 'discount') return null;      // 官网无折扣概念
  return o[metric] ?? null;
}
function offTitle(m) {
  const o = m.official; if (!o) return '';
  if (o.src === 'official') {
    let t = `官网价：${o.model || m.name}\n输入 ${nf(o.input)} / 输出 ${nf(o.output)}`;
    if (o.cache_read != null) t += `\n缓存命中 ${nf(o.cache_read)}`;
    if (o.cache_write != null) t += `\n缓存写入 ${nf(o.cache_write)}`;
    if (o.note) t += `\n${o.note}`;
    if (o.checked) t += `\n核对日期 ${o.checked}`;
    if (o.url) t += `\n来源 ${o.url}`;
    return t;
  }
  return `未检索到厂商官网价，采用 OpenRouter 发布价作为参考\n输入 ${nf(o.input)} / 输出 ${nf(o.output)}`;
}
function offCell(m) {
  const o = m.official;
  const v = offVal(m, S.metric);
  if (!o || v == null) return '<td class="na">—</td>';
  const fb = o.src === 'openrouter';
  return `<td><span class="pill ${fb ? 'off-fb' : 'off'}" title="${esc(offTitle(m))}">`
    + `${nf(v)}${fb ? '<sup class="fb">OR</sup>' : ''}</span></td>`;
}

/* ============================== 表格 ============================== */
function renderTable() {
  let list = visibleModels();
  const { k, dir } = S.sort;
  list.sort((a, b) => {
    let x, y;
    if (k === 'name') { x = a.name.toLowerCase(); y = b.name.toLowerCase(); }
    else if (k === 'watch') { x = a.watch ? 1 : 0; y = b.watch ? 1 : 0; }
    else if (k === 'n_src') { x = a.n_src; y = b.n_src; }
    else if (k === 'official') {
      // 无官网价的模型始终排在末尾（不受升降序影响）
      const av = offVal(a, S.metric), bv = offVal(b, S.metric);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    }
    else if (k === 'spread') {
      const sp = m => { const v = activeVals(m, S.metric); return v.length > 1 ? Math.max(...v) / Math.min(...v) : 0; };
      x = sp(a); y = sp(b);
    } else { x = valOf(a, k, S.metric) ?? 1e18; y = valOf(b, k, S.metric) ?? 1e18; }
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });

  $('cnt').textContent = `共 ${list.length} 个模型 · 单位 USD / 1M tokens`;
  if (!list.length) { $('tbl').innerHTML = '<div class="empty">没有匹配的模型，试试放宽筛选条件</div>'; return; }

  const ids = SRCIDS.filter(s => S.srcs.has(s));
  let h = '<table><thead><tr>';
  h += `<th class="l" data-k="name">模型 ${S.sort.k === 'name' ? (S.sort.dir > 0 ? '▲' : '▼') : ''}</th>`;
  h += `<th data-k="official">模型官网价格 ${S.sort.k === 'official' ? (S.sort.dir > 0 ? '▲' : '▼') : ''}</th>`;
  for (const sid of ids)
    h += `<th data-k="${sid}">${esc(srcLabel(sid))}</th>`;
  h += `<th data-k="spread">最大价差</th><th data-k="n_src">源数</th></tr></thead><tbody>`;

  for (const m of list) {
    const vals = activeVals(m, S.metric);
    const mn = vals.length ? Math.min(...vals) : null;
    const mx = vals.length ? Math.max(...vals) : null;
    h += `<tr data-loose="${esc(m.loose)}" class="${S.sel === m.loose ? 'sel' : ''}">
      <td class="l"><span class="mname">${esc(m.name)}</span>
        ${m.watch ? '<span class="bdge">关注</span>' : ''}
        ${m.n_ver > m.n_src ? `<span class="bdge">${m.n_ver}版本</span>` : ''}
        <br><span class="mven">${esc(m.vendor)} · ${esc(m.kind)} · ${esc(m.region === 'cn' ? '国产' : '国际')}</span></td>`;
    h += offCell(m);
    for (const sid of ids) {
      const v = valOf(m, sid, S.metric);
      if (v == null) { h += '<td class="na">—</td>'; continue; }
      let cls = 'pill mut';
      if (S.metric === 'discount') cls = v > 0 ? 'pill lo' : 'pill mut';
      else if (vals.length > 1 && v === mn) cls = 'pill lo';
      else if (vals.length > 1 && v === mx) cls = 'pill hi';
      const txt = S.metric === 'discount' ? (v > 0 ? v.toFixed(0) + '%' : '—') : nf(v);
      h += `<td><span class="${cls}">${txt}</span></td>`;
    }
    const sp = (mn && mx && mx > 0 && mn > 0 && vals.length > 1) ? ((mx / mn - 1) * 100) : null;
    h += `<td>${sp ? `<span class="pill mut">${sp.toFixed(0)}%</span>` : '<span class="na">—</span>'}</td>
      <td><span class="pill n">${m.n_src}</span></td></tr>`;
  }
  h += '</tbody></table>';
  $('tbl').innerHTML = h;
  $('tbl').querySelectorAll('th[data-k]').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k;
      if (S.sort.k === k) S.sort.dir *= -1;
      else { S.sort.k = k; S.sort.dir = (k === 'name') ? 1 : -1; }
      renderTable();
    };
  });
  $('tbl').querySelectorAll('tr[data-loose]').forEach(tr => {
    tr.onclick = () => {
      const lo = tr.dataset.loose;
      S.sel = (S.sel === lo) ? null : lo;
      renderTable(); renderDetail(); renderChart();
    };
  });
}

/* ========================= 展开详情 ========================= */
function renderDetail() {
  const box = $('detail');
  if (!S.sel) { box.innerHTML = ''; box.style.display = 'none'; return; }
  const m = D.models.find(x => x.loose === S.sel);
  if (!m) { box.innerHTML = ''; return; }
  const METRICS = [
    ['input', '输入'], ['output', '输出'],
    ['cache_read', '缓存命中'], ['cache_write', '缓存写入'],
    ['list_input', '官方原价(输入)'], ['discount', '折扣']
  ];
  // 官网价在详情页的列值（list_input 即官网原价，discount 官网无此概念）
  const offDet = mk => {
    const o = m.official; if (!o) return null;
    if (mk === 'list_input') return o.input ?? null;
    if (mk === 'discount') return null;
    return o[mk] ?? null;
  };
  let h = '<table class="dettab"><thead><tr><th class="l">指标</th>'
    + `<th>${m.official ? esc(m.official.src === 'official' ? '模型官网价格' : '官网价(OR兜底)') : '模型官网价格'}</th>`;
  for (const sid of SRCIDS) if (m.prices[sid]) h += `<th>${esc(srcLabel(sid))}</th>`;
  h += '</tr></thead><tbody>';
  for (const [mk, label] of METRICS) {
    const vals = SRCIDS.map(s => valOf(m, s, mk)).filter(v => v != null);
    const ov = offDet(mk);
    if (!vals.length && ov == null) continue;
    const mn = Math.min(...vals), mx = Math.max(...vals);
    h += `<tr><td class="l">${label}</td>`;
    h += ov == null ? '<td class="na">—</td>'
      : `<td class="offc">${mk === 'discount' ? '—' : nf(ov, 4)}</td>`;
    for (const sid of SRCIDS) {
      if (!m.prices[sid]) continue;
      const v = valOf(m, sid, mk);
      if (v == null) { h += '<td class="na">—</td>'; continue; }
      let cls = '';
      if (vals.length > 1 && v === mn) cls = 'hl2';
      else if (vals.length > 1 && v === mx) cls = 'hl3';
      h += `<td class="${cls}">${mk === 'discount' ? v.toFixed(0) + '%' : nf(v, 4)}</td>`;
    }
    h += '</tr>';
  }
  h += '</tbody></table>';

  // 版本明细
  let v = '<table class="dettab"><thead><tr><th class="l">源</th><th class="l">版本 / model_id</th>' +
    '<th>输入</th><th>输出</th><th>缓存命中</th></tr></thead><tbody>';
  for (const sid of SRCIDS) {
    const p = m.prices[sid]; if (!p) continue;
    for (const it of (p.versions || [p])) {
      v += `<tr><td class="l"><span class="bdge">${esc(srcLabel(sid))}</span></td>
        <td class="l mono">${esc(it.model_id)}${it.variant ? ' <span class="bdge">' + esc(it.variant) + '</span>' : ''}</td>
        <td>${nf(it.input, 4)}</td><td>${nf(it.output, 4)}</td><td>${nf(it.cache_read, 4)}</td></tr>`;
    }
  }
  v += '</tbody></table>';
  const o = m.official;
  let info = '';
  if (o) {
    const srcTxt = o.src === 'official'
      ? `厂商官方定价${o.url ? ` · <a href="${esc(o.url)}" target="_blank" rel="noopener">官方页面</a>` : ''}${o.checked ? ` · 核对 ${esc(o.checked)}` : ''}`
      : '未检索到厂商官网价，采用 OpenRouter 发布价作为参考';
    info = `<div class="offinfo"><b>模型官网价格</b>　输入 <b>${nf(o.input)}</b> / 输出 <b>${nf(o.output)}</b>`
      + ` USD 每百万 token<br><span class="sm">来源：${srcTxt}${o.note ? ' · ' + esc(o.note) : ''}</span></div>`;
  } else {
    info = `<div class="offinfo"><b>模型官网价格</b>　<span class="na">暂缺（四个源均无该模型）</span></div>`;
  }
  box.innerHTML = `<div class="detbox"><div><h3 style="margin-bottom:8px">${esc(m.name)} · 全指标对比</h3>${info}${h}</div>
    <div><h3 style="margin-bottom:8px">版本明细（已排除 batch / free 计费变体）</h3>${v}</div></div>`;
  box.style.display = 'block';
}

/* ========================= SVG 图表 ========================= */
function svgBar(el, groups, opt = {}) {
  // groups: [{label, color, value}]
  const data = groups.filter(g => g.value != null);
  if (!data.length) { el.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const W = opt.w || 720, H = opt.h || 260, pl = 58, pr = 16, pt = 18, pb = 40;
  const iw = W - pl - pr, ih = H - pt - pb;
  const mx = Math.max(...data.map(d => d.value)) || 1;
  const bw = iw / data.length, bwt = Math.min(74, bw * 0.56);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 4; i++) {
    const y = pt + ih - (ih * i / 4), v = mx * i / 4;
    s += `<line x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}" stroke="var(--line)" stroke-width="1"/>
      <text x="${pl - 8}" y="${y + 4}" text-anchor="end" fill="var(--tx3)" font-size="11">${v < 10 ? v.toFixed(2) : v.toFixed(0)}</text>`;
  }
  data.forEach((d, i) => {
    const bh = Math.max(2, ih * (d.value / mx));
    const x = pl + bw * i + (bw - bwt) / 2, y = pt + ih - bh;
    s += `<rect x="${x}" y="${y}" width="${bwt}" height="${bh}" rx="5" fill="${d.color}" opacity=".92">
        <title>${esc(d.label)}: ${nf(d.value, 4)}</title></rect>
      <text x="${x + bwt / 2}" y="${y - 6}" text-anchor="middle" fill="var(--tx)" font-size="11.5" font-weight="600">${nf(d.value, 4)}</text>
      <text x="${pl + bw * i + bw / 2}" y="${pt + ih + 18}" text-anchor="middle" fill="var(--tx2)" font-size="11.5">${esc(d.label)}</text>`;
  });
  s += `<text x="${pl}" y="${H - 6}" fill="var(--tx3)" font-size="11">${esc(opt.unit || 'USD / 1M tokens')}</text></svg>`;
  el.innerHTML = s;
}
function svgLine(el, dates, series, opt = {}) {
  const useable = series.filter(x => x.points.some(p => p != null));
  if (dates.length < 1 || !useable.length) {
    el.innerHTML = '<div class="empty">' + (opt.emptyMsg || '暂无数据') + '</div>'; return;
  }
  const W = opt.w || 720, H = opt.h || 280, pl = 58, pr = 90, pt = 18, pb = 44;
  const iw = W - pl - pr, ih = H - pt - pb;
  const all = series.flatMap(s => s.points).filter(v => v != null);
  let mx = Math.max(...all), mn = Math.min(...all);
  if (mx === mn) { mx = mx * 1.2 + 0.01; mn = mn * 0.8; }
  const pad = (mx - mn) * 0.12; mx += pad; mn = Math.max(0, mn - pad);
  const X = i => dates.length === 1 ? pl + iw / 2 : pl + iw * i / (dates.length - 1);
  const Y = v => pt + ih - ih * ((v - mn) / (mx - mn));
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let i = 0; i <= 4; i++) {
    const y = pt + ih - ih * i / 4, v = mn + (mx - mn) * i / 4;
    s += `<line x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}" stroke="var(--line)"/>
      <text x="${pl - 8}" y="${y + 4}" text-anchor="end" fill="var(--tx3)" font-size="11">${v < 10 ? v.toFixed(3) : v.toFixed(1)}</text>`;
  }
  dates.forEach((d, i) => {
    s += `<text x="${X(i)}" y="${pt + ih + 20}" text-anchor="middle" fill="var(--tx3)" font-size="11">${esc(d.slice(5))}</text>`;
  });
  series.forEach(se => {
    const pts = se.points.map((v, i) => v == null ? null : [X(i), Y(v)]).filter(Boolean);
    if (!pts.length) return;
    s += `<polyline fill="none" stroke="${se.color}" stroke-width="2.2" stroke-linejoin="round"
      points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`;
    pts.forEach(p => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="3.2" fill="${se.color}"><title>${esc(se.label)}</title></circle>`; });
    const last = pts[pts.length - 1];
    s += `<text x="${last[0] + 6}" y="${last[1] + 4}" fill="${se.color}" font-size="11" font-weight="600">${esc(se.label)}</text>`;
  });
  s += '</svg>';
  el.innerHTML = s;
}

/* ======================== 对比图表 ======================== */
function renderChart() {
  const m = S.sel ? D.models.find(x => x.loose === S.sel)
    : visibleModels().find(x => x.n_src >= 2);
  if (!m) { $('chart').innerHTML = '<div class="empty">选择一个模型查看图表</div>'; $('chart2').innerHTML = ''; return; }
  $('chartTitle').textContent = m.name + ' — 各源价格对比';
  const mk = g => SRCIDS.filter(s => m.prices[s]).map(s => ({ label: srcLabel(s), color: srcColor(s), value: valOf(m, s, g) }));
  svgBar($('chart'), mk(S.metric), {});
  svgBar($('chart2'), mk(S.metric === 'input' ? 'output' : 'input'), {});
  $('chart2Title').textContent = m.name + ' — ' + metricLabel(S.metric === 'input' ? 'output' : 'input');
  // 汇总卡片
  const vin = activeVals(m, 'input'), vout = activeVals(m, 'output');
  let best = null, bv = Infinity;
  for (const sid of S.srcs) { const p = m.prices[sid]; if (p && p.input != null && p.input < bv) { bv = p.input; best = sid; } }
  $('cards').innerHTML = `
    <div class="card"><h3>最低输入价</h3><div class="big" style="color:var(--lo)">${money(vin.length ? Math.min(...vin) : null)}</div>
      <div class="sm">${best ? esc(srcLabel(best)) : '—'}</div></div>
    <div class="card"><h3>最高输入价</h3><div class="big" style="color:var(--hi)">${money(vin.length ? Math.max(...vin) : null)}</div>
      <div class="sm">${vin.length > 1 ? '价差 ' + ((Math.max(...vin) / Math.min(...vin) - 1) * 100).toFixed(0) + '%' : '—'}</div></div>
    <div class="card"><h3>最低输出价</h3><div class="big" style="color:var(--lo)">${money(vout.length ? Math.min(...vout) : null)}</div><div class="sm">per 1M tokens</div></div>
    <div class="card"><h3>覆盖来源</h3><div class="big">${m.n_src}<span style="font-size:14px;color:var(--tx3)"> / 4</span></div>
      <div class="sm">${m.n_ver} 个版本</div></div>`;
}

/* ======================== 关注分组 ======================== */
function renderWatch() {
  const box = $('watch');
  let h = '';
  const groups = [];
  for (const w of D.watch) {
    let items = w.items.map(it => D.models.find(m => m.loose === it.loose)).filter(Boolean);
    if (w.group === 'Gemini 全系列') items = D.models.filter(m => m.loose.startsWith('gemini') && m.kind === '文本');
    if (w.group === 'GPT 全系列') items = D.models.filter(m => (m.loose.startsWith('gpt') || /^o[134]/.test(m.loose)) && m.kind === '文本');
    if (!items.length) continue;
    items.sort((a, b) => b.n_src - a.n_src || a.name.localeCompare(b.name));
    groups.push([w.group, w.region, items]);
  }
  for (const [gname, region, items] of groups) {
    h += `<div class="sec">${esc(gname)} <span class="tag">${region === 'cn' ? '国产' : '国际'}</span>
      <span class="tag">${items.length} 个模型</span></div>
      <div class="tw" style="max-height:none"><table><thead><tr><th class="l">模型</th>
      <th>模型官网价格</th>`;
    for (const sid of SRCIDS) h += `<th>${esc(srcLabel(sid))} 输入</th>`;
    h += '<th>最低</th><th>最高</th><th>最大价差</th></tr></thead><tbody>';
    for (const m of items) {
      const vin = SRCIDS.map(s => valOf(m, s, 'input')).filter(v => v != null);
      const mn = vin.length ? Math.min(...vin) : null, mx = vin.length ? Math.max(...vin) : null;
      h += `<tr data-loose="${esc(m.loose)}"><td class="l"><span class="mname">${esc(m.name)}</span>
        <br><span class="mven">${esc(m.vendor)}</span></td>`;
      const ov = offVal(m, 'input');
      h += ov == null ? '<td class="na">—</td>'
        : `<td><span class="pill ${m.official.src === 'openrouter' ? 'off-fb' : 'off'}" `
          + `title="${esc(offTitle(m))}">${nf(ov)}${m.official.src === 'openrouter' ? '<sup class="fb">OR</sup>' : ''}</span></td>`;
      for (const sid of SRCIDS) {
        const v = valOf(m, sid, 'input');
        if (v == null) { h += '<td class="na">—</td>'; continue; }
        let cls = 'pill mut';
        if (vin.length > 1 && v === mn) cls = 'pill lo';
        else if (vin.length > 1 && v === mx) cls = 'pill hi';
        h += `<td><span class="${cls}">${nf(v)}</span></td>`;
      }
      h += `<td class="${mn != null ? 'hl2' : ''}">${nf(mn)}</td>
        <td class="${mx != null ? 'hl3' : ''}">${nf(mx)}</td>
        <td>${(mn && mx && mx > mn) ? `<span class="pill hi">${((mx / mn - 1) * 100).toFixed(0)}%</span>` : '—'}</td></tr>`;
    }
    h += '</tbody></table></div>';
  }
  box.innerHTML = h;
  box.querySelectorAll('tr[data-loose]').forEach(tr => tr.onclick = () => {
    S.sel = tr.dataset.loose; S.tab = 'compare'; switchTab('compare');
    renderTable(); renderDetail(); renderChart();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ======================== 走势 ======================== */
function renderTrend() {
  const dates = D.history.dates;
  const sel = $('trendSrc');
  if (sel.options.length !== SRCIDS.length + 1) {
    sel.innerHTML = '<option value="__all__">全部源（对比）</option>' +
      SRCIDS.map(s => `<option value="${s}">${esc(srcLabel(s))}</option>`).join('');
    sel.value = S.trendSrc;
  }
  // 模型候选：有历史数据的
  const cand = D.models.filter(m => m.n_src >= 2).slice(0, 400);
  const ml = $('trendModel');
  if (ml.options.length !== cand.length) {
    ml.innerHTML = cand.map(m => `<option value="${esc(m.loose)}">${esc(m.name)} (${m.n_src}源)</option>`).join('');
    ml.value = (S.trendModels[0] || cand[0]?.loose || '');
  }
  const src = sel.value;
  const keys = ml.selectedOptions.length ? [...ml.selectedOptions].map(o => o.value)
    : (S.trendModels.length ? S.trendModels : [cand[0]?.loose]);
  if (keys.length && (!S.trendModels.length || S.trendModels[0] !== keys[0])) S.trendModels = keys;

  const palette = ['#4f9cf9', '#f97316', '#22c55e', '#a855f7', '#eab308', '#06b6d4'];
  const series = [];
  const ids = (src === '__all__') ? SRCIDS : [src];
  keys.slice(0, 6).forEach((loose, ki) => {
    const m = D.models.find(x => x.loose === loose); if (!m) return;
    ids.forEach((sid, si) => {
      const pts = dates.map(d => {
        const day = D.history.series[d] || {};
        return (day[sid] || {})[loose] ?? null;
      });
      if (pts.some(p => p != null))
        series.push({
          label: `${m.name} · ${srcLabel(sid)}`,
          color: (src === '__all__') ? srcColor(sid) : palette[ki % palette.length],
          points: pts
        });
    });
  });
  $('trendTitle').textContent = src === '__all__' ? '各源价格走势对比' : `${srcLabel(src)} 价格走势`;
  svgLine($('trend'), dates, series, {
    emptyMsg: dates.length < 2
      ? `走势图需要至少 2 天快照。当前已有 ${dates.length} 天（${dates[0]}）。每日自动采集后会逐日累积。`
      : '所选组合暂无价格数据'
  });
  $('trendNote').textContent = dates.length < 2
    ? `提示：历史走势依赖每日快照累积。数据库已于 ${D.latest} 建立首个快照，Agent A 每日采集后即可看到曲线。`
    : `已累积 ${dates.length} 天快照（${dates[0]} ~ ${dates[dates.length - 1]}）`;
}

/* ======================== 上传比对 ======================== */
/* 文件解析 / 智能识别：见 parsers.js（内联时在其后加载） */

async function handleFile(file) {
  $('upStatus').textContent = '解析中…';
  try {
    const name = file.name.toLowerCase();
    let rows = [];
    if (/\.(xlsx|xlsm)$/.test(name)) rows = parseXlsx(await unzip(await file.arrayBuffer()));
    else if (/\.docx?$/.test(name)) rows = parseDocx(await unzip(await file.arrayBuffer()));
    else if (/\.csv|\.tsv|\.txt$/.test(name)) rows = parseDelim(await file.text());
    else { $('upStatus').textContent = '不支持的格式：' + file.name; return; }
    analyzeRows(rows, file.name);
  } catch (e) {
    $('upStatus').innerHTML = '<span style="color:var(--hi)">解析失败：' + esc(e.message) +
      '。可改用下方"粘贴表格文本"。</span>';
  }
}
function analyzeRows(rows, srcName) {
  const found = [];
  for (const r of rows) {
    let model = null, nums = [];
    for (const c of r) {
      if (!model) model = guessModel(c, D.models);
      const p = guessPrice(c);
      if (p != null) nums.push(p);
    }
    if (!model) continue;
    if (!nums.length) { found.push({ m: model, in: null, out: null }); continue; }
    nums = nums.filter(n => n > 0);
    // 取两个最大的作为 input/output（价格通常成对出现）
    let vin = null, vout = null;
    if (nums.length === 1) vin = nums[0];
    else {
      const uniq = [...new Set(nums)].sort((a, b) => b - a);
      vout = uniq[0]; vin = uniq[1] ?? null;
      // 若 output<input 明显不合理（多数模型 output>=input），保持原顺序
      if (vin != null && vout != null && vin > vout) { const t = vin; vin = vout; vout = t; }
    }
    found.push({ m: model, in: vin, out: vout });
  }
  const seen = new Set();
  S.uploadRows = found.filter(f => { if (seen.has(f.m.loose)) return false; seen.add(f.m.loose); return true; });
  S.uploadMap = S.uploadRows;
  $('upStatus').innerHTML = `已解析 <b>${esc(srcName)}</b>：${rows.length} 行 → 识别出 <b>${S.uploadRows.length}</b> 个模型` +
    (S.uploadRows.length ? '' : ' （未识别到模型名，可粘贴文本重试）');
  renderUpload();
}
function renderUpload() {
  const box = $('upResult');
  if (!S.uploadRows.length) { box.innerHTML = ''; $('upChart').innerHTML = ''; return; }
  let h = `<div class="tw" style="max-height:none"><table><thead><tr>
    <th class="l">上传的模型</th><th>官网价 输入</th><th>官网价 输出</th>
    <th>上传 输入价</th><th>本站最低</th><th>本站最高</th><th>差异</th>
    <th>上传 输出价</th><th>本站最低</th><th>本站最高</th><th>差异</th></tr></thead><tbody>`;
  const curve = [];
  for (const f of S.uploadRows) {
    const m = f.m;
    const vin = SRCIDS.map(s => valOf(m, s, 'input')).filter(v => v != null);
    const vout = SRCIDS.map(s => valOf(m, s, 'output')).filter(v => v != null);
    const mnIn = vin.length ? Math.min(...vin) : null, mxIn = vin.length ? Math.max(...vin) : null;
    const mnOut = vout.length ? Math.min(...vout) : null, mxOut = vout.length ? Math.max(...vout) : null;
    const cmpIn = (f.in != null && mnIn != null) ? ((f.in - mnIn) / mnIn * 100) : null;
    const cmpOut = (f.out != null && mnOut != null) ? ((f.out - mnOut) / mnOut * 100) : null;
    const cellIn = (f.in != null && mnIn != null)
      ? (f.in > mxIn ? `<span class="pill hi">高 ${cmpIn.toFixed(0)}%</span>`
        : f.in < mnIn ? `<span class="pill lo">低</span>`
          : `<span class="hl">${((f.in - mnIn) / mnIn * 100).toFixed(0)}%</span>`) : '<span class="na">—</span>';
    const cellOut = (f.out != null && mnOut != null)
      ? (f.out > mxOut ? `<span class="pill hi">高 ${cmpOut.toFixed(0)}%</span>`
        : f.out < mnOut ? `<span class="pill lo">低</span>`
          : `<span class="hl">${((f.out - mnOut) / mnOut * 100).toFixed(0)}%</span>`) : '<span class="na">—</span>';
    const rowHl = (f.in != null && mnIn != null && f.in > mnIn * 1.0001) ? ' class="hl"' : '';
    // 官网价单元格（官方 / OpenRouter 兜底 两种样式）
    const o = m.official;
    const offIn = offVal(m, 'input'), offOut = offVal(m, 'output');
    const offCls = !o ? '' : (o.src === 'openrouter' ? 'off-fb' : 'off');
    const offCell2 = v => v == null ? '<span class="na">—</span>'
      : `<span class="pill ${offCls}" title="${esc(offTitle(m))}">${nf(v)}${o && o.src === 'openrouter' ? '<sup class="fb">OR</sup>' : ''}</span>`;
    h += `<tr${rowHl}><td class="l"><span class="mname">${esc(m.name)}</span><br>
      <span class="mven">${esc(m.vendor)} · 匹配 ${m.n_src} 源</span></td>
      <td>${offCell2(offIn)}</td><td>${offCell2(offOut)}</td>
      <td class="${f.in != null && mnIn != null && f.in > mnIn ? 'hl' : ''}">${nf(f.in)}</td>
      <td class="hl2">${nf(mnIn)}</td><td class="hl3">${nf(mxIn)}</td><td>${cellIn}</td>
      <td class="${f.out != null && mnOut != null && f.out > mnOut ? 'hl' : ''}">${nf(f.out)}</td>
      <td class="hl2">${nf(mnOut)}</td><td class="hl3">${nf(mxOut)}</td><td>${cellOut}</td></tr>`;
    if (f.in != null && mnIn != null)
      curve.push({ name: m.name, up: f.in, min: mnIn, max: mxIn, off: offIn });
  }
  h += '</tbody></table></div>';
  box.innerHTML = h;

  // 比较曲线
  if (curve.length) {
    const n = Math.min(curve.length, 14);
    const cs = curve.slice(0, n);
    const W = Math.max(720, cs.length * 60), H = 300, pl = 56, pr = 20, pt = 20, pb = 56;
    const iw = W - pl - pr, ih = H - pt - pb;
    const mx = Math.max(...cs.flatMap(c => [c.up, c.max || 0, c.off || 0])) || 1;
    const X = i => pl + iw * (i + .5) / cs.length;
    const Y = v => pt + ih - ih * (v / mx);
    let s = `<svg viewBox="0 0 ${W} ${H}">`;
    for (let i = 0; i <= 4; i++) {
      const y = pt + ih - ih * i / 4;
      s += `<line x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}" stroke="var(--line)"/>
        <text x="${pl - 8}" y="${y + 4}" text-anchor="end" fill="var(--tx3)" font-size="11">${(mx * i / 4).toFixed(2)}</text>`;
    }
    const poly = key => cs.map((c, i) => c[key] == null ? null
      : `${X(i).toFixed(1)},${Y(c[key]).toFixed(1)}`).filter(Boolean).join(' ');
    s += `<polyline points="${poly('min')}" fill="none" stroke="#22c55e" stroke-width="2"/>`;
    s += `<polyline points="${poly('max')}" fill="none" stroke="#ef4444" stroke-width="2"/>`;
    s += `<polyline points="${poly('up')}" fill="none" stroke="#eab308" stroke-width="2.6" stroke-dasharray="6 3"/>`;
    if (cs.some(c => c.off != null))
      s += `<polyline points="${poly('off')}" fill="none" stroke="var(--acc)" stroke-width="2" stroke-dasharray="2 3"/>`;
    cs.forEach((c, i) => {
      s += `<circle cx="${X(i)}" cy="${Y(c.up)}" r="4" fill="#eab308"><title>${esc(c.name)} 上传价 ${nf(c.up)}</title></circle>`;
      s += `<text x="${X(i)}" y="${pt + ih + 18}" text-anchor="middle" fill="var(--tx2)" font-size="10.5"
        transform="rotate(-18 ${X(i)} ${pt + ih + 18})">${esc(c.name.slice(0, 16))}</text>`;
    });
    s += '</svg>';
    $('upChart').innerHTML = s +
      `<div class="lgd"><span><i style="background:#eab308"></i>你的上传价</span>
       <span><i style="background:#22c55e"></i>本站最低</span>
       <span><i style="background:#ef4444"></i>本站最高</span>
       <span><i style="background:var(--acc)"></i>模型官网价格</span></div>`;
  }
}

/* ======================== 状态 ======================== */
function renderStatus() {
  let h = '<div class="grid g4">';
  for (const s of SRC) {
    const r = (D.runs || []).find(x => x.source === s.id) || {};
    const ok = r.status === 'ok';
    h += `<div class="card"><h3><span class="dotst ${ok ? 'ok' : 'bad'}"></span>${esc(s.label)}</h3>
      <div class="big">${r.kept ?? '—'}<span style="font-size:13px;color:var(--tx3)"> 个模型</span></div>
      <div class="sm">${ok ? '采集成功' : '采集失败：' + esc(r.message || '未知')}</div>
      <div class="sm" style="margin-top:6px">${esc(s.note)}</div>
      <div class="sm" style="margin-top:6px"><a href="${esc(s.url)}" target="_blank" rel="noopener">访问官网 ↗</a></div></div>`;
  }
  h += '</div>';
  h += `<div class="sec">覆盖统计</div><div class="grid g4">
    <div class="card"><h3>模型组总数</h3><div class="big">${D.models.length}</div><div class="sm">跨源去重后</div></div>
    <div class="card"><h3>可跨源比对</h3><div class="big">${D.models.filter(m => m.n_src >= 2).length}</div><div class="sm">≥2 个源有同款</div></div>
    <div class="card"><h3>关注模型</h3><div class="big">${D.models.filter(m => m.watch).length}</div><div class="sm">已全部命中数据</div></div>
    <div class="card"><h3>快照日期</h3><div class="big" style="font-size:16px">${esc(D.latest)}</div>
      <div class="sm">共 ${D.dates.length} 天</div></div></div>`;
  $('status').innerHTML = h;
}

/* ======================== 交互绑定 ======================== */
function switchTab(t) {
  S.tab = t;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.dataset.t === t));
  document.querySelectorAll('.pane').forEach(x => x.classList.toggle('on', x.id === 'p-' + t));
  if (t === 'watch') renderWatch();
  if (t === 'trend') renderTrend();
  if (t === 'status') renderStatus();
}
function init() {
  // 源 chips
  $('srcChips').innerHTML = SRC.map(s =>
    `<span class="chip on" data-s="${s.id}"><span class="sw" style="background:${s.color}"></span>${esc(s.label)}</span>`).join('');
  $('srcChips').querySelectorAll('.chip').forEach(c => c.onclick = () => {
    const id = c.dataset.s;
    if (S.srcs.has(id)) { if (S.srcs.size <= 1) return; S.srcs.delete(id); c.classList.add('off'); }
    else { S.srcs.add(id); c.classList.remove('off'); }
    renderTable(); renderChart();
  });
  $('metric').innerHTML = ['input', 'output', 'cache_read', 'cache_write', 'discount']
    .map(m => `<option value="${m}">${metricLabel(m)}</option>`).join('');
  $('metric').value = S.metric;
  $('metric').onchange = e => { S.metric = e.target.value; renderTable(); renderChart(); };
  $('q').oninput = e => { S.q = e.target.value.trim(); renderTable(); };
  $('region').onchange = e => { S.region = e.target.value; renderTable(); };
  $('kind').onchange = e => { S.kind = e.target.value; renderTable(); };
  $('minSrc').onchange = e => { S.minSrc = +e.target.value; renderTable(); };
  $('theme').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const nxt = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', nxt);
    try { localStorage.setItem('mp-theme', nxt); } catch (_) {}
    renderChart(); renderTrend();
  };
  try {
    const t = localStorage.getItem('mp-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (_) {}
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.t));

  // 上传
  const drop = $('drop');
  drop.onclick = () => $('file').click();
  $('file').onchange = e => { [...e.target.files].forEach(handleFile); };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { [...e.dataTransfer.files].forEach(handleFile); });
  $('pasteBtn').onclick = () => {
    const t = $('paste').value;
    if (!t.trim()) return;
    analyzeRows(parseDelim(t), '粘贴内容');
  };
  $('trendSrc').onchange = e => { S.trendSrc = e.target.value; renderTrend(); };
  $('trendModel').onchange = () => renderTrend();
  $('exportBtn').onclick = () => {
    const rows = [['model', 'vendor', 'source', 'model_id', 'input', 'output', 'cache_read', 'cache_write', 'list_input', 'discount']];
    for (const m of visibleModels()) for (const sid of SRCIDS) {
      const p = m.prices[sid]; if (!p) continue;
      rows.push([m.name, m.vendor, sid, p.model_id, p.input, p.output, p.cache_read, p.cache_write, p.list_input, p.discount]);
    }
    const csv = rows.map(r => r.map(v => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    a.download = `model-prices-${D.latest}.csv`;
    a.click();
  };

  $('updated').textContent = D.latest + ' ' + (D.generated || '').slice(11, 16);
  renderTable(); renderChart(); renderDetail();
}
init();
