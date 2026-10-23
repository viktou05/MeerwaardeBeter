import { useState } from 'react';
import type { Ctx } from '../App';
import { Card, Help, NumInput } from './ui';
import { uid, demoData, normalize } from '../store';
import { emptyData } from '../engine/types';
import { BROKERS } from '../import/brokers';


export default function SettingsPanel({ data, update, go }: Ctx) {
  const s = data.settings;
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState<string>();
  const used = (id: string) => data.startPositions.some((p) => p.accountId === id) || data.transactions.some((t) => t.accountId === id || t.toAccountId === id);
  const exemptionYears = Object.keys(s.exemptionByYear).sort();

  const addAccount = (name: string, withholds?: boolean) => {
    if (!name.trim()) return;
    const preset = BROKERS.find((b) => b.name.toLowerCase() === name.trim().toLowerCase());
    update((d) => {
      d.accounts.push({ id: uid(), name: name.trim(), broker: preset?.name, withholds: withholds ?? preset?.withholds ?? false });
      return d;
    });
    setNewName('');
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `meerwaarde-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (f: File) => {
    try {
      const d = normalize(JSON.parse(await f.text()));
      update(() => d);
      setMsg('Back-up geladen.');
    } catch {
      setMsg('Dit is geen geldig back-upbestand.');
    }
  };

  return (
    <div className="stack">
      <Card title="Rekeningen">
        <p>Maak één rekening aan per broker of bank. Duid aan of die in België 10% meerwaardebelasting inhoudt.</p>
        {data.accounts.length > 0 && (
          <div className="table-wrap">
            <table className="edit">
              <thead>
                <tr>
                  <th>Naam</th>
                  <th>Houdt 10% in?</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <input className="plain" value={a.name} onChange={(e) => update((d) => { d.accounts.find((x) => x.id === a.id)!.name = e.target.value; return d; })} aria-label="Naam rekening" />
                    </td>
                    <td>
                      <label className="inline">
                        <input type="checkbox" checked={a.withholds} onChange={(e) => update((d) => { d.accounts.find((x) => x.id === a.id)!.withholds = e.target.checked; return d; })} />
                        {a.withholds ? 'ja (Belgische bank, geen opt-out)' : 'nee (zelf aangeven)'}
                      </label>
                    </td>
                    <td>
                      <button className="icon" disabled={used(a.id)} title={used(a.id) ? 'Wordt gebruikt' : 'Verwijderen'} onClick={() => update((d) => ({ ...d, accounts: d.accounts.filter((x) => x.id !== a.id) }))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="chips">
          {BROKERS.filter((b) => !data.accounts.some((a) => a.name === b.name)).map((b) => (
            <button key={b.name} className="chip" onClick={() => addAccount(b.name, b.withholds)}>
              + {b.name}
            </button>
          ))}
        </div>
        <div className="inline">
          <input placeholder="Andere naam…" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAccount(newName)} />
          <button disabled={!newName.trim()} onClick={() => addAccount(newName)}>
            Toevoegen
          </button>
        </div>
        {data.accounts.length > 0 && data.startPositions.length === 0 && (
          <p>
            <button onClick={() => go('start')}>Volgende: posities op 31/12/2025 →</button>
          </p>
        )}
        <Help title="Inhouden of niet?">
          Belgische banken en brokers houden sinds 2026 automatisch 10% in op je meerwaarde per verkoop, zonder rekening te houden met je
          vrijstelling of met verliezen. Buitenlandse brokers en cryptoplatformen houden niets in: daar geef je zelf aan. Vraag bij twijfel je
          bank of je een opt-out hebt.
        </Help>
      </Card>

      <Card title="Belastingregels">
        <div className="form-grid">
          <label>
            Tarief (%)
            <NumInput value={s.taxRate} onChange={(v) => update((d) => { d.settings.taxRate = v ?? 10; return d; })} />
          </label>
          <label>
            Max. overdraagbaar per jaar (€)
            <NumInput value={s.carryPerYear} onChange={(v) => update((d) => { d.settings.carryPerYear = v ?? 0; return d; })} />
          </label>
          <label>
            Historische prijs bruikbaar tot
            <input type="date" value={s.historicalCostDeadline} onChange={(e) => update((d) => { d.settings.historicalCostDeadline = e.target.value; return d; })} />
          </label>
        </div>
        <h3>Vrijstelling per jaar (geïndexeerd)</h3>
        <div className="form-grid">
          {exemptionYears.map((y) => (
            <label key={y}>
              {y}
              <NumInput value={s.exemptionByYear[y]} onChange={(v) => update((d) => { if (v === undefined && y !== '2026') delete d.settings.exemptionByYear[y]; else d.settings.exemptionByYear[y] = v ?? 10000; return d; })} />
            </label>
          ))}
          <div>
            <button
              className="secondary"
              onClick={() =>
                update((d) => {
                  const next = String(Number(exemptionYears[exemptionYears.length - 1]) + 1);
                  d.settings.exemptionByYear[next] = d.settings.exemptionByYear[exemptionYears[exemptionYears.length - 1]];
                  return d;
                })
              }
            >
              + jaar
            </button>
          </div>
        </div>
        <p className="muted small">Jaren zonder bedrag nemen het laatst gekende bedrag over. Vul het geïndexeerde bedrag in zodra het gepubliceerd is.</p>
        <h3>FIFO</h3>
        <label className="inline">
          <input type="radio" checked={s.fifoScope === 'belastingplichtige'} onChange={() => update((d) => { d.settings.fifoScope = 'belastingplichtige'; return d; })} />
          Over al mijn rekeningen samen (per effect)
        </label>
        <label className="inline">
          <input type="radio" checked={s.fifoScope === 'rekening'} onChange={() => update((d) => { d.settings.fifoScope = 'rekening'; return d; })} />
          Per rekening afzonderlijk (zoals je bank rekent)
        </label>
        <h3>Planner</h3>
        <div className="form-grid">
          <label>
            Makelaarsloon per order (€)
            <NumInput value={s.defaultOrderFee} onChange={(v) => update((d) => { d.settings.defaultOrderFee = v ?? 0; return d; })} />
          </label>
          <label>
            Spread (%)
            <NumInput value={s.defaultSpreadPct} onChange={(v) => update((d) => { d.settings.defaultSpreadPct = v ?? 0; return d; })} />
          </label>
        </div>
      </Card>

      <Card title="Gegevens">
        <p>
          Alles wordt enkel in deze browser bewaard; er gaat niets naar een server (alleen bij import in vreemde munt vraagt de app de ECB-wisselkoers op, met enkel munt en datum). Maak regelmatig een back-up, zeker voor je een andere computer
          of browser gebruikt.
        </p>
        <div className="inline wrap">
          <button onClick={exportJson}>Back-up downloaden</button>
          <label className="button secondary">
            Back-up laden
            <input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          </label>
          <button className="secondary" onClick={() => { if (confirm('Demogegevens laden? Je huidige gegevens worden vervangen.')) { update(() => demoData()); go('overzicht'); } }}>
            Demogegevens laden
          </button>
          <button className="danger" onClick={() => { if (confirm('Alles wissen? Dit kan niet ongedaan gemaakt worden.')) update(() => emptyData()); }}>
            Alles wissen
          </button>
        </div>
        {msg && <p className="muted">{msg}</p>}
      </Card>
    </div>
  );
}
