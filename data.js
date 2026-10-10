/* ===================== DATA PROVIDER LAYER =====================
   Every engine consumes the StockDataBundle shape only.
   Swap DemoDataProvider for a live provider (NSE/BSE feed, Screener,
   Trendlyne, broker API) without touching the engines.
   Every metric carries {value, date, source, sourceType, period, status}.
=================================================================== */
const DEMO_SOURCE = { source: 'Demo data provider', sourceType: 'DEMO', verified: false };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function isoDate(d) { return d.toISOString().slice(0, 10); }
function tradingDays(startIso, count) {
  const out = []; const d = new Date(startIso + 'T00:00:00Z');
  while (out.length < count) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(isoDate(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const DemoDataProvider = {
  id: 'demo',
  label: 'DEMO DATA',
  universe: [
    { ticker: 'ARCADIA', name: 'Arcadia Specialty Chemicals Ltd', sector: 'Specialty Chemicals', exchange: 'NSE (demo)', available: true }
  ],
  search(q) {
    q = (q || '').trim().toUpperCase();
    if (!q) return this.universe;
    return this.universe.filter(s => s.ticker.includes(q) || s.name.toUpperCase().includes(q));
  },
  /* phase = how many times the demo clock was advanced (0 or 1+) */
  getBundle(ticker, phase) {
    if (ticker !== 'ARCADIA') return null;
    return buildArcadia(Math.min(phase || 0, 1));
  }
};

function buildArcadia(phase) {
  const years = ['FY17','FY18','FY19','FY20','FY21','FY22','FY23','FY24','FY25','FY26'];
  const rev   = [410,470,520,600,690,860,1010,1150,1330,1540];
  const gm    = [38,37.5,39,40,41,39,41.5,42,43,43.5];
  const em    = [16,15.5,17,18,18.5,17,19,19.5,20.5,21];
  const intr  = [18,20,19,17,14,12,10,8,7,6];
  const cfoR  = [0.72,0.65,0.78,0.80,0.70,0.62,0.82,0.85,0.83,0.86];
  const capex = [40,55,60,50,90,140,110,95,120,150];
  const debt  = [160,180,175,150,140,160,120,90,70,55];
  const cash  = [30,25,35,50,60,45,70,110,150,190];
  const recD  = [78,82,80,76,74,85,80,76,74,72];
  const invD  = [70,75,72,70,68,82,76,72,70,68];
  const payD  = [55,52,58,60,58,60,62,64,63,64];
  const cont  = [12,14,15,15,18,40,35,30,28,26];
  const shares= [11.6,11.6,11.6,11.6,11.6,12.0,12.0,12.0,12.0,12.0];
  const annual = []; let equity = 300;
  years.forEach((fy, i) => {
    const r = rev[i], ebitda = r * em[i] / 100, dep = r * 0.035;
    const ebit = ebitda - dep, pbt = ebit - intr[i], pat = pbt * 0.75;
    const cogs = r * (1 - gm[i] / 100);
    const cfo = ebitda * cfoR[i];
    const div = pat * 0.15;
    equity = equity + pat - div + (i === 5 ? 120 : 0); // FY22 QIP of ~120 cr (dilution)
    annual.push({
      fy, revenue: r, grossProfit: r - cogs, cogs, ebitda, depreciation: dep, ebit, interest: intr[i],
      pbt, pat, eps: pat / shares[i], cfo, capex: capex[i], fcf: cfo - capex[i], dividends: div,
      debt: debt[i], cash: cash[i], equity, sharesOut: shares[i],
      receivables: r * recD[i] / 365, inventory: cogs * invD[i] / 365, payables: cogs * payD[i] / 365,
      currentAssets: r * recD[i] / 365 + cogs * invD[i] / 365 + cash[i] + r * 0.05,
      currentLiabilities: cogs * payD[i] / 365 + r * 0.06 + debt[i] * 0.3,
      contingentLiabilities: cont[i], capitalEmployed: equity + debt[i],
      standaloneRevenue: r * 0.93, standalonePat: pat * 0.97,
      resultDate: (2017 + i) + '-05-14'
    });
  });

  const quarterly = [
    { q: 'Q2FY25', date: '2024-11-08', revenue: 325, ebitdaMargin: 20.2 },
    { q: 'Q3FY25', date: '2025-02-10', revenue: 335, ebitdaMargin: 20.4 },
    { q: 'Q4FY25', date: '2025-05-14', revenue: 360, ebitdaMargin: 21.0 },
    { q: 'Q1FY26', date: '2025-08-08', revenue: 360, ebitdaMargin: 20.6 },
    { q: 'Q2FY26', date: '2025-11-07', revenue: 375, ebitdaMargin: 20.8 },
    { q: 'Q3FY26', date: '2026-02-09', revenue: 390, ebitdaMargin: 21.0 },
    { q: 'Q4FY26', date: '2026-05-14', revenue: 415, ebitdaMargin: 21.5 },
    { q: 'Q1FY27', date: '2026-08-07', revenue: 418, ebitdaMargin: 21.4 }
  ];
  if (phase >= 1) quarterly.push({ q: 'Q2FY27', date: 'PHASE1_RESULT', revenue: 410, ebitdaMargin: 18.6 });
  quarterly.forEach(q => { q.ebitda = q.revenue * q.ebitdaMargin / 100; q.pat = (q.ebitda - q.revenue * 0.035 - 1.5) * 0.75; });

  const guidance = [
    { said: 'FY24', statement: 'Revenue growth of 15%+ in FY24', metric: 'revenueGrowth', target: 15, fy: 'FY24', kind: 'min' },
    { said: 'FY24', statement: 'EBITDA margin of 19–20% in FY24', metric: 'ebitdaMargin', target: 19, fy: 'FY24', kind: 'min' },
    { said: 'FY25', statement: 'Commission battery-chemicals plant by Q3 FY25', metric: 'event', outcome: 'DELAYED', note: 'Commissioned Q4 FY25, one quarter late' },
    { said: 'FY25', statement: 'Become net-cash by FY26', metric: 'netCash', target: 0, fy: 'FY26', kind: 'netcash' },
    { said: 'FY26', statement: 'Revenue growth of 15–18% in FY26', metric: 'revenueGrowth', target: 15, fy: 'FY26', kind: 'min' },
    { said: 'FY27', statement: 'EBITDA margin of 21–22% in FY27', metric: 'ebitdaMarginQ', target: 21, fy: 'FY27', kind: 'pendingQ' }
  ];
  const commentary = [
    { date: '2026-08-07', text: 'Demand steady across agro and pharma intermediates; battery chemicals ramp-up on track.' }
  ];
  if (phase >= 1) commentary.push({ date: 'PHASE1_RESULT', text: 'Pricing pressure from imported supply in agro intermediates; a top customer is destocking inventory.' });

  const shareholding = [
    ['Dec24',58.2,0,9.1,7.0],['Mar25',58.2,0,9.6,7.4],['Jun25',58.1,0,10.2,7.9],['Sep25',58.1,0,10.8,8.3],
    ['Dec25',58.0,0,11.3,8.8],['Mar26',58.0,0,11.9,9.2],['Jun26',57.9,0,12.4,9.8]
  ].map(r => ({ period: r[0], promoter: r[1], pledge: r[2], fii: r[3], dii: r[4] }));
  if (phase >= 1) shareholding.push({ period: 'Sep26', promoter: 57.9, pledge: 0, fii: 10.9, dii: 9.9 });

  const concentration = {
    customers: [ { fy: 'FY24', top1: 14, top5: 41, top10: 58 }, { fy: 'FY25', top1: 12.5, top5: 38, top10: 55 }, { fy: 'FY26', top1: 11, top5: 35, top10: 52 } ],
    customerTenureYearsTop10: 9, repeatRevenuePct: 86,
    segments: [
      { fy: 'FY24', mix: { 'Agro intermediates': 42, 'Pharma intermediates': 38, 'Performance polymers': 20, 'Battery chemicals': 0 } },
      { fy: 'FY25', mix: { 'Agro intermediates': 40, 'Pharma intermediates': 36, 'Performance polymers': 19, 'Battery chemicals': 5 } },
      { fy: 'FY26', mix: { 'Agro intermediates': 38, 'Pharma intermediates': 34, 'Performance polymers': 18, 'Battery chemicals': 10 } }
    ],
    geography: [ { fy: 'FY24', exportPct: 46 }, { fy: 'FY25', exportPct: 48 }, { fy: 'FY26', exportPct: 51 } ],
    supplier: { topSupplierPctOfRM: 18, commodityLinked: 'Benzene derivatives (crude-linked)' }
  };

  const governance = {
    auditorQualifications: 0, auditorResignations: 0, independentDirectorResignations: 0,
    rptPctRevenue: 1.8, litigation: [ { item: 'Environmental show-cause notice', year: 'FY23', status: 'Resolved FY24' }, { item: 'Tax demand ₹26 cr (in contingent liabilities)', year: 'FY22', status: 'Under appeal' } ],
    dilutionEvents: [ { fy: 'FY22', type: 'QIP', pct: 3.4, use: 'Capex for battery-chemicals plant' } ],
    acquisitions: []
  };

  const peers = [
    { name: 'Peer A (demo)', revCagr5: 12, ebitdaMargin: 17, roce: 16, pe: 34, de: 0.3, fcfYield: 1.4 },
    { name: 'Peer B (demo)', revCagr5: 18, ebitdaMargin: 23, roce: 24, pe: 48, de: 0.1, fcfYield: 1.1 },
    { name: 'Peer C (demo)', revCagr5: 9, ebitdaMargin: 14, roce: 11, pe: 22, de: 0.8, fcfYield: 2.0 }
  ];

  const qualitative = {
    moat: [
      { type: 'Switching costs', strength: 3, evidence: 'Pharma customers qualify suppliers over 18–24 months; re-qualification is costly.' },
      { type: 'Process technology', strength: 2, evidence: 'Proprietary process chemistry in 3 of 11 key molecules (company disclosure, demo).' },
      { type: 'Scale / cost', strength: 2, evidence: 'Among larger domestic producers in two intermediates; not the global cost leader.' },
      { type: 'Brand', strength: 0, evidence: 'B2B business; brand is not a purchase driver.' },
      { type: 'Network effects', strength: 0, evidence: 'Not applicable.' }
    ],
    disruptionRisk: 'Medium — imported supply can compress pricing in agro intermediates.',
    cyclicality: 'Medium — agro demand is seasonal and inventory-cycle driven.'
  };

  // Not available from this provider -> must surface as RED, never filled.
  const unavailable = {
    tam: 'Industry TAM/SAM needs an industry report source',
    marketShare: 'Market-share data not provided by the demo source',
    matchedCompanies: 'Requires a historical fundamentals database of listed companies',
    cohort: 'Requires a survivorship-free historical universe (including delisted companies)'
  };

  // ---------- price, volume, delivery, indices ----------
  const N0 = 1285, N1 = 45;
  const dates = tradingDays('2021-10-04', N0 + (phase >= 1 ? N1 : 0));
  if (phase >= 1) { const d1 = dates[N0 + 25]; quarterly.forEach(q => { if (q.date === 'PHASE1_RESULT') q.date = d1; }); commentary.forEach(c => { if (c.date === 'PHASE1_RESULT') c.date = d1; }); }
  const rng = mulberry32(20261006);
  const regimes = [
    [0, 250, 0.0004, 0.018, 1.0, 46], [250, 500, 0.0018, 0.020, 1.2, 52], [500, 650, -0.0012, 0.022, 1.1, 40],
    [650, 900, 0.0000, 0.015, 0.75, 48], [900, 1050, 0.0025, 0.022, 1.5, 56], [1050, 1190, 0.0002, 0.013, 0.7, 50],
    [1190, N0 - 60, 0.0008, 0.015, 0.9, 52], [N0 - 60, N0, 0.0024, 0.016, 1.4, 58]
  ];
  const rets = [], vmult = [], dbase = [], vols = [];
  for (let i = 0; i < N0; i++) {
    const g = regimes.find(r => i >= r[0] && i < r[1]);
    rets.push(g[2] + g[3] * gauss(rng)); vols.push(g[3]); vmult.push(g[4]); dbase.push(g[5]);
  }
  const start = 210, target = 790;
  const rng2 = mulberry32(777);
  if (phase >= 1) {
    for (let k = 0; k < N1; k++) {
      // distribution (choppy, heavy down-day volume) then breakdown
      const dist = k < 25;
      let r = dist ? (-0.0012 + 0.016 * gauss(rng2)) : (-0.0045 + 0.019 * gauss(rng2));
      if (k === 25) r = -0.062; // result-day gap down
      rets.push(r); vols.push(dist ? 0.016 : 0.019); vmult.push(dist ? 1.5 : 2.1); dbase.push(dist ? 36 : 33);
    }
  }
  // result-date reactions
  const eventDates = [];
  annual.forEach(a => eventDates.push(a.resultDate));
  quarterly.forEach(q => eventDates.push(q.date));
  ['2022-08-10','2022-11-10','2023-02-10','2023-08-10','2023-11-09','2024-02-09','2024-08-09'].forEach(d => eventDates.push(d));
  const evIdx = new Set();
  eventDates.forEach(d => { const i = dates.findIndex(x => x >= d); if (i > 30 && i < dates.length) evIdx.add(i); });
  const rng3 = mulberry32(99);
  evIdx.forEach(i => {
    if (i >= N0) return; // phase-2 event reaction already hard-coded
    for (let k = 1; k <= 7; k++) rets[i - k] += 0.0025;           // pre-result run-up
    rets[i] += (rng3() < 0.6 ? 1 : -1) * (0.015 + 0.03 * rng3()); // reaction
    for (let k = 1; k <= 3; k++) if (rets[i + k] !== undefined) rets[i + k] -= 0.003; // mild sell-the-news
  });

  // rescale phase-0 drift so the path lands near the target while keeping its shape
  { const sum = rets.slice(0, N0).reduce((a, b) => a + b, 0); const adj = (Math.log(target / start) - sum) / N0; for (let i = 0; i < N0; i++) rets[i] += adj; }
  const prices = []; let close = start;
  const rngV = mulberry32(4242);
  for (let i = 0; i < dates.length; i++) {
    const open = i === 0 ? start : close * (1 + 0.004 * gauss(rngV));
    const c = (i === 0 ? start : close) * Math.exp(rets[i]);
    const hi = Math.max(open, c) * (1 + Math.abs(gauss(rngV)) * vols[i] * 0.45);
    const lo = Math.min(open, c) * (1 - Math.abs(gauss(rngV)) * vols[i] * 0.45);
    const dirBoost = rets[i] > 0 ? (dbase[i] >= 50 ? 1.25 : 0.85) : (dbase[i] >= 50 ? 0.85 : 1.35);
    const evBoost = evIdx.has(i) ? 2.6 : 1;
    const vol = Math.round(180000 * vmult[i] * dirBoost * evBoost * Math.exp(0.35 * gauss(rngV)));
    const deliv = Math.max(15, Math.min(85, dbase[i] + 6 * gauss(rngV)));
    prices.push({ date: dates[i], open, high: hi, low: lo, close: c, volume: vol, deliveryPct: deliv });
    close = c;
  }
  // circuit band 20%: flag days at band
  prices.forEach((p, i) => { if (i > 0) { const ch = p.close / prices[i - 1].close - 1; p.circuit = Math.abs(ch) >= 0.199 ? (ch > 0 ? 'UPPER' : 'LOWER') : null; } });

  const rngN = mulberry32(1111); let nv = 17600, sv = 9800; const nifty = [], sector = [];
  for (let i = 0; i < dates.length; i++) {
    const nr = 0.00045 + 0.009 * gauss(rngN);
    const sr = 0.6 * nr + 0.0003 + 0.009 * gauss(rngN) + (i >= N0 ? -0.0006 : 0);
    nv *= Math.exp(nr); sv *= Math.exp(sr);
    nifty.push({ date: dates[i], close: nv }); sector.push({ date: dates[i], close: sv });
  }

  const asOf = dates[dates.length - 1];
  // point-in-time: nothing dated after asOf may reach the engines
  const filed = { Dec24: '2025-01-21', Mar25: '2025-04-21', Jun25: '2025-07-21', Sep25: '2025-10-21', Dec25: '2026-01-21', Mar26: '2026-04-21', Jun26: '2026-07-21', Sep26: '2026-10-21' };
  const qPit = quarterly.filter(q => q.date <= asOf), cPit = commentary.filter(c => c.date <= asOf), shPit = shareholding.filter(s => filed[s.period] <= asOf);
  quarterly.length = 0; quarterly.push(...qPit); commentary.length = 0; commentary.push(...cPit); shareholding.length = 0; shareholding.push(...shPit);
  return {
    meta: { ticker: 'ARCADIA', name: 'Arcadia Specialty Chemicals Ltd', sector: 'Specialty Chemicals', exchange: 'NSE (demo)',
      currency: 'INR', unit: '₹ crore', asOf, provider: 'DEMO DATA', isDemo: true, circuitBand: 20, phase },
    source: DEMO_SOURCE,
    annual, quarterly, guidance, commentary, shareholding, concentration, governance, peers, qualitative, unavailable,
    prices, nifty, sector, eventDates: [...evIdx].sort((a, b) => a - b).map(i => dates[i])
  };
}

if (typeof module !== 'undefined') module.exports = { DemoDataProvider, mulberry32 };
