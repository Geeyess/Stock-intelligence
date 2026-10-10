/*
 * Stock Intelligence — nightly official analysis.
 * Runs in GitHub Actions right after fetch_data.py:
 *   1. Builds each stock's data from data/*.json + quarterly results entered by the admin
 *   2. Runs MBF2.0, TAF1.0 and PVST once with the default settings
 *   3. Publishes the official snapshot + challenge answer key to Supabase (never overwritten)
 *   4. Scores 30-session predictions whose outcome is now known
 * Needs two GitHub secrets: SUPABASE_URL and SUPABASE_SERVICE_KEY.
 */
const fs = require('fs');
const path = require('path');

const { DemoDataProvider, mulberry32 } = require('./data.js');
global.mulberry32 = mulberry32;
global.DemoDataProvider = DemoDataProvider;
const live = require('./live.js');
const E = require('./engines.js');

const URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const DATA_DIR = process.env.DATA_DIR || 'data';
const log = (...a) => console.log(...a);

function headers(extra) {
  const h = { apikey: KEY, 'Content-Type': 'application/json' };
  if (KEY.startsWith('eyJ')) h.Authorization = 'Bearer ' + KEY; // legacy service_role key
  return Object.assign(h, extra || {});
}
async function rest(method, pathAndQuery, body, extraHeaders) {
  const res = await fetch(`${URL}/rest/v1/${pathAndQuery}`, { method, headers: headers(extraHeaders), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathAndQuery} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function loadImports() {
  const imports = {};
  if (!fs.existsSync(DATA_DIR)) return imports;
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (!f.endsWith('.json') || f === 'manifest.json') continue;
    const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
    const t = j.ticker;
    imports[t] = {
      auto: true, fileName: 'Automatic update (' + j.source + ')', importedAt: j.updated, from: j.from, to: j.to, notes: j.notes || [], rows: j.bars.length,
      bars: t === 'NIFTY' ? j.bars.map(b => [b[0], b[4]]) : j.bars.map(b => [b[0], b[1], b[2], b[3], b[4], b[5], b[6]])
    };
  }
  return imports;
}

function brier(k, base, pick, conf, answer) {
  const p = Math.max(Math.min(conf, 100), 0) / 100, pp = Math.max(p, 1 / k), r = (1 - pp) / (k - 1);
  const correct = String(pick).toLowerCase() === String(answer).toLowerCase();
  const bs = correct ? (1 - pp) ** 2 + (k - 1) * r ** 2 : pp ** 2 + (1 - r) ** 2 + (k - 2) * r ** 2;
  return { correct, bs: Math.round(bs * 1000) / 1000, xp: Math.round(base * (1 - bs / (1 - 1 / k))) };
}

async function main() {
  if (!URL || !KEY) { log('SUPABASE_URL / SUPABASE_SERVICE_KEY not set: skipping the official analysis (data files are still saved).'); return 0; }
  const imports = loadImports();
  const quarters = await rest('GET', 'quarters?select=ticker,q,result_date,revenue,ebitda,pat,entered_by');
  imports._quarters = {};
  quarters.forEach(q => (imports._quarters[q.ticker] = imports._quarters[q.ticker] || []).push({ q: q.q, date: q.result_date, revenue: q.revenue, ebitda: q.ebitda, pat: q.pat, enteredBy: q.entered_by }));
  log(`Loaded ${Object.keys(imports).length - 1} price files and ${quarters.length} admin-entered quarters.`);

  const bundles = {};
  for (const u of live.LiveProvider.universe) {
    const t = u.ticker;
    const b = live.LiveProvider.getBundle(t, imports);
    bundles[t] = b;
    if (!E.technicalReady(b)) { log(`  ${t}: not enough price history yet (${b.prices.length} sessions) — no official analysis.`); continue; }
    const asOf = b.meta.asOf;
    const prevRows = await rest('GET', `snapshots?ticker=eq.${t}&as_of=lt.${asOf}&order=as_of.desc&limit=1&select=summary`);
    const prev = prevRows.length ? prevRows[0].summary : null;
    const official = E.analyse(b, E.DEFAULT_CONFIG, prev);
    const keyRun = E.analyse(b, E.DEFAULT_CONFIG, null); keyRun._bundle = b;
    const answers = E.challengeAnswerKey(keyRun);
    if (!answers) { log(`  ${t}: engines did not produce a full analysis — skipped.`); continue; }
    await rest('POST', 'snapshots?on_conflict=ticker,as_of,config_version',
      [{ ticker: t, as_of: asOf, config_version: E.DEFAULT_CONFIG.configVersion, summary: official.snapshot, answers }],
      { Prefer: 'resolution=ignore-duplicates,return=minimal' });
    log(`  ${t} ${asOf}: MBF ${official.scores.mbf} · TAF ${official.scores.taf} · PVST ${official.scores.pvst} · ${official.state.state} (published)`);
  }

  // resolve 30-session calls
  const pending = await rest('GET', 'predictions?forward_status=eq.PENDING&select=id,ticker,as_of,results,xp');
  let resolved = 0;
  for (const p of pending) {
    const b = bundles[p.ticker]; if (!b || !b.prices.length) continue;
    const i = b.prices.findIndex(x => x.date === p.as_of); if (i < 0 || i + 30 >= b.prices.length) continue;
    const fr = p.results.find(x => x.id === 'forward'); if (!fr) { await rest('PATCH', `predictions?id=eq.${p.id}`, { forward_status: 'NONE' }); continue; }
    const sr = b.prices[i + 30].close / b.prices[i].close - 1;
    let nr = 0, vsN = fr.vsNifty !== false;
    if (vsN) { const nm = new Map((b.nifty || []).map(x => [x.date, x.close])); const n0 = nm.get(b.prices[i].date), n1 = nm.get(b.prices[i + 30].date); if (n0 == null || n1 == null) vsN = false; else nr = n1 / n0 - 1; }
    const outcome = sr > nr ? 'Yes' : 'No';
    const s = brier(2, 25, fr.pick, fr.conf, outcome);
    Object.assign(fr, { pending: false, answer: outcome, correct: s.correct, brier: s.bs, xp: s.xp,
      detail: vsN ? `Stock ${(sr * 100).toFixed(1)}% vs Nifty ${(nr * 100).toFixed(1)}% over 30 sessions` : `Stock ${(sr * 100).toFixed(1)}% over 30 sessions` });
    await rest('PATCH', `predictions?id=eq.${p.id}`, { results: p.results, xp: p.xp + s.xp, forward_status: 'RESOLVED' });
    resolved++;
  }
  log(`Resolved ${resolved} of ${pending.length} pending 30-session calls.`);
  return 0;
}

if (require.main === module) main().then(c => process.exit(c)).catch(e => { console.error('Nightly analysis failed:', e.message); process.exit(1); });
module.exports = { main, brier, loadImports };
