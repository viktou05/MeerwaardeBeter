const eur = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 6 });

export const fmtEUR = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? '—' : eur.format(n));
export const fmtEUR0 = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? '—' : eur0.format(n));
export const fmtNum = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? '—' : num.format(n));
export const fmtDate = (iso?: string) => (iso ? iso.split('-').reverse().join('/') : '—');
export const signClass = (n: number | undefined) => (n === undefined ? '' : n > 0.005 ? 'pos' : n < -0.005 ? 'neg' : '');

/** Lees een getal uit een invoerveld (komma of punt). */
export function readNum(s: string): number | undefined {
  const t = s.trim().replace(/\s/g, '');
  if (!t) return undefined;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(norm);
  return Number.isFinite(n) ? n : undefined;
}
