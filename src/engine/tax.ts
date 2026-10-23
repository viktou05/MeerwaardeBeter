// Rekenmotor Belgische meerwaardebelasting op financiële activa (algemene categorie, 10%).
//
// Regels die hier geïmplementeerd zijn (stand oktober 2026, ter controle met een fiscalist):
//  - Enkel gerealiseerde meerwaarden vanaf 1/1/2026 zijn belastbaar; tarief 10%.
//  - Bezittingen van vóór 2026: aanschaffingswaarde = waarde op 31/12/2025 (fotomoment).
//  - Tot en met 31/12/2030 mag de hogere historische aanschaffingswaarde gebruikt worden,
//    maar enkel om de meerwaarde te verkleinen (tot nul), niet om een minderwaarde te creëren.
//  - Kosten en taksen (makelaarsloon, TOB) zijn niet aftrekbaar: winst = verkoopprijs - aankoopprijs.
//  - Gedeeltelijke verkoop: FIFO (eerst gekocht = eerst verkocht).
//  - Minderwaarden enkel verrekenbaar met meerwaarden van hetzelfde jaar, niet overdraagbaar.
//  - Vrijstelling per persoon per jaar (2026: 10.000 EUR, geïndexeerd). Onbenut deel tot 1.000 EUR/jaar
//    overdraagbaar, max. 5 jaar geldig (vrijstelling dus max. 15.000 EUR).
//  - Belgische banken houden 10% voorheffing in zonder rekening te houden met vrijstelling of
//    minderwaarden; teveel ingehouden recupereer je via de aangifte.

import type { AppData, Settings, Transaction } from './types';

const EPS = 1e-9;

export interface Lot {
  id: string;
  accountId: string;
  assetId: string;
  acquisitionDate: string;
  quantityOriginal: number;
  quantity: number; // resterend
  /** Fiscale aanschaffingswaarde per eenheid (waarde 31/12/2025 of aankoopkoers). */
  basisPerUnit: number;
  /** Historische aankoopprijs per eenheid (alleen pre-2026, indien gekend). */
  historicalPerUnit?: number;
  pre2026: boolean;
}

export interface SaleMatch {
  lotId: string;
  lotAccountId: string;
  acquisitionDate: string;
  quantity: number;
  proceeds: number;
  basisUsed: number;
  result: number; // + winst, - verlies
  rule: 'normaal' | 'historisch-hoger' | 'historisch-nul' | 'geen-lot';
}

export interface SaleResult {
  txId: string;
  date: string;
  year: number;
  accountId: string;
  assetId: string;
  quantity: number;
  proceeds: number;
  basis: number;
  gain: number; // >= 0
  loss: number; // >= 0
  withheld: number;
  costs: number;
  matches: SaleMatch[];
  unmatchedQuantity: number;
}

export interface CarryChunk {
  fromYear: number;
  amount: number;
}

export interface YearSummary {
  year: number;
  gains: number;
  losses: number;
  net: number; // max(0, gains - losses)
  baseExemption: number;
  carryAvailable: number;
  exemptionAvailable: number;
  exemptionUsed: number;
  exemptionRemaining: number;
  taxable: number;
  tax: number;
  withheld: number;
  /** tax - withheld: > 0 nog te betalen, < 0 terug te krijgen via aangifte. */
  balance: number;
  carriedForward: number; // nieuw overgedragen naar volgend jaar
  carryPoolAfter: CarryChunk[];
  sales: SaleResult[];
}

export interface Warning {
  level: 'fout' | 'let-op' | 'info';
  message: string;
  txId?: string;
}

export interface EngineResult {
  lots: Lot[]; // open lots (quantity > 0)
  sales: SaleResult[];
  years: YearSummary[];
  warnings: Warning[];
}

export function exemptionForYear(settings: Settings, year: number): number {
  const entries = Object.entries(settings.exemptionByYear)
    .map(([y, v]) => [Number(y), v] as const)
    .filter(([y]) => y <= year)
    .sort((a, b) => a[0] - b[0]);
  if (entries.length === 0) return 10000;
  return entries[entries.length - 1][1];
}

const yearOf = (d: string) => Number(d.slice(0, 4));

function lotKey(scope: Settings['fifoScope'], accountId: string, assetId: string) {
  return scope === 'rekening' ? `${accountId}|${assetId}` : assetId;
}

/** Bereken het resultaat van één (deel)verkoop van een lot. */
export function lotSaleResult(
  lot: Pick<Lot, 'basisPerUnit' | 'historicalPerUnit' | 'pre2026'>,
  quantity: number,
  proceeds: number,
  saleDate: string,
  historicalCostDeadline: string,
): { basisUsed: number; result: number; rule: SaleMatch['rule'] } {
  const ref = lot.basisPerUnit * quantity;
  if (
    lot.pre2026 &&
    lot.historicalPerUnit !== undefined &&
    lot.historicalPerUnit * quantity > ref + EPS &&
    saleDate <= historicalCostDeadline
  ) {
    const hist = lot.historicalPerUnit * quantity;
    if (proceeds >= hist) return { basisUsed: hist, result: proceeds - hist, rule: 'historisch-hoger' };
    if (proceeds >= ref) return { basisUsed: proceeds, result: 0, rule: 'historisch-nul' };
    // Verkoop onder de waarde van 31/12/2025: minderwaarde t.o.v. die waarde (verlies sinds 2026).
    return { basisUsed: ref, result: proceeds - ref, rule: 'normaal' };
  }
  return { basisUsed: ref, result: proceeds - ref, rule: 'normaal' };
}

export function runEngine(data: AppData, extraTransactions: Transaction[] = []): EngineResult {
  const { settings } = data;
  const warnings: Warning[] = [];
  const pools = new Map<string, Lot[]>();
  const allLots: Lot[] = [];
  const assetName = (id: string) => data.assets.find((a) => a.id === id)?.name ?? 'onbekend effect';

  const pushLot = (lot: Lot) => {
    const k = lotKey(settings.fifoScope, lot.accountId, lot.assetId);
    if (!pools.has(k)) pools.set(k, []);
    pools.get(k)!.push(lot);
    allLots.push(lot);
  };

  // 1. Startposities 31/12/2025
  for (const sp of data.startPositions) {
    if (!(sp.quantity > 0)) {
      warnings.push({ level: 'fout', message: `Startpositie ${assetName(sp.assetId)}: aantal ontbreekt.` });
      continue;
    }
    if (!(sp.value20251231PerUnit > 0)) {
      warnings.push({
        level: 'fout',
        message: `Startpositie ${assetName(sp.assetId)}: koers op 31/12/2025 ontbreekt. Zonder die waarde wordt de volledige verkoopprijs als winst gezien.`,
      });
    }
    pushLot({
      id: `sp-${sp.id}`,
      accountId: sp.accountId,
      assetId: sp.assetId,
      acquisitionDate: '2025-12-31',
      quantityOriginal: sp.quantity,
      quantity: sp.quantity,
      basisPerUnit: sp.value20251231PerUnit || 0,
      historicalPerUnit:
        sp.historicalCostTotal && sp.historicalCostTotal > 0 ? sp.historicalCostTotal / sp.quantity : undefined,
      pre2026: true,
    });
  }

  // 2. Transacties chronologisch. Zelfde dag: koop, dan transfer, dan verkoop.
  const order: Record<string, number> = { koop: 0, transfer: 1, verkoop: 2 };
  const txs = [...data.transactions, ...extraTransactions]
    .sort((a, b) => (a.date === b.date ? order[a.type] - order[b.type] : a.date < b.date ? -1 : 1));

  const sales: SaleResult[] = [];

  for (const tx of txs) {
    if (!(tx.quantity > 0)) {
      warnings.push({ level: 'fout', message: `Transactie ${tx.date} ${assetName(tx.assetId)}: aantal ontbreekt.`, txId: tx.id });
      continue;
    }
    if (tx.date < '2026-01-01') {
      warnings.push({
        level: 'info',
        message: `Transactie van ${tx.date} (${assetName(tx.assetId)}) is van vóór 2026 en wordt genegeerd. Posities van vóór 2026 geef je in als startpositie op 31/12/2025.`,
        txId: tx.id,
      });
      continue;
    }

    if (tx.type === 'koop') {
      if (!(tx.amountEUR > 0)) {
        warnings.push({ level: 'let-op', message: `Aankoop ${tx.date} ${assetName(tx.assetId)} zonder bedrag: aanschaffingswaarde 0.`, txId: tx.id });
      }
      pushLot({
        id: `tx-${tx.id}`,
        accountId: tx.accountId,
        assetId: tx.assetId,
        acquisitionDate: tx.date,
        quantityOriginal: tx.quantity,
        quantity: tx.quantity,
        basisPerUnit: (tx.amountEUR || 0) / tx.quantity,
        pre2026: false,
      });
      continue;
    }

    if (tx.type === 'transfer') {
      if (!tx.toAccountId) {
        warnings.push({ level: 'let-op', message: `Transfer ${tx.date} zonder doelrekening.`, txId: tx.id });
        continue;
      }
      // Eigen transfer is geen realisatie: lots verhuizen met behoud van datum en aanschaffingswaarde.
      moveLots(pools.get(lotKey(settings.fifoScope, tx.accountId, tx.assetId)) ?? [], tx, warnings, pushLot, assetName);
      continue;
    }

    // verkoop
    const pool = (pools.get(lotKey(settings.fifoScope, tx.accountId, tx.assetId)) ?? [])
      .filter((l) => l.quantity > EPS)
      .sort((a, b) => (a.acquisitionDate < b.acquisitionDate ? -1 : a.acquisitionDate > b.acquisitionDate ? 1 : 0));
    let remaining = tx.quantity;
    const matches: SaleMatch[] = [];
    const pricePerUnit = (tx.amountEUR || 0) / tx.quantity;
    for (const lot of pool) {
      if (remaining <= EPS) break;
      const q = Math.min(remaining, lot.quantity);
      const proceeds = q * pricePerUnit;
      const r = lotSaleResult(lot, q, proceeds, tx.date, settings.historicalCostDeadline);
      matches.push({
        lotId: lot.id,
        lotAccountId: lot.accountId,
        acquisitionDate: lot.acquisitionDate,
        quantity: q,
        proceeds,
        basisUsed: r.basisUsed,
        result: r.result,
        rule: r.rule,
      });
      lot.quantity -= q;
      remaining -= q;
    }
    let unmatched = 0;
    if (remaining > 1e-7) {
      unmatched = remaining;
      const proceeds = remaining * pricePerUnit;
      matches.push({
        lotId: '-',
        lotAccountId: tx.accountId,
        acquisitionDate: '?',
        quantity: remaining,
        proceeds,
        basisUsed: 0,
        result: proceeds,
        rule: 'geen-lot',
      });
      warnings.push({
        level: 'fout',
        message: `Verkoop ${tx.date} van ${fmtQ(tx.quantity)} ${assetName(tx.assetId)}: ${fmtQ(remaining)} stuks niet gevonden in je startposities of aankopen. Dat deel wordt (voorzichtig) volledig als winst gerekend. Vul de startpositie of ontbrekende aankoop aan.`,
        txId: tx.id,
      });
    }
    // Winst en verlies per lot apart optellen (meerwaarden en minderwaarden).
    const gain = matches.reduce((s, m) => s + Math.max(0, m.result), 0);
    const loss = matches.reduce((s, m) => s + Math.max(0, -m.result), 0);
    sales.push({
      txId: tx.id,
      date: tx.date,
      year: yearOf(tx.date),
      accountId: tx.accountId,
      assetId: tx.assetId,
      quantity: tx.quantity,
      proceeds: tx.amountEUR || 0,
      basis: matches.reduce((s, m) => s + m.basisUsed, 0),
      gain,
      loss,
      withheld: tx.withheldEUR || 0,
      costs: tx.costsEUR || 0,
      matches,
      unmatchedQuantity: unmatched,
    });
  }

  // 3. Jaaroverzichten met vrijstelling en overdracht
  const currentYear = new Date().getFullYear();
  const lastYear = Math.max(2026, currentYear, ...sales.map((s) => s.year));
  const years: YearSummary[] = [];
  let pool: CarryChunk[] = [];
  for (let year = 2026; year <= lastYear; year++) {
    pool = pool.filter((c) => year - c.fromYear <= settings.carryYears && c.amount > EPS);
    const ys = sales.filter((s) => s.year === year);
    const gains = ys.reduce((s, x) => s + x.gain, 0);
    const losses = ys.reduce((s, x) => s + x.loss, 0);
    const net = Math.max(0, gains - losses);
    const base = exemptionForYear(settings, year);
    const carryAvailable = pool.reduce((s, c) => s + c.amount, 0);
    const exemptionAvailable = base + carryAvailable;
    const usedBase = Math.min(net, base);
    let restNeed = net - usedBase;
    // Overgedragen schijven: oudste eerst opgebruiken (die vervallen eerst).
    const newPool: CarryChunk[] = [];
    for (const c of [...pool].sort((a, b) => a.fromYear - b.fromYear)) {
      const use = Math.min(c.amount, restNeed);
      restNeed -= use;
      if (c.amount - use > EPS) newPool.push({ fromYear: c.fromYear, amount: c.amount - use });
    }
    const exemptionUsed = net - restNeed;
    const taxable = Math.max(0, net - exemptionUsed);
    const tax = round2(taxable * (settings.taxRate / 100));
    const withheld = ys.reduce((s, x) => s + x.withheld, 0);
    const carriedForward = Math.min(settings.carryPerYear, Math.max(0, base - usedBase));
    if (carriedForward > EPS) newPool.push({ fromYear: year, amount: carriedForward });
    pool = newPool;
    years.push({
      year,
      gains: round2(gains),
      losses: round2(losses),
      net: round2(net),
      baseExemption: base,
      carryAvailable: round2(carryAvailable),
      exemptionAvailable: round2(exemptionAvailable),
      exemptionUsed: round2(exemptionUsed),
      exemptionRemaining: round2(exemptionAvailable - exemptionUsed),
      taxable: round2(taxable),
      tax,
      withheld: round2(withheld),
      balance: round2(tax - withheld),
      carriedForward,
      carryPoolAfter: pool.map((c) => ({ ...c })),
      sales: ys,
    });
  }

  return { lots: allLots.filter((l) => l.quantity > EPS), sales, years, warnings };
}

function moveLots(
  from: Lot[],
  tx: Transaction,
  warnings: Warning[],
  pushLot: (l: Lot) => void,
  assetName: (id: string) => string,
) {
  // Verplaats FIFO de lots van rekening A naar B (datum en basis blijven behouden).
  let remaining = tx.quantity;
  const sorted = from
    .filter((l) => l.quantity > EPS && l.accountId === tx.accountId)
    .sort((a, b) => (a.acquisitionDate < b.acquisitionDate ? -1 : 1));
  for (const lot of sorted) {
    if (remaining <= EPS) break;
    const q = Math.min(remaining, lot.quantity);
    remaining -= q;
    lot.quantity -= q;
    pushLot({ ...lot, id: `${lot.id}>${tx.id}`, accountId: tx.toAccountId!, quantity: q, quantityOriginal: q });
  }
  if (remaining > 1e-7) {
    warnings.push({
      level: 'fout',
      message: `Transfer ${tx.date} van ${fmtQ(tx.quantity)} ${assetName(tx.assetId)}: ${fmtQ(remaining)} stuks niet aanwezig op de bronrekening.`,
      txId: tx.id,
    });
  }
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtQ = (n: number) => (Math.round(n * 1e6) / 1e6).toLocaleString('nl-BE');

// ---------- Posities & latente meerwaarden ----------

export interface Holding {
  key: string;
  accountId: string; // bij scope 'belastingplichtige' toch per rekening getoond
  assetId: string;
  quantity: number;
  fiscalBasis: number; // som basisPerUnit
  marketValue?: number;
  /** Fiscale winst/verlies als je vandaag alles zou verkopen (met 2030-regel). */
  latentResult?: number;
  hasHistoricalShield: boolean;
  lots: Lot[];
}

export function holdingsFrom(data: AppData, lots: Lot[], today: string): Holding[] {
  const map = new Map<string, Holding>();
  for (const lot of lots) {
    const k = `${lot.accountId}|${lot.assetId}`;
    if (!map.has(k))
      map.set(k, { key: k, accountId: lot.accountId, assetId: lot.assetId, quantity: 0, fiscalBasis: 0, hasHistoricalShield: false, lots: [] });
    const h = map.get(k)!;
    h.quantity += lot.quantity;
    h.fiscalBasis += lot.quantity * lot.basisPerUnit;
    h.lots.push(lot);
    if (lot.pre2026 && lot.historicalPerUnit && lot.historicalPerUnit > lot.basisPerUnit) h.hasHistoricalShield = true;
  }
  for (const h of map.values()) {
    const asset = data.assets.find((a) => a.id === h.assetId);
    if (asset?.currentPrice !== undefined && asset.currentPrice > 0) {
      h.marketValue = h.quantity * asset.currentPrice;
      h.latentResult = h.lots.reduce(
        (s, l) =>
          s + lotSaleResult(l, l.quantity, l.quantity * asset.currentPrice!, today, data.settings.historicalCostDeadline).result,
        0,
      );
    }
  }
  return [...map.values()].sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
