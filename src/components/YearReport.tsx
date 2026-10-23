import { useState } from 'react';
import type { Ctx } from '../App';
import { Card, Help } from './ui';
import { fmtEUR, fmtNum, fmtDate, signClass } from '../format';

export default function YearReport({ data, engine, today }: Ctx) {
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const y = engine.years.find((x) => x.year === year) ?? engine.years[0];
  const name = (id: string) => data.assets.find((a) => a.id === id)?.name ?? '?';
  const asset = (id: string) => data.assets.find((a) => a.id === id);
  const acc = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '?';

  const exportCsv = () => {
    const head = ['Datum', 'Rekening', 'Effect', 'ISIN', 'Aantal', 'Verkoopprijs EUR', 'Aanschaffingswaarde EUR', 'Meerwaarde EUR', 'Minderwaarde EUR', 'Ingehouden EUR'];
    const lines = y.sales.map((s) =>
      [s.date, acc(s.accountId), name(s.assetId), asset(s.assetId)?.isin ?? '', s.quantity, s.proceeds.toFixed(2), s.basis.toFixed(2), s.gain.toFixed(2), s.loss.toFixed(2), s.withheld.toFixed(2)]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(';'),
    );
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `meerwaarden-${year}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="stack">
      <Card
        title={`Inkomstenjaar ${y.year} (aanslagjaar ${y.year + 1})`}
        actions={
          <>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Jaar">
              {engine.years.map((x) => (
                <option key={x.year}>{x.year}</option>
              ))}
            </select>
            <button className="secondary" onClick={exportCsv} disabled={y.sales.length === 0}>
              Exporteer CSV
            </button>
          </>
        }
      >
        <table className="summary">
          <tbody>
            <tr><td>Gerealiseerde meerwaarden</td><td className="r">{fmtEUR(y.gains)}</td></tr>
            <tr><td>Gerealiseerde minderwaarden (zelfde jaar)</td><td className="r">− {fmtEUR(y.losses)}</td></tr>
            <tr className="sep"><td>Netto meerwaarde</td><td className="r">{fmtEUR(y.net)}</td></tr>
            <tr><td>Basisvrijstelling</td><td className="r">{fmtEUR(y.baseExemption)}</td></tr>
            <tr><td>Overgedragen vrijstelling vorige jaren</td><td className="r">{fmtEUR(y.carryAvailable)}</td></tr>
            <tr><td>Gebruikte vrijstelling</td><td className="r">− {fmtEUR(y.exemptionUsed)}</td></tr>
            <tr className="sep"><td>Belastbare meerwaarde</td><td className="r">{fmtEUR(y.taxable)}</td></tr>
            <tr><td>Belasting ({data.settings.taxRate}%)</td><td className="r"><strong>{fmtEUR(y.tax)}</strong></td></tr>
            <tr><td>Al ingehouden door Belgische bank(en)</td><td className="r">− {fmtEUR(y.withheld)}</td></tr>
            <tr className="sep"><td>{y.balance < 0 ? 'Terug te krijgen' : 'Nog te betalen'}</td><td className={`r ${y.balance < 0 ? 'pos' : y.balance > 0 ? 'neg' : ''}`}><strong>{fmtEUR(Math.abs(y.balance))}</strong></td></tr>
            <tr><td>Onbenutte vrijstelling die doorschuift</td><td className="r">{fmtEUR(y.carriedForward)}</td></tr>
          </tbody>
        </table>
        <Help title="Moet ik aangifte doen?">
          Ja als je verkocht via een buitenlandse broker (DEGIRO, IBKR/MEXEM, Trade Republic…), crypto verkocht, of bij je Belgische bank een
          opt-out deed. Ook als je bank voorheffing inhield maar je recht hebt op de vrijstelling of minderwaarden hebt, loont het om aangifte
          te doen: dan krijg je het teveel betaalde terug. Bewaar je borderellen en het overzicht op 31/12/2025 als bewijs.
        </Help>
      </Card>

      <Card title={`Verkopen in ${y.year} (${y.sales.length})`}>
        {y.sales.length === 0 ? (
          <p className="muted">Geen verkopen in dit jaar.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Effect</th>
                  <th className="r">Aantal</th>
                  <th className="r">Verkoopprijs</th>
                  <th className="r">Aanschaffingswaarde</th>
                  <th className="r">Resultaat</th>
                  <th>FIFO-detail</th>
                </tr>
              </thead>
              <tbody>
                {y.sales.map((s) => (
                  <tr key={s.txId} className={s.unmatchedQuantity ? 'row-error' : ''}>
                    <td>{fmtDate(s.date)}</td>
                    <td>
                      {name(s.assetId)}
                      <div className="muted small">{acc(s.accountId)}</div>
                    </td>
                    <td className="r">{fmtNum(s.quantity)}</td>
                    <td className="r">{fmtEUR(s.proceeds)}</td>
                    <td className="r">{fmtEUR(s.basis)}</td>
                    <td className={`r ${signClass(s.gain - s.loss)}`}>{fmtEUR(s.gain - s.loss)}</td>
                    <td className="small">
                      {s.matches.map((m, i) => (
                        <div key={i}>
                          {fmtNum(m.quantity)} st. uit {m.acquisitionDate === '2025-12-31' ? 'positie 31/12/2025' : m.acquisitionDate === '?' ? '— niet gevonden' : `aankoop ${fmtDate(m.acquisitionDate)}`}
                          {m.rule === 'historisch-hoger' && ' · historische prijs'}
                          {m.rule === 'historisch-nul' && ' · historische prijs → 0'}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {engine.warnings.length > 0 && (
        <Card title="Controles">
          <ul className="list">
            {engine.warnings.map((w, i) => (
              <li key={i} className={w.level === 'fout' ? 'neg' : ''}>
                <strong>{w.level}</strong>: {w.message}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
