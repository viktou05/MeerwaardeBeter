import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { parseImportText } from './convert';
import { matchAccount } from './brokers';
import { parseNumber, parseDate, currencyOf } from './csv';
import { readXlsx, rowsToTsv, excelSerialToDate } from './xlsx';

const active = (p: ReturnType<typeof parseImportText>) => p.trades.filter((t) => t.type !== 'negeer');

describe('getallen, munten en datums uit exports', () => {
  it('bedragen met muntcode of -symbool', () => {
    expect(parseNumber('USD 150.25')).toBeCloseTo(150.25);
    expect(parseNumber('€1,234.56')).toBeCloseTo(1234.56);
    expect(parseNumber('($1,234.50)')).toBeCloseTo(-1234.5);
    expect(parseNumber('-€12.30')).toBeCloseTo(-12.3);
    expect(parseNumber('12,5 GBP')).toBeCloseTo(12.5);
    expect(parseNumber('+3')).toBe(3);
  });
  it('vaste decimaalnotatie', () => {
    expect(parseNumber('1,000', '.')).toBe(1000); // Amerikaans: duizend
    expect(parseNumber('1,000')).toBe(1); // Belgisch: één komma nul
    expect(parseNumber('1.000', ',')).toBe(1000);
  });
  it('munt herkennen', () => {
    expect(currencyOf('USD 150.25')).toBe('USD');
    expect(currencyOf('€62,000.00')).toBe('EUR');
    expect(currencyOf('$5')).toBe('USD');
    expect(currencyOf('150')).toBeUndefined();
  });
  it('datums', () => {
    expect(parseDate('3/4/2026', { us: true })).toBe('2026-03-04');
    expect(parseDate('3/4/2026')).toBe('2026-04-03');
    expect(parseDate('20260304')).toBe('2026-03-04');
    expect(parseDate('20260304;153000')).toBe('2026-03-04');
    expect(parseDate('Mar 4, 2026, 2:30:12 PM')).toBe('2026-03-04');
    expect(parseDate('4 mrt. 2026')).toBe('2026-03-04');
    expect(parseDate('12 juil. 2026')).toBe('2026-07-12');
    expect(parseDate('2026-03-04T23:30:00.000Z')).toBe('2026-03-04');
    expect(parseDate('13/13/2026')).toBeUndefined();
  });
});

describe('DEGIRO', () => {
  it('Engelstalige export met AutoFX-kolom en USD', () => {
    const csv = `Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value,,Exchange rate,AutoFX Fee,Transaction and/or third party fees,,Total,,Order ID
04-03-2026,15:31,APPLE INC. - COMMON ST,US0378331005,NDQ,XNAS,-5,"210.00",USD,"1050.00",USD,"968.50",EUR,"1.0841","-2.42","-2.00",EUR,"964.08",EUR,abc-1
05-03-2026,09:05,VANGUARD FTSE ALL-WORLD,IE00BK5BQT80,EAM,XAMS,12,"120.10",EUR,"-1441.20",EUR,"-1441.20",EUR,,"0.00","-1.00",EUR,"-1442.20",EUR,abc-2`;
    const p = parseImportText(csv);
    expect(p.brokerId).toBe('degiro');
    expect(p.trades).toHaveLength(2);
    expect(p.trades[0]).toMatchObject({ type: 'verkoop', isin: 'US0378331005', quantity: 5, currency: 'EUR', date: '2026-03-04' });
    expect(p.trades[0].amountEUR).toBeCloseTo(968.5);
    expect(p.trades[0].costs).toBeCloseTo(4.42);
    expect(p.trades[1]).toMatchObject({ type: 'koop', quantity: 12, amountEUR: 1441.2, costs: 1 });
  });
});

describe('Revolut', () => {
  it('aandelen: trading statement', () => {
    const csv = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2026-02-02T14:30:12.123Z,,CASH TOP-UP,,,USD 1000,USD,1.08
2026-02-03T15:01:00.000Z,AAPL,BUY - MARKET,2.5,USD 200,USD 500,USD,1.08
2026-04-10T15:01:00.000Z,AAPL,SELL - LIMIT,1,USD 230,USD 230,USD,1.10
2026-05-01T10:00:00.000Z,AAPL,DIVIDEND,,,USD 1.2,USD,1.10
2026-06-01T10:00:00.000Z,ASML,BUY - MARKET,1,EUR 700,EUR 701,EUR,1`;
    const p = parseImportText(csv);
    expect(p.brokerId).toBe('revolut');
    const t = active(p);
    expect(t).toHaveLength(3);
    expect(t[0]).toMatchObject({ type: 'koop', ticker: 'AAPL', quantity: 2.5, amountLocal: 500, currency: 'USD', date: '2026-02-03' });
    expect(t[0].amountEUR).toBeUndefined(); // wordt aan ECB-koers omgerekend
    expect(t[1]).toMatchObject({ type: 'verkoop', quantity: 1, amountLocal: 230 });
    expect(t[2]).toMatchObject({ type: 'koop', ticker: 'ASML', amountEUR: 700, costs: 1 });
    expect(p.trades.filter((x) => x.type === 'negeer')).toHaveLength(2);
  });

  it('crypto: account statement', () => {
    const csv = `Symbol,Type,Quantity,Price,Value,Fees,Date
BTC,Buy,0.01,"€60,000.00",€600.00,€9.00,"Mar 4, 2026, 2:30:12 PM"
BTC,Sell,0.005,"€70,000.00",€350.00,€5.25,"Jun 1, 2026, 9:00:00 AM"
ETH,Stake,1,,,,"Jun 2, 2026, 9:00:00 AM"`;
    const p = parseImportText(csv);
    expect(p.brokerId).toBe('revolut');
    const t = active(p);
    expect(t[0]).toMatchObject({ type: 'koop', ticker: 'BTC', quantity: 0.01, amountEUR: 600, costs: 9, date: '2026-03-04' });
    expect(t[1]).toMatchObject({ type: 'verkoop', quantity: 0.005, amountEUR: 350, date: '2026-06-01' });
  });

  it('oud rekeningafschrift: enkel crypto-omwisselingen, gewone betalingen weggelaten', () => {
    const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Currency,Fiat amount,Fiat amount (inc. fees),Fee,Base currency,State,Balance
CARD_PAYMENT,Current,2026-03-01 10:00:00,2026-03-02 10:00:00,Delhaize,-25.30,EUR,-25.30,-25.30,0,EUR,COMPLETED,100
EXCHANGE,Current,2026-03-04 14:00:00,2026-03-04 14:00:01,Exchanged to BTC,0.002,BTC,120.00,121.80,1.80,EUR,COMPLETED,0.002
EXCHANGE,Current,2026-05-04 14:00:00,2026-05-04 14:00:01,Exchanged to EUR,-0.001,BTC,-70.00,-68.95,1.05,EUR,COMPLETED,0.001`;
    const p = parseImportText(csv);
    expect(p.brokerId).toBe('revolut');
    expect(p.trades).toHaveLength(2);
    expect(p.trades[0]).toMatchObject({ type: 'koop', ticker: 'BTC', quantity: 0.002, amountEUR: 120, costs: 1.8, date: '2026-03-04' });
    expect(p.trades[1]).toMatchObject({ type: 'verkoop', quantity: 0.001, amountEUR: 70 });
  });
});

describe('Bitvavo', () => {
  it('transactiegeschiedenis', () => {
    const csv = `Timezone,Date,Time,Type,Currency,Amount,Quote Currency,Quote Price,Received / Paid Currency,Received / Paid Amount,Fee currency,Fee amount,Status,Transaction ID,Address
Europe/Brussels,2026-01-15,10:00:00,deposit,EUR,500,,,,,,,Completed,t0,
Europe/Brussels,2026-01-15,10:05:00,buy,BTC,0.005,EUR,90000,EUR,-451.13,EUR,1.13,Completed,t1,
Europe/Brussels,2026-07-01,18:00:00,sell,BTC,-0.002,EUR,100000,EUR,199.50,EUR,0.50,Completed,t2,
Europe/Brussels,2026-07-02,18:00:00,staking,ETH,0.001,,,,,,,Completed,t3,
Europe/Brussels,2026-07-03,18:00:00,buy,ETH,1,EUR,3000,EUR,-3007.5,EUR,7.5,Canceled,t4,`;
    const p = parseImportText(csv);
    expect(p.brokerId).toBe('bitvavo');
    const t = active(p);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ type: 'koop', ticker: 'BTC', quantity: 0.005, amountEUR: 450, costs: 1.13, date: '2026-01-15' });
    expect(t[1]).toMatchObject({ type: 'verkoop', quantity: 0.002, amountEUR: 200, costs: 0.5 });
  });
});

describe('Coinbase', () => {
  it('transaction history met inleidende regels en omruiling', () => {
    const csv = `Transactions
User,Thomas,abc

ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes
1,2026-02-01 10:00:00 UTC,Buy,ETH,0.5,EUR,€2000.00,€1000.00,€1014.90,€14.90,Bought 0.5 ETH for €1014.90 EUR
2,2026-03-01 10:00:00 UTC,Convert,ETH,-0.1,EUR,€2500.00,€250.00,€250.00,€0.00,Converted 0.1 ETH to 249.5 USDC
3,2026-04-01 10:00:00 UTC,Advanced Trade Sell,ETH,-0.2,EUR,€3000.00,€600.00,€597.00,€3.00,
4,2026-04-02 10:00:00 UTC,Staking Income,ETH,0.001,EUR,€3000.00,€3.00,€3.00,€0.00,`;
    const p = parseImportText(csv);
    expect(p.brokerId).toBe('coinbase');
    const t = active(p);
    expect(t).toHaveLength(4);
    expect(t[0]).toMatchObject({ type: 'koop', ticker: 'ETH', quantity: 0.5, amountEUR: 1000, costs: 14.9, date: '2026-02-01' });
    expect(t[1]).toMatchObject({ type: 'verkoop', ticker: 'ETH', quantity: 0.1, amountEUR: 250 });
    expect(t[2]).toMatchObject({ type: 'koop', ticker: 'USDC', quantity: 249.5, amountEUR: 250 });
    expect(t[1].issues.join()).toMatch(/omgeruild/);
    expect(t[3]).toMatchObject({ type: 'verkoop', quantity: 0.2, amountEUR: 600, costs: 3 });
  });
});

describe('Robinhood', () => {
  it('activity report met Amerikaanse datums en bedragen', () => {
    const csv = `"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"
"3/4/2026","3/4/2026","3/5/2026","NVDA","NVIDIA
CUSIP: 67066G104","Buy","1,000","$120.50","($120,500.00)"
"6/10/2026","6/10/2026","6/11/2026","NVDA","NVIDIA
CUSIP: 67066G104","Sell","400","$150.00","$60,000.00"
"6/15/2026","6/15/2026","6/15/2026","NVDA","Cash Div: R/D 2026-06-01","CDIV","","","$4.00"`;
    const p = parseImportText(csv);
    expect(p.brokerId).toBe('robinhood');
    const t = active(p);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ type: 'koop', ticker: 'NVDA', name: 'NVIDIA', quantity: 1000, amountLocal: 120500, currency: 'USD', date: '2026-03-04' });
    expect(t[1]).toMatchObject({ type: 'verkoop', quantity: 400, amountLocal: 60000, date: '2026-06-10' });
  });
});

describe('Interactive Brokers / MEXEM Flex Query', () => {
  it('trades met FX naar EUR', () => {
    const csv = `"TradeDate","Symbol","Description","ISIN","Buy/Sell","Quantity","TradePrice","Proceeds","IBCommission","CurrencyPrimary","FXRateToBase","AssetClass"
"20260304","VWCE","VANGUARD FTSE ALL-WORLD","IE00BK5BQT80","BUY","10","120","-1200","-1.25","EUR","1","STK"
"20260310","MSFT","MICROSOFT CORP","US5949181045","SELL","-3","400","1200","-1","USD","0.92","STK"
"20260311","SPY 260320C00500000","SPY CALL","","BUY","1","5","-500","-1","USD","0.92","OPT"`;
    const p = parseImportText(csv);
    expect(p.brokerId).toBe('ibkr');
    const t = active(p);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ type: 'koop', isin: 'IE00BK5BQT80', quantity: 10, amountEUR: 1200, costs: 1.25, date: '2026-03-04' });
    expect(t[1]).toMatchObject({ type: 'verkoop', quantity: 3, currency: 'USD', amountLocal: 1200 });
    expect(t[1].amountEUR).toBeCloseTo(1104);
  });
});

describe('Generiek (Curvo, MeDirect, eigen tabellen)', () => {
  it('Nederlandstalige tabel met puntkomma', () => {
    const csv = `Transactiedatum;Type;Fonds;ISIN;Aantal deelbewijzen;Prijs per aandeel;Bedrag
02/03/2026;Aankoop;Vanguard FTSE All-World;IE00BK5BQT80;3,5;120,00;420,00`;
    const p = parseImportText(csv);
    expect(p.kind).toBe('generiek');
    expect(p.trades[0]).toMatchObject({ type: 'koop', name: 'Vanguard FTSE All-World', isin: 'IE00BK5BQT80', quantity: 3.5, amountEUR: 420, date: '2026-03-02' });
  });
  it('Franstalige tabel', () => {
    const csv = `Date d'opération;Type d'opération;Libellé;Code ISIN;Quantité;Cours;Montant;Devise;Frais
15/04/2026;Vente;ISHARES CORE MSCI WORLD;IE00B4L5Y983;10;110,50;1105,00;EUR;7,50`;
    const p = parseImportText(csv);
    expect(p.trades[0]).toMatchObject({ type: 'verkoop', isin: 'IE00B4L5Y983', quantity: 10, amountEUR: 1105, costs: 7.5, date: '2026-04-15' });
  });
});

describe('rekening herkennen', () => {
  const accounts = [
    { id: '1', name: 'Mijn beleggingen', broker: 'DEGIRO' },
    { id: '2', name: 'Revolut crypto' },
    { id: '3', name: 'ING Zichtrekening' },
  ];
  it('op naam of brokerveld', () => {
    expect(matchAccount(accounts, 'degiro')?.id).toBe('1');
    expect(matchAccount(accounts, 'revolut')?.id).toBe('2');
    expect(matchAccount(accounts, 'ing')?.id).toBe('3');
    expect(matchAccount(accounts, 'bitvavo')).toBeUndefined();
    expect(matchAccount([{ id: 'x', name: 'Trading account' }], 'ing')).toBeUndefined(); // "ing" in "trading" telt niet
  });
});

/** Bouwt een minimaal .xlsx-bestand (ZIP met gecomprimeerde XML-bestanden), zoals Excel/Revolut het aanmaakt. */
function makeXlsx(files: Record<string, string>): ArrayBuffer {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = new Uint8Array(deflateRawSync(enc.encode(content)));
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, 8, true); // deflate
    local.setUint32(18, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(10, 8, true);
    cd.setUint32(20, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, Object.keys(files).length, true);
  eocd.setUint16(10, Object.keys(files).length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of all) {
    out.set(x, p);
    p += x.length;
  }
  return out.buffer;
}

const cellsXml = (cells: [string, string, string?][]) =>
  cells.map(([ref, v, attrs]) => `<c r="${ref}"${attrs ?? ''}>${v}</c>`).join('');

describe('Excel (.xlsx)', () => {
  it('leest het eerste werkblad, met gedeelde tekst en datums', async () => {
    const headers = ['Date', 'Ticker', 'Type', 'Quantity', 'Price per share', 'Total Amount', 'Currency', 'FX Rate'];
    const shared = [...headers, 'AAPL', 'BUY - MARKET', 'USD 200', 'USD 500', 'USD', 'SELL - LIMIT', 'USD 230', '2026-04-10T15:01:00.000Z', 'CASH TOP-UP', 'USD 1000'];
    const s = (t: string) => `<v>${shared.indexOf(t)}</v>`;
    const sheet = `<worksheet><sheetData>
      <row r="1">${cellsXml(headers.map((h, i) => [`${'ABCDEFGH'[i]}1`, s(h), ' t="s"']))}</row>
      <row r="2">${cellsXml([['C2', s('CASH TOP-UP'), ' t="s"'], ['F2', s('USD 1000'), ' t="s"']])}</row>
      <row r="3">${cellsXml([['A3', '<v>46056.626388889</v>', ' s="1"'], ['B3', s('AAPL'), ' t="s"'], ['C3', s('BUY - MARKET'), ' t="s"'], ['D3', '<v>2.5</v>'], ['E3', s('USD 200'), ' t="s"'], ['F3', s('USD 500'), ' t="s"'], ['G3', s('USD'), ' t="s"'], ['H3', '<v>1.08</v>']])}</row>
      <row r="4">${cellsXml([['A4', s('2026-04-10T15:01:00.000Z'), ' t="s"'], ['B4', '<is><t>AAPL</t></is>', ' t="inlineStr"'], ['C4', s('SELL - LIMIT'), ' t="s"'], ['D4', '<v>1</v>'], ['E4', s('USD 230'), ' t="s"'], ['F4', s('USD 230'), ' t="s"'], ['G4', s('USD'), ' t="s"']])}</row>
    </sheetData></worksheet>`;
    const buf = makeXlsx({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Statement" sheetId="1" r:id="rId1"/><sheet name="Andere" sheetId="2" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': `<sst>${shared.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`,
      'xl/styles.xml': '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="22"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml': sheet,
      'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>niet deze</t></is></c></row></sheetData></worksheet>',
    });
    const rows = await readXlsx(buf);
    expect(rows[0]).toEqual(headers);
    const p = parseImportText(rowsToTsv(rows), { delimiter: '\t' });
    expect(p.brokerId).toBe('revolut');
    const t = active(p);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ type: 'koop', ticker: 'AAPL', quantity: 2.5, amountLocal: 500, date: '2026-02-03' });
    expect(t[1]).toMatchObject({ type: 'verkoop', ticker: 'AAPL', date: '2026-04-10' });
  });
  it('Excel-serienummer naar datum', () => {
    expect(excelSerialToDate(46085)).toBe('2026-03-04');
  });
});
