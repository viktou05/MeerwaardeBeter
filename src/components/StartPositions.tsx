import { useState } from 'react';
import type { Ctx } from '../App';
import { Card, Help, NumInput, AssetInput } from './ui';
import { fmtEUR, fmtEUR0 } from '../format';
import { findOrCreateAsset, uid } from '../store';
import ImportDialog from './ImportDialog';

export default function StartPositions(ctx: Ctx) {
  const { data, update, go } = ctx;
  const [importOpen, setImportOpen] = useState(false);
  const total = data.startPositions.reduce((s, p) => s + p.quantity * p.value20251231PerUnit, 0);

  if (data.accounts.length === 0)
    return (
      <Card title="Eerst een rekening aanmaken">
        <p>Maak in Instellingen eerst je rekeningen aan (bv. Bolero, DEGIRO, Bitvavo).</p>
        <button onClick={() => go('instellingen')}>Naar Instellingen</button>
      </Card>
    );

  return (
    <div className="stack">
      <Card
        title="Posities op 31/12/2025"
        actions={
          <button className="secondary" onClick={() => setImportOpen(true)}>
            Plakken / importeren
          </button>
        }
      >
        <p>
          Alles wat je vóór 2026 kocht, krijgt als fiscale aankoopprijs de <strong>slotkoers van 31/12/2025</strong>. Je geeft dus per
          rekening enkel in wat je toen bezat: aantal en koers. Je vindt dit op het jaaroverzicht of de waardestaat van je broker.
        </p>
        <Help title="Wat met de historische aankoopprijs?">
          Kocht je een effect vroeger duurder dan de koers op 31/12/2025, dan mag je bij verkoop tot en met 31/12/2030 die hogere
          historische prijs gebruiken (met bewijs). Dat kan je meerwaarde verkleinen tot nul, maar nooit een minderwaarde maken. Vul het
          veld alleen in als die prijs hoger ligt dan de waarde op 31/12/2025; anders mag je het leeg laten.
        </Help>
        <p className="muted small">Totale waarde op 31/12/2025: {fmtEUR(total)}</p>
      </Card>

      {data.accounts.map((acc) => {
        const rows = data.startPositions.filter((p) => p.accountId === acc.id);
        return (
          <Card key={acc.id} title={acc.name} actions={<span className="muted small">{fmtEUR0(rows.reduce((s, p) => s + p.quantity * p.value20251231PerUnit, 0))}</span>}>
            <div className="table-wrap">
              <table className="edit">
                <thead>
                  <tr>
                    <th>Effect</th>
                    <th className="r">Aantal</th>
                    <th className="r">Koers 31/12/2025 (€/stuk)</th>
                    <th className="r">Waarde</th>
                    <th className="r">Historische aankoopprijs totaal (optioneel)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const a = data.assets.find((x) => x.id === p.assetId);
                    const set = (patch: Partial<typeof p>) =>
                      update((d) => {
                        const t = d.startPositions.find((x) => x.id === p.id)!;
                        Object.assign(t, patch);
                        return d;
                      });
                    return (
                      <tr key={p.id}>
                        <td>
                          {a?.name}
                          <div className="muted small">{[a?.ticker, a?.isin].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="r">
                          <NumInput value={p.quantity} onChange={(v) => set({ quantity: v ?? 0 })} ariaLabel="Aantal" />
                        </td>
                        <td className="r">
                          <NumInput value={p.value20251231PerUnit} onChange={(v) => set({ value20251231PerUnit: v ?? 0 })} ariaLabel="Koers 31/12/2025" />
                        </td>
                        <td className="r">{fmtEUR(p.quantity * p.value20251231PerUnit)}</td>
                        <td className="r">
                          <NumInput value={p.historicalCostTotal} onChange={(v) => set({ historicalCostTotal: v })} placeholder="—" ariaLabel="Historische aankoopprijs" />
                        </td>
                        <td>
                          <button className="icon" title="Verwijderen" onClick={() => update((d) => ({ ...d, startPositions: d.startPositions.filter((x) => x.id !== p.id) }))}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  <NewRow accountId={acc.id} {...ctx} />
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
      {importOpen && <ImportDialog mode="start" onClose={() => setImportOpen(false)} {...ctx} />}
    </div>
  );
}

function NewRow({ accountId, data, update }: Ctx & { accountId: string }) {
  const [asset, setAsset] = useState('');
  const [isin, setIsin] = useState('');
  const [qty, setQty] = useState<number | undefined>();
  const [price, setPrice] = useState<number | undefined>();
  const [total, setTotal] = useState<number | undefined>();
  const [hist, setHist] = useState<number | undefined>();
  const [key, setKey] = useState(0);
  const unit = price ?? (total !== undefined && qty ? total / qty : undefined);
  const ok = asset.trim() && qty && unit;
  const add = () => {
    if (!ok) return;
    update((d) => {
      const { asset: a, created } = findOrCreateAsset(d.assets, { name: asset, isin: isin || undefined });
      if (created) d.assets.push(a);
      d.startPositions.push({ id: uid(), accountId, assetId: a.id, quantity: qty!, value20251231PerUnit: unit!, historicalCostTotal: hist });
      return d;
    });
    setAsset('');
    setIsin('');
    setQty(undefined);
    setPrice(undefined);
    setTotal(undefined);
    setHist(undefined);
    setKey((k) => k + 1);
  };
  const existing = data.assets.find((a) => a.name.toLowerCase() === asset.trim().toLowerCase());
  return (
    <tr className="newrow" key={key} onKeyDown={(e) => e.key === 'Enter' && add()}>
      <td>
        <AssetInput assets={data.assets} value={asset} onChange={setAsset} />
        {!existing && asset && <input className="small-input" placeholder="ISIN (optioneel)" value={isin} onChange={(e) => setIsin(e.target.value)} />}
      </td>
      <td className="r">
        <NumInput value={qty} onChange={setQty} placeholder="aantal" />
      </td>
      <td className="r">
        <NumInput value={price} onChange={(v) => { setPrice(v); setTotal(undefined); }} placeholder="€/stuk" />
      </td>
      <td className="r">
        <NumInput value={total ?? (price && qty ? price * qty : undefined)} onChange={(v) => { setTotal(v); setPrice(undefined); }} placeholder="of totaal €" />
      </td>
      <td className="r">
        <NumInput value={hist} onChange={setHist} placeholder="optioneel" />
      </td>
      <td>
        <button disabled={!ok} onClick={add}>
          +
        </button>
      </td>
    </tr>
  );
}
