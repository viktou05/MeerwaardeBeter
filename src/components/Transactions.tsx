import { useMemo, useState } from 'react';
import type { Ctx } from '../App';
import { Card, NumInput, AssetInput, Help } from './ui';
import { fmtEUR, fmtNum, fmtDate, signClass } from '../format';
import { findOrCreateAsset, uid } from '../store';
import { simulateSale } from '../engine/planner';
import type { Transaction, TxType } from '../engine/types';
import ImportDialog from './ImportDialog';

const LAST_ACC = 'meerwaarde.lastAccount';
const getLastAcc = () => {
  try {
    return localStorage.getItem(LAST_ACC) || '';
  } catch {
    return '';
  }
};

export default function Transactions(ctx: Ctx) {
  const { data, update, engine, today, go } = ctx;
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [filterYear, setFilterYear] = useState<string>('alle');
  const [filterAcc, setFilterAcc] = useState<string>('alle');

  if (data.accounts.length === 0)
    return (
      <>
        <Card title="Nog geen rekeningen">
          <p>Importeer meteen het exportbestand van je broker: de rekening wordt dan automatisch aangemaakt. Of maak je rekeningen eerst zelf aan.</p>
          <div className="inline">
            <button onClick={() => setImportOpen(true)}>Bestand van broker importeren</button>
            <button className="secondary" onClick={() => go('instellingen')}>
              Naar Instellingen
            </button>
          </div>
        </Card>
        {importOpen && <ImportDialog mode="transacties" onClose={() => setImportOpen(false)} {...ctx} />}
      </>
    );

  const years = [...new Set(data.transactions.map((t) => t.date.slice(0, 4)))].sort().reverse();
  const list = data.transactions
    .filter((t) => (filterYear === 'alle' || t.date.startsWith(filterYear)) && (filterAcc === 'alle' || t.accountId === filterAcc))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const saleById = new Map(engine.sales.map((s) => [s.txId, s]));

  return (
    <div className="stack">
      <QuickAdd key={editing?.id ?? 'new'} {...ctx} editing={editing} onDone={() => setEditing(null)} />

      <Card
        title={`Transacties (${data.transactions.length})`}
        actions={
          <>
            <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} aria-label="Jaar">
              <option value="alle">Alle jaren</option>
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
            <select value={filterAcc} onChange={(e) => setFilterAcc(e.target.value)} aria-label="Rekening">
              <option value="alle">Alle rekeningen</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button className="secondary" onClick={() => setImportOpen(true)}>
              Importeren / plakken
            </button>
          </>
        }
      >
        {list.length === 0 ? (
          <p className="muted">Nog geen transacties. Voeg ze hierboven toe, of importeer het CSV-bestand van je broker.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Type</th>
                  <th>Effect</th>
                  <th>Rekening</th>
                  <th className="r">Aantal</th>
                  <th className="r">Bedrag</th>
                  <th className="r">Meerwaarde</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => {
                  const a = data.assets.find((x) => x.id === t.assetId);
                  const s = saleById.get(t.id);
                  const res = s ? s.gain - s.loss : undefined;
                  return (
                    <tr key={t.id} className={s?.unmatchedQuantity ? 'row-error' : ''}>
                      <td>{fmtDate(t.date)}</td>
                      <td>
                        <span className={`pill ${t.type}`}>{t.type}</span>
                      </td>
                      <td>{a?.name}</td>
                      <td>
                        {data.accounts.find((x) => x.id === t.accountId)?.name}
                        {t.type === 'transfer' && <> → {data.accounts.find((x) => x.id === t.toAccountId)?.name}</>}
                      </td>
                      <td className="r">{fmtNum(t.quantity)}</td>
                      <td className="r">
                        {t.type === 'transfer' ? '—' : fmtEUR(t.amountEUR)}
                        {t.currency && t.currency !== 'EUR' && <div className="muted small">{t.currency}</div>}
                      </td>
                      <td className={`r ${signClass(res)}`}>{res !== undefined ? fmtEUR(res) : ''}</td>
                      <td className="nowrap">
                        <button className="icon" title="Bewerken" onClick={() => { setEditing(t); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                          ✎
                        </button>
                        <button className="icon" title="Verwijderen" onClick={() => update((d) => ({ ...d, transactions: d.transactions.filter((x) => x.id !== t.id) }))}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {importOpen && <ImportDialog mode="transacties" onClose={() => setImportOpen(false)} {...ctx} />}
      <p className="muted small">Vandaag: {fmtDate(today)}</p>
    </div>
  );
}

function QuickAdd({ data, update, editing, onDone }: Ctx & { editing: Transaction | null; onDone: () => void }) {
  const lastAcc = getLastAcc();
  const init = editing;
  const [type, setType] = useState<TxType>(init?.type ?? 'verkoop');
  const [date, setDate] = useState(init?.date ?? new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState(init?.accountId ?? (data.accounts.some((a) => a.id === lastAcc) ? lastAcc : data.accounts[0].id));
  const [toAccountId, setToAccountId] = useState(init?.toAccountId ?? data.accounts.find((a) => a.id !== accountId)?.id ?? '');
  const [asset, setAsset] = useState(init ? data.assets.find((a) => a.id === init.assetId)?.name ?? '' : '');
  const [qty, setQty] = useState<number | undefined>(init?.quantity);
  const [mode, setMode] = useState<'totaal' | 'koers'>('totaal');
  const [amount, setAmount] = useState<number | undefined>(init?.amountEUR);
  const [price, setPrice] = useState<number | undefined>();
  const [costs, setCosts] = useState<number | undefined>(init?.costsEUR);
  const [withheld, setWithheld] = useState<number | undefined>(init?.withheldEUR);
  const acc = data.accounts.find((a) => a.id === accountId);
  const total = mode === 'totaal' ? amount : price !== undefined && qty ? price * qty : undefined;
  const existingAsset = data.assets.find((a) => a.name.toLowerCase() === asset.trim().toLowerCase());

  // Live voorbeeld van de belasting bij een verkoop
  const preview = useMemo(() => {
    if (type !== 'verkoop' || !existingAsset || !qty || !total || !date) return null;
    const without = editing ? { ...data, transactions: data.transactions.filter((t) => t.id !== editing.id) } : data;
    return simulateSale(without, { accountId, assetId: existingAsset.id, quantity: qty, pricePerUnit: total / qty, date });
  }, [type, existingAsset, qty, total, date, accountId, data, editing]);

  const ok = asset.trim() && qty && qty > 0 && date && (type === 'transfer' ? toAccountId && toAccountId !== accountId : total !== undefined);

  const save = () => {
    if (!ok) return;
    try {
      localStorage.setItem(LAST_ACC, accountId);
    } catch {
      /* geen opslag */
    }
    update((d) => {
      const { asset: a, created } = findOrCreateAsset(d.assets, { name: asset });
      if (created) d.assets.push(a);
      const t: Transaction = {
        id: editing?.id ?? uid(),
        date,
        type,
        accountId,
        toAccountId: type === 'transfer' ? toAccountId : undefined,
        assetId: a.id,
        quantity: qty!,
        amountEUR: type === 'transfer' ? 0 : total!,
        costsEUR: costs,
        withheldEUR: type === 'verkoop' ? withheld : undefined,
      };
      if (editing) d.transactions = d.transactions.map((x) => (x.id === editing.id ? t : x));
      else d.transactions.push(t);
      return d;
    });
    setQty(undefined);
    setAmount(undefined);
    setPrice(undefined);
    setCosts(undefined);
    setWithheld(undefined);
    if (editing) onDone();
  };

  return (
    <Card title={editing ? 'Transactie bewerken' : 'Snel toevoegen'} actions={editing && <button className="secondary" onClick={onDone}>Annuleren</button>}>
      <div className="seg" role="radiogroup" aria-label="Type">
        {(['koop', 'verkoop', 'transfer'] as TxType[]).map((t) => (
          <button key={t} role="radio" aria-checked={type === t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
            {t === 'koop' ? 'Gekocht' : t === 'verkoop' ? 'Verkocht' : 'Overgezet naar eigen rekening'}
          </button>
        ))}
      </div>
      <div className="form-grid" onKeyDown={(e) => e.key === 'Enter' && save()}>
        <label>
          Datum
          <input type="date" value={date} min="2026-01-01" onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          {type === 'transfer' ? 'Van rekening' : 'Rekening'}
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {type === 'transfer' && (
          <label>
            Naar rekening
            <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              {data.accounts.filter((a) => a.id !== accountId).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="wide">
          Effect
          <AssetInput assets={data.assets} value={asset} onChange={setAsset} />
        </label>
        <label>
          Aantal
          <NumInput value={qty} onChange={setQty} placeholder="stuks" />
        </label>
        {type !== 'transfer' && (
          <label>
            <span>
              {mode === 'totaal' ? 'Totaalbedrag (€)' : 'Koers per stuk (€)'}{' '}
              <button type="button" className="link small" onClick={() => setMode(mode === 'totaal' ? 'koers' : 'totaal')}>
                {mode === 'totaal' ? 'of per stuk' : 'of totaal'}
              </button>
            </span>
            {mode === 'totaal' ? <NumInput value={amount} onChange={setAmount} placeholder="zonder kosten" /> : <NumInput value={price} onChange={setPrice} placeholder="€ per stuk" />}
          </label>
        )}
        {type !== 'transfer' && (
          <label>
            Kosten + TOB (€)
            <NumInput value={costs} onChange={setCosts} placeholder="optioneel" />
          </label>
        )}
        {type === 'verkoop' && acc?.withholds && (
          <label>
            Ingehouden door bank (€)
            <NumInput value={withheld} onChange={setWithheld} placeholder={preview ? `± ${fmtEUR(preview.withheldByBank)}` : 'zie borderel'} />
          </label>
        )}
      </div>
      {type === 'verkoop' && preview && (
        <div className={`preview ${preview.gain - preview.loss >= 0 ? '' : 'loss'}`}>
          {preview.gain - preview.loss >= 0 ? 'Meerwaarde' : 'Minderwaarde'} op deze verkoop: <strong className={signClass(preview.gain - preview.loss)}>{fmtEUR(preview.gain - preview.loss)}</strong>
          {' · '}extra belasting dit jaar: <strong>{fmtEUR(preview.extraTax)}</strong>
          {' · '}vrijstelling daarna nog: {fmtEUR(preview.after.exemptionRemaining)}
        </div>
      )}
      {type === 'verkoop' && asset && !existingAsset && <p className="warn-text small">Dit effect staat nog niet in je posities. Verkoop je iets van vóór 2026? Voeg het dan eerst toe bij “Posities 31/12/2025”.</p>}
      <div className="row-end">
        <button disabled={!ok} onClick={save}>
          {editing ? 'Opslaan' : 'Toevoegen'}
        </button>
      </div>
      <Help title="Welk bedrag vul ik in?">
        Het brutobedrag van de order: aantal × koers, <strong>zonder</strong> makelaarsloon of beurstaks (TOB). Die kosten zijn fiscaal niet
        aftrekbaar; je mag ze wel noteren voor je eigen overzicht. Was de order in dollar? Reken om naar euro aan de koers van je borderel,
        of importeer het bestand: dan haalt de app de ECB-koers zelf op. Crypto die je ruilt voor andere crypto geef je in als verkoop
        (EUR-waarde op dat moment) én aankoop.
      </Help>
    </Card>
  );
}
