import { useMemo, useState } from 'react';
import type { Ctx } from '../App';
import { Card, Help, NumInput, Stat } from './ui';
import { fmtEUR, fmtEUR0, fmtNum, signClass } from '../format';
import { harvestSuggestion, simulateSale, spreadTable } from '../engine/planner';
import { exemptionForYear, lotSaleResult } from '../engine/tax';

export default function Planner(ctx: Ctx) {
  const { data, engine, holdings, today } = ctx;
  const year = Number(today.slice(0, 4));
  const y = engine.years.find((x) => x.year === year)!;
  const daysLeft = Math.ceil((new Date(`${year}-12-31`).getTime() - new Date(today).getTime()) / 86400000);
  const name = (id: string) => data.assets.find((a) => a.id === id)?.name ?? '?';
  const accName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '?';

  const harvest = useMemo(
    () =>
      holdings
        .map((h) => harvestSuggestion(data, h, y.exemptionRemaining, today))
        .filter((x): x is NonNullable<typeof x> => !!x)
        .sort((a, b) => b.netBenefit - a.netBenefit),
    [holdings, data, y.exemptionRemaining, today],
  );
  const lossCandidates = holdings.filter((h) => (h.latentResult ?? 0) < -1);
  const shield = holdings.filter((h) => h.hasHistoricalShield && h.marketValue !== undefined);

  return (
    <div className="stack">
      <div className="stats">
        <Stat label={`Vrijstelling ${year} nog over`} value={fmtEUR0(y.exemptionRemaining)} tone="accent" sub={`${daysLeft} dagen tot 31/12`} />
        <Stat label="Al belastbaar dit jaar" value={fmtEUR0(y.taxable)} sub={`belasting ${fmtEUR(y.tax)}`} tone={y.taxable > 0 ? 'neg' : ''} />
        <Stat label="Onbenut naar volgend jaar" value={fmtEUR0(y.carriedForward)} sub={`max. ${fmtEUR0(data.settings.carryPerYear)} schuift door (5 jaar geldig)`} />
      </div>

      <Card title="1 · Vrijstelling opgebruiken: verkopen en meteen terugkopen">
        <p>
          Winst binnen je vrijstelling is belastingvrij. Verkoop je en koop je meteen terug, dan stijgt je fiscale aankoopprijs zonder dat
          je belasting betaalt; later betaal je dus minder. Onbenutte vrijstelling gaat grotendeels verloren (slechts {fmtEUR0(data.settings.carryPerYear)} schuift door). Doe dit liefst
          in december, als je weet wat je dat jaar nog verkoopt.
        </p>
        {y.exemptionRemaining <= 0 ? (
          <p className="muted">Je vrijstelling voor {year} is al opgebruikt.</p>
        ) : harvest.length === 0 ? (
          <p className="muted">Geen posities met latente winst (of koersen ontbreken).</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Effect</th>
                  <th className="r">Verkoop + terugkoop</th>
                  <th className="r">Belastingvrije winst</th>
                  <th className="r">Kosten (TOB×2, orders, spread)</th>
                  <th className="r">Later bespaard</th>
                  <th>Oordeel</th>
                </tr>
              </thead>
              <tbody>
                {harvest.map((s) => (
                  <tr key={s.holding.key}>
                    <td>
                      {name(s.holding.assetId)}
                      <div className="muted small">{accName(s.holding.accountId)}</div>
                    </td>
                    <td className="r">
                      {fmtNum(Math.floor(s.quantity * 1e4) / 1e4)} st.
                      <div className="muted small">≈ {fmtEUR0(s.saleAmount)}</div>
                    </td>
                    <td className="r pos">{fmtEUR(s.gainRealized)}</td>
                    <td className="r">{fmtEUR(s.costs)}</td>
                    <td className="r">{fmtEUR(s.futureTaxSaved)}</td>
                    <td>{s.worthIt ? <span className="pill ok">loont</span> : <span className="pill no">kosten te hoog</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          Per rij afzonderlijk berekend (de vrijstelling kan je maar één keer gebruiken). “Later bespaard” is de belasting die je bespaart als je
          later boven je vrijstelling verkoopt. Rond het aantal stuks af naar beneden. Gebruik je een Belgische bank, dan houdt die 10% in;
          die krijg je terug via je aangifte.
        </p>
        <Help title="Is verkopen en terugkopen toegestaan?">
          België kent geen specifieke ‘wash sale’-regel zoals de VS. De algemene antimisbruikbepaling bestaat wel; binnen je jaarlijkse
          vrijstelling wordt dit doorgaans als normaal beheer gezien, maar laat je bij twijfel adviseren. Bij koersbewegingen tussen verkoop en
          terugkoop loop je kort marktrisico.
        </Help>
      </Card>

      {y.taxable > 0 && (
        <Card title="2 · Belastbare winst verlagen met verliezen">
          <p>
            Je zit dit jaar {fmtEUR0(y.taxable)} boven je vrijstelling. Minderwaarden uit hetzelfde jaar mag je aftrekken; ze schuiven niet door naar
            volgend jaar.
          </p>
          {lossCandidates.length === 0 ? (
            <p className="muted">Geen posities met latent verlies.</p>
          ) : (
            <ul className="list">
              {lossCandidates.map((h) => {
                const usable = Math.min(-(h.latentResult ?? 0), y.taxable);
                return (
                  <li key={h.key}>
                    <strong>{name(h.assetId)}</strong> ({accName(h.accountId)}): latent verlies {fmtEUR(h.latentResult)} → bespaart tot{' '}
                    <strong>{fmtEUR(usable * (data.settings.taxRate / 100))}</strong> belasting als je vóór 31/12 verkoopt.
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {shield.length > 0 && (
        <Card title="3 · Historische aankoopprijs: verkopen vóór 31/12/2030?">
          <p>
            Voor deze posities ligt je oude aankoopprijs hoger dan de koers op 31/12/2025. Verkoop je ze uiterlijk op{' '}
            {data.settings.historicalCostDeadline.split('-').reverse().join('/')}, dan mag je die hogere prijs gebruiken.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Effect</th>
                  <th className="r">Meerwaarde nu (met 2030-regel)</th>
                  <th className="r">Zelfde koers na 2030</th>
                  <th className="r">Verschil in belasting</th>
                </tr>
              </thead>
              <tbody>
                {shield.map((h) => {
                  const price = data.assets.find((a) => a.id === h.assetId)!.currentPrice!;
                  const after = h.lots.reduce((s, l) => s + lotSaleResult(l, l.quantity, l.quantity * price, '2031-01-01', data.settings.historicalCostDeadline).result, 0);
                  return (
                    <tr key={h.key}>
                      <td>{name(h.assetId)}</td>
                      <td className={`r ${signClass(h.latentResult)}`}>{fmtEUR(h.latentResult)}</td>
                      <td className={`r ${signClass(after)}`}>{fmtEUR(after)}</td>
                      <td className="r">{fmtEUR((Math.max(0, after) - Math.max(0, h.latentResult ?? 0)) * (data.settings.taxRate / 100))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <SaleSimulator {...ctx} />
      <SpreadPlanner {...ctx} />
    </div>
  );
}

function SaleSimulator({ data, holdings, today }: Ctx) {
  const [key, setKey] = useState(holdings[0]?.key ?? '');
  const h = holdings.find((x) => x.key === key) ?? holdings[0];
  const asset = data.assets.find((a) => a.id === h?.assetId);
  const [qty, setQty] = useState<number | undefined>();
  const [price, setPrice] = useState<number | undefined>();
  const [date, setDate] = useState(today);
  const q = qty ?? h?.quantity;
  const p = price ?? asset?.currentPrice;
  const sim = h && q && p && date >= '2026-01-01' ? simulateSale(data, { accountId: h.accountId, assetId: h.assetId, quantity: Math.min(q, h.quantity), pricePerUnit: p, date }) : null;

  return (
    <Card title="4 · Verkoop simuleren">
      {holdings.length === 0 ? (
        <p className="muted">Geen posities.</p>
      ) : (
        <>
          <div className="form-grid">
            <label className="wide">
              Positie
              <select value={h?.key} onChange={(e) => { setKey(e.target.value); setQty(undefined); setPrice(undefined); }}>
                {holdings.map((x) => (
                  <option key={x.key} value={x.key}>
                    {data.assets.find((a) => a.id === x.assetId)?.name} · {data.accounts.find((a) => a.id === x.accountId)?.name} · {fmtNum(x.quantity)} st.
                  </option>
                ))}
              </select>
            </label>
            <label>
              Aantal
              <NumInput key={`q${h?.key}`} value={q} onChange={setQty} />
            </label>
            <label>
              Koers (€/stuk)
              <NumInput key={`p${h?.key}`} value={p} onChange={setPrice} placeholder="koers" />
            </label>
            <label>
              Datum
              <input type="date" value={date} min="2026-01-01" onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          {sim && (
            <div className="sim-out">
              <div>
                Opbrengst <strong>{fmtEUR((Math.min(q!, h.quantity)) * p!)}</strong>
              </div>
              <div>
                {sim.gain - sim.loss >= 0 ? 'Meerwaarde' : 'Minderwaarde'} <strong className={signClass(sim.gain - sim.loss)}>{fmtEUR(sim.gain - sim.loss)}</strong>
              </div>
              <div>
                Extra belasting {sim.year} <strong>{fmtEUR(sim.extraTax)}</strong>
              </div>
              <div>
                Vrijstelling daarna <strong>{fmtEUR(sim.after.exemptionRemaining)}</strong>
              </div>
              {sim.withheldByBank > 0 && (
                <div className="muted">
                  Je bank houdt ± {fmtEUR(sim.withheldByBank)} in; het verschil met {fmtEUR(sim.extraTax)} recupereer je via je aangifte.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function SpreadPlanner({ data, holdings, today }: Ctx) {
  const latentTotal = holdings.reduce((s, h) => s + Math.max(0, h.latentResult ?? 0), 0);
  const [gain, setGain] = useState<number | undefined>();
  const g = gain ?? Math.round(latentTotal);
  const ex = exemptionForYear(data.settings, Number(today.slice(0, 4)));
  const rows = spreadTable(g, ex, data.settings.taxRate);
  return (
    <Card title="5 · Grote winst in één keer of gespreid?">
      <p>
        Wil je een grote positie verkopen (bv. voor een huis)? Door de verkoop over meerdere kalenderjaren te spreiden, gebruik je elk jaar
        opnieuw je vrijstelling. Verkopen eind december en begin januari ligt maar enkele dagen uit elkaar, maar telt als twee jaren.
      </p>
      <label className="inline">
        Latente meerwaarde die je wil realiseren (€)
        <NumInput value={g} onChange={setGain} />
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Gespreid over</th>
              <th className="r">Winst per jaar</th>
              <th className="r">Belasting totaal</th>
              <th className="r">Besparing t.o.v. in één keer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.years}>
                <td>{r.years === 1 ? '1 jaar' : `${r.years} jaren`}</td>
                <td className="r">{fmtEUR0(r.perYear)}</td>
                <td className="r">{fmtEUR(r.totalTax)}</td>
                <td className="r pos">{r.saving > 0 ? fmtEUR(r.saving) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Vereenvoudigd: zelfde koers, geen andere verkopen, vrijstelling {fmtEUR0(ex)} per jaar zonder overdracht.</p>
    </Card>
  );
}
