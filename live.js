/* ===================== LIVE DATA PROVIDER =====================
   Anlon Healthcare Ltd — public data gathered 6 Oct 2026 from secondary
   sources that republish exchange filings. Every block names its source.
   Nothing here is estimated. Values that could not be found are null and
   surface in the app as "Data unavailable". Daily price-volume history is
   NOT bundled (not available in full from these sources): it comes from
   the user's NSE/BSE download through the importer below.
================================================================ */
const LIVE_RETRIEVED = '2026-10-06';
const LIVE_SOURCES = [
  { id: 'fyers', name: 'Fyers — stock page (price, consolidated balance sheet & cash flow, shareholding, bulk deals, SAST, corporate actions, announcements)', url: 'https://fyers.in/stocks/anlon-healthcare-ltd' },
  { id: 'tapetide', name: 'Tapetide — quarterly results, P&L, ratios, shareholding, filings list, technical indicators', url: 'https://tapetide.com/stocks/AHCL' },
  { id: 'screener', name: 'Screener — standalone P&L, balance sheet, cash flow and working-capital days FY21–FY25', url: 'https://www.screener.in/company/id/1285622' },
  { id: 'mojo', name: 'MarketsMojo — FY25/FY26 consolidated P&L detail, FY26 standalone, pledge', url: 'https://marketsmojo.motilaloswal.com/stocks-analysis/financial-annual/anlon-healthcare-10039733-0' },
  { id: 'wallet', name: 'WalletInvestor — daily OHLC 24 Aug – 6 Oct 2026', url: 'https://walletinvestor.com/bse-stock-forecast/anlon-healthcare-limited-stock-history/' },
  { id: 'choice', name: 'Choice — daily OHLC cross-check (7–20 Jul and 22 Sep – 6 Oct 2026)', url: 'https://choiceindia.com/stocks/anlon-healthcare-ltd-share-price-history' },
  { id: 'tickertape', name: 'Tickertape — Q1 FY27 earnings-call summary, FY27 guidance, related-party and share-swap disclosures, credit rating', url: 'https://www.tickertape.in/stocks/anlon-healthcare-AHC' },
  { id: 'mojobs', name: 'MarketsMojo — FY25/FY26 consolidated balance sheet', url: 'https://marketsmojo.motilaloswal.com/stocks-analysis/financial-balancesheet/anlon-healthcare-10039733-0' },
  { id: 'mojonews', name: 'MarketsMojo news — lower-circuit sessions 30 Sep, 1 Oct, 6 Oct 2026', url: 'https://www.marketsmojo.com/news/stocks-in-action/anlon-healthcare-ltd-plunges-to-lower-circuit-amid-heavy-selling-pressure-4215973' },
  { id: 'stockanalysis', name: 'StockAnalysis — income statement FY22–FY26 cross-check', url: 'https://stockanalysis.com/quote/nse/AHCL/financials/income-statement/' },
  { id: 'tradejini', name: 'Tradejini IPO note — FY23/FY24 revenue, PAT, debt; FY24 regulatory shutdown', url: 'https://www.tradejini.com/blogs/anlon-healthcare-ipo--complete-analysis' },
  { id: 'finology', name: 'Finology Ticker — FY22–FY25 sales, acquisition timeline', url: 'https://ticker.finology.in/company/AHCL' },
  { id: 'screenerc', name: 'Screener — FY26 auditor opinion (unmodified)', url: 'https://www.screener.in/company/AHCL/consolidated/' }
];

const AHCL_FACTS = {
  meta: { ticker: 'AHCL', name: 'Anlon Healthcare Ltd', aka: 'ANLON', sector: 'Pharma intermediates & APIs', exchange: 'NSE: AHCL · BSE: 544497', isin: 'INE0Y8W01025', listedOn: '2025-09-03', faceValue: 2,
    annualBasisNote: 'consolidated; FY22–FY25 equal standalone (first subsidiary acquired Jan 2026)' },
  lastPrice: { price: 29.66, prevClose: 31.22, date: '2026-10-06', volume: 11979158, upperCircuit: 32.78, lowerCircuit: 29.66, high52: 37.24, low52: 10.37, src: 'fyers, tapetide' },
  corporateActions: [{ exDate: '2026-04-24', factor: 10, label: '1:5 split (₹10 → ₹2) and 1:1 bonus', src: 'fyers, tapetide' }],
  // FY22–FY24: standalone (no subsidiaries then); revenue/PAT cross-checked on Finology, StockAnalysis, Tradejini. FY25–FY26: MarketsMojo/Fyers consolidated.
  annual: [
    { fy: 'FY22', resultDate: '2025-09-03', revenue: 57.14, ebitda: 6, depreciation: 2, interest: 4, pbt: -0.1, pat: -0.1, cfo: -2, fcf: -2, debt: 62, cash: null, equity: 2, sharesOut: 12, recDays: 130, invDays: 225, payDays: 128 },
    { fy: 'FY23', resultDate: '2025-09-03', revenue: 112.88, ebitda: 13, depreciation: 2, interest: 4, pbt: 7, pat: 5.82, cfo: -3, fcf: -3, debt: 66.39, cash: null, equity: 7, sharesOut: 12, recDays: 142, invDays: 112, payDays: 105 },
    { fy: 'FY24', resultDate: '2025-09-03', revenue: 66.58, ebitda: 16, depreciation: 2, interest: 4, pbt: 10, pat: 9.66, cfo: -3, fcf: -7, debt: 74.56, cash: null, equity: 21, sharesOut: 16, recDays: 213, invDays: 452, payDays: 217 },
    { fy: 'FY25', resultDate: '2025-09-03', revenue: 120.29, grossProfit: 45.70, ebitda: 32.21, otherIncome: 0.17, depreciation: 1.77, interest: 3.72, pbt: 26.89, pat: 20.52, eps: 20.52 / 39.85, cfo: -22.55, fcf: -20, debt: 67, cash: 1, equity: 80.42, minority: 0, sharesOut: 39.85, receivables: 75, inventory: 50, payables: 20, currentAssets: 158, currentLiabilities: 60, contingentLiabilities: 0, recDays: 228, invDays: 246, payDays: 96, standaloneRevenue: 120.29, standalonePat: 20.52 },
    { fy: 'FY26', resultDate: '2026-05-29', revenue: 171.97, grossProfit: 66.87, ebitda: 47.52, otherIncome: 0.26, depreciation: 1.52, interest: 3.74, pbt: 42.51, pat: 29.09, eps: 29.09 / 53.15, cfo: -59, fcf: -95, debt: 44, cash: 4, equity: 230.23, minority: 25, sharesOut: 53.15, receivables: 104, inventory: 113, payables: 42, currentAssets: 308, currentLiabilities: 108, contingentLiabilities: 0.25, recDays: 220, invDays: 393, payDays: 147, standaloneRevenue: 176.5, standalonePat: 27.81 }
  ],
  annualNotes: [
    'FY22–FY24 revenue and profit are cross-checked across three sources. FY24 revenue fell 41% because of a regulatory shutdown (Tradejini IPO note). FY22–FY24 cash-flow and working-capital-day figures come from Screener and were not cross-checked.',
    'FY23–FY24 debt uses the IPO-document figures (₹66.4 cr, ₹74.6 cr).',
    'Shares are post split/bonus equivalents (crore). EPS before FY25 is not computed: pre-IPO share-capital changes are not verified, so per-share history would not be comparable.',
    'FY25–FY26 gross profit = sales − (raw material cost + change in inventories), from MarketsMojo line items.',
    'FY26 operating cash flow: Tapetide/Screener report −₹59 cr, Fyers −₹79 cr. The app uses −₹59 cr and flags the conflict.'
  ],
  quarterly: [
    { q: 'Q4FY25', date: '2025-09-03', revenue: 48.93, ebitda: 17.19, pat: 16.65, taxPct: -7.49 },
    { q: 'Q1FY26', date: '2025-11-11', revenue: 33.30, ebitda: 6.24, pat: 3.55, taxPct: 29.2 },
    { q: 'Q2FY26', date: '2025-11-11', revenue: 52.20, ebitda: 13.71, pat: 9.32, derived: true, note: 'FY26 total minus Q1, Q3 and Q4 (Sep-2025 quarter not in sources used)' },
    { q: 'Q3FY26', date: '2026-02-09', revenue: 35.58, ebitda: 12.28, pat: 5.15, taxPct: 51.41 },
    { q: 'Q4FY26', date: '2026-05-29', revenue: 50.89, ebitda: 15.29, pat: 11.07, taxPct: 23.34 },
    { q: 'Q1FY27', date: '2026-07-30', revenue: 87.56, ebitda: 15.59, pat: 8.28, taxPct: 39.39 }
  ],
  shareholding: [
    { period: 'Jun25', filed: '2025-09-03', promoter: 52.68, pledge: null, fii: 14.42, dii: 4.35, holders: 9125 },
    { period: 'Sep25', filed: '2025-10-21', promoter: 52.68, pledge: null, fii: 0, dii: 2.83, holders: 9126 },
    { period: 'Dec25', filed: '2026-01-21', promoter: 52.68, pledge: null, fii: 0.23, dii: 4.49, holders: 11412 },
    { period: 'Mar26', filed: '2026-04-21', promoter: 52.68, pledge: null, fii: 0.32, dii: 4.60, holders: 12484 },
    { period: 'Jun26', filed: '2026-07-21', promoter: 52.68, pledge: 0, fii: 1.67, dii: 1.22, holders: 34671 }
  ],
  guidance: [
    { said: 'Aug 2026 (Q1 FY27 call)', statement: 'about 30% revenue CAGR over the next three years', kind: 'pendingCagr', target: 30, years: 3, baseFy: 'FY26' },
    { said: 'Aug 2026 (Q1 FY27 call)', statement: 'FY27 revenue of about ₹350–400 cr', kind: 'pendingRevenue', target: 350, fy: 'FY27' },
    { said: 'Aug 2026 (Q1 FY27 call)', statement: 'consolidated EBITDA margin normalising towards about 25%', kind: 'pendingQ', target: 25, fy: 'FY27', note: 'management expects price increases to pass through over one to two quarters' }
  ],
  commentary: [{ date: '2026-08-06', text: 'Q1 FY27 call: margins hit by sharply higher raw-material prices (petroleum-linked solvents, methanol) and consolidation of Remember India Health Links, still loss-making; price increases accepted by customers, benefit over one to two quarters; FY27 revenue guidance ₹350–400 cr.' }, { date: '2026-07-30', text: 'Q1 FY27 consolidated revenue ₹87.6 cr (+163% YoY, includes acquired subsidiaries); EBITDA margin 17.8% against 30.0% in Q4 FY26; consolidated PAT ₹8.3 cr.' }],
  standaloneQuarterNote: { divergent: true, text: 'Q1 FY27: consolidated revenue rose 163% YoY, but results coverage on Fyers reported Q1 revenue declining YoY and net profit of ₹4.8 cr. Those figures can only be standalone, so the parent business shrank while acquisitions drove consolidated growth (inference from two sources; standalone quarterly figures not loaded).' },
  governance: {
    auditorQualifications: 0, auditorOpinionNote: 'FY26 audited results: unmodified opinion (earlier years not checked)', auditorResignations: null, independentDirectorResignations: null, rptPctRevenue: null, litigation: null,
    dilutionEvents: [{ fy: 'FY26', type: 'IPO fresh issue', pct: 33.4 }],
    pendingIssuance: 'Board meeting on 13 Oct 2026 to consider raising funds through equity, debt or hybrid instruments',
    acquisitions: [{ name: 'Apiqo Organics', stake: '67.48%', date: 'Jan 2026' }, { name: 'Bizotic Life Science', stake: '56.67%', date: 'Mar 2026' }, { name: 'Remember India Health Links', stake: '63.98% for ₹5.38 cr', date: 'Apr–May 2026' }],
    events: [
      { check: 'Delayed financial results', severity: 5, date: '2025-12-18', finding: 'Company filed an intimation of delay in financial results' },
      { check: 'Preferential share swap', severity: 6, date: 'Aug 2026', finding: 'Up to 8.59 crore new shares at ₹17.85 (about 16% dilution) to buy out minority holders of subsidiaries Apiqo Organics and Bizotic; raises the holdings of the two executive directors' },
      { check: 'Related-party transactions', severity: 10, date: 'Sep 2026', finding: 'Proposed ₹500 cr of transactions with subsidiary Anlon Medicos, which had negative net worth (−₹4.3 cr) and a ₹4.9 cr loss in FY26; two directors are interested parties' },
      { check: 'Credit rating history', severity: 2, date: 'Sep 2026', finding: 'Brickwork assigned BBB/Stable, replacing earlier ratings that included BB+ and "issuer not cooperating" categories' },
      { check: 'Pending fund raise', severity: 4, date: '2026-09-29', finding: 'Board meeting called for 13 Oct 2026 to consider raising funds (equity, debt or hybrid)' },
      { check: 'Pre-IPO investor exit', severity: 2, date: 'Sep 2025 – Mar 2026', finding: 'Neomile Growth Fund cut its holding from about 12.9% to 4.4% through market sales (SAST disclosures)' },
      { check: 'Exchange price-movement query', severity: 3, date: '2026-09-16', finding: 'Exchange sought clarification on significant price movement; company replied 17 Sep' }
    ]
  },
  failureNotes: {
    commodity: { exposure: 3, why: 'Management cited sharply higher petroleum-linked solvent and methanol prices as the main Q1 FY27 margin hit' },
    regulation: { exposure: 3, why: 'FY24 revenue fell 41% because of a regulatory shutdown; API manufacturing is regulated (GMP, export registrations)' },
    technology: { exposure: 1, why: 'Process chemistry; no specific disruption identified' },
    demand: { exposure: 2, why: 'Lumpy, order-driven revenue: FY24 sales fell 42% before recovering' }
  },
  conflicts: [
    { metric: 'FY26 operating cash flow', values: ['−₹59 cr (Tapetide, Screener)', '−₹79 cr (Fyers)'], used: '−₹59 cr' },
    { metric: 'Q1 FY27 revenue direction', values: ['+163% YoY consolidated (Tapetide)', '"declines year-on-year" headline (Fyers news)'], used: 'Consolidated; headline read as standalone' }
  ],
  marketFacts: [
    { label: 'Last price', value: '₹29.66 on 6 Oct 2026 (−5.0%), at the lower circuit', src: 'fyers' },
    { label: 'Circuit band', value: '5% (upper ₹32.78, lower ₹29.66). Moves of ~10% on 22, 25 and 28 Sep show the band was 10% before; a cut is typical of exchange surveillance (reason not verified)', src: 'fyers, wallet' },
    { label: 'Lower-circuit streak', value: '1 Oct and 5 Oct traded at a single price (open = high = low = close); 6 Oct closed at the lower circuit', src: 'wallet, choice' },
    { label: 'Run-up', value: '₹15.6 on 8 Sep → ₹37.24 high on 30 Sep (+139% in 15 sessions); 52-week range ₹10.37–37.24', src: 'wallet, fyers' },
    { label: 'Exchange query', value: 'Exchange sought clarification on significant price movement on 16 Sep 2026; company replied 17 Sep', src: 'fyers' },
    { label: 'Bulk deals', value: 'Proprietary trading firms bought and sold almost identical quantities on the same day (e.g. 25 Sep: one firm bought 72.25 lakh and sold 72.45 lakh shares; 23 Sep: 1.32 crore bought and 1.33 crore sold)', src: 'fyers' },
    { label: 'Block trade', value: '6 Oct 2026: ₹20.54 cr NSE block deal, 68.7 lakh shares', src: 'fyers' },
    { label: 'Delivery on circuit days', value: 'Delivery volume on 5 Oct fell 89.8% versus the 5-day average (10.6 lakh shares): the lock trapped sellers rather than showing fresh dumping', src: 'mojonews' },
    { label: 'Bulk deals at the top', value: '29–30 Sep: Neo Apex sold 27.5 lakh shares at ₹36.39 and 27.0 lakh at ₹34.62 (also bought 17.5 and 52.1 lakh)', src: 'fyers' },
    { label: 'Shareholder count', value: '12,484 (Mar 2026) → 34,671 (Jun 2026): nearly tripled in one quarter', src: 'tapetide' },
    { label: 'Volume', value: '1.20 crore shares on 6 Oct 2026', src: 'tapetide' },
    { label: 'Third-party indicators (not recomputed)', value: 'SMA 20 ₹25.69 · SMA 50 ₹19.24 · SMA 100 ₹17.07 · SMA 200 ₹14.98 · RSI(14) 62.7', src: 'tapetide' }
  ],
  recentBars: [
    ['2026-07-07', 15.39, 16.06, 15.39, 15.61], ['2026-07-08', 15.52, 15.56, 15.00, 15.18], ['2026-07-09', 15.14, 15.64, 15.10, 15.47], ['2026-07-10', 15.64, 15.72, 15.50, 15.59], ['2026-07-13', 15.52, 15.67, 15.35, 15.39], ['2026-07-14', 15.28, 15.47, 14.98, 15.05], ['2026-07-15', 15.11, 15.28, 15.10, 15.15], ['2026-07-16', 15.09, 15.35, 14.94, 15.18], ['2026-07-17', 15.14, 15.18, 14.69, 14.72], ['2026-07-20', 14.72, 15.14, 14.60, 15.00],
    ['2026-08-24', 14.34, 15.60, 14.34, 15.43], ['2026-08-25', 15.45, 15.45, 14.97, 15.05], ['2026-08-26', 15.19, 15.26, 15.00, 15.11], ['2026-08-27', 15.10, 15.80, 15.10, 15.60], ['2026-08-28', 15.60, 16.87, 15.26, 15.91], ['2026-08-31', 16.10, 16.25, 15.58, 15.86],
    ['2026-09-01', 15.93, 15.97, 15.37, 15.49], ['2026-09-02', 15.49, 15.76, 15.32, 15.56], ['2026-09-03', 15.47, 16.25, 15.47, 15.60], ['2026-09-04', 15.68, 15.89, 15.54, 15.68], ['2026-09-07', 15.74, 15.85, 15.41, 15.48], ['2026-09-08', 15.54, 15.69, 15.41, 15.61], ['2026-09-09', 15.62, 16.68, 15.62, 16.28], ['2026-09-10', 16.41, 18.00, 16.05, 17.54], ['2026-09-11', 17.73, 20.00, 17.54, 19.57],
    ['2026-09-15', 21.05, 22.94, 19.37, 20.18], ['2026-09-16', 20.20, 20.50, 19.60, 20.04], ['2026-09-17', 19.70, 22.36, 19.70, 21.84], ['2026-09-18', 22.68, 24.78, 22.11, 22.90], ['2026-09-21', 23.16, 27.48, 23.15, 26.24], ['2026-09-22', 27.60, 28.86, 26.91, 28.86], ['2026-09-23', 30.30, 31.29, 26.55, 29.68], ['2026-09-24', 29.68, 30.68, 28.18, 28.65], ['2026-09-25', 28.78, 31.51, 27.71, 31.51], ['2026-09-28', 32.25, 34.66, 32.24, 34.66],
    ['2026-09-29', 36.39, 36.39, 35.50, 36.39], ['2026-09-30', 37.17, 37.24, 34.58, 34.58], ['2026-10-01', 32.86, 32.86, 32.86, 32.86], ['2026-10-05', 31.22, 31.22, 31.22, 31.22], ['2026-10-06', 29.66, 31.22, 29.66, 29.66]
  ],
  unavailable: {
    tam: 'Industry TAM/SAM for pharma intermediates & APIs needs an industry report source',
    marketShare: 'Market share not disclosed in the sources used',
    matchedCompanies: 'Requires a historical fundamentals database of listed companies',
    cohort: 'Requires a survivorship-free historical universe (including delisted companies)'
  }
};

/* ---------- CSV import (NSE / BSE downloads) ---------- */
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '\t' || c === ';') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x));
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseDate(s) {
  s = s.replace(/\s+/g, ' ').trim(); let m;
  const pad = x => String(x).padStart(2, '0');
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ,]+(\d{2,4})/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; const mo = MONTHS[m[2].toLowerCase()]; return mo ? `${y}-${pad(mo)}-${pad(m[1])}` : null; }
  if ((m = s.match(/^([A-Za-z]{3})[A-Za-z]* (\d{1,2}),? (\d{4})/))) { const mo = MONTHS[m[1].toLowerCase()]; return mo ? `${m[3]}-${pad(mo)}-${pad(m[2])}` : null; }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}
const num = s => { if (s == null) return null; const t = String(s).replace(/[,₹\s]/g, ''); if (t === '' || t === '-' || t === 'NA') return null; const v = parseFloat(t); return isNaN(v) ? null : v; };
function importPriceCsv(text, opts) {
  opts = opts || {};
  const rows = parseCsv(text);
  const hi = rows.findIndex(r => r.some(c => /^date$/i.test(c.replace(/[^a-z]/gi, ''))) && r.some(c => /close/i.test(c)));
  if (hi < 0) return { ok: false, error: 'No header row with Date and Close columns was found. Use the CSV download from the NSE or BSE historical-data page.' };
  const H = rows[hi].map(h => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const find = (...res) => H.findIndex(h => res.some(r => r.test(h)));
  const col = {
    date: find(/^date$/), series: find(/^series$/), open: find(/^open/, /open price/), high: find(/^high/, /high price/), low: find(/^low/, /low price/),
    close: H.findIndex(h => /close/.test(h) && !/prev/.test(h) && !/adj/.test(h)),
    volume: find(/total traded quantity/, /^volume/, /no\.? ?of shares/, /tottrdqty/, /shares traded/, /^qty/),
    delivPct: find(/% ?dly/, /deliverable.*%/, /% ?deli/, /deli.*to traded/),
    delivQty: find(/deliverable q/, /deli.*qty/)
  };
  if (col.close < 0) return { ok: false, error: 'No Close column found.' };
  let bars = [];
  for (const r of rows.slice(hi + 1)) {
    if (col.series >= 0 && r[col.series] && !/^(EQ|BE|BZ|SM|ST)$/i.test(r[col.series])) continue;
    const d = parseDate(r[col.date] || ''); const c = num(r[col.close]); if (!d || c == null) continue;
    const vol = col.volume >= 0 ? num(r[col.volume]) : null;
    let del = col.delivPct >= 0 ? num(r[col.delivPct]) : null;
    if (del == null && col.delivQty >= 0 && vol) { const dq = num(r[col.delivQty]); if (dq != null) del = dq / vol * 100; }
    bars.push({ date: d, open: num(r[col.open]) ?? c, high: num(r[col.high]) ?? c, low: num(r[col.low]) ?? c, close: c, volume: vol, deliveryPct: del });
  }
  const seen = new Set(); bars = bars.filter(b => !seen.has(b.date) && seen.add(b.date)).sort((a, z) => a.date < z.date ? -1 : 1);
  if (!bars.length) return { ok: false, error: 'The file has a header but no readable price rows.' };
  const notes = [];
  if (opts.index) return { ok: true, bars: bars.map(b => ({ date: b.date, close: b.close })), notes, from: bars[0].date, to: bars[bars.length - 1].date };
  (opts.corporateActions || []).forEach(ca => {
    const j = bars.findIndex(b => b.date >= ca.exDate); if (j <= 0) return;
    const jump = bars[j - 1].close / bars[j].open;
    if (jump > ca.factor * 0.5) { for (let k = 0; k < j; k++) { const b = bars[k]; b.open /= ca.factor; b.high /= ca.factor; b.low /= ca.factor; b.close /= ca.factor; if (b.volume != null) b.volume *= ca.factor; } notes.push(`Prices before ${ca.exDate} divided by ${ca.factor} and volumes multiplied by ${ca.factor} for the ${ca.label}.`); }
    else notes.push(`Prices around ${ca.exDate} already look adjusted for the ${ca.label}; left unchanged.`);
  });
  markCircuits(bars);
  const vCov = bars.filter(b => b.volume > 0).length / bars.length, dCov = bars.filter(b => b.deliveryPct != null).length / bars.length;
  if (vCov < 0.9) notes.push(`Volume present on only ${Math.round(vCov * 100)}% of sessions.`);
  if (dCov === 0) notes.push('No delivery data in this file; PVST will run without it. NSE\'s "Security-wise Price volume & Deliverable position data" download includes it.');
  return { ok: true, bars, notes, from: bars[0].date, to: bars[bars.length - 1].date, volumeCoverage: vCov, deliveryCoverage: dCov };
}
function markCircuits(bars) {
  const bands = [2, 5, 10, 20];
  bars.forEach((b, i) => {
    b.circuit = null; if (!i) return;
    const ch = (b.close / bars[i - 1].close - 1) * 100;
    const atBand = bands.some(x => Math.abs(Math.abs(ch) - x) <= 0.15);
    const locked = b.open === b.high && b.high === b.low && b.low === b.close;
    if (atBand && ch > 0 && b.close >= b.high * 0.999) b.circuit = 'UPPER';
    else if (atBand && ch < 0 && b.close <= b.low * 1.001) b.circuit = 'LOWER';
    else if (locked && Math.abs(ch) > 1.5) b.circuit = ch > 0 ? 'UPPER' : 'LOWER';
  });
  return bars;
}
const packBars = bars => bars.map(b => [b.date, +b.open.toFixed(4), +b.high.toFixed(4), +b.low.toFixed(4), +b.close.toFixed(4), b.volume == null ? null : Math.round(b.volume), b.deliveryPct == null ? null : +b.deliveryPct.toFixed(2)]);
const unpackBars = arr => arr.map(a => ({ date: a[0], open: a[1], high: a[2], low: a[3], close: a[4], volume: a[5], deliveryPct: a[6] }));

const LiveProvider = {
  id: 'live', label: 'LIVE · public sources',
  universe: [{ ticker: 'AHCL', name: 'Anlon Healthcare Ltd', aka: 'ANLON', sector: 'Pharma intermediates & APIs', exchange: 'NSE / BSE', available: true, live: true }],
  search(q) { q = (q || '').trim().toUpperCase(); if (!q) return this.universe; return this.universe.filter(s => s.ticker.includes(q) || s.name.toUpperCase().includes(q) || (s.aka && s.aka.includes(q))); },
  getBundle(ticker, imports) {
    if (ticker !== 'AHCL') return null;
    const F = AHCL_FACTS, imp = (imports || {})[ticker], nimp = (imports || {}).NIFTY;
    const prices = imp ? markCircuits(unpackBars(imp.bars)) : [];
    const asOf = prices.length ? prices[prices.length - 1].date : F.lastPrice.date;
    const annual = F.annual.map(a => { const ebit = a.ebitda + (a.otherIncome || 0) - a.depreciation; return Object.assign({ cogs: null, grossProfit: null, capex: null, dividends: 0, minority: 0, currentAssets: null, currentLiabilities: null, contingentLiabilities: null, receivables: null, inventory: null, payables: null, eps: null, standaloneRevenue: a.revenue, standalonePat: a.pat, otherIncome: 0 }, a, { ebit, capitalEmployed: a.equity + a.debt + (a.minority || 0) }); }).filter(a => a.resultDate <= asOf);
    // quarterly results entered by the admin (cloud version) are added or override the built-in ones
    const extraQ = (((imports || {})._quarters || {})[ticker] || []);
    const qMap = new Map(F.quarterly.map(q => [q.q, Object.assign({}, q)]));
    extraQ.forEach(x => qMap.set(x.q, { q: x.q, date: x.date, revenue: +x.revenue, ebitda: +x.ebitda, pat: +x.pat, enteredBy: x.enteredBy || 'admin' }));
    const quarterly = [...qMap.values()].sort((a, z) => a.date < z.date ? -1 : 1).filter(q => q.date <= asOf).map(q => Object.assign({}, q, { ebitdaMargin: q.ebitda / q.revenue * 100 }));
    const shareholding = F.shareholding.filter(s => s.filed <= asOf);
    const commentary = F.commentary.filter(c => c.date <= asOf);
    const eventDates = quarterly.map(q => { const b = prices.find(p => p.date >= q.date); return b ? b.date : null; }).filter((d, i, a) => d && a.indexOf(d) === i);
    const nifty = nimp ? nimp.bars.map(a => ({ date: a[0], close: a[4] != null ? a[4] : a[1] })) : null;
    return {
      meta: Object.assign({}, F.meta, { currency: 'INR', unit: '₹ crore', asOf, provider: 'LIVE', isDemo: false, circuitBand: null, phase: 0, lastPrice: prices.length ? prices[prices.length - 1].close : F.lastPrice.price, priceFile: imp ? { name: imp.fileName, importedAt: imp.importedAt, from: imp.from, to: imp.to, notes: imp.notes } : null, niftyFile: nimp ? { name: nimp.fileName, from: nimp.from, to: nimp.to } : null }),
      source: { label: 'Public filings via secondary sources (retrieved ' + LIVE_RETRIEVED + ')', sourceType: 'DATA_VENDOR', verified: false, sources: LIVE_SOURCES, retrieved: LIVE_RETRIEVED },
      annual, quarterly, guidance: F.guidance, commentary, shareholding,
      concentration: {}, governance: F.governance, peers: [], qualitative: null, unavailable: F.unavailable, failureNotes: F.failureNotes,
      standaloneQuarterNote: quarterly.some(q => q.q === 'Q1FY27') ? F.standaloneQuarterNote : null,
      conflicts: F.conflicts, marketFacts: F.marketFacts, corporateActions: F.corporateActions, annualNotes: F.annualNotes,
      recentBars: markCircuits(F.recentBars.map(a => ({ date: a[0], open: a[1], high: a[2], low: a[3], close: a[4], volume: null, deliveryPct: null }))),
      prices, nifty, sector: null, eventDates
    };
  }
};

if (typeof module !== 'undefined') module.exports = { LiveProvider, importPriceCsv, packBars, unpackBars, AHCL_FACTS };
