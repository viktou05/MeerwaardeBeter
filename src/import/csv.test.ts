import { describe, it, expect } from 'vitest';
import { parseNumber, parseDate } from './csv';
import { parseImportText } from './convert';

describe('getallen en datums', () => {
  it('Europese en Amerikaanse notatie', () => {
    expect(parseNumber('1.234,56')).toBeCloseTo(1234.56);
    expect(parseNumber('1,234.56')).toBeCloseTo(1234.56);
    expect(parseNumber('-12,5')).toBeCloseTo(-12.5);
    expect(parseNumber('€ 3 000')).toBe(3000);
    expect(parseNumber('(45,10)')).toBeCloseTo(-45.1);
  });
  it('datums', () => {
    expect(parseDate('03-02-2026')).toBe('2026-02-03');
    expect(parseDate('2026-02-03, 09:30:00')).toBe('2026-02-03');
    expect(parseDate('3/2/26')).toBe('2026-02-03');
  });
});

describe('import', () => {
  it('DEGIRO Transactions.csv', () => {
    const csv = `Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde,,Wisselkoers,Transactiekosten en/of,,Totaal,,Order ID
12-03-2026,10:01,ISHARES CORE MSCI WORLD,IE00B4L5Y983,EAM,XAMS,10,"95,20",EUR,"-952,00",EUR,"-952,00",EUR,,"-1,00",EUR,"-953,00",EUR,abc
20-05-2026,11:00,APPLE INC,US0378331005,NDQ,XNAS,-5,"210,00",USD,"1050,00",USD,"968,50",EUR,"1,0841","-2,00",EUR,"966,50",EUR,def`;
    const p = parseImportText(csv);
    expect(p.trades).toHaveLength(2);
    expect(p.trades[0]).toMatchObject({ type: 'koop', isin: 'IE00B4L5Y983', quantity: 10, date: '2026-03-12' });
    expect(p.trades[0].amountEUR).toBeCloseTo(952);
    expect(p.trades[0].costs).toBeCloseTo(1);
    expect(p.trades[1].type).toBe('verkoop');
    expect(p.trades[1].amountEUR).toBeCloseTo(968.5);
  });
  it('geplakte tabel uit Excel (tabs, Nederlandse koppen)', () => {
    const txt = `Datum\tType\tNaam\tAantal\tBedrag EUR\n01/04/2026\tVerkoop\tBitcoin\t0,1\t6.500,00`;
    const p = parseImportText(txt);
    expect(p.trades[0]).toMatchObject({ type: 'verkoop', name: 'Bitcoin', quantity: 0.1, amountEUR: 6500 });
  });
  it('IBKR/MEXEM activity statement met open posities op 31/12/2025', () => {
    const txt = `Statement,Header,Field Name,Field Value
Statement,Data,Period,"January 1, 2025 - December 31, 2025"
Financial Instrument Information,Header,Asset Category,Symbol,Description,Conid,Security ID,Underlying,Listing Exch,Multiplier,Type,Code
Financial Instrument Information,Data,Stocks,IMIE,SPDR ACWI IMI,89384965,IE00B3YLTY66,,IBIS2,1,ETF,
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,EUR,IMIE,"2025-07-01, 03:54:19",-38,221.6,221.7,8420.8,-16.8228,-7416.96171,987.015491,-3.8,C;P
Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code
Open Positions,Data,Summary,Stocks,EUR,IMIE,12,1,190,2280,240.5,2886,606,`;
    const p = parseImportText(txt);
    expect(p.kind).toBe('ibkr');
    expect(p.trades[0]).toMatchObject({ type: 'verkoop', quantity: 38, isin: 'IE00B3YLTY66' });
    expect(p.startPositions[0]).toMatchObject({ quantity: 12, pricePerUnitEUR: 240.5, historicalCostEUR: 2280 });
  });
});
