// Zet geplakte tekst of CSV-bestanden om naar voorlopige importregels.

import { parseDelimited, parseNumber, parseDate, guessMapping, guessType, type Field, type RowType } from './csv';
import { detectBrokerFormat, type BrokerId } from './brokers';

export interface ImportRow {
  include: boolean;
  date?: string;
  type: RowType;
  name: string;
  isin?: string;
  ticker?: string;
  quantity?: number; // positief
  amountEUR?: number; // positief, bruto (zonder kosten)
  amountLocal?: number;
  currency: string;
  fx?: number;
  costs?: number;
  withheld?: number;
  accountName?: string;
  issues: string[];
}

export interface StartRow {
  include: boolean;
  name: string;
  isin?: string;
  ticker?: string;
  quantity: number;
  pricePerUnitEUR?: number;
  priceLocal?: number;
  currency: string;
  historicalCostEUR?: number;
  issues: string[];
}

export interface ParsedImport {
  /** generiek = kolommen automatisch gekoppeld (aanpasbaar); broker = gekend formaat; ibkr = IB/MEXEM Activity Statement. */
  kind: 'generiek' | 'broker' | 'ibkr';
  headers: string[];
  rows: string[][];
  mapping: Partial<Record<Field, number>>;
  trades: ImportRow[];
  startPositions: StartRow[];
  periodNote?: string;
  /** Herkende broker, om de juiste rekening voor te stellen. */
  brokerId?: BrokerId;
}

export function parseImportText(text: string, opts: { delimiter?: string } = {}): ParsedImport {
  const clean = text.replace(/^\uFEFF/, '');
  if (!opts.delimiter && /^\s*"?Statement"?,"?(Header|Data)"?,/m.test(clean)) return parseIBKR(clean);
  const all = parseDelimited(clean, opts.delimiter);
  if (all.length === 0) return { kind: 'generiek', headers: [], rows: [], mapping: {}, trades: [], startPositions: [] };
  // 1. Gekend formaat? Sommige exports (Coinbase) hebben eerst een paar inleidende regels.
  for (let i = 0; i < Math.min(all.length, 30); i++) {
    const parser = detectBrokerFormat(all[i]);
    if (parser) {
      const headers = all[i];
      const rows = all.slice(i + 1).filter((r) => r.length > 1);
      return { kind: 'broker', headers, rows, mapping: {}, trades: parser.parse(headers, rows), startPositions: [], brokerId: parser.id };
    }
  }
  // 2. Generiek: zoek de kopregel = eerste rij met minstens 2 herkende kolommen
  let headerIdx = 0;
  for (let i = 0; i < Math.min(all.length, 15); i++) {
    const m = guessMapping(all[i]);
    if (Object.keys(m).length >= 2) {
      headerIdx = i;
      break;
    }
  }
  const headers = all[headerIdx].map((h, i) => h || `(kolom ${i + 1})`);
  const rows = all.slice(headerIdx + 1);
  const mapping = guessMapping(all[headerIdx]);
  return { kind: 'generiek', headers, rows, mapping, trades: rowsToTrades(rows, mapping), startPositions: [] };
}

export function rowsToTrades(rows: string[][], mapping: Partial<Record<Field, number>>): ImportRow[] {
  const get = (r: string[], f: Field) => (mapping[f] !== undefined ? r[mapping[f]!] : undefined);
  return rows.map((r) => {
    const issues: string[] = [];
    const qtyRaw = parseNumber(get(r, 'quantity'));
    const price = parseNumber(get(r, 'price'));
    const amtEURraw = parseNumber(get(r, 'amountEUR'));
    const amtLocalRaw = parseNumber(get(r, 'amountLocal'));
    const fx = parseNumber(get(r, 'fx'));
    const typeRaw = get(r, 'type');
    const type = guessType(typeRaw, qtyRaw, amtEURraw ?? amtLocalRaw);
    let currency = (get(r, 'currency') || 'EUR').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) currency = 'EUR';
    const quantity = qtyRaw !== undefined ? Math.abs(qtyRaw) : undefined;
    let amountEUR = amtEURraw !== undefined ? Math.abs(amtEURraw) : undefined;
    let amountLocal = amtLocalRaw !== undefined ? Math.abs(amtLocalRaw) : undefined;
    if (amountEUR === undefined && amountLocal === undefined && quantity !== undefined && price !== undefined) {
      if (currency === 'EUR') amountEUR = quantity * Math.abs(price);
      else amountLocal = quantity * Math.abs(price);
    }
    if (amountEUR === undefined && amountLocal !== undefined) {
      if (currency === 'EUR') amountEUR = amountLocal;
      else if (fx) {
        // DEGIRO-wisselkoers is "1 EUR = x vreemde munt"
        amountEUR = amountLocal / fx;
      }
    }
    const date = parseDate(get(r, 'date'));
    if (!date) issues.push('datum niet herkend');
    if (type !== 'negeer' && !quantity) issues.push('aantal ontbreekt');
    if (type !== 'negeer' && type !== 'transfer' && amountEUR === undefined)
      issues.push(currency !== 'EUR' ? `bedrag in ${currency}: EUR-koers wordt opgehaald` : 'bedrag ontbreekt');
    if (type === 'transfer') issues.push('transfer: voeg die zelf toe via “Overgezet naar eigen rekening”');
    const costs = parseNumber(get(r, 'costs'));
    const withheld = parseNumber(get(r, 'withheld'));
    return {
      include: type !== 'negeer' && type !== 'transfer' && !!date,
      date,
      type: type === 'transfer' ? 'negeer' : type,
      name: get(r, 'name') || get(r, 'ticker') || get(r, 'isin') || '',
      isin: cleanIsin(get(r, 'isin')),
      ticker: get(r, 'ticker')?.toUpperCase() || undefined,
      quantity,
      amountEUR,
      amountLocal,
      currency,
      fx,
      costs: costs !== undefined ? Math.abs(costs) : undefined,
      withheld: withheld !== undefined ? Math.abs(withheld) : undefined,
      accountName: get(r, 'account') || undefined,
      issues,
    };
  });
}

const cleanIsin = (s?: string) => {
  const t = (s || '').trim().toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(t) ? t : undefined;
};

// ---------- Interactive Brokers / MEXEM "Activity Statement" ----------

function parseIBKR(text: string): ParsedImport {
  const lines = parseDelimited(text, ',');
  const headers: Record<string, string[]> = {};
  const sections: Record<string, Record<string, string>[]> = {};
  for (const row of lines) {
    if (row.length < 2) continue;
    const [section, kind, ...rest] = row;
    if (kind === 'Header') {
      headers[section] = rest;
      continue;
    }
    if (kind !== 'Data') continue;
    const h = headers[section];
    if (!h) continue;
    const obj: Record<string, string> = {};
    h.forEach((k, i) => (obj[k] = rest[i] ?? ''));
    (sections[section] ||= []).push(obj);
  }
  const info: Record<string, { isin?: string; name?: string; type?: string }> = {};
  for (const r of sections['Financial Instrument Information'] || []) {
    info[(r['Symbol'] || '').toUpperCase()] = { isin: cleanIsin(r['Security ID']), name: r['Description'], type: r['Type'] };
  }
  // TOB staat apart onder Transaction Fees
  const tob = new Map<string, number>();
  for (const r of sections['Transaction Fees'] || []) {
    const k = `${(r['Symbol'] || '').toUpperCase()}|${parseDate(r['Date/Time'])}`;
    tob.set(k, (tob.get(k) || 0) + Math.abs(parseNumber(r['Amount']) || 0));
  }
  const trades: ImportRow[] = [];
  for (const r of sections['Trades'] || []) {
    if (r['DataDiscriminator'] && r['DataDiscriminator'] !== 'Order' && r['DataDiscriminator'] !== 'Trade') continue;
    const cat = (r['Asset Category'] || '').toLowerCase();
    if (cat && !cat.startsWith('stock') && !cat.startsWith('etf') && !cat.startsWith('bond') && !cat.startsWith('crypto')) continue;
    const sym = (r['Symbol'] || '').toUpperCase();
    const q = parseNumber(r['Quantity']) || 0;
    if (!q) continue;
    const date = parseDate(r['Date/Time']);
    const currency = (r['Currency'] || 'EUR').toUpperCase();
    const proceeds = Math.abs(parseNumber(r['Proceeds']) || q * (parseNumber(r['T. Price']) || 0));
    const fee = Math.abs(parseNumber(r['Comm/Fee']) || 0);
    const i = info[sym] || {};
    const issues: string[] = [];
    if (currency !== 'EUR') issues.push(`bedrag in ${currency}: EUR-koers wordt opgehaald`);
    trades.push({
      include: true,
      date,
      type: q > 0 ? 'koop' : 'verkoop',
      name: i.name || sym,
      isin: i.isin,
      ticker: sym,
      quantity: Math.abs(q),
      amountEUR: currency === 'EUR' ? proceeds : undefined,
      amountLocal: currency === 'EUR' ? undefined : proceeds,
      currency,
      costs: currency === 'EUR' ? fee + (tob.get(`${sym}|${date}`) || 0) : undefined,
      issues,
    });
  }
  // Open posities op het einde van een periode die op 31/12/2025 eindigt => startposities
  const period = (sections['Statement'] || []).find((r) => r['Field Name'] === 'Period')?.['Field Value'] || '';
  const endsEnd2025 = /December 31, 2025/i.test(period);
  const startPositions: StartRow[] = [];
  if (endsEnd2025) {
    for (const r of sections['Open Positions'] || []) {
      if (r['DataDiscriminator'] && r['DataDiscriminator'] !== 'Summary') continue;
      const sym = (r['Symbol'] || '').toUpperCase();
      const q = parseNumber(r['Quantity']) || 0;
      if (!sym || q <= 0) continue;
      const currency = (r['Currency'] || 'EUR').toUpperCase();
      const close = parseNumber(r['Close Price']) || 0;
      const cost = parseNumber(r['Cost Basis']);
      const i = info[sym] || {};
      startPositions.push({
        include: true,
        name: i.name || sym,
        isin: i.isin,
        ticker: sym,
        quantity: q,
        pricePerUnitEUR: currency === 'EUR' ? close : undefined,
        priceLocal: currency === 'EUR' ? undefined : close,
        currency,
        historicalCostEUR: currency === 'EUR' && cost ? Math.abs(cost) : undefined,
        issues: currency === 'EUR' ? [] : [`koers in ${currency}: omgerekend aan ECB-koers 31/12/2025`],
      });
    }
  }
  return {
    kind: 'ibkr',
    headers: [],
    rows: [],
    mapping: {},
    trades,
    startPositions,
    brokerId: 'ibkr',
    periodNote: period ? `Periode: ${period}${endsEnd2025 ? ' → open posities op 31/12/2025 herkend als startposities' : ''}` : undefined,
  };
}

// ---------- Wisselkoersen (ECB-referentiekoersen via frankfurter) ----------

const fxCache = new Map<string, number>();

/** Geeft EUR per 1 eenheid vreemde munt op (of net vóór) de datum. */
export async function fetchEurRate(currency: string, date: string): Promise<number | undefined> {
  if (currency === 'EUR') return 1;
  const key = `${currency}|${date}`;
  if (fxCache.has(key)) return fxCache.get(key);
  const urls = [
    `https://api.frankfurter.dev/v1/${date}?base=${currency}&symbols=EUR`,
    `https://api.frankfurter.app/${date}?from=${currency}&to=EUR`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const j = await r.json();
      const rate = j?.rates?.EUR;
      if (typeof rate === 'number') {
        fxCache.set(key, rate);
        return rate;
      }
    } catch {
      /* volgende proberen */
    }
  }
  return undefined;
}

const fmt = (n: number) => n.toLocaleString('nl-BE', { maximumFractionDigits: 2 });

export async function fillFx(trades: ImportRow[], starts: StartRow[]): Promise<{ failed: number }> {
  let failed = 0;
  for (const t of trades) {
    if (t.type === 'negeer') continue;
    if (t.amountEUR === undefined && t.amountLocal !== undefined && t.currency !== 'EUR' && t.date) {
      const rate = await fetchEurRate(t.currency, t.date);
      t.issues = t.issues.filter((x) => !x.includes('EUR-koers'));
      if (rate) {
        t.fx = rate;
        t.amountEUR = t.amountLocal * rate;
        t.issues.push(`omgerekend aan ECB-koers ${rate.toFixed(4)}`);
      } else {
        t.issues.push(`${fmt(t.amountLocal)} ${t.currency}: EUR-koers niet gevonden, vul het bedrag in euro zelf in`);
        failed++;
      }
    }
  }
  for (const s of starts) {
    if (s.pricePerUnitEUR === undefined && s.priceLocal !== undefined) {
      const rate = await fetchEurRate(s.currency, '2025-12-31');
      if (rate) s.pricePerUnitEUR = s.priceLocal * rate;
      else failed++;
    }
  }
  return { failed };
}
