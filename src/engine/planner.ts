// Planner: "wanneer verkoop ik best?" — alles hypothetisch, er wordt niets opgeslagen.

import { runEngine, round2, lotSaleResult, type Holding, type YearSummary } from './tax';
import { TOB_PRESETS, type AppData, type Transaction } from './types';

export interface SaleSimulation {
  year: number;
  gain: number; // extra meerwaarde
  loss: number; // extra minderwaarde
  extraTax: number; // extra verschuldigde belasting voor het jaar
  before: YearSummary;
  after: YearSummary;
  withheldByBank: number; // wat een Belgische bank zou inhouden (10% op de winst van deze verkoop)
}

export function simulateSale(
  data: AppData,
  opts: { accountId: string; assetId: string; quantity: number; pricePerUnit: number; date: string },
): SaleSimulation {
  const base = runEngine(data);
  const year = Number(opts.date.slice(0, 4));
  const tx: Transaction = {
    id: '__sim__',
    date: opts.date,
    type: 'verkoop',
    accountId: opts.accountId,
    assetId: opts.assetId,
    quantity: opts.quantity,
    amountEUR: opts.quantity * opts.pricePerUnit,
  };
  const sim = runEngine(data, [tx]);
  const before = base.years.find((y) => y.year === year) ?? emptyYear(year);
  const after = sim.years.find((y) => y.year === year) ?? emptyYear(year);
  const s = sim.sales.find((x) => x.txId === '__sim__');
  const acc = data.accounts.find((a) => a.id === opts.accountId);
  const gain = s?.gain ?? 0;
  const loss = s?.loss ?? 0;
  return {
    year,
    gain: round2(gain),
    loss: round2(loss),
    extraTax: round2(after.tax - before.tax),
    before,
    after,
    withheldByBank: acc?.withholds ? round2(Math.max(0, gain - loss) * (data.settings.taxRate / 100)) : 0,
  };
}

function emptyYear(year: number): YearSummary {
  return {
    year, gains: 0, losses: 0, net: 0, baseExemption: 0, carryAvailable: 0, exemptionAvailable: 0,
    exemptionUsed: 0, exemptionRemaining: 0, taxable: 0, tax: 0, withheld: 0, balance: 0,
    carriedForward: 0, carryPoolAfter: [], sales: [],
  };
}

/** TOB voor één order, met wettelijk plafond. */
export function tobFor(amount: number, rate: number): number {
  if (!rate) return 0;
  const preset = TOB_PRESETS.find((p) => p.rate === rate);
  const t = amount * (rate / 100);
  return round2(preset && preset.cap ? Math.min(t, preset.cap) : t);
}

export interface HarvestSuggestion {
  holding: Holding;
  price: number;
  /** Aantal stuks verkopen (en terugkopen) om de resterende vrijstelling net op te gebruiken. */
  quantity: number;
  gainRealized: number;
  saleAmount: number;
  costs: number; // TOB verkoop + TOB terugkoop + 2x orderkost + spread
  futureTaxSaved: number; // 10% van de belastingvrij gerealiseerde winst
  netBenefit: number;
  worthIt: boolean;
}

/**
 * Gain harvesting: verkoop zoveel stuks dat de meerwaarde = resterende vrijstelling dit jaar,
 * en koop meteen terug. Je aanschaffingswaarde stijgt belastingvrij.
 */
export function harvestSuggestion(
  data: AppData,
  holding: Holding,
  roomLeft: number,
  today: string,
): HarvestSuggestion | null {
  const asset = data.assets.find((a) => a.id === holding.assetId);
  const price = asset?.currentPrice;
  if (!price || roomLeft <= 0 || (holding.latentResult ?? 0) <= 0) return null;
  // FIFO-volgorde binnen deze positie
  const lots = [...holding.lots].sort((a, b) => (a.acquisitionDate < b.acquisitionDate ? -1 : 1));
  let qty = 0;
  let gain = 0;
  for (const lot of lots) {
    const full = lotSaleResult(lot, lot.quantity, lot.quantity * price, today, data.settings.historicalCostDeadline).result;
    if (gain + Math.max(0, full) <= roomLeft) {
      qty += lot.quantity;
      gain += full;
      continue;
    }
    // gedeeltelijk lot: winst is lineair in aantal binnen één lot (zolang regel dezelfde blijft)
    const perUnit = full / lot.quantity;
    if (perUnit > 0) {
      const q = (roomLeft - gain) / perUnit;
      qty += q;
      gain += q * perUnit;
    }
    break;
  }
  if (qty <= 0) return null;
  const saleAmount = qty * price;
  const rate = asset?.tobRate ?? 0.35;
  const fee = data.settings.defaultOrderFee;
  const spread = saleAmount * (data.settings.defaultSpreadPct / 100);
  const costs = round2(tobFor(saleAmount, rate) * 2 + fee * 2 + spread);
  const futureTaxSaved = round2(Math.max(0, gain) * (data.settings.taxRate / 100));
  return {
    holding,
    price,
    quantity: qty,
    gainRealized: round2(gain),
    saleAmount: round2(saleAmount),
    costs,
    futureTaxSaved,
    netBenefit: round2(futureTaxSaved - costs),
    worthIt: futureTaxSaved > costs,
  };
}

export interface SpreadRow {
  years: number;
  perYear: number;
  totalTax: number;
  saving: number;
}

/** Een grote latente winst in 1 keer vs. gespreid over n jaren (zelfde koers, geen andere winsten). */
export function spreadTable(totalGain: number, exemption: number, taxRate: number, maxYears = 5): SpreadRow[] {
  const rows: SpreadRow[] = [];
  const once = Math.max(0, totalGain - exemption) * (taxRate / 100);
  for (let n = 1; n <= maxYears; n++) {
    const per = totalGain / n;
    const total = n * Math.max(0, per - exemption) * (taxRate / 100);
    rows.push({ years: n, perYear: round2(per), totalTax: round2(total), saving: round2(once - total) });
  }
  return rows;
}
