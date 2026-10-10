"""
Stock Intelligence - nightly market-data updater.

What it does (runs on GitHub every weekday evening):
  1. Reads the stock list from watchlist.txt
  2. Downloads NSE's free end-of-day files for each missing trading day:
       - sec_bhavdata_full_DDMMYYYY.csv  (price, volume, delivery %)
       - ind_close_all_DDMMYYYY.csv      (Nifty 50 close)
  3. Adjusts history automatically if a stock splits or issues bonus shares
  4. Saves one small file per stock in the data/ folder for the app to read

If NSE cannot be reached, it falls back to Yahoo Finance (no delivery %).
Nothing is estimated: a day with no data is simply left out.
"""
import csv, io, json, os, sys, time
from datetime import date, datetime, timedelta, timezone

import requests

DATA_DIR = "data"
HISTORY_DAYS = 420          # first run downloads about 14 months
KEEP_BARS = 800             # about 3 years kept per stock
SERIES_OK = ("EQ", "BE", "BZ", "SM", "ST")
NSE = "https://nsearchives.nseindia.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/csv,text/plain,*/*",
    "Accept-Language": "en-IN,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}


def log(*a):
    print(*a, flush=True)


def read_watchlist(path="watchlist.txt"):
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            t = line.split("#")[0].strip().upper()
            if t and t not in out:
                out.append(t)
    return out


def load_json(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def num(s):
    if s is None:
        return None
    s = str(s).strip().replace(",", "")
    if s in ("", "-", "NA", "nan"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def norm(h):
    return "".join(ch for ch in h.upper() if ch.isalnum())


class Fetcher:
    def __init__(self):
        self.s = requests.Session()
        self.s.headers.update(HEADERS)
        self.failures = 0
        self.ok = 0

    def get(self, url):
        for attempt in range(3):
            try:
                r = self.s.get(url, timeout=25)
                if r.status_code == 200 and r.text.strip():
                    self.ok += 1
                    return r.text
                if r.status_code == 404:
                    return None          # holiday or not published yet
                log(f"  HTTP {r.status_code} for {url}")
            except requests.RequestException as e:
                log(f"  network error ({e.__class__.__name__}) for {url}")
            time.sleep(2 + attempt * 3)
        self.failures += 1
        return None


def parse_bhav(text, tickers):
    """Rows for our tickers from sec_bhavdata_full (prefers EQ series)."""
    rows = {}
    reader = csv.reader(io.StringIO(text))
    header = [norm(h) for h in next(reader)]
    col = {h: i for i, h in enumerate(header)}
    need = ["SYMBOL", "SERIES", "OPENPRICE", "HIGHPRICE", "LOWPRICE", "CLOSEPRICE", "TTLTRDQNTY"]
    if not all(k in col for k in need):
        raise ValueError(f"Unexpected bhavcopy columns: {header}")
    for r in reader:
        if len(r) < len(header):
            continue
        sym, ser = r[col["SYMBOL"]].strip().upper(), r[col["SERIES"]].strip().upper()
        if sym not in tickers or ser not in SERIES_OK:
            continue
        if sym in rows and rows[sym]["series"] == "EQ":
            continue
        rows[sym] = {
            "series": ser,
            "open": num(r[col["OPENPRICE"]]), "high": num(r[col["HIGHPRICE"]]),
            "low": num(r[col["LOWPRICE"]]), "close": num(r[col["CLOSEPRICE"]]),
            "volume": num(r[col["TTLTRDQNTY"]]),
            "deliv": num(r[col["DELIVPER"]]) if "DELIVPER" in col else None,
        }
    return rows


def parse_index(text, name="NIFTY 50"):
    reader = csv.reader(io.StringIO(text))
    header = [norm(h) for h in next(reader)]
    find = lambda key: next((i for i, h in enumerate(header) if h.startswith(key)), None)
    i_name, i_o, i_h, i_l, i_c = find("INDEXNAME"), find("OPEN"), find("HIGH"), find("LOW"), find("CLOS")
    for r in reader:
        if i_name is not None and len(r) > i_c and r[i_name].strip().upper() == name:
            return {"open": num(r[i_o]), "high": num(r[i_h]), "low": num(r[i_l]), "close": num(r[i_c])}
    return None


def adjust_splits(bars):
    """Detect split/bonus gaps (a one-day fall far beyond any circuit limit) and adjust older bars."""
    notes = []
    for i in range(1, len(bars)):
        prev_close, today_open = bars[i - 1][4], bars[i][1]
        if not prev_close or not today_open:
            continue
        ratio = prev_close / today_open
        if ratio < 1.8:
            continue
        f = round(ratio)
        if f in (2, 3, 4, 5, 6, 8, 10, 20) and abs(ratio / f - 1) < 0.12:
            for k in range(i):
                b = bars[k]
                for j in (1, 2, 3, 4):
                    b[j] = round(b[j] / f, 4)
                if b[5] is not None:
                    b[5] = round(b[5] * f)
            notes.append(f"Prices before {bars[i][0]} divided by {f} (split/bonus detected).")
    return notes


def yahoo_fallback(ticker, start):
    try:
        import yfinance as yf
    except ImportError:
        return []
    sym = "^NSEI" if ticker == "NIFTY" else ticker + ".NS"
    df = yf.download(sym, start=start.isoformat(), progress=False, auto_adjust=False)
    out = []
    if df is None or df.empty:
        return out
    if hasattr(df.columns, "levels"):
        df.columns = [c[0] for c in df.columns]
    for idx, row in df.iterrows():
        out.append([idx.date().isoformat(), float(row["Open"]), float(row["High"]), float(row["Low"]),
                    float(row["Close"]), None if ticker == "NIFTY" else float(row["Volume"]), None])
    return out


def main():
    tickers = read_watchlist()
    if not tickers:
        log("watchlist.txt is empty - nothing to do.")
        return 0
    os.makedirs(DATA_DIR, exist_ok=True)
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()   # India time

    stores = {}
    for t in tickers + ["NIFTY"]:
        old = load_json(os.path.join(DATA_DIR, f"{t}.json")) or {}
        stores[t] = {"bars": {b[0]: b for b in old.get("bars", [])}, "notes": old.get("notes", []), "source": old.get("source")}

    last_dates = [max(s["bars"]) for s in stores.values() if s["bars"]]
    have_all = all(stores[t]["bars"] for t in tickers + ["NIFTY"])
    start = (date.fromisoformat(min(last_dates)) + timedelta(days=1)) if (have_all and last_dates) else today - timedelta(days=HISTORY_DAYS)
    days = [start + timedelta(days=k) for k in range((today - start).days + 1)]
    days = [d for d in days if d.weekday() < 5]
    log(f"Stocks: {', '.join(tickers)} | checking {len(days)} weekdays from {start} to {today}")

    f = Fetcher()
    got = 0
    for d in days:
        tag = d.strftime("%d%m%Y")
        text = f.get(f"{NSE}/products/content/sec_bhavdata_full_{tag}.csv")
        if text:
            try:
                rows = parse_bhav(text, set(tickers))
            except ValueError as e:
                log(f"  {d}: {e}")
                rows = {}
            for t, r in rows.items():
                if r["close"] is None:
                    continue
                stores[t]["bars"][d.isoformat()] = [d.isoformat(), r["open"] or r["close"], r["high"] or r["close"],
                                                    r["low"] or r["close"], r["close"], r["volume"], r["deliv"]]
                stores[t]["source"] = "NSE end-of-day files"
            got += 1
            itext = f.get(f"{NSE}/content/indices/ind_close_all_{tag}.csv")
            if itext:
                ix = parse_index(itext)
                if ix and ix["close"]:
                    stores["NIFTY"]["bars"][d.isoformat()] = [d.isoformat(), ix["open"] or ix["close"], ix["high"] or ix["close"],
                                                              ix["low"] or ix["close"], ix["close"], None, None]
                    stores["NIFTY"]["source"] = "NSE end-of-day files"
        time.sleep(0.4)          # be polite to NSE
        if f.failures >= 8 and f.ok == 0:
            log("NSE is not answering from this server; switching to Yahoo Finance.")
            break
    log(f"NSE files read for {got} trading days ({f.failures} failed requests).")

    if days and f.ok == 0:
        for t in tickers + ["NIFTY"]:
            bars = yahoo_fallback(t, start)
            for b in bars:
                stores[t]["bars"][b[0]] = b
            if bars:
                stores[t]["source"] = "Yahoo Finance (fallback, no delivery data)"
            log(f"  Yahoo: {t} {len(bars)} days")

    manifest = {"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "stocks": {}}
    for t, s in stores.items():
        bars = [s["bars"][k] for k in sorted(s["bars"])]
        if not bars:
            log(f"  {t}: no data found (check the ticker in watchlist.txt)")
            continue
        notes = s["notes"]
        if t != "NIFTY":
            notes = (notes + adjust_splits(bars))[-10:]
        bars = bars[-KEEP_BARS:]
        out = {"ticker": t, "source": s["source"], "updated": manifest["updated"], "from": bars[0][0], "to": bars[-1][0],
               "notes": notes, "columns": ["date", "open", "high", "low", "close", "volume", "delivery_pct"], "bars": bars}
        with open(os.path.join(DATA_DIR, f"{t}.json"), "w", encoding="utf-8") as fh:
            json.dump(out, fh, separators=(",", ":"))
        manifest["stocks"][t] = {"file": f"{t}.json", "from": out["from"], "to": out["to"], "sessions": len(bars), "source": s["source"]}
        log(f"  {t}: {len(bars)} sessions, {out['from']} to {out['to']}")
    with open(os.path.join(DATA_DIR, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
    if not manifest["stocks"]:
        log("No data could be saved.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
