// Kleine, afhankelijkheidsvrije CSV/TSV-parser + slimme kolomherkenning.

export function detectDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts: [string, number][] = ['\t', ';', ','].map((d) => [d, firstLines.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function parseDelimited(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

/** Munt uit een bedrag met symbool of code: "€12", "USD 150.25", "$1,234.50", "12,5 GBP". */
export function currencyOf(raw: string | undefined): string | undefined {
  const s = (raw || '').trim();
  if (!s) return undefined;
  if (s.includes('€')) return 'EUR';
  if (s.includes('£')) return 'GBP';
  if (s.includes('$')) return 'USD';
  const m = s.match(/^([A-Z]{3})\s*[-\d(.]/) || s.match(/[\d)]\s*([A-Z]{3})$/);
  return m ? m[1] : undefined;
}

/**
 * Getal uit Belgische/Europese of Amerikaanse notatie: "1.234,56", "1,234.56", "-12,5", "€ 3 000", "USD 150.25".
 * Met decimal '.' is een komma altijd een duizendtal (Amerikaanse exports: "1,000" = duizend);
 * met decimal ',' is een punt altijd een duizendtal.
 */
export function parseNumber(raw: unknown, decimal?: '.' | ','): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  let s = String(raw)
    .trim()
    .replace(/[€$£\s\u00a0\u202f']/g, '')
    .replace(/^([+-]?)[A-Za-z]{3}(?=[-+\d(.])/, '$1')
    .replace(/(?<=[\d)])[A-Za-z]{3}$/, '');
  if (s === '' || s === '-') return undefined;
  let neg = false;
  if (/^-?\(.*\)$/.test(s)) {
    neg = true;
    s = s.replace(/^-/, '').slice(1, -1);
  }
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (decimal === '.') s = s.replace(/,/g, '');
  else if (decimal === ',') s = s.replace(/\./g, '').replace(',', '.');
  else {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma > -1) {
      // "1,234" kan duizendtal zijn; in BE is komma bijna altijd decimaal. Duizendtal enkel bij meerdere komma's.
      if ((s.match(/,/g) || []).length > 1) s = s.replace(/,/g, '');
      else s = s.replace(',', '.');
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, ''); // 1.234.567
    }
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return neg ? -n : n;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, maa: 3, mrt: 3, apr: 4, may: 5, mei: 5, mai: 5, jun: 6, jui: 6, jul: 7, aug: 8, aoû: 8, sep: 9,
  oct: 10, okt: 10, nov: 11, dec: 12, déc: 12, fév: 2, avr: 4, juil: 7,
};
const monthNum = (name: string) => {
  const l = name.toLowerCase();
  return MONTHS[l.slice(0, 4)] ?? MONTHS[l.slice(0, 3)];
};
const ymd = (y: number | string, m: number | string, d: number | string) => {
  const yy = String(y).length === 2 ? `20${y}` : String(y);
  const mm = Number(m);
  const dd = Number(d);
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return undefined;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
};

/**
 * Datum naar YYYY-MM-DD. Ondersteunt 2026-03-01, 20260301, 01-03-2026, 01/03/2026, 1.3.2026,
 * "2026-03-01, 09:30:00", "Mar 4, 2026, 2:30 PM", "4 mrt 2026". Met us=true is 3/4/2026 = 4 maart (maand/dag).
 */
export function parseDate(raw: string | undefined, opts: { us?: boolean } = {}): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return ymd(m[1], m[2], m[3]);
  m = s.match(/^(20\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (m) return ymd(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return opts.us ? ymd(m[3], m[1], m[2]) : ymd(m[3], m[2], m[1]);
  // Maandnamen: "Mar 4, 2026" of "4 mrt. 2026"
  m = s.match(/^([A-Za-zéû]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && monthNum(m[1])) return ymd(m[3], monthNum(m[1])!, m[2]);
  m = s.match(/^(\d{1,2})\s+([A-Za-zéû]{3,})\.?,?\s+(\d{4})/);
  if (m && monthNum(m[2])) return ymd(m[3], monthNum(m[2])!, m[1]);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return undefined;
}

export type Field =
  | 'date'
  | 'type'
  | 'name'
  | 'isin'
  | 'ticker'
  | 'quantity'
  | 'price'
  | 'amountEUR'
  | 'amountLocal'
  | 'currency'
  | 'fx'
  | 'costs'
  | 'withheld'
  | 'account';

export const FIELD_LABELS: Record<Field, string> = {
  date: 'Datum',
  type: 'Type (koop/verkoop)',
  name: 'Naam effect',
  isin: 'ISIN',
  ticker: 'Ticker / symbool',
  quantity: 'Aantal',
  price: 'Koers per stuk',
  amountEUR: 'Bedrag in EUR',
  amountLocal: 'Bedrag in vreemde munt',
  currency: 'Munt',
  fx: 'Wisselkoers',
  costs: 'Kosten / TOB',
  withheld: 'Ingehouden meerwaardebelasting',
  account: 'Rekening',
};

// Synoniemen (kleine letters, exacte match eerst, dan 'begint met').
const SYNONYMS: Record<Field, string[]> = {
  date: ['datum', 'date', 'trade date', 'transactiedatum', 'uitvoeringsdatum', 'datum transactie', 'verrichtingsdatum', 'boekingsdatum', 'date/time', 'timestamp', 'activity date', 'tijdstip', "date d'opération", "date d'exécution", 'date de transaction', 'date opération'],
  type: ['type', 'transactietype', 'type transactie', 'soort', 'soort verrichting', 'verrichting', 'buy/sell', 'side', 'richting', 'order type', 'omschrijving', 'description', 'transaction type', 'trans code', "type d'opération", 'opération', 'sens'],
  name: ['product', 'naam', 'name', 'effect', 'instrument', 'asset name', 'security', 'omschrijving effect', 'naam effect', 'fonds', 'fund', 'etf', 'titre', 'libellé', 'valeur', 'produit'],
  isin: ['isin', 'isin code', 'isin-code', 'code isin', 'security id'],
  ticker: ['symbol', 'symbool', 'ticker', 'asset', 'currency', 'munt (crypto)', 'symbole'],
  quantity: ['aantal', 'quantity', 'qty', 'stuks', 'aantal stuks', 'aantal aandelen', 'aantal deelbewijzen', 'amount', 'hoeveelheid', 'quantity transacted', 'shares', 'units', 'quantité', 'nombre'],
  price: ['koers', 'price', 't. price', 'prijs', 'prijs per aandeel', 'prijs per stuk', 'unit price', 'price per share', 'spot price at transaction', 'price at transaction', 'quote price', 'koers per stuk', 'uitvoeringskoers', 'cours', "cours d'exécution", 'prix', 'prix unitaire'],
  amountEUR: ['waarde', 'bedrag eur', 'bedrag (eur)', 'waarde eur', 'value eur', 'totaal eur', 'subtotal', 'received / paid amount', 'bedrag', 'brutobedrag', 'amount eur', 'montant', 'montant brut', 'montant (eur)', 'bruto'],
  amountLocal: ['lokale waarde', 'proceeds', 'local value', 'bedrag lokaal', 'montant en devise'],
  currency: ['valuta', 'munt', 'currency code', 'quote currency', 'spot price currency', 'price currency', 'devise', 'monnaie'],
  fx: ['wisselkoers', 'exchange rate', 'fx', 'fx rate', 'taux de change'],
  costs: ['transactiekosten', 'transactiekosten en/of', 'kosten', 'fees', 'fee', 'comm/fee', 'commission', 'fee amount', 'makelaarsloon', 'beurstaks', 'tob', 'frais', 'courtage', 'taxe sur les opérations de bourse'],
  withheld: ['meerwaardebelasting', 'ingehouden belasting', 'voorheffing', 'roerende voorheffing', 'withholding', 'taxe sur les plus-values', 'précompte'],
  account: ['rekening', 'account', 'portefeuille', 'broker', 'compte'],
};

export function guessMapping(headers: string[]): Partial<Record<Field, number>> {
  const h = headers.map((x) => x.toLowerCase().trim());
  const used = new Set<number>();
  const map: Partial<Record<Field, number>> = {};
  const fields = Object.keys(SYNONYMS) as Field[];
  // Pass 1: exacte matches, in volgorde van synoniemprioriteit
  for (const f of fields) {
    for (const syn of SYNONYMS[f]) {
      const i = h.findIndex((x, idx) => x === syn && !used.has(idx));
      if (i > -1) {
        map[f] = i;
        used.add(i);
        break;
      }
    }
  }
  // Pass 2: 'begint met'
  for (const f of fields) {
    if (map[f] !== undefined) continue;
    for (const syn of SYNONYMS[f]) {
      const i = h.findIndex((x, idx) => x.startsWith(syn) && !used.has(idx));
      if (i > -1) {
        map[f] = i;
        used.add(i);
        break;
      }
    }
  }
  return map;
}

export type RowType = 'koop' | 'verkoop' | 'transfer' | 'negeer';

export function guessType(raw: string | undefined, quantity: number | undefined, amount: number | undefined): RowType {
  const s = (raw || '').toLowerCase();
  if (/(verkoop|sell|sold|\bs\b|vente)/.test(s)) return 'verkoop';
  if (/(aankoop|koop|buy|bought|\bb\b|achat|inschrijving)/.test(s)) return 'koop';
  if (/(transfer|overdracht|overboeking effecten)/.test(s)) return 'transfer';
  if (/(dividend|rente|interest|storting|deposit|withdraw|opname|fee|kosten|staking|reward)/.test(s)) return 'negeer';
  if (quantity !== undefined && quantity < 0) return 'verkoop';
  if (quantity !== undefined && quantity > 0) return 'koop';
  // Geen aantal-teken: kijk naar bedrag (DEGIRO-stijl: aankoop = negatief bedrag)
  if (amount !== undefined && amount < 0) return 'koop';
  return 'negeer';
}
