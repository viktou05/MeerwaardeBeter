import type { Ctx } from '../App';
import { Card, NumInput } from './ui';
import { fmtDate, fmtEUR, fmtNum } from '../format';
import { TOB_PRESETS, type AssetType } from '../engine/types';

const TYPES: AssetType[] = ['ETF', 'Aandeel', 'Obligatie', 'Fonds', 'Crypto', 'Andere'];

export default function Prices({ data, update, holdings, today }: Ctx) {
  const held = new Map<string, number>();
  holdings.forEach((h) => held.set(h.assetId, (held.get(h.assetId) ?? 0) + h.quantity));
  const assets = [...data.assets].sort((a, b) => Number(held.has(b.id)) - Number(held.has(a.id)) || a.name.localeCompare(b.name));

  const set = (id: string, patch: Record<string, unknown>) =>
    update((d) => {
      Object.assign(d.assets.find((a) => a.id === id)!, patch);
      return d;
    });

  return (
    <div className="stack">
      <Card title="Koersen bijwerken">
        <p>
          Vul af en toe de huidige koers in (in euro per stuk). Meer hoeft niet: de app berekent zelf je latente meerwaarde en wat een verkoop
          zou kosten. De datum wordt automatisch op vandaag gezet.
        </p>
        <div className="table-wrap">
          <table className="edit">
            <thead>
              <tr>
                <th>Effect</th>
                <th className="r">In bezit</th>
                <th className="r">Koers nu (€/stuk)</th>
                <th>Bijgewerkt</th>
                <th className="r">Waarde</th>
                <th>Soort</th>
                <th>TOB</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} className={held.has(a.id) ? '' : 'dim'}>
                  <td>
                    <input className="plain" value={a.name} onChange={(e) => set(a.id, { name: e.target.value })} aria-label="Naam" />
                    <div className="sub-inputs">
                      <input className="small-input" placeholder="ticker" value={a.ticker ?? ''} onChange={(e) => set(a.id, { ticker: e.target.value.toUpperCase() || undefined })} />
                      <input className="small-input" placeholder="ISIN" value={a.isin ?? ''} onChange={(e) => set(a.id, { isin: e.target.value.toUpperCase() || undefined })} />
                    </div>
                  </td>
                  <td className="r">{fmtNum(held.get(a.id) ?? 0)}</td>
                  <td className="r">
                    <NumInput value={a.currentPrice} onChange={(v) => set(a.id, { currentPrice: v, priceDate: today })} placeholder="koers" ariaLabel={`Koers ${a.name}`} />
                  </td>
                  <td className="small">{fmtDate(a.priceDate)}</td>
                  <td className="r">{a.currentPrice ? fmtEUR((held.get(a.id) ?? 0) * a.currentPrice) : '—'}</td>
                  <td>
                    <select value={a.type} onChange={(e) => set(a.id, { type: e.target.value })}>
                      {TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={a.tobRate ?? 0.35} onChange={(e) => set(a.id, { tobRate: Number(e.target.value) })} title="Beurstaks per order, voor de kostenschatting in de planner">
                      {TOB_PRESETS.map((p) => (
                        <option key={p.rate} value={p.rate}>
                          {String(p.rate).replace('.', ',')}%
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {assets.length === 0 && <p className="muted">Nog geen effecten.</p>}
        <p className="muted small">
          TOB-tarieven: 0,12% (distribuerende ETF’s, kapitaliserende ETF’s die niet in België geregistreerd zijn, obligaties), 0,35%
          (aandelen), 1,32% (kapitaliserende fondsen/ETF’s geregistreerd in België). Twijfel je? Kijk op een recent aankoopborderel.
        </p>
      </Card>
    </div>
  );
}
