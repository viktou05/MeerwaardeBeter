import { describe, it, expect } from 'vitest';
import { runEngine, holdingsFrom } from './tax';
import { simulateSale, harvestSuggestion, spreadTable, tobFor } from './planner';
import { emptyData, type AppData, type Transaction } from './types';

function base(): AppData {
  const d = emptyData();
  d.accounts = [
    { id: 'A', name: 'Bolero', withholds: true },
    { id: 'B', name: 'DEGIRO', withholds: false },
  ];
  d.assets = [
    { id: 'iwda', name: 'iShares MSCI World', isin: 'IE00B4L5Y983', type: 'ETF', tobRate: 0.12 },
    { id: 'aapl', name: 'Apple', isin: 'US0378331005', type: 'Aandeel', tobRate: 0.35 },
  ];
  return d;
}
let n = 0;
const tx = (p: Partial<Transaction>): Transaction => ({
  id: `t${++n}`, date: '2026-05-01', type: 'verkoop', accountId: 'A', assetId: 'iwda', quantity: 1, amountEUR: 0, ...p,
});

describe('basisregels', () => {
  it('winst t.o.v. waarde 31/12/2025, kosten niet aftrekbaar', () => {
    const d = base();
    d.startPositions = [{ id: 's1', accountId: 'A', assetId: 'iwda', quantity: 100, value20251231PerUnit: 100 }];
    d.transactions = [tx({ quantity: 40, amountEUR: 4800, costsEUR: 10 })];
    const r = runEngine(d);
    expect(r.sales[0].gain).toBeCloseTo(800);
    const y = r.years.find((x) => x.year === 2026)!;
    expect(y.tax).toBe(0); // binnen vrijstelling
    expect(y.exemptionRemaining).toBeCloseTo(9200);
    expect(r.lots[0].quantity).toBeCloseTo(60);
  });

  it('FIFO: oudste lot eerst', () => {
    const d = base();
    d.startPositions = [{ id: 's1', accountId: 'A', assetId: 'iwda', quantity: 10, value20251231PerUnit: 100 }];
    d.transactions = [
      tx({ type: 'koop', date: '2026-02-01', quantity: 10, amountEUR: 1500 }),
      tx({ date: '2026-06-01', quantity: 15, amountEUR: 3000 }), // 200/stuk
    ];
    const r = runEngine(d);
    // 10 x (200-100) + 5 x (200-150) = 1000 + 250
    expect(r.sales[0].gain).toBeCloseTo(1250);
    expect(r.lots[0].quantity).toBeCloseTo(5);
    expect(r.lots[0].basisPerUnit).toBeCloseTo(150);
  });

  it('boven vrijstelling: 10% belasting en vergelijking met inhouding', () => {
    const d = base();
    d.startPositions = [{ id: 's1', accountId: 'A', assetId: 'iwda', quantity: 100, value20251231PerUnit: 100 }];
    d.transactions = [tx({ quantity: 100, amountEUR: 25000, withheldEUR: 1500 })];
    const y = runEngine(d).years.find((x) => x.year === 2026)!;
    expect(y.net).toBeCloseTo(15000);
    expect(y.taxable).toBeCloseTo(5000);
    expect(y.tax).toBeCloseTo(500);
    expect(y.balance).toBeCloseTo(-1000); // 1000 terug te vragen
  });

  it('minderwaarden enkel in hetzelfde jaar', () => {
    const d = base();
    d.startPositions = [
      { id: 's1', accountId: 'A', assetId: 'iwda', quantity: 100, value20251231PerUnit: 100 },
      { id: 's2', accountId: 'B', assetId: 'aapl', quantity: 10, value20251231PerUnit: 200 },
    ];
    d.transactions = [
      tx({ date: '2026-03-01', assetId: 'aapl', accountId: 'B', quantity: 10, amountEUR: 1000 }), // -1000
      tx({ date: '2027-03-01', quantity: 100, amountEUR: 22000 }), // +12000 in 2027
    ];
    const r = runEngine(d);
    const y26 = r.years.find((x) => x.year === 2026)!;
    const y27 = r.years.find((x) => x.year === 2027)!;
    expect(y26.losses).toBeCloseTo(1000);
    expect(y26.net).toBe(0);
    expect(y27.net).toBeCloseTo(12000); // verlies 2026 niet overgedragen
  });
});

describe('historische aanschaffingswaarde (tot 31/12/2030)', () => {
  const mk = (sale: number, date = '2026-05-01') => {
    const d = base();
    d.startPositions = [
      { id: 's1', accountId: 'A', assetId: 'aapl', quantity: 10, value20251231PerUnit: 100, historicalCostTotal: 1500 },
    ];
    d.transactions = [tx({ assetId: 'aapl', quantity: 10, amountEUR: sale, date })];
    return runEngine(d).sales[0];
  };
  it('verkoop boven historische prijs: winst t.o.v. historische prijs', () => {
    const s = mk(1800);
    expect(s.gain).toBeCloseTo(300);
    expect(s.matches[0].rule).toBe('historisch-hoger');
  });
  it('verkoop tussen waarde 31/12 en historische prijs: winst 0, geen verlies', () => {
    const s = mk(1200);
    expect(s.gain).toBe(0);
    expect(s.loss).toBe(0);
  });
  it('verkoop onder waarde 31/12: verlies t.o.v. waarde 31/12', () => {
    const s = mk(800);
    expect(s.loss).toBeCloseTo(200);
  });
  it('na 2030 geldt enkel de waarde op 31/12/2025', () => {
    const s = mk(1800, '2031-02-01');
    expect(s.gain).toBeCloseTo(800);
  });
});

describe('vrijstelling overdragen', () => {
  it('onbenut deel (max 1000/jaar) schuift door, vervalt na 5 jaar', () => {
    const d = base();
    d.startPositions = [{ id: 's1', accountId: 'A', assetId: 'iwda', quantity: 1000, value20251231PerUnit: 100 }];
    // 2026: 9500 winst -> 500 over. 2027: niets -> 1000 over. 2028: 12000 winst
    d.transactions = [
      tx({ date: '2026-06-01', quantity: 95, amountEUR: 95 * 200 }),
      tx({ date: '2028-06-01', quantity: 120, amountEUR: 120 * 200 }),
    ];
    const r = runEngine(d);
    const y26 = r.years.find((x) => x.year === 2026)!;
    const y28 = r.years.find((x) => x.year === 2028)!;
    expect(y26.carriedForward).toBeCloseTo(500);
    expect(y28.carryAvailable).toBeCloseTo(1500);
    expect(y28.exemptionAvailable).toBeCloseTo(11500);
    expect(y28.taxable).toBeCloseTo(500);
    expect(y28.tax).toBeCloseTo(50);
  });
  it('maximaal 15.000 vrijstelling na 5 jaar niets verkopen', () => {
    const d = base();
    d.startPositions = [{ id: 's1', accountId: 'A', assetId: 'iwda', quantity: 1000, value20251231PerUnit: 100 }];
    d.transactions = [tx({ date: '2033-06-01', quantity: 200, amountEUR: 200 * 200 })];
    const y = runEngine(d).years.find((x) => x.year === 2033)!;
    expect(y.exemptionAvailable).toBeCloseTo(15000);
  });
});

describe('transfers en ontbrekende data', () => {
  it('transfer tussen eigen rekeningen is niet belastbaar en behoudt de basis', () => {
    const d = base();
    d.settings.fifoScope = 'rekening';
    d.startPositions = [{ id: 's1', accountId: 'A', assetId: 'iwda', quantity: 10, value20251231PerUnit: 100 }];
    d.transactions = [
      tx({ type: 'transfer', date: '2026-02-01', quantity: 10, toAccountId: 'B' }),
      tx({ date: '2026-03-01', accountId: 'B', quantity: 10, amountEUR: 1200 }),
    ];
    const r = runEngine(d);
    expect(r.sales[0].gain).toBeCloseTo(200);
    expect(r.warnings.filter((w) => w.level === 'fout')).toHaveLength(0);
  });
  it('verkoop zonder lot geeft foutmelding en telt voorzichtig als winst', () => {
    const d = base();
    d.transactions = [tx({ quantity: 5, amountEUR: 500 })];
    const r = runEngine(d);
    expect(r.sales[0].unmatchedQuantity).toBe(5);
    expect(r.sales[0].gain).toBeCloseTo(500);
    expect(r.warnings.some((w) => w.level === 'fout')).toBe(true);
  });
  it('FIFO over alle rekeningen vs. per rekening', () => {
    const d = base();
    d.startPositions = [{ id: 's1', accountId: 'A', assetId: 'iwda', quantity: 10, value20251231PerUnit: 100 }];
    d.transactions = [
      tx({ type: 'koop', accountId: 'B', date: '2026-02-01', quantity: 10, amountEUR: 1500 }),
      tx({ accountId: 'B', date: '2026-06-01', quantity: 10, amountEUR: 1600 }),
    ];
    // Over alle rekeningen: het oudste lot (rekening A, basis 100) wordt eerst verkocht.
    expect(runEngine(d).sales[0].gain).toBeCloseTo(600);
    // Per rekening: enkel de aankoop op rekening B (basis 150) telt.
    d.settings.fifoScope = 'rekening';
    expect(runEngine(d).sales[0].gain).toBeCloseTo(100);
  });
  it('aankoop en verkoop op dezelfde dag: eerst de aankoop', () => {
    const d = base();
    d.transactions = [
      tx({ date: '2026-03-01', quantity: 5, amountEUR: 550 }),
      tx({ type: 'koop', date: '2026-03-01', quantity: 5, amountEUR: 500 }),
    ];
    const r = runEngine(d);
    expect(r.sales[0].unmatchedQuantity).toBe(0);
    expect(r.sales[0].gain).toBeCloseTo(50);
  });
  it('transacties van vóór 2026 worden genegeerd met uitleg', () => {
    const d = base();
    d.transactions = [tx({ type: 'koop', date: '2025-06-01', quantity: 5, amountEUR: 500 })];
    const r = runEngine(d);
    expect(r.lots).toHaveLength(0);
    expect(r.warnings[0].level).toBe('info');
  });
});

describe('planner', () => {
  it('simulatie geeft extra belasting en inhouding door Belgische bank', () => {
    const d = base();
    d.startPositions = [{ id: 's1', accountId: 'A', assetId: 'iwda', quantity: 100, value20251231PerUnit: 100 }];
    d.transactions = [tx({ quantity: 50, amountEUR: 50 * 300 })]; // 10000 winst
    const s = simulateSale(d, { accountId: 'A', assetId: 'iwda', quantity: 10, pricePerUnit: 300, date: '2026-11-01' });
    expect(s.gain).toBeCloseTo(2000);
    expect(s.extraTax).toBeCloseTo(200);
    expect(s.withheldByBank).toBeCloseTo(200);
  });
  it('harvest: verkoop net genoeg om de vrijstelling op te gebruiken', () => {
    const d = base();
    d.assets[0].currentPrice = 150;
    d.startPositions = [{ id: 's1', accountId: 'A', assetId: 'iwda', quantity: 1000, value20251231PerUnit: 100 }];
    const r = runEngine(d);
    const h = holdingsFrom(d, r.lots, '2026-10-01')[0];
    const s = harvestSuggestion(d, h, 10000, '2026-10-01')!;
    expect(s.quantity).toBeCloseTo(200);
    expect(s.gainRealized).toBeCloseTo(10000);
    expect(s.futureTaxSaved).toBeCloseTo(1000);
    expect(s.worthIt).toBe(true);
  });
  it('spreiden over jaren', () => {
    const rows = spreadTable(30000, 10000, 10);
    expect(rows[0].totalTax).toBeCloseTo(2000);
    expect(rows[2].totalTax).toBeCloseTo(0);
  });
  it('TOB met plafond', () => {
    expect(tobFor(10000, 0.35)).toBeCloseTo(35);
    expect(tobFor(2_000_000, 0.12)).toBe(1300);
  });
});
