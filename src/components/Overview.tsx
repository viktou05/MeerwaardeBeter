import type { Ctx } from '../App';
import { Card, Stat } from './ui';
import { fmtEUR, fmtEUR0, fmtNum, fmtDate, signClass } from '../format';

export default function Overview({ data, engine, holdings, today, go }: Ctx) {
  const year = Number(today.slice(0, 4));
  const y = engine.years.find((x) => x.year === year) ?? engine.years[engine.years.length - 1];
  const totalValue = holdings.reduce((s, h) => s + (h.marketValue ?? 0), 0);
  const latent = holdings.reduce((s, h) => s + (h.latentResult ?? 0), 0);
  const missingPrices = holdings.filter((h) => h.marketValue === undefined);
  const stalePrices = data.assets.filter(
    (a) => holdings.some((h) => h.assetId === a.id) && a.priceDate && daysBetween(a.priceDate, today) > 31,
  );
  const errors = engine.warnings.filter((w) => w.level === 'fout');
  const assetName = (id: string) => data.assets.find((a) => a.id === id)?.name ?? '?';
  const accName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '?';

  const steps = [
    { done: data.accounts.length > 0, label: 'Rekeningen aanmaken', tab: 'instellingen' as const },
    { done: data.startPositions.length > 0, label: 'Posities op 31/12/2025 ingeven', tab: 'start' as const },
    { done: data.transactions.length > 0, label: 'Aan- en verkopen sinds 2026 toevoegen (of importeren)', tab: 'transacties' as const },
    { done: holdings.length > 0 && missingPrices.length === 0, label: 'Huidige koersen invullen', tab: 'koersen' as const },
  ];
  const allDone = steps.every((s) => s.done);

  return (
    <div className="stack">
      {!allDone && (
        <Card title="Zo zet je alles klaar">
          <ol className="steps">
            {steps.map((s) => (
              <li key={s.label} className={s.done ? 'done' : ''}>
                <button className="link" onClick={() => go(s.tab)}>
                  {s.done ? '✓ ' : ''}
                  {s.label}
                </button>
              </li>
            ))}
          </ol>
          <p className="muted small">Tip: in Instellingen kan je demogegevens laden om eerst rond te kijken.</p>
        </Card>
      )}

      <div className="stats">
        <Stat label={`Gerealiseerde meerwaarde ${y.year}`} value={fmtEUR(y.gains - y.losses)} sub={`winst ${fmtEUR0(y.gains)} · verlies ${fmtEUR0(y.losses)}`} />
        <Stat label="Vrijstelling nog over" value={fmtEUR(y.exemptionRemaining)} sub={`van ${fmtEUR0(y.exemptionAvailable)}${y.carryAvailable ? ` (incl. ${fmtEUR0(y.carryAvailable)} overgedragen)` : ''}`} tone="accent" />
        <Stat label={`Geschatte belasting ${y.year}`} value={fmtEUR(y.tax)} sub={y.withheld ? `al ingehouden: ${fmtEUR(y.withheld)}` : 'nog niets ingehouden'} tone={y.tax > 0 ? 'neg' : ''} />
        <Stat
          label={y.balance < 0 ? 'Terug te vragen via aangifte' : 'Nog te betalen via aangifte'}
          value={fmtEUR(Math.abs(y.balance))}
          tone={y.balance < 0 ? 'pos' : y.balance > 0 ? 'neg' : ''}
          sub={y.balance < 0 ? 'bank hield meer in dan verschuldigd' : undefined}
        />
      </div>

      {(errors.length > 0 || missingPrices.length > 0 || stalePrices.length > 0) && (
        <Card title="Aandachtspunten" className="warn">
          <ul className="list">
            {errors.slice(0, 6).map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
            {errors.length > 6 && <li>… en nog {errors.length - 6} meldingen (zie Aangifte).</li>}
            {missingPrices.length > 0 && (
              <li>
                Geen huidige koers voor {missingPrices.map((h) => assetName(h.assetId)).join(', ')}.{' '}
                <button className="link" onClick={() => go('koersen')}>Koersen invullen</button>
              </li>
            )}
            {stalePrices.length > 0 && <li>Koersen ouder dan een maand: {stalePrices.map((a) => a.name).join(', ')}.</li>}
          </ul>
        </Card>
      )}

      <Card
        title="Wat je nu bezit"
        actions={
          <span className="muted small">
            Waarde {fmtEUR0(totalValue)} · latent <span className={signClass(latent)}>{fmtEUR0(latent)}</span>
          </span>
        }
      >
        {holdings.length === 0 ? (
          <p className="muted">Nog geen posities. Begin bij “Posities 31/12/2025”.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Effect</th>
                  <th>Rekening</th>
                  <th className="r">Aantal</th>
                  <th className="r">Fiscale basis</th>
                  <th className="r">Waarde nu</th>
                  <th className="r">Latente meerwaarde</th>
                  <th className="r">Belasting bij verkoop*</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const a = data.assets.find((x) => x.id === h.assetId);
                  return (
                    <tr key={h.key}>
                      <td>
                        {a?.name}
                        {h.hasHistoricalShield && <span className="tag" title="Historische aankoopprijs hoger dan 31/12/2025: verkoop vóór 31/12/2030 kan voordeliger zijn">2030</span>}
                        <div className="muted small">{[a?.ticker, a?.isin].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td>{accName(h.accountId)}</td>
                      <td className="r">{fmtNum(h.quantity)}</td>
                      <td className="r">{fmtEUR(h.fiscalBasis)}</td>
                      <td className="r">
                        {fmtEUR(h.marketValue)}
                        {a?.priceDate && <div className="muted small">{fmtDate(a.priceDate)}</div>}
                      </td>
                      <td className={`r ${signClass(h.latentResult)}`}>{fmtEUR(h.latentResult)}</td>
                      <td className="r">{h.latentResult !== undefined ? fmtEUR(Math.max(0, h.latentResult) * (data.settings.taxRate / 100)) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">* Zonder vrijstelling, per positie. Wat je echt betaalt hangt af van je resterende vrijstelling: zie de Planner.</p>
      </Card>
    </div>
  );
}

function daysBetween(a: string, b: string) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}
