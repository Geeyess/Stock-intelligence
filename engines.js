/* ===================== ANALYSIS ENGINES =====================
   Pure functions. Input: StockDataBundle + EngineConfig.
   Output: structured JSON (see engine-interfaces.ts).
   Framework versions are stamped on every result.
=============================================================== */
const FRAMEWORK_VERSIONS = { mbf: '2.0', taf: '1.0', pvst: '1.0', valuation: '1.0', state: '1.0' };

const DEFAULT_CONFIG = {
  configVersion: 'default-1',
  mbfWeights: { businessQuality: 25, growth: 15, competitivePosition: 10, financialQuality: 15, managementGovernance: 10, cashGeneration: 10, valuation: 10, forensicFallback: 5 },
  compositeWeights: { mbf: 50, taf: 30, pvst: 20 },
  tafWeights: { trend: 25, movingAverages: 15, momentum: 15, relativeStrength: 15, volume: 10, structure: 10, priceAction: 5, volatility: 5 },
  pvstWeights: { price: 20, volume: 20, participation: 20, circuit: 5, levels: 15, trend: 10, history: 10 },
  thresholds: { high: 70, low: 45 },
  valuation: { costOfEquity: 12, horizonYears: 5, fadeFactor10y: 0.6 }
};

/* ---------- math helpers ---------- */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const scale = (x, lo, hi) => clamp(((x - lo) / (hi - lo)) * 100, 0, 100);
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pctile = (a, p) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const rankPct = (a, x) => (a.filter(v => v <= x).length / a.length) * 100;
const stdev = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const cagr = (a, b, n) => (a > 0 && b > 0 && n > 0 ? (Math.pow(b / a, 1 / n) - 1) * 100 : NaN);
const r1 = x => (x === null || x === undefined || isNaN(x) ? null : Math.round(x * 10) / 10);
const r2 = x => (x === null || x === undefined || isNaN(x) ? null : Math.round(x * 100) / 100);
const r0 = x => (x === null || x === undefined || isNaN(x) ? null : Math.round(x));
const slopePct = (arr) => { const n = arr.length; const xs = arr.map((_, i) => i); const mx = mean(xs), my = mean(arr); let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (arr[i] - my); den += (xs[i] - mx) ** 2; } return (num / den) / Math.abs(my) * 100; };
function sma(a, k) { const out = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= k) s -= a[i - k]; if (i >= k - 1) out[i] = s / k; } return out; }
function ema(a, k) { const out = []; const m = 2 / (k + 1); let e = a[0]; for (let i = 0; i < a.length; i++) { e = i === 0 ? a[0] : a[i] * m + e * (1 - m); out.push(e); } return out; }
function rsiSeries(c, k = 14) { const out = new Array(c.length).fill(null); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; const up = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= k) { g += up / k; l += dn / k; if (i === k) out[i] = 100 - 100 / (1 + g / (l || 1e-9)); } else { g = (g * (k - 1) + up) / k; l = (l * (k - 1) + dn) / k; out[i] = 100 - 100 / (1 + g / (l || 1e-9)); } } return out; }
function atrSeries(p, k = 14) { const tr = p.map((b, i) => i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - p[i - 1].close), Math.abs(b.low - p[i - 1].close))); return sma(tr, k); }

/* ===================== DATA VALIDATION ===================== */
const nz = x => x !== null && x !== undefined && !isNaN(x);
function priceCoverage(b) {
  const P = b.prices || [];
  const withVol = P.filter(p => nz(p.volume) && p.volume > 0).length;
  const withDel = P.filter(p => nz(p.deliveryPct)).length;
  return { bars: P.length, volPct: P.length ? withVol / P.length : 0, delPct: P.length ? withDel / P.length : 0 };
}
const MIN_BARS = 220;
function technicalReady(b) { const c = priceCoverage(b); return c.bars >= MIN_BARS && c.volPct >= 0.9; }

function validateData(b) {
  const daysBetween = (a, z) => (new Date(z) - new Date(a)) / 86400000;
  const A = b.annual, Q = b.quarterly, lastQ = Q[Q.length - 1];
  const cov = priceCoverage(b);
  const C = b.concentration || {};
  const has = x => x && (!Array.isArray(x) || x.length);
  const derivedQ = Q.filter(q => q.derived).length;
  const fields = [
    { key: 'annual', label: `Annual financials (${A.length} yrs)`, w: 12, status: A.length >= 8 ? 'GREEN' : A.length >= 5 ? 'YELLOW' : 'ORANGE', period: `${A[0].fy}–${A[A.length - 1].fy}${b.meta.annualBasisNote ? ' · ' + b.meta.annualBasisNote : ''}` },
    { key: 'quarterly', label: 'Quarterly results', w: 10, status: !lastQ ? 'RED' : daysBetween(lastQ.date, b.meta.asOf) > 130 ? 'YELLOW' : derivedQ ? 'YELLOW' : 'GREEN', period: lastQ ? `${Q.length} quarters to ${lastQ.q}${derivedQ ? ` (${derivedQ} derived from annual totals)` : ''}` : '' },
    { key: 'prices', label: 'Daily price & volume', w: 12, status: cov.bars >= 750 && cov.volPct > 0.95 ? 'GREEN' : cov.bars >= MIN_BARS && cov.volPct >= 0.9 ? 'YELLOW' : cov.bars ? 'ORANGE' : 'RED', period: `${cov.bars} sessions, volume on ${Math.round(cov.volPct * 100)}%${cov.bars < MIN_BARS ? ` — TAF/PVST need ${MIN_BARS}+ with volume` : ''}` },
    { key: 'delivery', label: 'Delivery percentage', w: 5, status: cov.delPct > 0.9 ? 'GREEN' : cov.delPct > 0 ? 'ORANGE' : 'RED', period: cov.delPct ? `${Math.round(cov.delPct * 100)}% of sessions` : 'Not in price data' },
    { key: 'indices', label: 'Nifty & sector index', w: 5, status: b.nifty && b.nifty.length >= Math.min(cov.bars, MIN_BARS) && cov.bars ? (b.sector ? 'GREEN' : 'YELLOW') : 'RED', period: b.nifty ? `${b.nifty.length} sessions${b.sector ? '' : ', no sector index'}` : 'Not loaded' },
    { key: 'shareholding', label: 'Shareholding & pledge', w: 6, status: has(b.shareholding) ? 'GREEN' : 'RED', period: has(b.shareholding) ? b.shareholding[b.shareholding.length - 1].period : '' },
    { key: 'concentration', label: 'Customer concentration', w: 6, status: has(C.customers) ? 'YELLOW' : 'RED', period: has(C.customers) ? 'Annual disclosure ' + C.customers[C.customers.length - 1].fy : 'Not disclosed in sources used' },
    { key: 'segments', label: 'Segment & geography mix', w: 5, status: has(C.segments) ? 'GREEN' : 'RED', period: has(C.segments) ? C.segments[C.segments.length - 1].fy : 'Not in sources used' },
    { key: 'guidance', label: 'Management guidance history', w: 6, status: (b.guidance || []).filter(g => g.kind !== 'pendingCagr').length >= 3 ? 'GREEN' : has(b.guidance) ? 'ORANGE' : 'RED', period: `${(b.guidance || []).length} statement(s)` },
    { key: 'governance', label: 'Governance & litigation', w: 6, status: nz(b.governance.auditorQualifications) ? 'GREEN' : 'ORANGE', period: nz(b.governance.auditorQualifications) ? 'Complete' : 'Events only; auditor & related-party data not in sources used' },
    { key: 'peers', label: 'Peer set', w: 5, status: has(b.peers) ? 'ORANGE' : 'RED', period: has(b.peers) ? `${b.peers.length} peers` : 'No verified peer set' },
    { key: 'moat', label: 'Moat (analyst input)', w: 4, status: b.qualitative && has(b.qualitative.moat) ? 'ORANGE' : 'RED', period: b.qualitative && has(b.qualitative.moat) ? 'Qualitative' : 'Not entered' },
    { key: 'tam', label: 'Industry TAM / SAM', w: 5, status: 'RED', note: b.unavailable.tam },
    { key: 'marketShare', label: 'Market share', w: 5, status: 'RED', note: b.unavailable.marketShare },
    { key: 'matched', label: 'Historical matched companies', w: 4, status: 'RED', note: b.unavailable.matchedCompanies },
    { key: 'cohort', label: 'Survivorship-free cohort', w: 4, status: 'RED', note: b.unavailable.cohort }
  ];
  const val = { GREEN: 1, YELLOW: 0.8, ORANGE: 0.5, RED: 0 };
  const tw = fields.reduce((s, f) => s + f.w, 0);
  const score = Math.round(fields.reduce((s, f) => s + f.w * val[f.status], 0) / tw * 100);
  return { score, fields, verified: !!b.source.verified, sourceType: b.source.sourceType, conflicts: b.conflicts || [], technicalReady: technicalReady(b), coverage: cov };
}

/* ===================== MBF2.0 ===================== */
function pillar(id, name, group, o) {
  return Object.assign({ id, name, group, score: null, status: 'GREEN', evidence: [], positives: [], negatives: [], trend: 'STABLE', risk: 'LOW', source: 'Demo data provider (not verified)', confidence: 'MEDIUM', metrics: {} }, o);
}
const unscored = (id, name, group, why, src) => Object.assign(pillar(id, name, group, { status: 'RED', confidence: 'LOW', trend: 'UNKNOWN', risk: 'UNKNOWN', source: src }), { evidence: why });
const daysOf = (a, k) => nz(a[k + 'Days']) ? a[k + 'Days'] : k === 'rec' && nz(a.receivables) ? a.receivables / a.revenue * 365 : k === 'inv' && nz(a.inventory) && nz(a.cogs) ? a.inventory / a.cogs * 365 : k === 'pay' && nz(a.payables) && nz(a.cogs) ? a.payables / a.cogs * 365 : null;

function runMBF(b, val, cfg) {
  const A = b.annual, n = A.length, L = A[n - 1], SRC = b.source.label || 'Demo data provider (not verified)';
  const P = (id, name, group, o) => pillar(id, name, group, Object.assign({ source: SRC }, o));
  const yoy = A.slice(1).map((a, i) => (A[i].revenue > 0 ? (a.revenue / A[i].revenue - 1) * 100 : null)).filter(nz);
  const Q = b.quarterly;
  const qYoY = (k) => { const q = Q[k]; if (!q) return null; const prev = Q.find(x => x.q === q.q.slice(0, 2) + 'FY' + String(+q.q.slice(4) - 1)); return prev ? (q.revenue / prev.revenue - 1) * 100 : null; };
  const lastQ = Q[Q.length - 1]; const lastQYoY = qYoY(Q.length - 1);
  const ttm = Q.slice(-4); const prevTtm = Q.slice(-8, -4);
  const ttmRev = ttm.reduce((s, q) => s + q.revenue, 0);
  const ttmYoY = prevTtm.length === 4 ? (ttmRev / prevTtm.reduce((s, q) => s + q.revenue, 0) - 1) * 100 : null;
  const ce = a => a.equity + a.debt + (a.minority || 0);
  const roce = A.map((a, i) => { const c = i === 0 ? ce(a) : (ce(a) + ce(A[i - 1])) / 2; return c > 0 ? a.ebit / c * 100 : null; });
  const roe = A.map((a, i) => { const e = i === 0 ? a.equity : (a.equity + A[i - 1].equity) / 2; return e > 5 ? a.pat / e * 100 : null; });
  const roic = A.map(a => nz(a.cash) ? a.ebit * 0.75 / (ce(a) - a.cash) * 100 : null);
  const em = A.map(a => a.ebitda / a.revenue * 100), gm = A.map(a => nz(a.grossProfit) ? a.grossProfit / a.revenue * 100 : null), pm = A.map(a => a.pat / a.revenue * 100);
  const acq = b.governance.acquisitions || [];
  const pillars = [];
  const k5 = Math.max(0, n - 6), k3 = Math.max(0, n - 4), yrs5 = n - 1 - k5, yrs3 = n - 1 - k3;
  const rec5 = A.slice(-5);

  // P1 Revenue growth
  {
    const c3 = cagr(A[k3].revenue, L.revenue, yrs3), c5 = cagr(A[k5].revenue, L.revenue, yrs5), cAll = cagr(A[0].revenue, L.revenue, n - 1);
    const sd = stdev(yoy), medY = median(yoy), weak = yoy.filter(g => g < 5).length;
    const capped5 = Math.min(c5, medY + 5), capped3 = Math.min(c3, medY + 5);
    const accel = c3 - c5; const recentVs = lastQYoY != null ? lastQYoY - c3 : 0;
    const inorganic = acq.length > 0;
    let score = 0.45 * scale(capped5, 0, 25) + 0.30 * scale(capped3, 0, 25) + 0.25 * clamp(100 - sd * 6 - weak * 8, 0, 100);
    if (inorganic && recentVs > 20) score -= 10;
    const trend = inorganic && recentVs > 20 ? 'UNKNOWN' : recentVs < -5 ? 'DETERIORATING' : accel > 1.5 ? 'IMPROVING' : accel < -3 ? 'DETERIORATING' : 'STABLE';
    const p = P(1, 'Revenue growth', 'growth', { score: clamp(score, 0, 100), trend, metrics: { cagr3: r1(c3), cagr5: r1(c5), cagrAll: r1(cAll), medianYoY: r1(medY), yoyStdev: r1(sd), latestQuarterYoY: r1(lastQYoY), ttmYoY: r1(ttmYoY), weakYears: weak, organic: !inorganic } });
    p.evidence.push(`Revenue CAGR: ${yrs3}Y ${r1(c3)}%, ${yrs5}Y ${r1(c5)}%, ${A[0].fy}–${L.fy} ${r1(cAll)}%.`, `Year-on-year growth ranged ${r1(Math.min(...yoy))}% to ${r1(Math.max(...yoy))}% (median ${r1(medY)}%, std-dev ${r1(sd)} pts).`, `Latest quarter ${lastQ.q}: ${r1(lastQYoY) ?? '—'}% YoY${ttmYoY != null ? `; TTM ${r1(ttmYoY)}% YoY` : '; TTM comparison needs 8 quarters (Data unavailable)'}.`);
    p.evidence.push(inorganic ? `Acquisitions recorded (${acq.map(x => x.name).join(', ')}): recent consolidated growth is partly inorganic; organic growth is not separable from the sources used.` : 'No acquisitions recorded: growth is organic.');
    if (b.standaloneQuarterNote) p.evidence.push(b.standaloneQuarterNote.text);
    if (c5 > 14 && !inorganic) p.positives.push(`${yrs5}-year revenue CAGR of ${r1(c5)}% with only ${weak} year(s) below 5%`);
    if (c3 > 14 && inorganic) p.positives.push(`${yrs3}-year revenue CAGR of ${r1(c3)}% (${A[k3].fy}–${L.fy})`);
    if (sd > 40) p.negatives.push(`Revenue is erratic: yearly growth ranged ${r1(Math.min(...yoy))}% to ${r1(Math.max(...yoy))}%`);
    if (lastQYoY != null && lastQYoY < c3 - 5) p.negatives.push(`Latest quarter growth (${r1(lastQYoY)}%) is well below the ${yrs3}-year CAGR (${r1(c3)}%)`);
    if (inorganic && recentVs > 20) p.negatives.push(`Latest-quarter jump (${r1(lastQYoY)}% YoY) comes with acquisitions; organic growth unverified`);
    p.risk = trend === 'DETERIORATING' || sd > 40 ? 'MEDIUM' : 'LOW';
    pillars.push(p);
  }
  // P2 Concentration
  const C = b.concentration || {};
  if (C.customers && C.customers.length) {
    const cc = C.customers, cl = cc[cc.length - 1], cf = cc[0];
    const seg = C.segments[C.segments.length - 1].mix; const maxSeg = Math.max(...Object.values(seg));
    const geo = C.geography[C.geography.length - 1].exportPct;
    const custS = scale(65 - cl.top5, 0, 45) + (cl.top5 < cf.top5 ? 10 : cl.top5 > cf.top5 ? -10 : 0);
    const prodS = scale(80 - maxSeg, 0, 60), geoS = geo >= 20 && geo <= 65 ? 75 : 55;
    const supS = scale(50 - C.supplier.topSupplierPctOfRM, 0, 40) - (C.supplier.commodityLinked ? 10 : 0);
    const score = clamp(0.4 * custS + 0.25 * prodS + 0.15 * geoS + 0.2 * supS, 0, 100);
    const p = P(2, 'Revenue concentration & dependency', 'businessQuality', { score, status: 'YELLOW', trend: cl.top5 < cf.top5 ? 'IMPROVING' : 'STABLE', confidence: 'MEDIUM',
      metrics: { top1: cl.top1, top3: null, top5: cl.top5, top10: cl.top10, top5Trend: cc.map(c => c.top5), largestSegmentPct: maxSeg, exportPct: geo, topSupplierPctOfRM: C.supplier.topSupplierPctOfRM, repeatRevenuePct: C.repeatRevenuePct, tenureYears: C.customerTenureYearsTop10 } });
    p.evidence.push(`Top customer ${cl.top1}% of revenue (${cf.top1}% in ${cf.fy}); top 5 at ${cl.top5}% (was ${cf.top5}%); top 10 at ${cl.top10}%.`, 'Top-3 customer share: Data unavailable.', `Largest segment is ${maxSeg}% of revenue; ${Object.keys(seg).length} segments reported.`, `Exports ${geo}% of revenue (rising from ${C.geography[0].exportPct}%).`, `Top supplier is ${C.supplier.topSupplierPctOfRM}% of raw materials; key inputs are ${C.supplier.commodityLinked}.`, `Repeat business ${C.repeatRevenuePct}% of revenue; top-10 customer tenure ~${C.customerTenureYearsTop10} years.`);
    if (cl.top5 < cf.top5) p.positives.push(`Customer concentration falling: top-5 share down from ${cf.top5}% to ${cl.top5}%`);
    p.negatives.push(`Raw materials are ${C.supplier.commodityLinked}, exposing margins to commodity swings`);
    p.risk = cl.top1 > 20 ? 'HIGH' : 'MEDIUM';
    pillars.push(p);
  } else pillars.push(unscored(2, 'Revenue concentration & dependency', 'businessQuality', ['Customer, product, geographic and supplier concentration: Data unavailable in the sources used.', 'Next step: the RHP (Aug 2025) and annual report usually disclose top-customer and export shares; load them to score this pillar.'], SRC));
  // P3 Industry & TAM
  pillars.push(unscored(3, 'Industry structure & TAM', 'businessQuality', ['TAM, SAM, industry growth and penetration: Data unavailable. ' + b.unavailable.tam + '.', b.qualitative && b.qualitative.cyclicality ? 'Cyclicality (analyst input): ' + b.qualitative.cyclicality : 'Cyclicality: not assessed.', b.qualitative && b.qualitative.disruptionRisk ? 'Disruption risk (analyst input): ' + b.qualitative.disruptionRisk : 'Disruption risk: not assessed.', 'Pillar not scored: its weight is redistributed and data quality is reduced.'], SRC));
  // P4 Moat
  {
    const hasQual = b.qualitative && b.qualitative.moat && b.qualitative.moat.length;
    const gmv = gm.slice(-5).filter(nz); const gmSd = gmv.length >= 2 ? stdev(gmv) : null; const gmStab = gmSd != null ? clamp(100 - gmSd * 30, 0, 100) : null;
    const rv = roce.slice(-5).filter(nz); const roceYrs = rv.filter(x => x > 15).length; const spread = rv.length ? roceYrs / rv.length * 100 : null;
    let qual = null; if (hasQual) { const top = b.qualitative.moat.map(m => m.strength).sort((x, y) => y - x).slice(0, 3); qual = top.reduce((s, x) => s + x, 0) / 9 * 100; }
    const parts = [[qual, 0.5], [gmStab, 0.25], [spread, 0.25]].filter(x => nz(x[0]));
    let score = parts.reduce((s, x) => s + x[0] * x[1], 0) / parts.reduce((s, x) => s + x[1], 0);
    if (!hasQual) score = Math.min(score, 69); // proxies alone cannot establish a strong moat
    const capped = !hasQual;
    const cls = score >= 85 ? 'VERY STRONG' : score >= 70 ? 'STRONG' : score >= 50 ? 'MODERATE' : score >= 30 ? 'WEAK' : 'NONE';
    const p = P(4, 'Competitive advantage (moat)', 'businessQuality', { score, status: 'ORANGE', confidence: hasQual ? 'MEDIUM' : 'LOW', metrics: { classification: cls, qualitativeScore: r0(qual), grossMarginStdev5y: r1(gmSd), yearsRoceAbove15: roceYrs } });
    if (hasQual) b.qualitative.moat.forEach(m => p.evidence.push(`${m.type}: ${['none', 'weak', 'moderate', 'strong'][m.strength]} — ${m.evidence}`));
    else p.evidence.push('Qualitative moat inputs (switching costs, process IP, scale, brand): Data unavailable. Scored on quantitative proxies only, so confidence is LOW.');
    p.evidence.push(`Quantitative check: gross margin std-dev ${gmSd != null ? r1(gmSd) + ' pts over ' + gmv.length + ' years' : 'Data unavailable'}; ROCE above 15% in ${roceYrs} of ${rv.length} years.`, `Moat classification: ${cls}.`);
    if (roceYrs >= 4) p.positives.push(`ROCE above 15% in ${roceYrs} of the last ${rv.length} years, consistent with a real but ${cls.toLowerCase()} moat`);
    pillars.push(p);
  }
  // P5 Market share & competitive position
  const peers = b.peers || [];
  if (peers.length) {
    const c5 = cagr(A[k5].revenue, L.revenue, yrs5);
    const pg = median(peers.map(p => p.revCagr5)), pmg = median(peers.map(p => p.ebitdaMargin));
    const rel = c5 - pg, relM = em[n - 1] - pmg;
    const score = 0.6 * scale(rel, -8, 8) + 0.4 * scale(relM, -6, 6);
    const p = P(5, 'Market share & competitive position', 'competitivePosition', { score, status: 'ORANGE', confidence: 'LOW', metrics: { marketShare: null, relativeGrowthVsPeers: r1(rel), relativeMarginVsPeers: r1(relM) } });
    p.evidence.push('Market share and share trend: Data unavailable. ' + b.unavailable.marketShare + '.', `Revenue CAGR ${r1(c5)}% vs peer median ${r1(pg)}% (${rel >= 0 ? '+' : ''}${r1(rel)} pts).`, `EBITDA margin ${r1(em[n - 1])}% vs peer median ${r1(pmg)}%.`, 'Outgrowing peers suggests share gain but does not prove it without market-share data. Scored on relative growth and margin only.');
    if (rel > 2) p.positives.push(`Growing ${r1(rel)} pts a year faster than the peer median (share gain likely, not verified)`);
    pillars.push(p);
  } else pillars.push(unscored(5, 'Market share & competitive position', 'competitivePosition', ['Market share: Data unavailable. ' + b.unavailable.marketShare + '.', 'No verified peer set of comparable API/intermediate makers was loaded, so relative growth and margin cannot be scored. Broker "peer" lists that mix this company with large-cap pharma are not comparable and were not used.'], SRC));
  // P6 Profitability
  {
    const emSlope = slopePct(em.slice(-5)) * em[n - 1] / 100;
    const c5r = cagr(A[k5].revenue, L.revenue, yrs5), c5e = cagr(A[k5].ebitda, L.ebitda, yrs5);
    const opLev = nz(c5e) && c5r ? c5e / c5r : null; const pmg = peers.length ? median(peers.map(p => p.ebitdaMargin)) : null;
    const qm = Q.map(q => q.ebitdaMargin); const qDrop = qm.length >= 2 ? qm[qm.length - 1] - Math.max(...qm.slice(-5, -1)) : 0;
    const parts = [[scale(em[n - 1], 8, 25), 0.35], [scale(emSlope, -1, 1), 0.25], [opLev != null ? scale(opLev, 0.8, 1.4) : null, 0.2], [pmg != null ? scale(em[n - 1] - pmg, -6, 6) : null, 0.2]].filter(x => nz(x[0]));
    const score = parts.reduce((s, x) => s + x[0] * x[1], 0) / parts.reduce((s, x) => s + x[1], 0) - (qDrop < -2 ? Math.min(30, -qDrop * 1.5) : 0);
    const trend = qDrop < -2 ? 'DETERIORATING' : emSlope > 0.2 ? 'IMPROVING' : emSlope < -0.2 ? 'DETERIORATING' : 'STABLE';
    const p = P(6, 'Profitability quality', 'financialQuality', { score: clamp(score, 0, 100), trend, metrics: { grossMargin: r1(gm[n - 1]), ebitdaMargin: r1(em[n - 1]), ebitMargin: r1(L.ebit / L.revenue * 100), patMargin: r1(pm[n - 1]), marginSlopePtsPerYr: r1(emSlope), operatingLeverage: r1(opLev), latestQuarterMargin: r1(lastQ.ebitdaMargin) } });
    p.evidence.push(`${L.fy} margins: gross ${gm[n - 1] != null ? r1(gm[n - 1]) + '%' : 'Data unavailable'}, EBITDA ${r1(em[n - 1])}%, EBIT ${r1(L.ebit / L.revenue * 100)}%, PAT ${r1(pm[n - 1])}%.`, `EBITDA margin moved from ${r1(em[k5])}% (${A[k5].fy}) to ${r1(em[n - 1])}% (${L.fy}).`, opLev != null && c5e > 0 && c5r > 0 ? `Operating leverage: EBITDA grew ${r1(c5e)}% a year vs revenue ${r1(c5r)}% (ratio ${r1(opLev)}).` : `Operating leverage: not meaningful (EBITDA was negative in ${A[k5].fy}).`, `Latest quarter EBITDA margin ${r1(lastQ.ebitdaMargin)}% (${qDrop >= 0 ? '+' : ''}${r1(qDrop)} pts vs best of prior 4 quarters).`, pmg == null ? 'Peer margin comparison: Data unavailable.' : `Peer median EBITDA margin ${r1(pmg)}%.`);
    if (opLev > 1.05) p.positives.push(`Profitable growth: EBITDA compounding faster than revenue (${r1(c5e)}% vs ${r1(c5r)}%)`);
    if (em[n - 1] > 22 && !(qDrop < -2)) p.positives.push(`High operating margin: EBITDA ${r1(em[n - 1])}% in ${L.fy}`);
    if (qDrop < -2) p.negatives.push(`Latest-quarter EBITDA margin fell to ${r1(lastQ.ebitdaMargin)}% (${r1(qDrop)} pts vs recent best)`);
    p.risk = qDrop < -2 ? 'MEDIUM' : 'LOW';
    pillars.push(p);
  }
  // P7 Cash conversion
  {
    const cfoS = rec5.reduce((s, a) => s + a.cfo, 0), patS = rec5.reduce((s, a) => s + a.pat, 0), fcfS = rec5.reduce((s, a) => s + a.fcf, 0), ebS = rec5.reduce((s, a) => s + a.ebitda, 0);
    const cfoPat = cfoS / patS, fcfPat = fcfS / patS, cfoEb = cfoS / ebS;
    const ccc = A.map(a => { const r = daysOf(a, 'rec'), i = daysOf(a, 'inv'), p = daysOf(a, 'pay'); return nz(r) && nz(i) && nz(p) ? r + i - p : null; });
    const flag = cfoPat < 0.7;
    const cccFrom = ccc[k5], cccTo = ccc[n - 1];
    const score = 0.4 * scale(cfoPat, 0.5, 1.2) + 0.3 * scale(fcfPat, -0.2, 0.7) + 0.3 * (nz(cccFrom) && nz(cccTo) ? scale(cccFrom - cccTo, -15, 15) : 50);
    const p = P(7, 'Cash conversion', 'cashGeneration', { score, trend: nz(cccTo) && nz(cccFrom) ? (cccTo < cccFrom ? 'IMPROVING' : 'DETERIORATING') : 'UNKNOWN', metrics: { cfoToPat5y: r2(cfoPat), fcfToPat5y: r2(fcfPat), cfoToEbitda5y: r2(cfoEb), receivableDays: r0(daysOf(L, 'rec')), inventoryDays: r0(daysOf(L, 'inv')), payableDays: r0(daysOf(L, 'pay')), cashConversionCycle: r0(cccTo), cccStart: r0(cccFrom), fcfLatest: r0(L.fcf), cfoHistory: A.map(a => r0(a.cfo)) } });
    p.evidence.push(`${rec5.length}-year cumulative (${rec5[0].fy}–${L.fy}) CFO ₹${r0(cfoS)} cr vs PAT ₹${r0(patS)} cr: CFO/PAT ${r2(cfoPat)}×, FCF/PAT ${r2(fcfPat)}×, CFO/EBITDA ${r2(cfoEb)}×.`, `Operating cash flow by year: ${A.map(a => a.fy + ' ' + r0(a.cfo)).join(', ')} (₹ cr).`, nz(cccTo) ? `Working-capital cycle ${r0(cccTo)} days in ${L.fy} vs ${r0(cccFrom)} in ${A[k5].fy} (receivables ${r0(daysOf(L, 'rec'))}, inventory ${r0(daysOf(L, 'inv'))}, payables ${r0(daysOf(L, 'pay'))} days).` : 'Working-capital days: Data unavailable.', flag ? 'FLAG: Profit growth without cash conversion.' : 'No "profit without cash" flag: cash conversion supports reported profits.');
    if (!flag) p.positives.push(`Profits convert to cash: ${rec5.length}-year CFO/PAT of ${r2(cfoPat)}×`);
    else p.negatives.push(`Profit growth without cash conversion: ${rec5.length}-year CFO ₹${r0(cfoS)} cr against PAT ₹${r0(patS)} cr`);
    if (nz(cccTo) && cccTo > 250) p.negatives.push(`Working capital ties up ${r0(cccTo)} days of sales (inventory ${r0(daysOf(L, 'inv'))} days, receivables ${r0(daysOf(L, 'rec'))} days)`);
    p.risk = flag ? 'HIGH' : 'LOW';
    pillars.push(p);
  }
  // P8 Balance sheet
  {
    const de = L.debt / L.equity, nd = nz(L.cash) ? L.debt - L.cash : null, ndE = nd != null ? nd / L.ebitda : null, ic = L.interest > 0 ? L.ebit / L.interest : 99, cr = nz(L.currentAssets) ? L.currentAssets / L.currentLiabilities : null, cl = nz(L.contingentLiabilities) ? L.contingentLiabilities / L.equity * 100 : null;
    const cls = nd != null && nd < 0 && ic > 10 ? 'STRONG' : de < 0.5 && ic > 5 ? 'HEALTHY' : de < 1 ? 'WATCH' : de < 2 ? 'STRESSED' : 'DANGEROUS';
    const parts = [[ndE != null ? scale(-ndE, -3, 1) : null, 0.3], [scale(ic, 2, 20), 0.25], [cr != null ? scale(cr, 0.8, 2.2) : null, 0.2], [scale(1 - de, 0, 1), 0.15], [cl != null ? scale(15 - cl, 0, 15) : null, 0.1]].filter(x => nz(x[0]));
    const score = parts.reduce((s, x) => s + x[0] * x[1], 0) / parts.reduce((s, x) => s + x[1], 0);
    const p = P(8, 'Balance sheet strength', 'financialQuality', { score, trend: A[k5].debt > L.debt ? 'IMPROVING' : 'STABLE', metrics: { classification: cls, debt: r0(L.debt), cash: r0(L.cash), netDebt: r0(nd), debtToEquity: r2(de), netDebtToEbitda: r1(ndE), interestCoverage: r1(ic), currentRatio: r1(cr), contingentToNetWorthPct: r1(cl) } });
    p.evidence.push(nd != null ? `Debt ₹${r0(L.debt)} cr vs cash ₹${r0(L.cash)} cr: ${nd < 0 ? 'net cash ₹' + r0(-nd) + ' cr' : 'net debt ₹' + r0(nd) + ' cr'}.` : `Debt ₹${r0(L.debt)} cr; cash: Data unavailable.`, `Debt/equity ${de.toFixed(2)}, interest coverage ${r1(ic)}×${cr != null ? ', current ratio ' + cr.toFixed(2) : ''}.`, cl != null ? `Contingent liabilities ₹${L.contingentLiabilities} cr (${r1(cl)}% of net worth).` : 'Contingent liabilities: Data unavailable.', `Classification: ${cls}.`);
    if (nd != null && nd < 0) p.positives.push(`Net-cash balance sheet (₹${r0(-nd)} cr) with ${r1(ic)}× interest cover`);
    else if (de < 0.3) p.positives.push(`Low leverage: debt/equity ${de.toFixed(2)}, interest cover ${r1(ic)}×`);
    pillars.push(p);
  }
  // P9 Return ratios
  {
    const ceA = ce(A[k5]), ceL = ce(L);
    const incr = ceL - ceA > 0 ? (L.ebit - A[k5].ebit) / (ceL - ceA) * 100 : null;
    const sl = nz(roce[k5]) ? roce[n - 1] - roce[k5] : 0;
    const parts = [[scale(roce[n - 1], 8, 28), 0.4], [nz(roe[n - 1]) ? scale(roe[n - 1], 8, 25) : null, 0.2], [incr != null ? scale(incr, 5, 35) : null, 0.2], [scale(sl, -5, 5), 0.2]].filter(x => nz(x[0]));
    const score = parts.reduce((s, x) => s + x[0] * x[1], 0) / parts.reduce((s, x) => s + x[1], 0);
    const p = P(9, 'Return ratios', 'financialQuality', { score, trend: sl > 1 ? 'IMPROVING' : sl < -1 ? 'DETERIORATING' : 'STABLE', metrics: { roce: r1(roce[n - 1]), roe: r1(roe[n - 1]), roic: r1(roic[n - 1]), incrementalRoce5y: r1(incr), roceHistory: roce.map(r1), roceMin5y: r1(Math.min(...roce.slice(-5).filter(nz))) } });
    p.evidence.push(`ROCE ${r1(roce[n - 1])}%, ROE ${r1(roe[n - 1]) ?? '—'}%, ROIC ${r1(roic[n - 1]) ?? 'Data unavailable'}${nz(roic[n - 1]) ? '%' : ''} (${L.fy}).`, `ROCE trajectory ${A[k5].fy}→${L.fy}: ${r1(roce[k5])}% → ${r1(roce[n - 1])}%.`, incr != null ? `Incremental ROCE: ${r1(incr)}% on ₹${r0(ceL - ceA)} cr of new capital.` : 'Incremental ROCE: not meaningful.');
    if (incr > 20) p.positives.push(`Incremental ROCE of ${r1(incr)}%: reinvested capital earns well`);
    pillars.push(p);
  }
  // P10 Management
  const gTrack = (b.guidance || []).map(g => {
    let outcome = g.outcome || 'PENDING', actual = null;
    const fyRow = A.find(a => a.fy === g.fy);
    if (g.kind === 'min' && fyRow) {
      const i = A.indexOf(fyRow);
      actual = g.metric === 'revenueGrowth' ? (fyRow.revenue / A[i - 1].revenue - 1) * 100 : fyRow.ebitda / fyRow.revenue * 100;
      outcome = actual >= g.target ? 'DELIVERED' : actual >= g.target - 1.5 ? 'PARTIAL' : 'MISSED';
    } else if (g.kind === 'netcash' && fyRow) { actual = fyRow.debt - fyRow.cash; outcome = actual <= 0 ? 'DELIVERED' : 'MISSED'; }
    else if (g.kind === 'pendingQ') {
      const fyQs = Q.filter(q => q.q.endsWith(g.fy));
      if (fyQs.length) { actual = fyQs[fyQs.length - 1].ebitdaMargin; outcome = actual < g.target - 1.5 ? 'AT RISK' : 'ON TRACK'; }
    } else if (g.kind === 'pendingCagr') { outcome = 'TOO EARLY'; }
    else if (g.kind === 'pendingRevenue') {
      const fyQs = Q.filter(q => q.q.endsWith(g.fy));
      if (fyQs.length) { const run = fyQs.reduce((s, q) => s + q.revenue, 0) * 4 / fyQs.length; actual = run; outcome = run >= g.target ? 'ON TRACK' : run >= g.target * 0.85 ? 'BEHIND' : 'AT RISK'; }
    }
    return Object.assign({}, g, { actual: r1(actual), outcome });
  });
  {
    const scored = gTrack.filter(g => ['DELIVERED', 'PARTIAL', 'MISSED', 'DELAYED'].includes(g.outcome));
    const rate = scored.length ? scored.reduce((s, g) => s + ({ DELIVERED: 1, PARTIAL: 0.6, DELAYED: 0.5, MISSED: 0 }[g.outcome]), 0) / scored.length : null;
    const sh = b.shareholding, last = sh[sh.length - 1], prom = last.promoter, promCh = prom - sh[0].promoter, pledge = last.pledge;
    const atRisk = gTrack.some(g => g.outcome === 'AT RISK');
    const parts = [[rate != null ? rate * 100 : null, 0.6], [scale(prom, 25, 60), 0.2], [nz(pledge) ? (pledge === 0 ? 100 : clamp(100 - pledge * 5, 0, 100)) : null, 0.2]].filter(x => nz(x[0]));
    let score = parts.reduce((s, x) => s + x[0] * x[1], 0) / parts.reduce((s, x) => s + x[1], 0) - (atRisk ? 10 : 0) - (promCh < -2 ? 10 : 0);
    if (rate == null) score = Math.min(score, 70); // no promise → delivery evidence yet
    const p = P(10, 'Management quality', 'managementGovernance', { score: clamp(score, 0, 100), confidence: rate == null ? 'LOW' : 'MEDIUM', trend: atRisk ? 'DETERIORATING' : 'STABLE', metrics: { guidanceDeliveryRate: r0(rate != null ? rate * 100 : null), promoterHolding: prom, promoterChange: r1(promCh), pledge, guidanceTrack: gTrack } });
    gTrack.forEach(g => p.evidence.push(`Said in ${g.said}: "${g.statement}" → ${g.outcome}${g.actual != null ? ' (actual ' + g.actual + (g.kind === 'netcash' ? ' cr net debt' : g.kind === 'pendingRevenue' ? ' cr annualised run-rate' : '%') + ')' : ''}${g.note ? ' — ' + g.note : ''}.`));
    if (rate == null) p.evidence.push('Promise → delivery: no measurable guidance has reached its due date yet, so delivery cannot be scored. Weight shifts to ownership and pledge, confidence LOW.');
    p.evidence.push(`Promoter holding ${prom}% (${promCh >= 0 ? '+' : ''}${r1(promCh)} pts over ${sh.length} quarters); pledge ${nz(pledge) ? pledge + '%' : 'Data unavailable'}.`);
    (b.commentary || []).forEach(c => p.evidence.push(`Commentary ${c.date}: ${c.text}`));
    if (rate >= 0.7) p.positives.push(`Management delivered ${r0(rate * 100)}% of measurable guidance (promise → delivery)`);
    if (rate == null && promCh === 0 && pledge === 0) p.positives.push(`Promoters steady at ${prom}% with no pledge`);
    if (atRisk) p.negatives.push('Current-year margin guidance is at risk (promise → failure watch)');
    pillars.push(p);
  }
  // P11 Governance & forensic
  const forensicFlags = [];
  {
    const G = b.governance;
    const add = (f, sev, msg, unknown) => forensicFlags.push({ check: f, severity: sev, finding: msg, unknown: !!unknown });
    const rd = A.map(a => daysOf(a, 'rec')), id = A.map(a => daysOf(a, 'inv'));
    const recUp = nz(rd[k3]) && nz(rd[n - 1]) ? rd[n - 1] / rd[k3] - 1 : null, invUp = nz(id[k3]) && nz(id[n - 1]) ? id[n - 1] / id[k3] - 1 : null;
    const em5 = em.slice(-5); const marginJump = Math.max(...em5.slice(1).map((m, i) => m - em5[i]));
    const contPct = nz(L.contingentLiabilities) ? L.contingentLiabilities / L.equity * 100 : null;
    const lastSh = b.shareholding[b.shareholding.length - 1];
    nz(G.auditorQualifications) ? add('Auditor qualifications', G.auditorQualifications ? 25 : 0, G.auditorQualifications ? 'Qualified opinion' : (G.auditorOpinionNote || `None in ${n} years`)) : add('Auditor qualifications', 0, 'Data unavailable (not in sources used)', true);
    nz(G.auditorResignations) ? add('Auditor / director resignations', G.auditorResignations + G.independentDirectorResignations ? 20 : 0, 'None recorded') : add('Auditor / director resignations', 0, 'Data unavailable', true);
    nz(G.rptPctRevenue) ? add('Related-party transactions', G.rptPctRevenue > 5 ? 15 : 0, `${G.rptPctRevenue}% of revenue`) : (G.events || []).some(ev => /related-party/i.test(ev.check)) ? null : add('Related-party transactions', 0, 'Data unavailable', true);
    nz(lastSh.pledge) ? add('Promoter pledge', lastSh.pledge > 0 ? 15 : 0, `${lastSh.pledge}%`) : add('Promoter pledge', 0, 'Data unavailable', true);
    recUp != null ? add('Receivable days (3Y)', recUp > 0.15 ? 10 : 0, `${r0(rd[k3])} → ${r0(rd[n - 1])} days`) : add('Receivable days (3Y)', 0, 'Data unavailable', true);
    invUp != null ? add('Inventory days (3Y)', invUp > 0.15 ? 10 : 0, `${r0(id[k3])} → ${r0(id[n - 1])} days`) : add('Inventory days (3Y)', 0, 'Data unavailable', true);
    add('Unexplained margin jump (5Y)', marginJump > 4 ? 10 : 0, `Largest one-year EBITDA margin change +${r1(marginJump)} pts`);
    contPct != null ? add('Contingent liabilities', contPct > 15 ? 10 : contPct > 5 ? 3 : 0, `${r1(contPct)}% of net worth`) : add('Contingent liabilities', 0, 'Data unavailable', true);
    G.litigation ? add('Open litigation', G.litigation.filter(l => !/Resolved/.test(l.status)).length ? 4 : 0, G.litigation.map(l => `${l.item} (${l.status})`).join('; ') || 'None') : add('Open litigation', 0, 'Data unavailable', true);
    add('Equity dilution', G.dilutionEvents.length ? Math.min(3 * G.dilutionEvents.length, 9) : 0, G.dilutionEvents.map(d => `${d.fy} ${d.type}${d.pct ? ' ' + d.pct + '%' : ''}${d.use ? ' for ' + d.use : ''}`).join('; ') || 'None');
    if (acq.length >= 2) add('Serial acquisitions', 8, `${acq.length} acquisitions: ${acq.map(x => `${x.name} (${x.stake}, ${x.date})`).join('; ')}`);
    (G.events || []).forEach(ev => add(ev.check, ev.severity, `${ev.date}: ${ev.finding}`));
    const total = forensicFlags.reduce((s, f) => s + f.severity, 0);
    const score = clamp(100 - total, 0, 100);
    // EXTREME (which suppresses the composite) needs evidence of governance failure, not only an accumulation of warnings
    const critical = forensicFlags.filter(f => f.severity >= 15 && /Auditor|resignation|pledge/i.test(f.check) || (G.events || []).some(ev => ev.critical && ev.check === f.check));
    let level = score >= 80 ? 'LOW' : score >= 60 ? 'MODERATE' : score >= 35 ? 'HIGH' : 'EXTREME';
    const capped = level === 'EXTREME' && !critical.length && score >= 15;
    if (capped) level = 'HIGH';
    const unknowns = forensicFlags.filter(f => f.unknown).length;
    const p = P(11, 'Governance & forensic risk', 'managementGovernance', { score, risk: level, confidence: unknowns >= 3 ? 'LOW' : 'MEDIUM', status: unknowns >= 3 ? 'ORANGE' : 'GREEN', metrics: { forensicSafetyScore: score, forensicRisk: level, uncheckedItems: unknowns, flags: forensicFlags } });
    forensicFlags.forEach(f => p.evidence.push(`${f.check}: ${f.finding}${f.unknown ? '' : f.severity ? ` (−${f.severity})` : ' ✓'}`));
    if (capped) p.evidence.push(`Warning signals add up to an extreme-range score (${score}), but no critical failure (auditor qualification, auditor or director resignation, promoter pledge, default) was found, so the level is HIGH and the composite is not suppressed.`);
    p.evidence.push(`Forensic risk: ${level} (safety score ${score}/100)${unknowns ? `; ${unknowns} checks could not be run, so the real risk may be higher` : ''}.`);
    if (level === 'LOW' && !unknowns) p.positives.push('Clean forensic screen: no auditor issues, no pledge, low related-party exposure');
    forensicFlags.filter(f => f.severity >= 3).sort((a, z) => z.severity - a.severity).forEach(f => p.negatives.push(`${f.check}: ${f.finding}`));
    pillars.push(p);
  }
  // P12 Capital allocation
  {
    const cfo = rec5.reduce((s, a) => s + a.cfo, 0), capex = rec5.reduce((s, a) => s + (nz(a.capex) ? a.capex : a.cfo - a.fcf), 0), div = rec5.reduce((s, a) => s + (a.dividends || 0), 0);
    const debtRep = A[k5].debt - L.debt, cashBuild = nz(L.cash) && nz(A[k5].cash) ? L.cash - A[k5].cash : null;
    const incr = ce(L) - ce(A[k5]) > 0 ? (L.ebit - A[k5].ebit) / (ce(L) - ce(A[k5])) * 100 : null;
    const dil = b.governance.dilutionEvents.reduce((s, d) => s + (d.pct || 0), 0);
    const score = clamp(0.5 * (incr != null ? scale(incr, 5, 35) : 50) + 0.2 * scale(debtRep, -50, 100) + 0.15 * scale(10 - dil, 0, 10) + 0.15 * (div > 0 ? 80 : 50) - (acq.length >= 2 ? 10 : 0) - (cfo < 0 ? 10 : 0), 0, 100);
    const p = P(12, 'Capital allocation', 'managementGovernance', { score, metrics: { cfo5y: r0(cfo), capex5y: r0(capex), dividends5y: r0(div), debtRepaid5y: r0(debtRep), cashBuilt5y: r0(cashBuild), incrementalRoce: r1(incr), dilutionPct: r1(dil), acquisitions: acq.length, buybacks: 0 } });
    p.evidence.push(`${rec5[0].fy}–${L.fy}: CFO ₹${r0(cfo)} cr; capex ₹${r0(capex)} cr; dividends ₹${r0(div)} cr; debt repaid ₹${r0(debtRep)} cr${cashBuild != null ? `; cash built ₹${r0(cashBuild)} cr` : ''}.`, incr != null ? `Return on reinvested capital (incremental ROCE) ${r1(incr)}%.` : 'Incremental ROCE: not meaningful.', `Dilution recorded: ${b.governance.dilutionEvents.length ? b.governance.dilutionEvents.map(d => `${d.fy} ${d.type}${d.pct ? ' ' + d.pct + '%' : ''}`).join('; ') : 'none'}. Acquisitions: ${acq.length ? acq.map(x => x.name).join(', ') : 'none'}.`, cfo < 0 ? 'Operations consumed cash over the period, so growth was funded by equity and debt.' : incr > 15 ? 'Verdict: capital allocation has created value.' : 'Verdict: reinvestment returns are below the cost of capital.');
    if (cfo < 0) p.negatives.push(`Growth funded externally: cumulative operating cash flow ₹${r0(cfo)} cr`);
    pillars.push(p);
  }
  // P13 Diversification
  if (C.segments && C.segments.length) {
    const S = C.segments; const hhi = s => Object.values(s.mix).reduce((t, x) => t + (x / 100) ** 2, 0);
    const h0 = hhi(S[0]), h1 = hhi(S[S.length - 1]);
    const newSeg = Object.entries(S[S.length - 1].mix).filter(([k, v]) => (S[0].mix[k] || 0) === 0 && v > 0);
    const sig = Object.values(S[S.length - 1].mix).filter(v => v >= 10).length;
    const marginHeld = em[n - 1] >= em[n - 3];
    const score = 0.35 * scale(sig, 1, 4) + 0.3 * scale((h0 - h1) * 100, -3, 5) + 0.2 * (newSeg.length ? 85 : 50) + 0.15 * (marginHeld ? 80 : 40);
    const p = P(13, 'Business diversification', 'businessQuality', { score, trend: h1 < h0 ? 'IMPROVING' : 'STABLE', metrics: { significantSegments: sig, hhiThen: r2(h0), hhiNow: r2(h1), newSegments: newSeg.map(([k, v]) => `${k} (${v}%)`) } });
    p.evidence.push(`${sig} segments contribute ≥10% of revenue; concentration index fell from ${h0.toFixed(2)} to ${h1.toFixed(2)}.`, newSeg.length ? `New business: ${newSeg.map(([k, v]) => k + ' at ' + v + '% of revenue').join(', ')}.` : 'No new segments.', marginHeld ? 'Margins held while diversifying: adds resilience rather than complexity.' : 'Margins fell while diversifying: complexity risk.');
    if (newSeg.length && marginHeld) p.positives.push(`New ${newSeg[0][0].toLowerCase()} segment reached ${newSeg[0][1]}% of revenue without diluting margins`);
    pillars.push(p);
  } else pillars.push(unscored(13, 'Business diversification', 'businessQuality', ['Segment and product revenue mix: Data unavailable in the sources used.', acq.length ? `Diversification is happening through acquisitions (${acq.map(x => `${x.name}, ${x.stake}`).join('; ')}). Whether this reduces risk or adds complexity cannot be scored without segment data.` : 'No acquisitions or new segments recorded.'], SRC));
  // P14 Peer benchmarking
  const peerRank = {};
  if (peers.length) {
    const co = { revCagr5: cagr(A[k5].revenue, L.revenue, yrs5), ebitdaMargin: em[n - 1], roce: roce[n - 1], de: L.debt / L.equity };
    const metrics = [['revCagr5', 1], ['ebitdaMargin', 1], ['roce', 1], ['de', -1]];
    const ranks = metrics.map(([k, dir]) => { const all = [co[k], ...peers.map(p => p[k])]; const better = all.filter(v => dir > 0 ? v > co[k] : v < co[k]).length; peerRank[k] = better + 1; return (all.length - 1 - better) / (all.length - 1) * 100; });
    const p = P(14, 'Historical peer benchmarking', 'competitivePosition', { score: mean(ranks), status: 'ORANGE', confidence: 'LOW', metrics: { company: { revCagr5: r1(co.revCagr5), ebitdaMargin: r1(co.ebitdaMargin), roce: r1(co.roce), de: r2(co.de) }, peers, ranks: peerRank, peerCount: peers.length } });
    p.evidence.push(`Rank among ${peers.length + 1} companies: growth #${peerRank.revCagr5}, EBITDA margin #${peerRank.ebitdaMargin}, ROCE #${peerRank.roce}, leverage #${peerRank.de}.`, 'Peer set is small and has no price history, so confidence is LOW. Historical peer cohorts: Data unavailable.');
    pillars.push(p);
  } else pillars.push(unscored(14, 'Historical peer benchmarking', 'competitivePosition', ['No verified peer set loaded. Define 3–6 listed API / intermediate makers of similar size to score this pillar.'], SRC));
  pillars.push(unscored(15, 'Historical matched-company test', 'forensicFallback', ['Not run: ' + b.unavailable.matchedCompanies + '.', 'The test must include failures and delisted companies to avoid survivorship bias; it will not be approximated with successful companies only.'], SRC));
  pillars.push(unscored(16, 'Cohort / survivorship-bias test', 'forensicFallback', ['Not run: ' + b.unavailable.cohort + '.', 'Cohort definition ready: revenue CAGR ≥20%, ROCE ≥15%, D/E <0.5, expanding margins, P/E within ±20% of current. Needs winners, average performers, failures and value traps.'], SRC));
  // P17 Forensic failure test
  {
    const cl = C.customers && C.customers.length ? C.customers[C.customers.length - 1] : null;
    const emv = em.slice(-5); const emRange = Math.max(...emv) - Math.min(...emv);
    const cfoNeg = rec5.reduce((s, a) => s + a.cfo, 0) < 0;
    const fn = b.failureNotes || {};
    const nd = nz(L.cash) ? L.debt - L.cash : L.debt;
    const modes = [
      { mode: 'Loss of top customer', exposure: cl ? (cl.top1 > 20 ? 3 : cl.top1 > 10 ? 2 : 1) : 2, why: cl ? `Top customer is ${cl.top1}% of revenue` : 'Customer concentration not disclosed in sources used (unverified)' },
      { mode: 'Margin collapse', exposure: emRange > 8 ? 3 : 2, why: `EBITDA margin has ranged ${r1(Math.min(...emv))}–${r1(Math.max(...emv))}% over ${emv.length} years` + (C.supplier && C.supplier.commodityLinked ? '; inputs are commodity-linked' : '') },
      { mode: 'Debt / funding stress', exposure: nd < 0 ? 0 : cfoNeg ? 2 : nd / L.ebitda > 2 ? 3 : 1, why: nd < 0 ? 'Net cash' : `Net debt ₹${r0(nd)} cr${cfoNeg ? '; operations consume cash, so growth depends on external funding' : ''}` },
      { mode: 'Dilution', exposure: b.governance.pendingIssuance ? 3 : b.governance.dilutionEvents.length > 1 ? 2 : 1, why: b.governance.pendingIssuance ? b.governance.pendingIssuance : `${b.governance.dilutionEvents.length} equity issue(s) recorded` },
      { mode: 'Commodity shock', exposure: fn.commodity ? fn.commodity.exposure : 2, why: fn.commodity ? fn.commodity.why : (C.supplier ? C.supplier.commodityLinked : 'Raw-material exposure not in sources used') },
      { mode: 'Regulation / environment', exposure: fn.regulation ? fn.regulation.exposure : 2, why: fn.regulation ? fn.regulation.why : 'Chemical manufacturing; one environmental notice (FY23, resolved)' },
      { mode: 'Technology disruption', exposure: fn.technology ? fn.technology.exposure : 1, why: fn.technology ? fn.technology.why : 'Process chemistry evolves slowly; battery chemistry is the exception' },
      { mode: 'Governance failure', exposure: forensicFlags.reduce((s, f) => s + f.severity, 0) > 20 ? 3 : forensicFlags.filter(f => f.unknown).length >= 3 ? 2 : 0, why: forensicFlags.filter(f => f.unknown).length >= 3 ? 'Forensic screen incomplete; several checks unverified' : 'Forensic screen' },
      { mode: 'Capital allocation failure', exposure: acq.length >= 2 ? 3 : 1, why: acq.length >= 2 ? `${acq.length} acquisitions in quick succession` : (fn.capital ? fn.capital : 'Large capex still ramping') },
      { mode: 'Demand collapse', exposure: fn.demand ? fn.demand.exposure : 2, why: fn.demand ? fn.demand.why : (b.qualitative ? b.qualitative.cyclicality : 'Not assessed') }
    ];
    if ((b.commentary || []).some(c => /pressure|destock/i.test(c.text))) { modes[1].exposure = 3; modes[1].why += '. New: management reports pricing pressure'; modes[9].exposure = 3; modes[9].why = modes[9].why.replace(/\.$/, '') + '. New: a top customer is destocking'; }
    const tot = modes.reduce((s, m) => s + m.exposure, 0);
    const score = clamp(100 - tot * 3.5, 0, 100);
    const p = P(17, 'Forensic failure test', 'forensicFallback', { score, risk: score >= 60 ? 'MEDIUM' : 'HIGH', metrics: { failureModes: modes } });
    p.evidence.push('Attempt to disprove the thesis: what could permanently destroy value?');
    modes.forEach(m => p.evidence.push(`${m.mode}: ${['negligible', 'low', 'medium', 'high'][m.exposure]} — ${m.why}.`));
    modes.filter(m => m.exposure >= 3).forEach(m => p.negatives.push(`Failure mode — ${m.mode.toLowerCase()}: ${m.why}`));
    pillars.push(p);
  }
  return { pillars, peerRank, gTrack, forensicFlags, roce, roe, em, pm, gm, yoy, ttmRev, lastQYoY };
}

/* ===================== VALUATION ENGINE ===================== */
function runValuation(b, m, cfg) {
  const A = b.annual, n = A.length, L = A[n - 1], P = b.prices || [];
  const price = P.length ? P[P.length - 1].close : b.meta.lastPrice;
  const Q = b.quarterly, t4 = Q.slice(-4);
  const shares = L.sharesOut;
  const mcap = price * shares;
  const patTTM = t4.reduce((s, q) => s + q.pat, 0), ebitdaTTM = t4.reduce((s, q) => s + q.ebitda, 0), revTTM = t4.reduce((s, q) => s + q.revenue, 0);
  const epsTTM = patTTM / shares, ev = mcap + L.debt - (L.cash || 0);
  const pe = price / epsTTM, pb = mcap / L.equity, evE = ev / ebitdaTTM, evS = ev / revTTM, fcfY = L.fcf / mcap * 100;
  const epsRows = A.filter(a => nz(a.eps));
  const eps3 = epsRows.length >= 4 ? cagr(epsRows[epsRows.length - 4].eps, L.eps, 3) : null;
  const eps5 = epsRows.length >= 6 ? cagr(epsRows[epsRows.length - 6].eps, L.eps, 5) : null;
  const peg = eps3 > 5 ? pe / eps3 : null;
  const out = { price: r2(price), marketCap: r0(mcap), ev: r0(ev), epsTTM: r2(epsTTM), patTTM: r1(patTTM), revTTM: r1(revTTM), ttmIncludesDerived: t4.some(q => q.derived),
    multiples: { pe: r1(pe), pb: r1(pb), evEbitda: r1(evE), evSales: r1(evS), fcfYield: r1(fcfY), peg: peg ? r1(peg) : null }, history: null, reverse: null, scenarios: null, bizVsStock: null, notes: [] };
  if (!nz(L.eps)) out.notes.push('Per-share history before the IPO is not comparable (share-capital changes not verified), so EPS growth uses profit growth where needed.');
  // historical P/E — point-in-time EPS only
  const peSeries = [];
  P.forEach((p, i) => { if (i % 5) return; const known = A.filter(a => a.resultDate <= p.date && nz(a.eps)); if (!known.length) return; peSeries.push({ date: p.date, pe: p.close / known[known.length - 1].eps }); });
  if (peSeries.length >= 24) {
    const pes = peSeries.map(x => x.pe);
    const peMed = median(pes), pe25 = pctile(pes, 0.25), pe75 = pctile(pes, 0.75), pe90 = pctile(pes, 0.9);
    const curPct = rankPct(pes, peSeries[peSeries.length - 1].pe);
    const back = Math.max(0, peSeries.length - 151); const pe3yAgo = peSeries[back].pe;
    const spanYrs = (new Date(peSeries[peSeries.length - 1].date) - new Date(peSeries[0].date)) / 31557600000;
    out.history = { peMedian: r1(peMed), pe25: r1(pe25), pe75: r1(pe75), pe90: r1(pe90), currentPercentile: r0(curPct), premiumToMedianPct: r1((pe / peMed - 1) * 100), pe3yAgo: r1(pe3yAgo), directionSpanYears: r1(Math.min(3, spanYrs)), direction: pe > pe3yAgo * 1.1 ? 'EXPANSION' : pe < pe3yAgo * 0.9 ? 'CONTRACTION' : 'STABLE', series: peSeries.map(x => ({ date: x.date, pe: r1(x.pe) })), accumulationZoneBelowPE: r1(pe25), spanYears: r1(spanYrs) };
    // reverse valuation
    const r = cfg.valuation.costOfEquity / 100, H = cfg.valuation.horizonYears;
    const exitPE = peMed; const reqEps = price * Math.pow(1 + r, H) / exitPE;
    const impliedEpsCagr = (Math.pow(reqEps / epsTTM, 1 / H) - 1) * 100;
    const k5 = Math.max(0, n - 6);
    const histRev5 = cagr(A[k5].revenue, L.revenue, n - 1 - k5);
    const patM = patTTM / revTTM * 100;
    const reqMarginAtHistGrowth = reqEps * shares / (revTTM * Math.pow(1 + histRev5 / 100, H)) * 100;
    // growth anchor: delivered EPS CAGR when per-share history exists; otherwise the most conservative available anchor
    let anchor = eps5, anchorLabel = 'EPS CAGR delivered (5Y)';
    if (!nz(anchor)) {
      const k3 = Math.max(0, n - 4); const cands = [];
      const pat3 = cagr(A[k3].pat, L.pat, n - 1 - k3); if (nz(pat3)) cands.push([pat3, `PAT CAGR (${A[k3].fy}–${L.fy})`]);
      const lastG = (L.pat / A[n - 2].pat - 1) * 100; if (nz(lastG) && A[n - 2].pat > 0) cands.push([lastG, `PAT growth (${L.fy})`]);
      (b.guidance || []).filter(g => g.kind === 'pendingCagr').forEach(g => cands.push([g.target, `management guidance (${g.statement})`]));
      if (cands.length) { cands.sort((x, y) => x[0] - y[0]); anchor = cands[0][0]; anchorLabel = 'most conservative of: ' + cands.map(c => `${c[1]} ${r1(c[0])}%`).join(', '); }
    }
    const ratio = impliedEpsCagr / anchor;
    const level = ratio < 0.7 ? 'LOW' : ratio < 1.0 ? 'REASONABLE' : ratio < 1.4 ? 'AGGRESSIVE' : 'EXTREME';
    out.reverse = { costOfEquity: cfg.valuation.costOfEquity, horizon: H, exitPE: r1(exitPE), exitPENote: out.history.spanYears < 2 ? `Own P/E history covers only ${out.history.spanYears} years` : null, requiredEps: r2(reqEps), impliedEpsCagr: r1(impliedEpsCagr), impliedRevenueCagrAtConstantMargin: r1(impliedEpsCagr), currentPatMargin: r1(patM), requiredPatMarginAtHistoricalGrowth: r1(reqMarginAtHistGrowth), historicalRevenueCagr5: r1(histRev5), historicalEpsCagr5: r1(anchor), anchorLabel, ratioToHistory: r2(ratio), level };
    // scenarios — inputs from observable history only
    const roll3 = []; for (let i = 3; i < n; i++) { const g = cagr(A[i - 3].revenue, A[i].revenue, 3); if (nz(g)) roll3.push(g); }
    let w0 = n - 1; while (w0 > 0 && A[w0 - 1].pat > 0 && n - w0 < 5) w0--; // margin window: years since the last loss, max 5
    const pms = m.pm.slice(w0), ems = m.em.slice(w0);
    const fcfConv = A.slice(-5).reduce((s, a) => s + a.fcf, 0) / A.slice(-5).reduce((s, a) => s + a.pat, 0);
    const peersMax = (b.peers || []).length ? Math.max(...b.peers.map(p => p.revCagr5)) + 4 : null;
    const guid = (b.guidance || []).find(g => g.kind === 'pendingCagr');
    const bullCap = peersMax != null ? peersMax : guid ? Math.max(guid.target, median(roll3)) : Math.max(...roll3);
    const sc = {};
    [['bear', Math.min(...roll3), Math.min(...pms), Math.min(...ems), pe25], ['base', median(roll3), median(pms), median(ems), peMed], ['bull', Math.min(Math.max(...roll3), bullCap), Math.max(...pms), Math.max(...ems), pe75]].forEach(([k, g, pmr, emr, mult]) => {
      const rev5 = revTTM * Math.pow(1 + g / 100, 5), rev10 = rev5 * Math.pow(1 + g * cfg.valuation.fadeFactor10y / 100, 5);
      const mk = rev => ({ revenue: r0(rev), ebitda: r0(rev * emr / 100), ebit: r0(rev * (emr - 3.5) / 100), pat: r0(rev * pmr / 100), eps: r2(rev * pmr / 100 / shares), fcf: r0(rev * pmr / 100 * fcfConv) });
      const y5 = mk(rev5), y10 = mk(rev10);
      const p5 = y5.eps * mult, p10 = y10.eps * mult;
      sc[k] = { assumptions: { revenueGrowth: r1(g), revenueGrowthYears6to10: r1(g * cfg.valuation.fadeFactor10y), patMargin: r1(pmr), ebitdaMargin: r1(emr), exitPE: r1(mult), fcfConversion: r2(fcfConv) }, y5, y10, price5: r1(p5), price10: r1(p10), cagr5: r1((Math.pow(Math.max(p5, 0.01) / price, 1 / 5) - 1) * 100), cagr10: r1((Math.pow(Math.max(p10, 0.01) / price, 1 / 10) - 1) * 100) };
    });
    sc.sources = { growthWindow: `rolling 3-year revenue CAGRs ${roll3.map(r1).join(', ')}%`, marginWindow: `${A[w0].fy}–${L.fy}${w0 > 0 ? ' (years since the last loss)' : ''}`, bullCap: peersMax != null ? 'best peer + 4 pts' : guid ? 'management guidance' : 'none' };
    out.scenarios = sc;
  } else out.notes.push(`Historical P/E, reverse valuation and scenarios need at least ~6 months of daily prices after the first reported EPS; ${P.length ? P.length + ' sessions loaded' : 'no price history loaded'}.`);
  // business CAGR vs stock CAGR
  if (P.length >= 240) {
    const yrs = (new Date(P[P.length - 1].date) - new Date(P[0].date)) / 31557600000;
    const stockCagr = cagr(P[0].close, price, yrs);
    const startRow = A.filter(a => a.resultDate <= P[0].date && nz(a.eps)).slice(-1)[0] || A.filter(a => a.resultDate <= P[0].date).slice(-1)[0];
    if (startRow) {
      const bizEps = nz(startRow.eps) ? cagr(startRow.eps, epsTTM, yrs) : null;
      const bizPat = cagr(startRow.pat, patTTM, yrs), bizRev = cagr(startRow.revenue, revTTM, yrs);
      const base = nz(bizEps) ? bizEps : bizPat;
      out.bizVsStock = { years: r1(yrs), stockCagr: r1(stockCagr), businessEpsCagr: r1(bizEps), businessPatCagr: r1(bizPat), businessRevenueCagr: r1(bizRev), valuationContribution: r1(((1 + stockCagr / 100) / (1 + base / 100) - 1) * 100), basis: nz(bizEps) ? 'EPS' : 'PAT' };
    }
  }
  return out;
}

/* ===================== MBF: finish (P18–P20, groups, special tests) ===================== */
function finishMBF(b, m, v, val, cfg) {
  const P = m.pillars, SRC = b.source.label || 'Demo data provider (not verified)';
  if (v.bizVsStock) {
    const bv = v.bizVsStock; const vc = bv.valuationContribution;
    const score = vc > 8 ? 45 : vc > 3 ? 65 : vc >= -5 ? 80 : 70;
    const p = pillar(18, 'Business CAGR vs stock CAGR', 'valuation', { score, metrics: bv, source: SRC, confidence: bv.years < 2 ? 'LOW' : 'MEDIUM' });
    p.evidence.push(`Over ${bv.years} years: stock CAGR ${bv.stockCagr}%, business ${bv.basis} CAGR ${bv.basis === 'EPS' ? bv.businessEpsCagr : bv.businessPatCagr}%, revenue CAGR ${bv.businessRevenueCagr}%.`, `Valuation contribution: ${vc >= 0 ? '+' : ''}${vc}% a year (${vc > 3 ? 'returns partly from re-rating, which can reverse' : vc < -3 ? 'multiple has compressed; returns lag the business' : 'returns explained by business growth'}).`);
    if (bv.years < 2) p.evidence.push(`Only ${bv.years} years of trading history: short windows exaggerate both numbers.`);
    if (Math.abs(vc) <= 5) p.positives.push(`Stock returns (${bv.stockCagr}%/yr) are backed by business growth, not re-rating`);
    if (vc > 15) p.negatives.push(`Stock has re-rated: price compounding ${bv.stockCagr}%/yr vs business ${bv.basis === 'EPS' ? bv.businessEpsCagr : bv.businessPatCagr}%/yr`);
    P.push(p);
  } else P.push(unscored(18, 'Business CAGR vs stock CAGR', 'valuation', ['Needs at least one year of daily prices. ' + (v.notes.find(x => /P\/E/.test(x)) || '')], SRC));
  if (v.scenarios) {
    const s = v.scenarios;
    const p = pillar(19, 'Scenario projection', 'valuation', { status: 'GREEN', metrics: s, confidence: 'MEDIUM', source: SRC });
    ['bear', 'base', 'bull'].forEach(k => p.evidence.push(`${k[0].toUpperCase() + k.slice(1)}: revenue ${s[k].assumptions.revenueGrowth}%/yr, PAT margin ${s[k].assumptions.patMargin}%, exit P/E ${s[k].assumptions.exitPE}× → 5Y CAGR ${s[k].cagr5}%.`));
    p.evidence.push(`Inputs: ${s.sources.growthWindow}; margins ${s.sources.marginWindow}; bull growth capped by ${s.sources.bullCap}; own P/E quartiles. Not scored separately. Probabilities are not assigned.`);
    P.push(p);
  } else P.push(unscored(19, 'Scenario projection', 'valuation', ['Needs own P/E history for exit multiples. ' + v.notes.join(' ')], SRC));
  if (v.reverse) {
    const R = v.reverse; const base = { LOW: 85, REASONABLE: 70, AGGRESSIVE: 45, EXTREME: 20 }[R.level];
    const score = clamp(0.6 * base + 0.25 * (100 - v.history.currentPercentile) + 0.15 * scale(v.multiples.fcfYield, 0, 4), 0, 100);
    const p = pillar(20, 'Valuation & reverse valuation', 'valuation', { score, source: SRC, confidence: R.exitPENote ? 'LOW' : 'MEDIUM', risk: R.level === 'EXTREME' ? 'HIGH' : R.level === 'AGGRESSIVE' ? 'MEDIUM' : 'LOW', metrics: { multiples: v.multiples, reverse: R, history: Object.assign({}, v.history, { series: undefined }) } });
    p.evidence.push(`P/E ${v.multiples.pe}×, P/B ${v.multiples.pb}×, EV/EBITDA ${v.multiples.evEbitda}×, EV/Sales ${v.multiples.evSales}×, FCF yield ${v.multiples.fcfYield}%${v.multiples.peg ? ', PEG ' + v.multiples.peg : ''}.`, `P/E is at the ${v.history.currentPercentile}th percentile of its own ${v.history.spanYears}-year history (median ${v.history.peMedian}×).`, `At ₹${v.price}, the market implies ${R.impliedEpsCagr}% EPS CAGR for ${R.horizon} years (exit P/E ${R.exitPE}×, ${R.costOfEquity}% required return). Compared with: ${R.anchorLabel}.`, `Expectation level: ${R.level}.`);
    if (R.exitPENote) p.evidence.push(R.exitPENote + ': exit multiple is low-confidence.');
    if (R.level === 'LOW' || R.level === 'REASONABLE') p.positives.push(`Price implies ${R.impliedEpsCagr}% EPS growth vs ${R.historicalEpsCagr5}% anchor: expectations ${R.level.toLowerCase()}`);
    else p.negatives.push(`Price already implies ${R.impliedEpsCagr}% EPS CAGR vs ${R.historicalEpsCagr5}% anchor: expectations ${R.level.toLowerCase()}`);
    if (v.history.currentPercentile > 75) p.negatives.push(`Valuation in the top quartile of its own history (P/E ${v.multiples.pe}× vs median ${v.history.peMedian}×)`);
    if (v.multiples.fcfYield < 0) p.negatives.push(`Negative free-cash-flow yield (${v.multiples.fcfYield}%)`);
    P.push(p);
  } else {
    const p = unscored(20, 'Valuation & reverse valuation', 'valuation', [`Current multiples (fact): P/E ${v.multiples.pe}× on TTM EPS ₹${v.epsTTM}${v.ttmIncludesDerived ? ' (one quarter derived from annual totals)' : ''}, P/B ${v.multiples.pb}×, EV/EBITDA ${v.multiples.evEbitda}×, EV/Sales ${v.multiples.evSales}×, FCF yield ${v.multiples.fcfYield}%.`, 'Reverse valuation needs an exit multiple from the stock\'s own P/E history; ' + v.notes.join(' '), 'Not scored until price history is loaded.'], SRC);
    p.metrics = { multiples: v.multiples };
    P.push(p);
  }
  P.sort((a, b2) => a.id - b2.id);
  P.forEach(p => { if (p.score != null) p.score = r0(p.score); });
  const groupMap = { businessQuality: 'Business quality', growth: 'Growth', competitivePosition: 'Competitive position', financialQuality: 'Financial quality', managementGovernance: 'Management & governance', cashGeneration: 'Cash generation', valuation: 'Valuation', forensicFallback: 'Forensic / failure risk' };
  const groups = Object.keys(groupMap).map(k => {
    const ps = P.filter(p => p.group === k && p.score != null && p.id !== 19);
    const all = P.filter(p => p.group === k && p.id !== 19);
    return { key: k, name: groupMap[k], weight: cfg.mbfWeights[k], score: ps.length ? r0(mean(ps.map(p => p.score))) : null, pillarIds: all.map(p => p.id), coverage: r0(ps.length / all.length * 100) };
  });
  const avail = groups.filter(g => g.score != null);
  const tw = avail.reduce((s, g) => s + g.weight, 0), allW = groups.reduce((s, g) => s + g.weight, 0);
  const score = r0(avail.reduce((s, g) => s + g.weight * g.score, 0) / tw);
  const scoredPillars = P.filter(p => p.id !== 19);
  const pillarCoverage = r0(scoredPillars.filter(p => p.score != null).length / scoredPillars.length * 100);
  // special tests
  const A = b.annual, L = A[A.length - 1];
  const cfoPat = P[6].metrics.cfoToPat5y, incr = P[8].metrics.incrementalRoce5y, gdr = P[9].metrics.guidanceDeliveryRate;
  const second = [
    { check: 'Cash conversion CFO/PAT ≥ 0.8', pass: cfoPat >= 0.8, value: cfoPat },
    { check: 'Forensic risk not HIGH/EXTREME', pass: ['LOW', 'MODERATE'].includes(P[10].metrics.forensicRisk), value: P[10].metrics.forensicRisk },
    { check: 'Incremental ROCE ≥ 15%', pass: incr >= 15, value: incr != null ? incr + '%' : 'n/a' },
    { check: 'Guidance delivery ≥ 60%', pass: gdr >= 60, value: gdr != null ? gdr + '%' : 'not yet measurable' },
    { check: 'Data quality ≥ 70', pass: val.score >= 70, value: val.score },
    { check: 'Latest quarter not deteriorating', pass: !(P[0].trend === 'DETERIORATING' || P[5].trend === 'DETERIORATING'), value: `${P[0].trend.toLowerCase()} growth, ${P[5].trend.toLowerCase()} margin` }
  ];
  const secondPass = second.every(s => s.pass);
  const recDays = A.map(a => daysOf(a, 'rec'));
  const sh = b.shareholding; const fiiCh = sh.length >= 2 ? sh[sh.length - 1].fii - sh[sh.length - 2].fii : null;
  const diiCh = sh.length >= 2 && nz(sh[sh.length - 1].dii) ? sh[sh.length - 1].dii - sh[sh.length - 2].dii : null;
  const instCh = nz(fiiCh) ? fiiCh + (diiCh || 0) : null;
  const Q = b.quarterly; const taxQ = Q.filter(q => nz(q.taxPct));
  const oi = nz(L.otherIncome) ? L.otherIncome / L.pbt * 100 : null;
  const k3 = Math.max(0, A.length - 4);
  const sixth = [
    { check: 'Receivable days rising while revenue grows', found: nz(recDays[k3]) && nz(recDays[recDays.length - 1]) ? recDays[recDays.length - 1] > recDays[k3] + 5 : null, detail: nz(recDays[k3]) ? `${r0(recDays[k3])} → ${r0(recDays[recDays.length - 1])} days` : 'Data unavailable' },
    { check: 'Growth driven by a single year', found: Math.max(...m.yoy.slice(-5)) > 2 * median(m.yoy.slice(-5)), detail: `Max 5-yr YoY ${r1(Math.max(...m.yoy.slice(-5)))}% vs median ${r1(median(m.yoy.slice(-5)))}%` },
    { check: 'Latest quarter diverges from annual trend', found: m.lastQYoY != null && Math.abs(m.lastQYoY - P[0].metrics.cagr3) > 5 && (m.lastQYoY < P[0].metrics.cagr3 || (b.governance.acquisitions || []).length > 0), detail: `${Q[Q.length - 1].q} YoY ${r1(m.lastQYoY)}% vs ${P[0].metrics.cagr3}% 3Y CAGR` },
    { check: 'Institutions selling (latest quarter)', found: nz(instCh) ? instCh < -1 : null, detail: nz(fiiCh) ? `FII ${fiiCh >= 0 ? '+' : ''}${r1(fiiCh)} pts${nz(diiCh) ? `, DII ${diiCh >= 0 ? '+' : ''}${r1(diiCh)} pts` : ''}` : 'Data unavailable' },
    { check: 'Standalone vs consolidated divergence', found: Math.abs(L.standalonePat / L.pat - 1) > 0.1 || !!(b.standaloneQuarterNote && b.standaloneQuarterNote.divergent), detail: `Standalone PAT is ${r0(L.standalonePat / L.pat * 100)}% of consolidated (${L.fy})${b.standaloneQuarterNote && b.standaloneQuarterNote.divergent ? '; latest quarter diverges in direction' : ''}` },
    { check: 'Other income share of profit', found: oi != null ? oi > 20 : null, detail: oi != null ? `${r1(oi)}% of PBT` : 'Data unavailable' },
    { check: 'Tax-rate anomalies (quarterly)', found: taxQ.length ? taxQ.some(q => q.taxPct < 5 || q.taxPct > 45) : null, detail: taxQ.length ? taxQ.map(q => `${q.q} ${r1(q.taxPct)}%`).join(', ') : 'Data unavailable' }
  ];
  const consol = { revenueDiffPct: r1((L.standaloneRevenue / L.revenue - 1) * 100), patDiffPct: r1((L.standalonePat / L.pat - 1) * 100), material: Math.abs(L.standalonePat / L.pat - 1) > 0.1 || Math.abs(L.standaloneRevenue / L.revenue - 1) > 0.1 || !!(b.standaloneQuarterNote && b.standaloneQuarterNote.divergent), quarterNote: b.standaloneQuarterNote ? b.standaloneQuarterNote.text : null };
  const pr = m.peerRank; const prv = Object.values(pr); const tops = prv.filter(x => x === 1).length; const top2 = prv.filter(x => x <= 2).length;
  const competitiveness = prv.length ? { answer: tops >= 3 ? 'YES' : top2 >= 3 ? 'PARTLY' : 'NO', detail: `Ranks #1 on ${tops} and top-2 on ${top2} of 4 peer metrics (growth #${pr.revCagr5}, margin #${pr.ebitdaMargin}, ROCE #${pr.roce}, leverage #${pr.de}).`, confidence: 'LOW' } : { answer: 'UNKNOWN', detail: 'No verified peer set, so this cannot be answered yet.', confidence: 'LOW' };
  return {
    version: FRAMEWORK_VERSIONS.mbf, score, pillars: P, groups, coverage: r0(tw / allW * 100), pillarCoverage,
    forensic: { score: P[10].score, level: P[10].metrics.forensicRisk, flags: m.forensicFlags },
    specialTests: { secondStage: { ran: true, pass: secondPass, checks: second }, sixthLayer: sixth, consolidatedVsStandalone: consol, competitiveness, managementTracking: m.gTrack, matchedCompany: { status: 'UNAVAILABLE' }, cohort: { status: 'UNAVAILABLE' } },
    trendCount: { improving: P.filter(p => p.trend === 'IMPROVING').length, deteriorating: P.filter(p => p.trend === 'DETERIORATING').length }
  };
}

/* ===================== TAF1.0 ===================== */
function alignIndex(P, idx) { if (!idx || !idx.length) return null; const m = new Map(idx.map(x => [x.date, x.close])); let lastV = null; const out = P.map(p => { const v = m.get(p.date); if (v != null) lastV = v; return v != null ? v : lastV; }); return out.filter(x => x != null).length >= P.length * 0.9 ? out : null; }
function runTAF(b, cfg) {
  if (!technicalReady(b)) { const c = priceCoverage(b); return { version: FRAMEWORK_VERSIONS.taf, available: false, score: null, reason: `Needs ${MIN_BARS}+ daily sessions with volume; ${c.bars} sessions loaded${c.bars ? `, volume on ${Math.round(c.volPct * 100)}%` : ''}.` }; }
  const P = b.prices, n = P.length, C = P.map(p => p.close), V = P.map(p => p.volume || 0), last = C[n - 1];
  const NI = alignIndex(P, b.nifty), SE = alignIndex(P, b.sector);
  const ret = (arr, k) => (arr && n - 1 - k >= 0 && arr[n - 1] != null && arr[n - 1 - k] != null ? (arr[n - 1] / arr[n - 1 - k] - 1) * 100 : null);
  const periods = { '1D': 1, '1W': 5, '1M': 21, '3M': 63, '6M': 126, '1Y': 252, '3Y': 756, '5Y': 1250 };
  const taf1 = Object.entries(periods).map(([k, d]) => ({ period: k, stock: r1(ret(C, d)), nifty: r1(ret(NI, d)), sector: r1(ret(SE, d)), vsNifty: ret(C, d) == null || ret(NI, d) == null ? null : r1(ret(C, d) - ret(NI, d)) }));
  const m20 = sma(C, 20), m50 = sma(C, 50), m100 = sma(C, 100), m200 = sma(C, 200);
  const slope20 = (ma) => (ma[n - 1] / ma[n - 21] - 1) * 100;
  const cls = (ma, s, strongS) => { const above = last > ma[n - 1]; const sl = slope20(ma); if (above && sl > strongS) return 2; if (above && sl > 0) return 1; if (!above && sl < -strongS) return -2; if (!above && sl < 0) return -1; return 0; };
  const prim = cls(m200, 0, 3), sec = cls(m50, 0, 4), sht = cls(m20, 0, 4);
  const tScore = prim * 0.5 + sec * 0.3 + sht * 0.2;
  const label = x => x >= 1.5 ? 'STRONG UPTREND' : x >= 0.5 ? 'UPTREND' : x > -0.5 ? 'SIDEWAYS' : x > -1.5 ? 'DOWNTREND' : 'STRONG DOWNTREND';
  const taf2 = { primary: label(prim), secondary: label(sec), shortTerm: label(sht), overall: label(tScore), raw: r1(tScore) };
  // MAs & crossovers
  let cross = null; for (let i = n - 1; i > n - 300 && i > 200; i--) { if (m50[i] > m200[i] && m50[i - 1] <= m200[i - 1]) { cross = { type: 'Golden cross (50 above 200)', date: P[i].date }; break; } if (m50[i] < m200[i] && m50[i - 1] >= m200[i - 1]) { cross = { type: 'Death cross (50 below 200)', date: P[i].date }; break; } }
  const mas = [['20', m20], ['50', m50], ['100', m100], ['200', m200]].map(([k, a]) => ({ ma: k + ' DMA', value: r1(a[n - 1]), slope20d: r1(slope20(a)), distancePct: r1((last / a[n - 1] - 1) * 100), above: last > a[n - 1] }));
  const stacked = m20[n - 1] > m50[n - 1] && m50[n - 1] > m100[n - 1] && m100[n - 1] > m200[n - 1];
  const stackedDown = m20[n - 1] < m50[n - 1] && m50[n - 1] < m100[n - 1] && m100[n - 1] < m200[n - 1];
  const taf3 = { mas, lastCross: cross, stacked: stacked ? 'BULLISH (20>50>100>200)' : stackedDown ? 'BEARISH (20<50<100<200)' : 'MIXED', aboveCount: mas.filter(x => x.above).length };
  // momentum
  const rs = rsiSeries(C); const e12 = ema(C, 12), e26 = ema(C, 26); const macd = C.map((_, i) => e12[i] - e26[i]); const sig = ema(macd, 9); const hist = macd.map((x, i) => x - sig[i]);
  const roc20 = (C[n - 1] / C[n - 21] - 1) * 100, roc20prev = (C[n - 11] / C[n - 31] - 1) * 100;
  const rsiNow = rs[n - 1];
  const rsiRead = rsiNow > 70 ? (prim > 0 ? 'Strong momentum inside an uptrend; overbought readings can persist' : 'Overbought without trend support') : rsiNow < 30 ? (prim < 0 ? 'Oversold inside a downtrend; not a reversal signal on its own' : 'Oversold pullback within a rising primary trend') : rsiNow >= 50 ? 'Momentum bias positive' : 'Momentum bias negative';
  const taf4 = { rsi: r1(rsiNow), rsiReading: rsiRead, macd: r1(macd[n - 1]), macdSignal: r1(sig[n - 1]), macdHist: r1(hist[n - 1]), macdState: hist[n - 1] > 0 ? (hist[n - 1] > hist[n - 6] ? 'Bullish, strengthening' : 'Bullish, fading') : (hist[n - 1] < hist[n - 6] ? 'Bearish, strengthening' : 'Bearish, fading'), roc20: r1(roc20), momentumChange: r1(roc20 - roc20prev), acceleration: roc20 > roc20prev + 2 ? 'ACCELERATING' : roc20 < roc20prev - 2 ? 'DECELERATING' : 'STEADY' };
  // volume
  const av = k => mean(V.slice(n - k)); const obv = []; V.forEach((v, i) => obv.push(i === 0 ? 0 : obv[i - 1] + (C[i] > C[i - 1] ? v : C[i] < C[i - 1] ? -v : 0)));
  const obvSlope = (obv[n - 1] - obv[n - 51]) / (av(50) * 50) * 100;
  let upV = 0, dnV = 0; for (let i = n - 50; i < n; i++) { if (C[i] > C[i - 1]) upV += V[i]; else dnV += V[i]; }
  const dv = a => { const x = a.map(p => p.deliveryPct).filter(nz); return x.length ? mean(x) : null; };
  const d20 = dv(P.slice(n - 20)), d250 = dv(P.slice(n - 250));
  const taf5 = { avgVol20: r0(av(20)), avgVol50: r0(av(50)), avgVol250: r0(av(250)), relativeVolume: r1(V[n - 1] / av(50)), volTrend: av(20) > av(250) * 1.15 ? 'EXPANDING' : av(20) < av(250) * 0.85 ? 'CONTRACTING' : 'NORMAL', obvSlope50: r1(obvSlope), upDownVolRatio50: r2(upV / dnV), delivery20: r1(d20), delivery250: r1(d250) };
  // candles
  const candles = [];
  for (let i = n - 10; i < n; i++) {
    const p = P[i], q = P[i - 1], body = Math.abs(p.close - p.open), rng = p.high - p.low || 1e-9, up = p.high - Math.max(p.open, p.close), lo = Math.min(p.open, p.close) - p.low;
    const hh20 = Math.max(...P.slice(i - 21, i - 1).map(x => x.high)), ll20 = Math.min(...P.slice(i - 21, i - 1).map(x => x.low));
    if (p.close > p.open && q.close < q.open && p.close > q.open && p.open < q.close) candles.push({ date: p.date, pattern: 'Bullish engulfing', bias: 1 });
    if (p.close < p.open && q.close > q.open && p.close < q.open && p.open > q.close) candles.push({ date: p.date, pattern: 'Bearish engulfing', bias: -1 });
    if (up > 2 * body && up / rng > 0.55) candles.push({ date: p.date, pattern: 'Long upper wick (rejection)', bias: -1 });
    if (lo > 2 * body && lo / rng > 0.55) candles.push({ date: p.date, pattern: 'Long lower wick (buying support)', bias: 1 });
    if (p.close > hh20 && body / rng > 0.6) candles.push({ date: p.date, pattern: 'Breakout candle above 20-day high', bias: 1 });
    if (p.close < ll20 && body / rng > 0.6) candles.push({ date: p.date, pattern: 'Breakdown candle below 20-day low', bias: -1 });
    const gap = (p.open / q.close - 1) * 100; if (Math.abs(gap) > 2) candles.push({ date: p.date, pattern: `Gap ${gap > 0 ? 'up' : 'down'} ${r1(gap)}%`, bias: gap > 0 ? 1 : -1 });
  }
  const taf6 = { patterns: candles, netBias: candles.reduce((s, c) => s + c.bias, 0) };
  // support / resistance (fractal pivots, clustered)
  const piv = []; const look = Math.max(5, n - 500);
  for (let i = look; i < n - 5; i++) {
    const w = P.slice(i - 5, i + 6);
    if (P[i].high === Math.max(...w.map(x => x.high))) piv.push({ i, price: P[i].high, type: 'H', vol: V[i] });
    if (P[i].low === Math.min(...w.map(x => x.low))) piv.push({ i, price: P[i].low, type: 'L', vol: V[i] });
  }
  const clusters = [];
  piv.sort((a, b2) => a.price - b2.price).forEach(p => { const c = clusters.find(c => Math.abs(c.price / p.price - 1) < 0.025); if (c) { c.members.push(p); c.price = mean(c.members.map(m => m.price)); } else clusters.push({ price: p.price, members: [p] }); });
  clusters.forEach(c => { c.touches = c.members.length; c.lastIdx = Math.max(...c.members.map(m => m.i)); c.strength = c.touches + c.members.reduce((s, m) => s + m.vol, 0) / mean(V) / 4; });
  const brokenUp = c => c.members.some(m => m.type === 'H') && last > c.price;
  const supports = clusters.filter(c => c.price < last).sort((a, b2) => b2.price - a.price).slice(0, 3).map(c => ({ level: r1(c.price), touches: c.touches, strength: r1(c.strength), role: brokenUp(c) ? 'Former resistance (breakout zone)' : 'Support', lastTouched: P[c.lastIdx].date }));
  const resist = clusters.filter(c => c.price > last).sort((a, b2) => a.price - b2.price).slice(0, 3).map(c => ({ level: r1(c.price), touches: c.touches, strength: r1(c.strength), role: c.members.some(m => m.type === 'L') ? 'Former support (breakdown zone)' : 'Resistance', lastTouched: P[c.lastIdx].date }));
  const taf7 = { supports, resistances: resist, pivots: piv.length };
  // patterns
  const pats = [];
  const hh60 = Math.max(...P.slice(n - 70, n - 10).map(p => p.high)), ll60 = Math.min(...P.slice(n - 70, n - 10).map(p => p.low));
  const recentMax = Math.max(...C.slice(n - 10)), recentMin = Math.min(...C.slice(n - 10));
  const rangeW = (Math.max(...P.slice(n - 60).map(p => p.high)) / Math.min(...P.slice(n - 60).map(p => p.low)) - 1) * 100;
  if (recentMax > hh60) { const holding = last > hh60; const bi = n - 10 + C.slice(n - 10).findIndex(c => c > hh60); const vc = V[bi] / mean(V.slice(bi - 50, bi)); pats.push({ pattern: holding ? 'Breakout above 60-day range' : 'Breakout attempt failed', level: r1(hh60), confidence: holding && vc > 1.3 ? 'HIGH' : holding ? 'MEDIUM' : 'MEDIUM', note: `Breakout-day volume ${r1(vc)}× its 50-day average` }); }
  if (recentMin < ll60) pats.push({ pattern: last < ll60 ? 'Breakdown below 60-day range' : 'Breakdown attempt reversed', level: r1(ll60), confidence: last < ll60 * 0.98 ? 'HIGH' : 'MEDIUM', note: 'Close relative to prior 60-day low' });
  if (rangeW < 15) pats.push({ pattern: 'Consolidation range', level: null, confidence: rangeW < 10 ? 'HIGH' : 'MEDIUM', note: `60-day high-low width ${r1(rangeW)}%` });
  const ph = piv.filter(p => p.type === 'H' && p.i > n - 150), pl = piv.filter(p => p.type === 'L' && p.i > n - 150);
  for (let a = 0; a < ph.length; a++) for (let c = a + 1; c < ph.length; c++) { if (ph[c].i - ph[a].i > 15 && Math.abs(ph[c].price / ph[a].price - 1) < 0.03) { const trough = Math.min(...C.slice(ph[a].i, ph[c].i)); if (trough < ph[a].price * 0.94) { pats.push({ pattern: last < trough ? 'Double top (confirmed)' : 'Possible double top', level: r1(trough), confidence: last < trough ? 'MEDIUM' : 'LOW', note: `Peaks ${P[ph[a].i].date} and ${P[ph[c].i].date}; neckline ${r1(trough)}` }); a = ph.length; break; } } }
  for (let a = 0; a < pl.length; a++) for (let c = a + 1; c < pl.length; c++) { if (pl[c].i - pl[a].i > 15 && Math.abs(pl[c].price / pl[a].price - 1) < 0.03) { const peak = Math.max(...C.slice(pl[a].i, pl[c].i)); if (peak > pl[a].price * 1.06) { pats.push({ pattern: last > peak ? 'Double bottom (confirmed)' : 'Possible double bottom', level: r1(peak), confidence: last > peak ? 'MEDIUM' : 'LOW', note: `Lows ${P[pl[a].i].date} and ${P[pl[c].i].date}` }); a = pl.length; break; } } }
  const lastH = ph.slice(-2), lastL = pl.slice(-2);
  if (lastH.length === 2 && lastL.length === 2 && lastH[1].price < lastH[0].price && lastL[1].price > lastL[0].price) pats.push({ pattern: 'Contracting triangle', level: null, confidence: 'LOW', note: 'Lower highs and higher lows in the last 150 sessions' });
  const tl = pl.slice(-3); if (tl.length >= 2) { const s = (tl[tl.length - 1].price - tl[0].price) / (tl[tl.length - 1].i - tl[0].i); const proj = tl[tl.length - 1].price + s * (n - 1 - tl[tl.length - 1].i); if (s > 0 && last < proj * 0.98) pats.push({ pattern: 'Rising trendline broken', level: r1(proj), confidence: 'MEDIUM', note: `Trendline through recent swing lows projects to ${r1(proj)}` }); }
  if (!pats.length) pats.push({ pattern: 'No clear pattern', level: null, confidence: 'LOW', note: 'Structure is not decisive' });
  const taf8 = { patterns: pats };
  // relative strength
  const ex = (k) => { const a = ret(C, k), z = ret(NI, k); return a == null || z == null ? null : a - z; }, exS = (k) => { const a = ret(C, k), z = ret(SE, k); return a == null || z == null ? null : a - z; };
  const exParts = [[ex(63), 0.4], [ex(126), 0.4], [ex(252), 0.2]].filter(x => nz(x[0]));
  const rsScore = exParts.length ? exParts.reduce((s, x) => s + x[0] * x[1], 0) / exParts.reduce((s, x) => s + x[1], 0) : null;
  const taf9 = { vsNifty3M: r1(ex(63)), vsNifty6M: r1(ex(126)), vsNifty1Y: r1(ex(252)), vsSector3M: r1(exS(63)), vsSector6M: r1(exS(126)), vsPeers: 'Data unavailable (peer price history not provided)', classification: rsScore == null ? 'DATA UNAVAILABLE' : rsScore > 4 ? 'OUTPERFORMING' : rsScore < -4 ? 'UNDERPERFORMING' : 'NEUTRAL', composite: r1(rsScore), note: NI ? null : 'Nifty history not loaded: relative strength not computed and its weight is redistributed.' };
  // volatility & liquidity
  const atr = atrSeries(P); const lr = C.slice(n - 21).map((c, i, a) => i ? Math.log(c / a[i - 1]) : 0).slice(1);
  const atv = mean(P.slice(n - 20).map(p => p.close * p.volume)) / 1e7;
  const circ = P.slice(n - 250).filter(p => p.circuit).length;
  const taf10 = { atr14: r1(atr[n - 1]), atrPct: r1(atr[n - 1] / last * 100), realisedVol20: r1(stdev(lr) * Math.sqrt(252) * 100), avgTradedValueCr: r1(atv), circuitHits1Y: circ, liquidityRisk: atv < 1 ? 'HIGH' : atv < 5 ? 'MEDIUM' : 'LOW', atrVs100: r1(atr[n - 1] / mean(atr.slice(n - 100).filter(x => x))) };
  // event behaviour (results)
  const evs = b.eventDates.map(d => P.findIndex(p => p.date === d)).filter(i => i > 31 && i < n);
  const evRows = evs.map(i => { const g = (a, z) => (z < n && a >= 0 ? r1((C[z] / C[a] - 1) * 100) : null); return { date: P[i].date, pre30: g(i - 31, i - 1), pre15: g(i - 16, i - 1), pre7: g(i - 8, i - 1), day: g(i - 1, i), post1: g(i - 1, i + 1), post7: g(i - 1, i + 7), post15: g(i - 1, i + 15), post30: g(i - 1, i + 30) }; });
  const avgOf = k => { const xs = evRows.map(r => r[k]).filter(x => x != null); return xs.length ? r1(mean(xs)) : null; };
  const hit = k => { const xs = evRows.map(r => r[k]).filter(x => x != null); return xs.length ? r0(xs.filter(x => x > 0).length / xs.length * 100) : null; };
  const avgs = { pre30: avgOf('pre30'), pre15: avgOf('pre15'), pre7: avgOf('pre7'), day: avgOf('day'), post1: avgOf('post1'), post7: avgOf('post7'), post15: avgOf('post15'), post30: avgOf('post30') };
  const reactionAfterDay = avgs.post7 - avgs.day;
  const evPattern = avgs.pre15 > 1.5 && reactionAfterDay < -0.5 ? 'Buy the rumour, sell the news' : avgs.pre15 > 1.5 ? 'Rallies before results' : avgs.pre15 < -1.5 ? 'Sells off before results' : avgs.day > 0.5 ? 'Reacts positively on results' : avgs.day < -0.5 ? 'Reacts negatively on results' : 'No consistent result-day behaviour';
  const nextEv = b.meta.phase >= 1 ? '2027-02-08 (estimated)' : '2026-11-06 (estimated)';
  const taf11 = { events: evRows, averages: avgs, hitRates: { day: hit('day'), post7: hit('post7'), post30: hit('post30') }, pattern: evPattern, sampleSize: evRows.length, nextResultDate: nextEv };
  // Fibonacci
  const w = P.slice(n - 252); let hiI = 0, loI = 0; w.forEach((p, i) => { if (p.high > w[hiI].high) hiI = i; if (p.low < w[loI].low) loI = i; });
  const H = w[hiI].high, Lo = w[loI].low, upSwing = loI < hiI; const rngF = H - Lo;
  const fibLevels = [0.236, 0.382, 0.5, 0.618, 0.786].map(f => ({ ratio: f, level: r1(upSwing ? H - rngF * f : Lo + rngF * f) }));
  const ext = [1.272, 1.618].map(f => ({ ratio: f, level: r1(upSwing ? Lo + rngF * f : H - rngF * f) }));
  const nearest = fibLevels.reduce((a, z) => Math.abs(z.level - last) < Math.abs(a.level - last) ? z : a);
  const taf12 = { swing: upSwing ? 'Up-swing (low → high)' : 'Down-swing (high → low)', swingHigh: r1(H), swingLow: r1(Lo), retracements: fibLevels, extensions: ext, nearest, note: 'Fibonacci levels are reference zones, not guaranteed support or resistance.' };
  // volume profile + Elliott-style swing structure + projections
  const vp = P.slice(n - 250); const vmin = Math.min(...vp.map(p => p.low)), vmax = Math.max(...vp.map(p => p.high)); const bins = 24, bw = (vmax - vmin) / bins;
  const prof = Array.from({ length: bins }, (_, i) => ({ from: vmin + i * bw, to: vmin + (i + 1) * bw, vol: 0 }));
  vp.forEach(p => { const k = clamp(Math.floor(((p.high + p.low + p.close) / 3 - vmin) / bw), 0, bins - 1); prof[k].vol += p.volume; });
  const avgBin = mean(prof.map(x => x.vol)); const poc = prof.reduce((a, z) => z.vol > a.vol ? z : a);
  prof.forEach(x => x.node = x.vol > avgBin * 1.3 ? 'HVN' : x.vol < avgBin * 0.5 ? 'LVN' : '');
  // zigzag swings (8%)
  const zz = []; const z0 = Math.max(0, n - 400); let dir = 0, ext0 = C[z0], extI = z0;
  for (let i = Math.max(1, n - 400); i < n; i++) { const c = C[i]; if (dir >= 0) { if (c > ext0) { ext0 = c; extI = i; } else if (c < ext0 * 0.92) { zz.push({ i: extI, price: ext0, type: 'H' }); dir = -1; ext0 = c; extI = i; } } if (dir < 0) { if (c < ext0) { ext0 = c; extI = i; } else if (c > ext0 * 1.08) { zz.push({ i: extI, price: ext0, type: 'L' }); dir = 1; ext0 = c; extI = i; } } }
  const legs = zz.length; const lastSw = zz.slice(-5);
  let wave = 'Insufficient swing structure for a wave count', wConf = 'LOW';
  if (lastSw.length >= 4) { const ups = []; for (let k = 1; k < lastSw.length; k++) if (lastSw[k].type === 'H') ups.push(lastSw[k].price - lastSw[k - 1].price); wave = prim > 0 ? `Impulsive advance in progress; ${legs} swings of ≥8% in 400 sessions. A possible late-stage (wave 3–5) structure, but alternate counts are equally plausible.` : `Corrective structure; ${legs} swings of ≥8% in 400 sessions. Count is ambiguous.`; wConf = 'LOW'; }
  const base = { lo: Math.min(...P.slice(n - 120, n - 40).map(p => p.low)), hi: Math.max(...P.slice(n - 120, n - 40).map(p => p.high)) };
  const mm = base.hi + (base.hi - base.lo);
  const taf13 = { volumeProfile: prof.map(x => ({ from: r1(x.from), to: r1(x.to), vol: x.vol, node: x.node })), poc: r1((poc.from + poc.to) / 2), elliott: { reading: wave, confidence: wConf, swings: legs }, projections: [ { method: 'Measured move from prior base', target: r1(mm), confidence: 'LOW' }, { method: 'Fibonacci 1.272 extension', target: ext[0].level, confidence: 'LOW' }, { method: 'Fibonacci 1.618 extension', target: ext[1].level, confidence: 'LOW' } ] };
  // TAF score
  const W = cfg.tafWeights;
  const sTrend = scale(tScore, -2, 2);
  const sMA = clamp(taf3.aboveCount * 20 + (stacked ? 20 : stackedDown ? -10 : 5), 0, 100);
  const sMom = clamp((rsiNow >= 45 && rsiNow <= 72 ? 70 : rsiNow > 72 ? (prim > 0 ? 65 : 45) : rsiNow < 30 ? 25 : 45) + (hist[n - 1] > 0 ? 15 : -15) + clamp(roc20, -15, 15), 0, 100);
  const sRS = rsScore == null ? null : scale(rsScore, -15, 15);
  const sVol = clamp(scale(upV / dnV, 0.6, 1.6) * 0.6 + scale(obvSlope, -40, 40) * 0.4, 0, 100);
  let sStruct = 50; pats.forEach(p => { if (/^Breakout above/.test(p.pattern)) sStruct += 25; if (/failed|Breakdown below|Double top \(confirmed|trendline broken/.test(p.pattern)) sStruct -= 20; if (/Double bottom \(confirmed/.test(p.pattern)) sStruct += 15; }); sStruct = clamp(sStruct + (supports.length ? 5 : -5), 0, 100);
  const sPA = clamp(50 + taf6.netBias * 12, 0, 100);
  const sVolat = clamp((taf10.liquidityRisk === 'LOW' ? 80 : taf10.liquidityRisk === 'MEDIUM' ? 55 : 25) - (taf10.atrVs100 > 1.5 ? 20 : 0), 0, 100);
  const comps = [['trend', 'Trend structure', sTrend], ['movingAverages', 'Moving averages', sMA], ['momentum', 'Momentum', sMom], ['relativeStrength', 'Relative strength', sRS], ['volume', 'Volume / accumulation', sVol], ['structure', 'Support, resistance & patterns', sStruct], ['priceAction', 'Price action', sPA], ['volatility', 'Volatility & liquidity', sVolat]];
  const cAvail = comps.filter(c => c[2] != null);
  const tw = cAvail.reduce((s, c) => s + W[c[0]], 0);
  const score = r0(cAvail.reduce((s, c) => s + W[c[0]] * c[2], 0) / tw);
  return { version: FRAMEWORK_VERSIONS.taf, available: true, score, bars: n, components: comps.map(c => ({ key: c[0], name: c[1], score: r0(c[2]), weight: c[2] == null ? 0 : W[c[0]] })), taf1, taf2, taf3, taf4, taf5, taf6, taf7, taf8, taf9, taf10, taf11, taf12, taf13,
    series: { m20, m50, m100, m200, rsi: rs, macd, macdSignal: sig, macdHist: hist } };
}

/* ===================== PVST1.0 ===================== */
function pvstFeatures(P, i, supportLevels, resistanceLevels, primaryUp) {
  const C = P.map(p => p.close), V = P.map(p => p.volume || 0);
  const p5 = (C[i] / C[i - 5] - 1) * 100, p20 = (C[i] / C[i - 20] - 1) * 100;
  const v20 = mean(V.slice(i - 19, i + 1)), vBase = mean(V.slice(Math.max(0, i - 119), i - 19)), v5 = mean(V.slice(i - 4, i + 1));
  let up = 0, dn = 0; for (let k = i - 19; k <= i; k++) { if (C[k] > C[k - 1]) up += V[k]; else dn += V[k]; }
  const dvm = a => { const x = a.map(p => p.deliveryPct).filter(nz); return x.length ? mean(x) : null; };
  const d20 = dvm(P.slice(i - 19, i + 1)), dBase = dvm(P.slice(Math.max(0, i - 249), i - 19));
  const circuit = P.slice(i - 19, i + 1).filter(p => p.circuit).map(p => p.circuit);
  const sup = supportLevels.filter(s => C[i - 20] > s).sort((a, b) => b - a)[0];
  const res = resistanceLevels.filter(r => C[i - 20] < r).sort((a, b) => a - b)[0];
  const supportBroken = sup != null && C[i] < sup * 0.98 && C.slice(i - 2, i + 1).every(c => c < sup);
  const maxRecent = Math.max(...C.slice(i - 19, i + 1));
  const brokeRes = res != null && maxRecent > res * 1.02;
  const breakoutFailed = brokeRes && C[i] < res;
  const breakoutHeld = brokeRes && C[i] > res;
  let boVol = null; if (brokeRes) { const k = i - 19 + C.slice(i - 19, i + 1).findIndex(c => c > res * 1.02); boVol = V[k] / vBase; }
  const hh30 = Math.max(...P.slice(i - 29, i + 1).map(p => p.high)); let failed = 0;
  for (let k = i - 29; k <= i; k++) { const p = P[k]; const pos = (p.close - p.low) / ((p.high - p.low) || 1e-9); if (p.high >= hh30 * 0.985 && pos < 0.4) failed++; }
  const atrNow = mean(P.slice(i - 13, i + 1).map(p => p.high - p.low)), atrBase = mean(P.slice(Math.max(0, i - 113), i - 13).map(p => p.high - p.low));
  const recentCirc = P.slice(i - 2, i + 1).map(p => p.circuit).filter(Boolean);
  return { p5, p20, rvol20: v20 / vBase, rvol5: v5 / vBase, udRatio: up / (dn || 1), delivery20: d20, deliveryBase: dBase, circuit, support: sup, resistance: res, supportBroken, breakoutFailed, breakoutHeld, breakoutVol: boVol, failedRallies: failed, volExpansion: atrNow / atrBase, primaryUp, lowerLocks: recentCirc.filter(c => c === 'LOWER').length, upperLocks: recentCirc.filter(c => c === 'UPPER').length };
}
function pvstClassify(f) {
  const delKnown = nz(f.delivery20) && nz(f.deliveryBase);
  if (f.lowerLocks >= 2) return 'LOWER-CIRCUIT LOCK';
  if (f.upperLocks >= 2) return 'UPPER-CIRCUIT LOCK';
  if (f.p5 < -12 && f.rvol5 > 2.5 && f.volExpansion > 1.5 && f.supportBroken) return 'CAPITULATION';
  if (f.supportBroken && f.rvol20 > 1.25 && f.udRatio < 0.85) return 'GENUINE BREAKDOWN';
  if (f.breakoutFailed && (f.breakoutVol == null || f.breakoutVol < 1.3)) return 'FALSE BREAKOUT';
  if (f.p20 <= 2 && f.rvol20 > 1.15 && f.udRatio < 0.85 && (f.failedRallies >= 2 || (delKnown && f.delivery20 < f.deliveryBase - 3))) return 'DISTRIBUTION';
  if (f.p20 > 6 && f.rvol20 > 1.1 && f.udRatio > 1.2 && f.primaryUp) return 'MOMENTUM CONTINUATION';
  if (f.p20 >= -2 && f.udRatio > 1.1 && (!delKnown || f.delivery20 >= f.deliveryBase - 1) && f.primaryUp) return 'HEALTHY ACCUMULATION';
  if (f.p20 < -3 && f.primaryUp && !f.supportBroken) return 'PROFIT BOOKING';
  if (Math.abs(f.p20) < 5 && f.rvol20 < 0.95 && !f.supportBroken) return 'HEALTHY CONSOLIDATION';
  return 'MIXED / UNCONFIRMED';
}
const PVST_POLARITY = { 'LOWER-CIRCUIT LOCK': -1, 'UPPER-CIRCUIT LOCK': 0, 'HEALTHY ACCUMULATION': 1, 'MOMENTUM CONTINUATION': 1, 'HEALTHY CONSOLIDATION': 0.5, 'PROFIT BOOKING': 0, 'MIXED / UNCONFIRMED': 0, 'FALSE BREAKOUT': -1, 'DISTRIBUTION': -1, 'GENUINE BREAKDOWN': -1, 'CAPITULATION': -1 };

function runPVST(b, taf, cfg) {
  if (!taf || !taf.available) return { version: FRAMEWORK_VERSIONS.pvst, available: false, score: null, classification: 'NOT RUN', polarity: 0, reason: taf ? taf.reason : 'Price-volume history missing' };
  const P = b.prices, n = P.length, i = n - 1;
  const sup = taf.taf7.supports.map(s => s.level), res = taf.taf7.resistances.map(r => r.level);
  // include broken-through levels within last 20 sessions as candidate support/resistance
  const extraRes = [Math.max(...P.slice(n - 80, n - 20).map(p => p.high))], extraSup = [Math.min(...P.slice(n - 80, n - 20).map(p => p.low)), taf.taf3.mas[3].value, taf.taf3.mas[1].value];
  const primaryUp = /UPTREND/.test(taf.taf2.primary);
  const f = pvstFeatures(P, i, [...sup, ...extraSup, ...res], [...res, ...extraRes, ...sup], primaryUp);
  const cls = pvstClassify(f);
  // history of this classification in this stock (point-in-time levels only)
  const hist = {};
  for (let k = 260; k < n - 21; k += 5) {
    const s = Math.min(...P.slice(k - 80, k - 20).map(p => p.low)), r = Math.max(...P.slice(k - 80, k - 20).map(p => p.high));
    const m200 = mean(P.slice(k - 199, k + 1).map(p => p.close));
    const ff = pvstFeatures(P, k, [s, m200], [r], P[k].close > m200);
    const c = pvstClassify(ff); const fwd = (P[k + 20].close / P[k].close - 1) * 100;
    (hist[c] = hist[c] || []).push(fwd);
  }
  const h = hist[cls] || [];
  const histStat = { sample: h.length, avgFwd20: h.length ? r1(mean(h)) : null, hitRate: h.length ? r0(h.filter(x => x > 0).length / h.length * 100) : null };
  const W = cfg.pvstWeights, pol = PVST_POLARITY[cls];
  const sPrice = scale(f.p20, -15, 15) * 0.6 + scale(f.p5, -8, 8) * 0.4;
  const dirUp = f.p20 >= 0;
  const sVol = dirUp ? scale(f.rvol20, 0.7, 1.6) : scale(1.6 - f.rvol20, 0, 0.9);
  const sPart = nz(f.delivery20) && nz(f.deliveryBase) ? scale(f.udRatio, 0.6, 1.6) * 0.6 + scale(f.delivery20 - f.deliveryBase, -8, 8) * 0.4 : scale(f.udRatio, 0.6, 1.6);
  const sCirc = f.circuit.length === 0 ? 100 : f.circuit.includes('LOWER') ? Math.max(0, 30 - 10 * f.circuit.filter(c => c === 'LOWER').length) : 40;
  const sLev = f.supportBroken ? 10 : f.breakoutFailed ? 25 : f.breakoutHeld ? 90 : 60;
  const sTrend = primaryUp ? 80 : /SIDEWAYS/.test(taf.taf2.primary) ? 50 : 20;
  const sHist = histStat.sample >= 5 ? scale(histStat.avgFwd20, -5, 5) : 50;
  const comps = [['price', 'Price behaviour', sPrice], ['volume', 'Volume confirmation', sVol], ['participation', 'Participation (up/down volume, delivery)', sPart], ['circuit', 'Circuit behaviour', sCirc], ['levels', 'Support / resistance context', sLev], ['trend', 'Trend context', sTrend], ['history', 'Historical pattern in this stock', sHist]];
  const tw = comps.reduce((s, c) => s + W[c[0]], 0);
  let score = comps.reduce((s, c) => s + W[c[0]] * c[2], 0) / tw;
  score = clamp(score + pol * 6, 0, 100); // classification nudges, never alone
  if (cls === 'LOWER-CIRCUIT LOCK') score = Math.min(score, 25); // participation unreadable, exits blocked
  if (cls === 'UPPER-CIRCUIT LOCK') score = Math.min(score, 55); // move unconfirmed
  const why = [];
  why.push(`Price ${r1(f.p20)}% over 20 sessions (${r1(f.p5)}% over 5).`);
  why.push(`Volume ${r2(f.rvol20)}× its prior 100-day average; up-day volume ${r2(f.udRatio)}× down-day volume.`);
  why.push(nz(f.delivery20) ? `Delivery ${r1(f.delivery20)}% vs ${r1(f.deliveryBase)}% baseline.` : 'Delivery percentage: Data unavailable in the price file.');
  if (cls === 'LOWER-CIRCUIT LOCK') why.unshift(`${f.lowerLocks} of the last 3 sessions closed at the lower circuit. Sellers could not find buyers, so volume understates selling pressure and price discovery is suspended.`);
  if (cls === 'UPPER-CIRCUIT LOCK') why.unshift(`${f.upperLocks} of the last 3 sessions closed at the upper circuit. Buyers could not find sellers; the move is unconfirmed until trading resumes freely.`);
  why.push(f.circuit.length ? `Circuit hits in last 20 sessions: ${f.circuit.join(', ')}.` : 'No circuit hits in last 20 sessions.');
  if (f.support != null) why.push(`Nearest support tested: ${r1(f.support)} — ${f.supportBroken ? 'broken and held below' : 'intact'}.`);
  if (f.resistance != null) why.push(`Nearest resistance: ${r1(f.resistance)} — ${f.breakoutHeld ? 'broken and holding above' : f.breakoutFailed ? 'broken then lost' : 'not broken'}.`);
  why.push(`Failed rallies near the 30-day high: ${f.failedRallies}.`);
  why.push(`Past occurrences of "${cls}" in this stock: ${histStat.sample} (avg next-20-day return ${histStat.avgFwd20 ?? 'n/a'}%, positive ${histStat.hitRate ?? 'n/a'}% of the time).`);
  return { version: FRAMEWORK_VERSIONS.pvst, available: true, score: r0(score), classification: cls, polarity: pol, features: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'number' ? (['rvol20', 'rvol5', 'udRatio', 'breakoutVol', 'volExpansion'].includes(k) ? r2(v) : r1(v)) : v])), components: comps.map(c => ({ key: c[0], name: c[1], score: r0(c[2]), weight: W[c[0]] })), history: histStat, historyByClass: Object.fromEntries(Object.entries(hist).map(([k, v]) => [k, { sample: v.length, avgFwd20: r1(mean(v)) }])), why };
}

/* ===================== CONFLICT / COMPOSITE / STATE / CONFIDENCE ===================== */
function detectConflict(mbf, taf, pvst, cfg) {
  if (taf == null || pvst == null) return { type: 'TECHNICAL ENGINES NOT RUN', text: 'Only the business engine could run. TAF1.0 and PVST need daily price-volume history.', spread: null };
  const H = cfg.thresholds.high, Lo = cfg.thresholds.low;
  const s = [mbf, taf, pvst], spread = Math.max(...s) - Math.min(...s);
  let type, text;
  if (mbf >= H && taf >= H && pvst >= H) { type = 'STRONG CONFLUENCE'; text = 'Business, market structure and participation all agree.'; }
  else if (mbf >= H && taf < Lo && pvst < Lo) { type = 'STRONG BUSINESS / WEAK MARKET'; text = 'Good company, technically unfavourable entry.'; }
  else if (mbf < Lo && taf >= H && pvst >= H) { type = 'MOMENTUM WITHOUT BUSINESS QUALITY'; text = 'Price strength is not backed by the business. Not a long-term investment by default.'; }
  else if (mbf >= H - 5 && taf >= 60 && pvst < Lo) { type = 'TECHNICAL STRESS'; text = 'Trend still intact but participation has turned. Investigate: profit booking, distribution or thesis deterioration?'; }
  else if (mbf >= H && taf >= H && pvst < H) { type = 'CONFLUENCE, PARTICIPATION UNCONFIRMED'; text = 'Business and trend agree; volume is not yet confirming.'; }
  else if (mbf >= H && taf < 60) { type = 'STRONG BUSINESS / SOFT MARKET'; text = 'Business is strong while market structure is weakening.'; }
  else if (s.every(x => x < Lo)) { type = 'BROAD WEAKNESS'; text = 'All three engines are weak.'; }
  else { type = 'PARTIAL ALIGNMENT'; text = `Engines disagree by ${spread} points; no single read dominates.`; }
  return { type, text, spread };
}

function composite(mbf, taf, pvst, cfg, forensicLevel, dq) {
  if (taf.score == null || pvst.score == null) return { raw: null, score: null, partial: true, suppressed: forensicLevel === 'EXTREME', suppressionReason: forensicLevel === 'EXTREME' ? 'Score suppressed due to critical forensic risk.' : null, weights: cfg.compositeWeights, lowDataWarning: dq < 60 };
  const w = cfg.compositeWeights, t = w.mbf + w.taf + w.pvst;
  const raw = (mbf.score * w.mbf + taf.score * w.taf + pvst.score * w.pvst) / t;
  const suppressed = forensicLevel === 'EXTREME';
  return { raw: r0(raw), score: suppressed ? Math.min(r0(raw), 30) : r0(raw), suppressed, suppressionReason: suppressed ? 'Score suppressed due to critical forensic risk.' : null, weights: w, lowDataWarning: dq < 60 };
}

function stateEngine(ctx, cfg) {
  const { mbf, taf, pvst, comp, val, prev } = ctx; const H = cfg.thresholds.high, Lo = cfg.thresholds.low;
  const M = mbf.score, T = taf.score, V = pvst.score, cls = pvst.classification, lvl = val.reverse ? val.reverse.level : 'UNKNOWN';
  const mbfDrop = prev ? prev.scores.mbf - M : 0;
  const deteriorating = mbfDrop >= 6 || mbf.trendCount.deteriorating >= 3;
  let state, rule;
  if (T == null || V == null) {
    if (comp.suppressed) return { state: 'AVOID', rule: 'Critical forensic risk', action: 'AVOID', matrix: 'UNKNOWN', matrixOverlay: 'PVST not run', classification: { code: '—', name: 'Unclassified' } };
    const fState = M < Lo ? 'AVOID' : 'WATCH';
    return { state: fState, rule: `Business-only read (MBF ${M}${val.reverse ? ', expectations ' + val.reverse.level.toLowerCase() : ''}). TAF1.0 and PVST need daily price-volume history before an entry or exit state can be set`, action: fState === 'AVOID' ? 'AVOID' : 'WATCH', matrix: M >= H ? 'STRONG BUSINESS, TECHNICALS UNKNOWN' : 'TECHNICALS UNKNOWN', matrixOverlay: 'PVST not run', classification: { code: '—', name: 'Needs price data' } };
  }
  if (comp.suppressed) { state = 'AVOID'; rule = 'Critical forensic risk suppresses all positive states'; }
  else if (deteriorating && (T < 55 || V < 40)) { state = 'FUNDAMENTAL DETERIORATION'; rule = `MBF deteriorating (${mbf.trendCount.deteriorating} pillars on a worsening trend${prev && prev.scores.mbf > M ? ', MBF ' + prev.scores.mbf + '→' + M : ''}: ${mbf.pillars.filter(p => p.trend === 'DETERIORATING').map(p => p.name.toLowerCase()).slice(0, 3).join(', ')}) with technical confirmation`; }
  else if (cls === 'GENUINE BREAKDOWN' || cls === 'CAPITULATION' || (/DOWNTREND/.test(taf.taf2.primary) && !taf.taf3.mas[3].above)) { state = 'TECHNICAL BREAKDOWN'; rule = `PVST ${cls} / price below 200 DMA in a downtrend`; }
  else if (cls === 'DISTRIBUTION') { state = 'DISTRIBUTION'; rule = 'PVST classifies price-volume as distribution'; }
  else if (M >= 85 && T >= 75 && V >= 75 && mbf.specialTests.secondStage.pass && (lvl === 'LOW' || lvl === 'REASONABLE')) { state = 'ELITE'; rule = 'All engines ≥75, MBF ≥85, second-stage test passed'; }
  else if (M >= H && T >= 65 && V >= 65 && mbf.specialTests.secondStage.pass && (lvl === 'LOW' || lvl === 'REASONABLE')) { state = 'STRONG BUY CANDIDATE'; rule = `MBF ≥${H}, TAF ≥65, PVST ≥65, second-stage passed, priced-in expectations ${lvl.toLowerCase()}`; }
  else if (M >= H && cls === 'PROFIT BOOKING') { state = 'PROFIT BOOKING'; rule = 'Strong business, price falling on elevated volume with structure intact'; }
  else if (M >= H && ['HEALTHY ACCUMULATION', 'HEALTHY CONSOLIDATION', 'MOMENTUM CONTINUATION'].includes(cls) && T >= 50) { state = 'ACCUMULATION'; rule = `Strong business; PVST ${cls.toLowerCase()}${mbf.specialTests.secondStage.pass ? '' : '; second-stage test not fully passed'}${lvl === 'AGGRESSIVE' || lvl === 'EXTREME' ? '; held below Strong Buy because priced-in expectations are ' + lvl.toLowerCase() : ''}`; }
  else if (M >= H && T >= 50 && (lvl === 'AGGRESSIVE' || lvl === 'EXTREME')) { state = 'HOLD'; rule = 'Strong business, intact trend, but valuation already prices in strong growth'; }
  else if (M >= H && T < 50) { state = 'WAIT FOR BETTER ENTRY'; rule = 'Strong business, weak market structure'; }
  else if (M < Lo && T >= 65 && V >= 60) { state = 'SPECULATIVE'; rule = 'Trading candidate only: momentum without business quality'; }
  else if (M < Lo) { state = 'AVOID'; rule = `MBF below ${Lo}`; }
  else { state = 'WATCH'; rule = 'Mixed evidence; no state threshold met'; }
  if (cls === 'LOWER-CIRCUIT LOCK' && !['FUNDAMENTAL DETERIORATION', 'AVOID'].includes(state)) { state = 'TECHNICAL BREAKDOWN'; rule = 'Repeated lower-circuit closes: exits are blocked and price discovery is suspended'; }
  const action = ['ELITE', 'STRONG BUY CANDIDATE', 'ACCUMULATION', 'HOLD'].includes(state) ? 'INVEST' : state === 'SPECULATIVE' ? 'TRADE' : ['AVOID', 'TECHNICAL BREAKDOWN', 'FUNDAMENTAL DETERIORATION'].includes(state) ? 'AVOID' : 'WATCH';
  const fundStrong = M >= H, techStrong = T >= 60;
  const matrix = fundStrong && techStrong ? 'IDEAL' : fundStrong ? 'WAIT' : techStrong ? 'TRADE ONLY' : 'AVOID';
  let klass;
  if (deteriorating && (T < 55 || V < 40)) klass = { code: 'G', name: 'Thesis break' };
  else if (M >= H && (cls === 'DISTRIBUTION' || cls === 'GENUINE BREAKDOWN' || V < Lo)) klass = { code: 'F', name: 'Distribution' };
  else if (M >= H && T >= 60) klass = { code: 'A', name: 'Long-term compounder' };
  else if (M >= H && (lvl === 'LOW') ) klass = { code: 'C', name: 'Value opportunity' };
  else if (M >= H) klass = { code: 'B', name: 'Watchlist compounder' };
  else if (M < 60 && T >= 65 && V >= 60) klass = { code: 'D', name: 'Momentum trade' };
  else if (M < Lo && val.history && val.multiples.pe < val.history.pe25) klass = { code: 'E', name: 'Value trap' };
  else klass = { code: '—', name: 'Unclassified' };
  return { state, rule, action, matrix, matrixOverlay: V >= H ? 'PVST confirms' : V < Lo ? 'PVST contradicts' : 'PVST neutral', classification: klass };
}

function confidenceEngine(ctx) {
  const { val, mbf, taf, pvst, conflict } = ctx;
  const parts = [
    { name: 'Data completeness & quality', score: val.score, w: 30 },
    { name: 'MBF pillar coverage', score: mbf.pillarCoverage, w: 15 },
    { name: 'Technical data completeness', score: taf.available ? (ctx.bars >= 750 ? 100 : ctx.bars / 7.5) : 0, w: 10 },
    { name: 'Agreement between engines', score: conflict.spread == null ? 0 : clamp(100 - conflict.spread * 1.5, 0, 100), w: 20 },
    { name: 'Historical sample size', score: taf.available ? clamp((taf.taf11.sampleSize / 20) * 50 + (pvst.history.sample / 20) * 50, 0, 100) : 0, w: 10 },
    { name: 'Confirmed vs conflicting signals', score: clamp(50 + 8 * (mbf.trendCount.improving - mbf.trendCount.deteriorating) + 15 * pvst.polarity, 0, 100), w: 15 }
  ];
  let score = parts.reduce((s, p) => s + p.score * p.w, 0) / parts.reduce((s, p) => s + p.w, 0);
  if (!val.verified) score = Math.min(score, val.sourceType === 'DEMO' ? 75 : 90);
  if (val.conflicts && val.conflicts.length) score -= Math.min(10, 3 * val.conflicts.length);
  score = r0(score);
  return { score, label: score >= 85 ? 'VERY HIGH' : score >= 70 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW', parts: parts.map(p => ({ name: p.name, score: r0(p.score), weight: p.w })), cappedForUnverifiedData: !val.verified, cap: val.verified ? null : (val.sourceType === 'DEMO' ? 75 : 90) };
}

/* ===================== THESIS ===================== */
function thesisEngine(b, mbf, taf, pvst, v, m) {
  const P = mbf.pillars;
  const pos = P.flatMap(p => p.positives.map(t => ({ t, w: p.score || 50, src: 'MBF P' + p.id }))).sort((a, z) => z.w - a.w);
  const neg = P.flatMap(p => p.negatives.map(t => ({ t, w: 100 - (p.score || 50), src: 'MBF P' + p.id }))).sort((a, z) => z.w - a.w);
  if (taf.available && /UPTREND/.test(taf.taf2.primary)) pos.push({ t: `Primary trend ${taf.taf2.primary.toLowerCase()}; price above ${taf.taf3.aboveCount} of 4 key moving averages`, w: taf.score, src: 'TAF2/3' });
  if (taf.available && taf.taf9.classification === 'OUTPERFORMING') pos.push({ t: `Outperforming Nifty by ${taf.taf9.vsNifty6M} pts over 6 months`, w: taf.score, src: 'TAF9' });
  if (taf.available && taf.taf9.classification === 'UNDERPERFORMING') neg.push({ t: `Underperforming Nifty by ${-taf.taf9.vsNifty6M} pts over 6 months`, w: 70, src: 'TAF9' });
  if (pvst.polarity > 0) pos.push({ t: `PVST: ${pvst.classification.toLowerCase()} — volume and delivery confirm price`, w: pvst.score, src: 'PVST' });
  if (pvst.polarity < 0) neg.push({ t: `PVST: ${pvst.classification.toLowerCase()} — participation contradicts the trend`, w: 100 - pvst.score + 20, src: 'PVST' });
  const A = b.annual, n = A.length;
  const minYoY = Math.min(...m.yoy.slice(-5)), emMin = Math.min(...m.em.slice(-5)), roceMin = Math.min(...m.roce.slice(-5));
  const cc = (b.concentration && b.concentration.customers) || []; const maxTop1 = cc.length ? Math.max(...cc.map(c => c.top1)) : null;
  const Q = b.quarterly, lq = Q[Q.length - 1];
  const m200 = taf.available ? taf.taf3.mas[3].value : null, price = v.price;
  const vol50 = taf.available ? taf.taf5.avgVol50 : null;
  const recentBelow200HighVol = taf.available && b.prices.slice(-10).some(p => p.close < m200 && p.volume > 1.5 * vol50);
  const guid = m.gTrack.find(g => g.kind === 'pendingQ');
  const st = (trig, watch) => trig ? 'TRIGGERED' : watch ? 'WATCH' : 'OK';
  const minYoYv = r1(minYoY);
  const L = A[n - 1];
  const breakers = [
    minYoY > 0 ? { id: 'rev', condition: `Quarterly revenue growth below ${minYoYv}% YoY (weakest year in the last 5) for 2 consecutive quarters`, current: `${lq.q}: ${r1(m.lastQYoY)}%`, status: st(false, m.lastQYoY < minYoY * 1.1), basis: `Weakest annual growth ${A[Math.max(1, n - 5)].fy}–${A[n - 1].fy}` } : { id: 'rev', condition: 'Year-on-year revenue decline in 2 consecutive quarters', current: `${lq.q}: ${r1(m.lastQYoY)}%`, status: st(false, m.lastQYoY < 0), basis: `History already includes a ${minYoYv}% year, so the bar is any repeat decline` },
    { id: 'margin', condition: `EBITDA margin below ${r1(emMin)}% (5-year low)`, current: `${lq.q}: ${lq.ebitdaMargin}%`, status: st(lq.ebitdaMargin < emMin, lq.ebitdaMargin < emMin + 1.5), basis: '5-year EBITDA margin range' },
    { id: 'roce', condition: `ROCE below ${r1(roceMin)}% (5-year low)`, current: `FY26: ${r1(m.roce[n - 1])}%`, status: st(m.roce[n - 1] < roceMin, false), basis: '5-year ROCE range' },
    { id: 'debt', condition: 'Net debt above 1× EBITDA', current: `Net debt ₹${r0(L.debt - (L.cash || 0))} cr`, status: st((L.debt - (L.cash || 0)) / L.ebitda > 1, L.debt - (L.cash || 0) > 0 && (L.debt - (L.cash || 0)) / L.ebitda > 0.5), basis: `${L.fy} balance sheet` },
    cc.length ? { id: 'customer', condition: `Top customer above ${maxTop1}% of revenue, or loss of a top-5 customer`, current: `Top customer ${cc[cc.length - 1].top1}%`, status: 'OK', basis: 'Highest top-customer share on record' } : { id: 'customer', condition: 'Loss of a major customer', current: 'Concentration not disclosed', status: 'NO DATA', basis: 'Needs customer disclosure' },
    { id: 'pledge', condition: 'Any promoter pledge', current: nz(b.shareholding[b.shareholding.length - 1].pledge) ? `${b.shareholding[b.shareholding.length - 1].pledge}%` : 'Data unavailable', status: nz(b.shareholding[b.shareholding.length - 1].pledge) ? st(b.shareholding[b.shareholding.length - 1].pledge > 0, false) : 'NO DATA', basis: 'Pledge record' },
    taf.available ? { id: 'dma', condition: `Close below 200 DMA (now ₹${m200}) on ≥1.5× average volume, confirmed by PVST breakdown`, current: `Price ₹${r1(price)}`, status: st(recentBelow200HighVol && pvst.polarity < 0, price < m200 * 1.05), basis: 'Technical invalidation' } : { id: 'dma', condition: 'Close below 200 DMA on ≥1.5× average volume, confirmed by PVST breakdown', current: 'Price history not loaded', status: 'NO DATA', basis: 'Technical invalidation' },
    guid ? { id: 'guidance', condition: `Miss FY27 EBITDA-margin guidance (${guid.target}%) by more than 1.5 pts`, current: guid.actual != null ? `Latest quarter ${guid.actual}%` : 'Pending', status: (() => { const fyQs = b.quarterly.filter(q => q.q.endsWith(guid.fy)); const below = fyQs.filter(q => q.ebitdaMargin < guid.target - 1.5).length; return st(below >= 2, below === 1); })(), basis: 'Management guidance; triggers after two quarters below, since management guided a one-to-two-quarter recovery' } : (() => { const gc = m.gTrack.find(g => g.kind === 'pendingCagr'); return gc ? { id: 'guidance', condition: `Revenue falls behind the guided ${gc.target}% CAGR path for two consecutive quarters`, current: `${b.quarterly[b.quarterly.length - 1].q} revenue ₹${b.quarterly[b.quarterly.length - 1].revenue} cr`, status: 'OK', basis: gc.statement } : { id: 'guidance', condition: 'Miss of stated guidance', current: 'No measurable guidance', status: 'NO DATA', basis: 'Management guidance' }; })(),
    ...(m.extraBreakers || [])
  ];
  return { bull: pos.slice(0, 6).map(x => ({ text: x.t, source: x.src })), bear: neg.slice(0, 6).map(x => ({ text: x.t, source: x.src })), breakers };
}

/* ===================== WHAT CHANGED ===================== */
function whatChanged(prev, cur) {
  if (!prev) return null;
  const d = (a, z) => r1(z - a); const items = [];
  const push = (label, a, z, unit = '', invert = false, thr = 0.5) => { if (a == null || z == null) return; const dd = d(a, z); if (Math.abs(dd) >= thr) items.push({ label, from: a, to: z, delta: dd, unit, good: invert ? dd < 0 : dd > 0 }); };
  push('MBF2.0', prev.scores.mbf, cur.scores.mbf, '', false, 1); push('TAF1.0', prev.scores.taf, cur.scores.taf, '', false, 1); push('PVST', prev.scores.pvst, cur.scores.pvst, '', false, 1); push('Composite', prev.scores.composite, cur.scores.composite, '', false, 1);
  push('Latest-quarter revenue growth', prev.key.qRevYoY, cur.key.qRevYoY, ' pts');
  push('Latest-quarter EBITDA margin', prev.key.qEbitdaMargin, cur.key.qEbitdaMargin, ' pts');
  push('Price', prev.price, cur.price, ''); push('P/E', prev.key.pe, cur.key.pe, '×', true); push('Implied EPS CAGR', prev.key.impliedEpsCagr, cur.key.impliedEpsCagr, ' pts', true);
  push('RSI', prev.key.rsi, cur.key.rsi, '', false, 5); push('Relative strength vs Nifty (6M)', prev.key.rs6m, cur.key.rs6m, ' pts', false, 2);
  const pill = []; Object.keys(cur.pillars).forEach(k => { const a = prev.pillars[k], z = cur.pillars[k]; if (a != null && z != null && Math.abs(z - a) >= 5) pill.push({ id: k, from: a, to: z, delta: z - a }); });
  const breakers = []; Object.keys(cur.breakers).forEach(k => { if (prev.breakers[k] && prev.breakers[k] !== cur.breakers[k]) breakers.push({ id: k, from: prev.breakers[k], to: cur.breakers[k] }); });
  const why = [];
  if (prev.state !== cur.state) why.push(`State moved ${prev.state} → ${cur.state}. Rule: ${cur.stateRule}.`);
  if (prev.pvstClass !== cur.pvstClass) why.push(`Price-volume behaviour changed from ${prev.pvstClass.toLowerCase()} to ${cur.pvstClass.toLowerCase()}.`);
  if (prev.trend !== cur.trend) why.push(`Trend changed from ${prev.trend.toLowerCase()} to ${cur.trend.toLowerCase()}.`);
  if (prev.key.lastQuarter !== cur.key.lastQuarter) why.push(`New result: ${cur.key.lastQuarter} (revenue growth ${cur.key.qRevYoY}%, EBITDA margin ${cur.key.qEbitdaMargin}%).`);
  breakers.forEach(x => why.push(`Thesis breaker "${x.id}" moved ${x.from} → ${x.to}.`));
  if (prev.configVersion !== cur.configVersion) why.push(`Scoring settings changed (${prev.configVersion} → ${cur.configVersion}); part of the score change comes from weights, not the stock.`);
  if (!why.length) why.push('No material change. Differences are within noise thresholds.');
  return { fromDate: prev.asOf, toDate: cur.asOf, stateFrom: prev.state, stateTo: cur.state, items, pillars: pill, breakers, why };
}

/* ===================== ORCHESTRATOR ===================== */
function analyse(bundle, cfg, prevSnapshot) {
  const val = validateData(bundle);
  const m = runMBF(bundle, val, cfg);
  const v = runValuation(bundle, m, cfg);
  const mbf = finishMBF(bundle, m, v, val, cfg);
  const taf = runTAF(bundle, cfg);
  const pvst = runPVST(bundle, taf, cfg);
  const conflict = detectConflict(mbf.score, taf.score, pvst.score, cfg);
  val.technicalReady = taf.available;
  const comp = composite(mbf, taf, pvst, cfg, mbf.forensic.level, val.score);
  const st = stateEngine({ mbf, taf, pvst, comp, val: v, prev: prevSnapshot }, cfg);
  const conf = confidenceEngine({ val, mbf, taf, pvst, conflict, bars: bundle.prices.length });
  const thesis = thesisEngine(bundle, mbf, taf, pvst, v, m);
  const lq = bundle.quarterly[bundle.quarterly.length - 1];
  const result = {
    ticker: bundle.meta.ticker, meta: bundle.meta, analysisDate: new Date().toISOString(), dataAsOf: bundle.meta.asOf,
    frameworkVersions: FRAMEWORK_VERSIONS, configVersion: cfg.configVersion,
    scores: { mbf: mbf.score, taf: taf.score, pvst: pvst.score, composite: comp.score },
    composite: comp, state: st, confidence: conf, dataQuality: val, conflict,
    mbf, taf, pvst, valuation: v, thesis,
    key: { valPct: v.history ? v.history.currentPercentile : null, qRevYoY: r1(m.lastQYoY), qEbitdaMargin: r1(lq.ebitdaMargin), lastQuarter: lq.q, pe: v.multiples.pe, impliedEpsCagr: v.reverse ? v.reverse.impliedEpsCagr : null, rsi: taf.available ? taf.taf4.rsi : null, rs6m: taf.available ? taf.taf9.vsNifty6M : null }
  };
  result.snapshot = toSnapshot(result);
  result.changes = whatChanged(prevSnapshot, result.snapshot);
  return result;
}
function toSnapshot(r) {
  return { id: r.ticker + '@' + r.dataAsOf + '@' + r.configVersion + (r.taf.available ? '' : '@F'), ticker: r.ticker, savedAt: r.analysisDate, asOf: r.dataAsOf, phase: r.meta.phase, configVersion: r.configVersion, frameworkVersions: r.frameworkVersions,
    price: r.valuation.price, scores: r.scores, state: r.state.state, stateRule: r.state.rule, pvstClass: r.pvst.classification, trend: r.taf.available ? r.taf.taf2.overall : 'NOT RUN', confidence: r.confidence.score, dataQuality: r.dataQuality.score,
    valuationLevel: r.valuation.reverse ? r.valuation.reverse.level : null, technical: !!r.taf.available, key: r.key, pillars: Object.fromEntries(r.mbf.pillars.map(p => [p.id, p.score])), breakers: Object.fromEntries(r.thesis.breakers.map(b => [b.id, b.status])),
    thesisTop: r.thesis.bull.slice(0, 2).map(x => x.text), risksTop: r.thesis.bear.slice(0, 2).map(x => x.text) };
}

/* ===================== CHALLENGE ANSWER KEY =====================
   Shared by the app (to build the questions) and the nightly job (to publish
   the official key). Always computed from analyse(bundle, DEFAULT_CONFIG, null)
   so every device and the server get the same answers from the same data.
=================================================================== */
const sentenceCase = s => s ? s.charAt(0) + s.slice(1).toLowerCase() : s;
function challengeAnswerKey(r) {
  if (!r || !r.taf || r.taf.score == null || r.pvst.score == null) return null;
  const key = {
    business: r.scores.mbf >= 70 ? 'Strong' : r.scores.mbf >= 45 ? 'Moderate' : 'Weak',
    trend: /UPTREND/.test(r.taf.taf2.overall) ? 'Uptrend' : /DOWNTREND/.test(r.taf.taf2.overall) ? 'Downtrend' : 'Sideways',
    pvst: sentenceCase(r.pvst.classification),
    state: sentenceCase(r.state.state)
  };
  const k = { business: 3, trend: 3, pvst: 4, state: 4, forward: 2 };
  const base = { business: 10, trend: 10, pvst: 25, state: 25, forward: 25 };
  if (r.valuation && r.valuation.reverse) { key.valuation = sentenceCase(r.valuation.reverse.level); k.valuation = 4; base.valuation = 25; }
  return { key, k, base, vsNifty: !!(r._bundle ? r._bundle.nifty : r.meta && r.meta.niftyFile) };
}

if (typeof module !== 'undefined') module.exports = { analyse, DEFAULT_CONFIG, FRAMEWORK_VERSIONS, challengeAnswerKey, technicalReady };
