// Herkenning en verwerking van de exportbestanden van specifieke brokers/platformen.
// Elke parser krijgt de kopregel en de datarijen, en geeft voorlopige importregels terug.
// Onbekende formaten vallen terug op de generieke kolomherkenning (csv.ts).

import { parseNumber, parseDate, currencyOf } from './csv';
import type { ImportRow } from './convert';

export type BrokerId =
  | 'degiro'
  | 'revolut'
  | 'curvo'
  | 'bitvavo'
  | 'robinhood'
  | 'coinbase'
  | 'medirect'
  | 'ibkr'
  | 'bolero'
  | 'keytrade'
  | 'kbc'
  | 'belfius'
  | 'ing'
  | 'bnp'
  | 'argenta'
  | 'traderepublic'
  | 'saxo';

export interface BrokerInfo {
  id: BrokerId;
  name: string;
  /** Belgische bank/broker die 10% meerwaardebelasting inhoudt bij verkoop. */
  withholds: boolean;
  /** Woorden om een bestaande rekening te herkennen. */
  keywords: string[];
  /** Waar vind je de export? (menu's kunnen licht verschillen per versie van de app) */
  howTo?: string;
  /** Formaat wordt automatisch herkend. */
  autoDetect?: boolean;
}

export const BROKERS: BrokerInfo[] = [
  {
    id: 'degiro',
    name: 'DEGIRO',
    withholds: false,
    keywords: ['degiro'],
    autoDetect: true,
    howTo: 'Website (niet de app): Inbox → Transacties → kies de periode (bv. 01-01-2026 tot vandaag) → Exporteren → CSV. Gebruik “Transacties”, niet “Rekeningoverzicht”.',
  },
  {
    id: 'revolut',
    name: 'Revolut',
    withholds: false,
    keywords: ['revolut'],
    autoDetect: true,
    howTo: 'Aandelen: tab Beleggen → ⋯ → Documenten → Brokerage-rekening → Rekeningafschrift → periode kiezen → Excel of CSV. Crypto: tab Crypto → ⋯ → Documenten → Rekeningafschrift → Excel/CSV.',
  },
  {
    id: 'curvo',
    name: 'Curvo',
    withholds: false,
    keywords: ['curvo'],
    howTo: 'Curvo (website): Portefeuille → Transacties → exporteren, of selecteer de transactietabel en plak ze hieronder. De kolommen worden automatisch gekoppeld; controleer ze even.',
  },
  {
    id: 'bitvavo',
    name: 'Bitvavo',
    withholds: false,
    keywords: ['bitvavo'],
    autoDetect: true,
    howTo: 'Website: klik rechtsboven op je account → Transactiegeschiedenis → Exporteren → CSV (kies “Alle” of de gewenste periode).',
  },
  {
    id: 'robinhood',
    name: 'Robinhood',
    withholds: false,
    keywords: ['robinhood'],
    autoDetect: true,
    howTo: 'Account → Menu → Reports and statements → Reports → Generate new report (CSV) voor de gewenste periode. Je krijgt een e-mail wanneer het klaar is.',
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    withholds: false,
    keywords: ['coinbase'],
    autoDetect: true,
    howTo: 'Profiel → Statements / Rapporten → Transaction history → Generate report → CSV.',
  },
  {
    id: 'medirect',
    name: 'MeDirect',
    withholds: true,
    keywords: ['medirect', 'me direct'],
    howTo: 'Online bankieren: Beleggen → Transacties/Verrichtingen → periode kiezen → exporteren naar Excel/CSV, of selecteer de tabel op het scherm en plak ze hieronder.',
  },
  {
    id: 'ibkr',
    name: 'Interactive Brokers / MEXEM',
    withholds: false,
    keywords: ['interactive', 'ibkr', 'mexem'],
    autoDetect: true,
    howTo: 'Client Portal: Performance & Reports → Statements → Activity → periode “Custom date range” (of “Annual” voor 2025 = startposities) → formaat CSV → Download. Een Flex Query (Trades, CSV) werkt ook.',
  },
  { id: 'bolero', name: 'Bolero', withholds: true, keywords: ['bolero'] },
  { id: 'keytrade', name: 'Keytrade', withholds: true, keywords: ['keytrade'] },
  { id: 'kbc', name: 'KBC / CBC', withholds: true, keywords: ['kbc', 'cbc'] },
  { id: 'belfius', name: 'Belfius', withholds: true, keywords: ['belfius'] },
  { id: 'ing', name: 'ING', withholds: true, keywords: ['ing'] },
  { id: 'bnp', name: 'BNP Paribas Fortis', withholds: true, keywords: ['bnp', 'fortis'] },
  { id: 'argenta', name: 'Argenta', withholds: true, keywords: ['argenta'] },
  { id: 'traderepublic', name: 'Trade Republic', withholds: false, keywords: ['trade republic', 'traderepublic'] },
  { id: 'saxo', name: 'Saxo', withholds: false, keywords: ['saxo'] },
];

export const brokerById = (id?: string) => BROKERS.find((b) => b.id === id);

/** Zoek de rekening die bij een broker hoort (op naam of broker-veld). */
export function matchAccount<T extends { id: string; name: string; broker?: string }>(accounts: T[], id?: BrokerId): T | undefined {
  const b = brokerById(id);
  if (!b) return undefined;
  return accounts.find((a) => {
    const hay = `${a.name} ${a.broker ?? ''}`.toLowerCase();
    return b.keywords.some((k) => (k.length <= 3 ? new RegExp(`\\b${k}\\b`).test(hay) : hay.includes(k)));
  });
}

// ---------------------------------------------------------------------------------------------

const FIAT = new Set(['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'NZD', 'SGD', 'HKD', 'TRY', 'ZAR', 'MXN', 'ILS']);

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Zoekt kolommen op exacte naam (string) of patroon (RegExp). Geeft -1 als niet gevonden. */
function columns(headers: string[]) {
  const low = headers.map(norm);
  return (...pats: (string | RegExp)[]) => {
    for (const p of pats) {
      const i = low.findIndex((h) => (typeof p === 'string' ? h === p : p.test(h)));
      if (i > -1) return i;
    }
    return -1;
  };
}

const cell = (r: string[], i: number) => (i > -1 ? (r[i] ?? '').trim() : '');

const cleanIsin = (s?: string) => {
  const t = (s || '').trim().toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(t) ? t : undefined;
};

/** Maak een importregel en vul de standaardopmerkingen in. */
function row(p: Partial<ImportRow> & { type: ImportRow['type'] }): ImportRow {
  const r: ImportRow = { include: true, name: '', currency: 'EUR', issues: [], ...p };
  r.currency = (r.currency || 'EUR').toUpperCase();
  if (r.quantity !== undefined) r.quantity = Math.abs(r.quantity);
  if (r.amountEUR !== undefined) r.amountEUR = Math.abs(r.amountEUR);
  if (r.amountLocal !== undefined) r.amountLocal = Math.abs(r.amountLocal);
  if (r.costs !== undefined) r.costs = Math.abs(r.costs) || undefined;
  if (r.currency === 'EUR' && r.amountEUR === undefined && r.amountLocal !== undefined) {
    r.amountEUR = r.amountLocal;
    r.amountLocal = undefined;
  }
  if (r.type === 'negeer') r.include = false;
  else {
    if (!r.date) r.issues.push('datum niet herkend');
    if (!r.quantity) r.issues.push('aantal ontbreekt');
    if (r.amountEUR === undefined)
      r.issues.push(r.currency !== 'EUR' && r.amountLocal !== undefined ? `bedrag in ${r.currency}: EUR-koers wordt opgehaald` : 'bedrag ontbreekt');
    if (!r.date || !r.quantity) r.include = false;
  }
  return r;
}

interface BrokerParser {
  id: BrokerId;
  detect: (find: ReturnType<typeof columns>, headers: string[]) => boolean;
  parse: (headers: string[], rows: string[][]) => ImportRow[];
}

// ---------- DEGIRO: Transactions.csv (NL/EN/FR/DE) ----------
// Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde,,Wisselkoers,[AutoFX Kosten],Transactiekosten en/of,,Totaal,,Order ID
// De naamloze kolom na Koers/Lokale waarde/Waarde bevat telkens de munt.
const degiro: BrokerParser = {
  id: 'degiro',
  detect: (f) =>
    f('isin', 'code isin') > -1 &&
    (f('uitvoeringsplaats', 'venue', "lieu d'exécution", 'ausführungsort') > -1 ||
      (f('product', 'produit', 'produkt') > -1 && f(/^order ?-?id$|^id ordre$|^order-id$/) > -1)),
  parse: (headers, rows) => {
    const f = columns(headers);
    const iDate = f('datum', 'date');
    const iProd = f('product', 'produit', 'produkt');
    const iIsin = f('isin', 'code isin');
    const iQty = f('aantal', 'quantity', 'quantité', 'anzahl');
    const iPrice = f('koers', 'price', 'cours', 'kurs');
    const iLocal = f(/^lokale waarde/, /^local value/, /^valeur locale/, /^lokaler/);
    const iValue = f('waarde', 'value', 'valeur', 'kurswert', 'wert', /^waarde/, /^value/);
    const iCost = f(/^transactiekosten/, /^transaction and/, /^transaction cost/, /^frais de/, /^transaktions/);
    const iAutoFx = f(/autofx/);
    return rows.map((r) => {
      const q = parseNumber(cell(r, iQty));
      const priceCur = cell(r, iPrice + 1).toUpperCase();
      const localCur = iLocal > -1 ? cell(r, iLocal + 1).toUpperCase() || priceCur : priceCur;
      const valueCur = iValue > -1 ? cell(r, iValue + 1).toUpperCase() || 'EUR' : 'EUR';
      const value = parseNumber(cell(r, iValue));
      const local = parseNumber(cell(r, iLocal));
      const price = parseNumber(cell(r, iPrice));
      const costs = (Math.abs(parseNumber(cell(r, iCost)) || 0) + Math.abs(parseNumber(cell(r, iAutoFx)) || 0)) || undefined;
      const useEur = valueCur === 'EUR' && value !== undefined;
      return row({
        type: !q ? 'negeer' : q > 0 ? 'koop' : 'verkoop',
        date: parseDate(cell(r, iDate)),
        name: cell(r, iProd),
        isin: cleanIsin(cell(r, iIsin)),
        quantity: q,
        amountEUR: useEur ? value : undefined,
        amountLocal: useEur ? undefined : local ?? (q && price ? q * price : undefined),
        currency: useEur ? 'EUR' : localCur || 'EUR',
        costs,
      });
    });
  },
};

// ---------- Revolut aandelen: trading account statement ----------
// Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
const revolutStocks: BrokerParser = {
  id: 'revolut',
  detect: (f) => f('ticker') > -1 && f(/^price per share/) > -1 && f(/^total amount/) > -1,
  parse: (headers, rows) => {
    const f = columns(headers);
    const iDate = f('date');
    const iTicker = f('ticker');
    const iType = f('type');
    const iQty = f('quantity');
    const iPrice = f(/^price per share/);
    const iTotal = f(/^total amount/);
    const iCur = f('currency');
    return rows.map((r) => {
      const t = cell(r, iType).toUpperCase();
      const type: ImportRow['type'] = /^BUY/.test(t) ? 'koop' : /^SELL/.test(t) ? 'verkoop' : 'negeer';
      const priceRaw = cell(r, iPrice);
      const currency = cell(r, iCur).toUpperCase() || currencyOf(priceRaw) || currencyOf(cell(r, iTotal)) || 'USD';
      const q = parseNumber(cell(r, iQty), '.');
      const price = parseNumber(priceRaw, '.');
      const total = parseNumber(cell(r, iTotal), '.');
      const gross = q && price ? Math.abs(q * price) : total !== undefined ? Math.abs(total) : undefined;
      const fee = gross !== undefined && total !== undefined ? Math.abs(Math.abs(total) - gross) : undefined;
      const res = row({
        type,
        date: parseDate(cell(r, iDate)),
        name: cell(r, iTicker),
        ticker: cell(r, iTicker).toUpperCase() || undefined,
        quantity: q,
        amountLocal: gross,
        currency,
        costs: currency === 'EUR' && fee && fee > 0.005 ? fee : undefined,
      });
      if (t.includes('SPLIT')) res.issues.push('aandelensplitsing: pas de aantallen van je aankopen zelf aan');
      else if (type === 'negeer' && t) res.issues.push(t.toLowerCase());
      return res;
    });
  },
};

// ---------- Revolut crypto: account statement ----------
// Symbol,Type,Quantity,Price,Value,Fees,Date
const revolutCrypto: BrokerParser = {
  id: 'revolut',
  detect: (f) => f('symbol') > -1 && f('type') > -1 && f('quantity') > -1 && f('price') > -1 && f('value') > -1 && f('fees') > -1,
  parse: (headers, rows) => {
    const f = columns(headers);
    const iSym = f('symbol');
    const iType = f('type');
    const iQty = f('quantity');
    const iPrice = f('price');
    const iValue = f('value');
    const iFees = f('fees');
    const iDate = f('date');
    return rows.map((r) => {
      const t = cell(r, iType).toLowerCase();
      const type: ImportRow['type'] = /^buy/.test(t) ? 'koop' : /^sell/.test(t) ? 'verkoop' : 'negeer';
      const valueRaw = cell(r, iValue);
      const currency = currencyOf(valueRaw) || currencyOf(cell(r, iPrice)) || 'EUR';
      const q = parseNumber(cell(r, iQty), '.');
      const value = parseNumber(valueRaw, '.');
      const price = parseNumber(cell(r, iPrice), '.');
      const sym = cell(r, iSym).toUpperCase();
      const res = row({
        type,
        date: parseDate(cell(r, iDate)),
        name: sym,
        ticker: sym || undefined,
        quantity: q,
        amountLocal: value ?? (q && price ? q * price : undefined),
        currency,
        costs: currency === 'EUR' ? parseNumber(cell(r, iFees), '.') : undefined,
      });
      if (type === 'negeer' && t) res.issues.push(t);
      return res;
    });
  },
};

// ---------- Revolut (oud): rekeningafschrift met crypto-omwisselingen ----------
// Type,Product,Started Date,Completed Date,Description,Amount,Currency,Fiat amount,Fiat amount (inc. fees),Fee,Base currency,State,Balance
const revolutStatement: BrokerParser = {
  id: 'revolut',
  detect: (f) => f('started date') > -1 && f('completed date') > -1 && f('currency') > -1 && f('amount') > -1,
  parse: (headers, rows) => {
    const f = columns(headers);
    const iType = f('type');
    const iDate = f('completed date', 'started date');
    const iAmount = f('amount');
    const iCur = f('currency');
    const iFiat = f('fiat amount');
    const iFee = f('fee');
    const iBase = f('base currency');
    const iState = f('state');
    return rows
      .filter((r) => !FIAT.has(cell(r, iCur).toUpperCase())) // gewone betalingen in euro weglaten
      .map((r) => {
        const t = cell(r, iType).toUpperCase();
        const state = cell(r, iState).toUpperCase();
        const amt = parseNumber(cell(r, iAmount), '.');
        const isTrade = (t === 'EXCHANGE' || t === 'TRADE' || t === 'BUY' || t === 'SELL') && (!state || state === 'COMPLETED');
        const sym = cell(r, iCur).toUpperCase();
        const base = cell(r, iBase).toUpperCase() || 'EUR';
        const res = row({
          type: !isTrade || !amt ? 'negeer' : amt > 0 ? 'koop' : 'verkoop',
          date: parseDate(cell(r, iDate)),
          name: sym,
          ticker: sym || undefined,
          quantity: amt,
          amountLocal: parseNumber(cell(r, iFiat), '.'),
          currency: base,
          costs: base === 'EUR' ? parseNumber(cell(r, iFee), '.') : undefined,
        });
        if (!isTrade && t) res.issues.push(t.toLowerCase());
        return res;
      });
  },
};

// ---------- Bitvavo ----------
// Timezone,Date,Time,Type,Currency,Amount,Quote Currency,Quote Price,Received / Paid Currency,Received / Paid Amount,Fee currency,Fee amount,Status,Transaction ID,Address
const bitvavo: BrokerParser = {
  id: 'bitvavo',
  detect: (f) => f('quote currency') > -1 || f(/received \/ paid/) > -1,
  parse: (headers, rows) => {
    const f = columns(headers);
    const iDate = f('date', 'time');
    const iTime = f('time');
    const iType = f('type');
    const iCur = f('currency');
    const iAmount = f('amount');
    const iQuoteCur = f('quote currency');
    const iQuotePrice = f('quote price', /^price/);
    const iPaidCur = f('received / paid currency');
    const iPaid = f('received / paid amount', /received \/ paid/);
    const iFeeCur = f('fee currency');
    const iFee = f('fee amount', 'fee');
    const iStatus = f('status');
    return rows.map((r) => {
      const t = cell(r, iType).toLowerCase();
      const status = cell(r, iStatus).toLowerCase();
      const ok = !status || /completed|settled|filled|done/.test(status);
      const type: ImportRow['type'] = !ok ? 'negeer' : t === 'buy' ? 'koop' : t === 'sell' ? 'verkoop' : 'negeer';
      const q = parseNumber(cell(r, iAmount), '.');
      const price = parseNumber(cell(r, iQuotePrice), '.');
      const quoteCur = cell(r, iQuoteCur).toUpperCase() || 'EUR';
      const paid = parseNumber(cell(r, iPaid), '.');
      const paidCur = cell(r, iPaidCur).toUpperCase() || quoteCur;
      const gross = q && price ? Math.abs(q * price) : paid;
      const sym = cell(r, iCur).toUpperCase();
      const dateRaw = iDate === iTime ? cell(r, iDate) : `${cell(r, iDate)} ${cell(r, iTime)}`;
      const res = row({
        type,
        date: parseDate(dateRaw),
        name: sym,
        ticker: sym || undefined,
        quantity: q,
        amountLocal: q && price ? gross : paid,
        currency: q && price ? quoteCur : paidCur,
        costs: (cell(r, iFeeCur).toUpperCase() || 'EUR') === 'EUR' ? parseNumber(cell(r, iFee), '.') : undefined,
      });
      if (type === 'negeer' && t) res.issues.push(ok ? t : `${t} (${status})`);
      return res;
    });
  },
};

// ---------- Coinbase: Transaction history report ----------
// (ID,)Timestamp,Transaction Type,Asset,Quantity Transacted,(Spot )Price Currency,(Spot )Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes
const coinbase: BrokerParser = {
  id: 'coinbase',
  detect: (f) => f('quantity transacted') > -1 && f('transaction type') > -1,
  parse: (headers, rows) => {
    const f = columns(headers);
    const iDate = f('timestamp', 'date');
    const iType = f('transaction type');
    const iAsset = f('asset');
    const iQty = f('quantity transacted');
    const iCur = f('price currency', 'spot price currency');
    const iPrice = f('price at transaction', 'spot price at transaction');
    const iSub = f('subtotal');
    const iFee = f(/^fees/);
    const iNotes = f('notes');
    const out: ImportRow[] = [];
    for (const r of rows) {
      const t = cell(r, iType).toLowerCase();
      const sym = cell(r, iAsset).toUpperCase();
      const currency = cell(r, iCur).toUpperCase() || currencyOf(cell(r, iSub)) || 'EUR';
      const q = parseNumber(cell(r, iQty), '.');
      const price = parseNumber(cell(r, iPrice), '.');
      const sub = parseNumber(cell(r, iSub), '.');
      const gross = sub !== undefined ? Math.abs(sub) : q && price ? Math.abs(q * price) : undefined;
      const date = parseDate(cell(r, iDate));
      const fee = currency === 'EUR' ? parseNumber(cell(r, iFee), '.') : undefined;
      if (/convert/.test(t)) {
        // "Converted 0.01 ETH to 25.3 USDC": verkoop van het ene, aankoop van het andere aan dezelfde waarde.
        const m = cell(r, iNotes).match(/converted\s+([\d.,]+)\s+(\w+)\s+to\s+([\d.,]+)\s+(\w+)/i);
        const note = 'crypto omgeruild: controleer of dit voor jou een belastbare verkoop is';
        out.push(row({ type: 'verkoop', date, name: sym, ticker: sym, quantity: q, amountLocal: gross, currency, costs: fee, issues: [note] }));
        if (m) {
          const to = m[4].toUpperCase();
          out.push(row({ type: 'koop', date, name: to, ticker: to, quantity: parseNumber(m[3], '.'), amountLocal: gross, currency, issues: [note] }));
        }
        continue;
      }
      const type: ImportRow['type'] = /\bbuy\b/.test(t) ? 'koop' : /\bsell\b/.test(t) ? 'verkoop' : 'negeer';
      const res = row({ type, date, name: sym, ticker: sym || undefined, quantity: q, amountLocal: gross, currency, costs: fee });
      if (type === 'negeer' && t) res.issues.push(t);
      out.push(res);
    }
    return out;
  },
};

// ---------- Robinhood: activity report ----------
// "Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"
const robinhood: BrokerParser = {
  id: 'robinhood',
  detect: (f) => f('trans code') > -1 && f('instrument') > -1,
  parse: (headers, rows) => {
    const f = columns(headers);
    const iDate = f('activity date', 'process date');
    const iInstr = f('instrument');
    const iDesc = f('description');
    const iCode = f('trans code');
    const iQty = f('quantity');
    const iPrice = f('price');
    const iAmount = f('amount');
    return rows.map((r) => {
      const code = cell(r, iCode).toLowerCase();
      const type: ImportRow['type'] = code === 'buy' ? 'koop' : code === 'sell' ? 'verkoop' : 'negeer';
      const priceRaw = cell(r, iPrice);
      const currency = currencyOf(priceRaw) || currencyOf(cell(r, iAmount)) || 'USD';
      const q = parseNumber(cell(r, iQty), '.');
      const price = parseNumber(priceRaw, '.');
      const amount = parseNumber(cell(r, iAmount), '.');
      const sym = cell(r, iInstr).toUpperCase();
      const desc = cell(r, iDesc).split(/\r?\n/)[0].trim();
      const res = row({
        type,
        date: parseDate(cell(r, iDate), { us: true }),
        name: desc && !/^(buy|sell)\b/i.test(desc) ? desc : sym,
        ticker: sym || undefined,
        quantity: q,
        amountLocal: q && price ? Math.abs(q * price) : amount,
        currency,
      });
      if (type === 'negeer' && code) res.issues.push(code.toUpperCase());
      return res;
    });
  },
};

// ---------- Interactive Brokers / MEXEM: Flex Query (Trades) ----------
// TradeDate,Symbol,Description,ISIN,Buy/Sell,Quantity,TradePrice,Proceeds,IBCommission,CurrencyPrimary,FXRateToBase,AssetClass
const ibkrFlex: BrokerParser = {
  id: 'ibkr',
  detect: (f) => f('buy/sell') > -1 && (f('tradeprice') > -1 || f('ibcommission') > -1),
  parse: (headers, rows) => {
    const f = columns(headers);
    const iDate = f('tradedate', 'date/time', 'datetime');
    const iSym = f('symbol');
    const iDesc = f('description');
    const iIsin = f('isin', 'securityid');
    const iSide = f('buy/sell');
    const iQty = f('quantity');
    const iPrice = f('tradeprice');
    const iProceeds = f('proceeds', 'tradegross');
    const iComm = f('ibcommission');
    const iCur = f('currencyprimary', 'currency');
    const iFx = f('fxratetobase');
    const iClass = f('assetclass');
    return rows.map((r) => {
      const cls = cell(r, iClass).toUpperCase();
      const side = cell(r, iSide).toUpperCase();
      const allowed = !cls || ['STK', 'ETF', 'BOND', 'CRYPTO', 'FUND'].includes(cls);
      const type: ImportRow['type'] = !allowed ? 'negeer' : side.startsWith('BUY') ? 'koop' : side.startsWith('SELL') ? 'verkoop' : 'negeer';
      const q = parseNumber(cell(r, iQty), '.');
      const price = parseNumber(cell(r, iPrice), '.');
      const proceeds = parseNumber(cell(r, iProceeds), '.');
      const gross = proceeds !== undefined && proceeds !== 0 ? Math.abs(proceeds) : q && price ? Math.abs(q * price) : undefined;
      const currency = cell(r, iCur).toUpperCase() || 'EUR';
      const fx = parseNumber(cell(r, iFx), '.');
      const sym = cell(r, iSym).toUpperCase();
      return row({
        type,
        date: parseDate(cell(r, iDate)),
        name: cell(r, iDesc) || sym,
        isin: cleanIsin(cell(r, iIsin)),
        ticker: sym || undefined,
        quantity: q,
        amountLocal: gross,
        // FXRateToBase = EUR per eenheid vreemde munt als je basismunt EUR is
        amountEUR: currency !== 'EUR' && fx && gross !== undefined ? gross * fx : undefined,
        fx: currency !== 'EUR' ? fx : undefined,
        currency,
        costs: currency === 'EUR' ? parseNumber(cell(r, iComm), '.') : undefined,
        issues: !allowed ? [`${cls}: geen effect (genegeerd)`] : [],
      });
    });
  },
};

const PARSERS: BrokerParser[] = [degiro, revolutStocks, revolutCrypto, revolutStatement, bitvavo, coinbase, robinhood, ibkrFlex];

/** Probeer een gekend formaat te herkennen aan de kopregel. */
export function detectBrokerFormat(headers: string[]): BrokerParser | undefined {
  const f = columns(headers);
  return PARSERS.find((p) => p.detect(f, headers));
}

export type { BrokerParser };
