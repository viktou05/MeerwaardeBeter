import { useState } from 'react';
import type { Ctx } from '../App';
import { parseImportText, rowsToTrades, fillFx, type ParsedImport, type ImportRow, type StartRow } from '../import/convert';
import { FIELD_LABELS, parseNumber, type Field } from '../import/csv';
import { findOrCreateAsset, uid } from '../store';
import { BROKERS, brokerById, matchAccount, type BrokerId } from '../import/brokers';
import { readXlsx, rowsToTsv } from '../import/xlsx';
import { fmtEUR, fmtNum, fmtDate } from '../format';
import { NumInput } from './ui';

type Mode = 'start' | 'transacties';

const NEW_ACCOUNT = '__nieuw__';

export default function ImportDialog({ mode, onClose, data, update }: Ctx & { mode: Mode; onClose: () => void }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string>();
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [trades, setTrades] = useState<ImportRow[]>([]);
  const [starts, setStarts] = useState<StartRow[]>([]);
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? NEW_ACCOUNT);
  const [brokerId, setBrokerId] = useState<BrokerId | ''>('');
  const [showIgnored, setShowIgnored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();

  const pickBroker = (id: BrokerId | '') => {
    setBrokerId(id);
    if (!id) return;
    const match = matchAccount(data.accounts, id);
    setAccountId(match ? match.id : NEW_ACCOUNT);
  };

  const analyse = async (raw: string, delimiter?: string) => {
    const p = parseImportText(raw, { delimiter });
    setParsed(p);
    if (p.brokerId) pickBroker(p.brokerId);
    let t = p.trades;
    let s = p.startPositions;
    if (mode === 'start' && p.kind === 'generiek') {
      s = rowsToStarts(p);
      t = [];
    }
    if (mode === 'transacties') s = p.kind === 'ibkr' ? s : [];
    setBusy(true);
    const { failed } = await fillFx(t, s);
    setBusy(false);
    setTrades([...t]);
    setStarts([...s]);
    // Ontbrekende koersen bij transacties worden per rij getoond; hier enkel voor startposities.
    setMsg(failed && s.some((x) => x.pricePerUnitEUR === undefined) ? 'Niet alle wisselkoersen konden opgehaald worden: vul de koers in euro zelf aan.' : undefined);
  };

  const remap = async (field: Field, col: number | undefined) => {
    if (!parsed) return;
    const mapping = { ...parsed.mapping, [field]: col };
    const p = { ...parsed, mapping };
    setParsed(p);
    if (mode === 'start') setStarts(rowsToStarts(p));
    else {
      const t = rowsToTrades(p.rows, mapping);
      setBusy(true);
      await fillFx(t, []);
      setBusy(false);
      setTrades(t);
    }
  };

  const isDuplicate = (r: ImportRow) =>
    data.transactions.some((t) => {
      const a = data.assets.find((x) => x.id === t.assetId);
      const sameAsset = a && ((r.isin && a.isin === r.isin) || (r.ticker && a.ticker === r.ticker) || a.name.toLowerCase() === r.name.toLowerCase());
      return sameAsset && t.date === r.date && Math.abs(t.quantity - (r.quantity ?? 0)) < 1e-9 && t.type === r.type;
    });

  const broker = brokerById(brokerId || parsed?.brokerId);
  const newAccountName = broker?.name ?? (fileName ? fileName.replace(/\.[^.]+$/, '') : 'Nieuwe rekening');

  const commit = () => {
    let nT = 0;
    let nS = 0;
    update((d) => {
      // Nieuwe rekening pas aanmaken als er effectief iets geïmporteerd wordt.
      let targetId = d.accounts.some((a) => a.id === accountId) ? accountId : undefined;
      const target = () => {
        if (!targetId) {
          targetId = uid();
          d.accounts.push({ id: targetId, name: newAccountName, broker: broker?.name, withholds: broker?.withholds ?? false });
        }
        return targetId;
      };
      const accFor = (name?: string) => (name && d.accounts.find((a) => a.name.toLowerCase() === name.toLowerCase())?.id) || target();
      for (const r of trades) {
        if (!r.include || r.type === 'negeer' || !r.date || !r.quantity || (r.type !== 'transfer' && r.amountEUR === undefined)) continue;
        if (isDuplicate(r)) continue;
        const { asset, created } = findOrCreateAsset(d.assets, { name: r.name, isin: r.isin, ticker: r.ticker });
        if (created) d.assets.push(asset);
        d.transactions.push({
          id: uid(),
          date: r.date,
          type: r.type === 'transfer' ? 'transfer' : r.type,
          accountId: accFor(r.accountName),
          assetId: asset.id,
          quantity: r.quantity,
          amountEUR: r.amountEUR ?? 0,
          costsEUR: r.costs,
          withheldEUR: r.withheld,
          currency: r.currency !== 'EUR' ? r.currency : undefined,
          amountOriginal: r.currency !== 'EUR' ? r.amountLocal : undefined,
          fxRate: r.fx,
          source: fileName ?? 'geplakt',
        });
        nT++;
      }
      for (const s of starts) {
        if (!s.include || !s.quantity || !s.pricePerUnitEUR) continue;
        const { asset, created } = findOrCreateAsset(d.assets, { name: s.name, isin: s.isin, ticker: s.ticker });
        if (created) d.assets.push(asset);
        d.startPositions.push({
          id: uid(),
          accountId: target(),
          assetId: asset.id,
          quantity: s.quantity,
          value20251231PerUnit: s.pricePerUnitEUR,
          historicalCostTotal: s.historicalCostEUR && s.historicalCostEUR > s.quantity * s.pricePerUnitEUR ? s.historicalCostEUR : undefined,
        });
        nS++;
      }
      return d;
    });
    const skipped = trades.filter((r) => r.include && r.type !== 'negeer' && isDuplicate(r)).length;
    setMsg(`${nT} transacties en ${nS} startposities toegevoegd${skipped ? ` (${skipped} stonden er al)` : ''}.`);
    setTimeout(onClose, 900);
  };

  const onFile = async (f: File) => {
    setFileName(f.name);
    setMsg(undefined);
    try {
      if (/\.xlsx$/i.test(f.name)) {
        const tsv = rowsToTsv(await readXlsx(await f.arrayBuffer()));
        setText(tsv);
        await analyse(tsv, '\t');
        return;
      }
      if (/\.xls$/i.test(f.name)) {
        setMsg('Oud Excel-formaat (.xls): open het bestand en bewaar het als .xlsx of CSV, of kopieer de tabel en plak ze hieronder.');
        return;
      }
      const raw = await f.text();
      setText(raw);
      await analyse(raw);
    } catch (e) {
      setMsg(`Dit bestand kon niet gelezen worden (${e instanceof Error ? e.message : 'onbekende fout'}). Probeer CSV, of plak de tabel.`);
    }
  };

  const fields: Field[] =
    mode === 'start' ? ['name', 'isin', 'ticker', 'quantity', 'price', 'amountEUR'] : ['date', 'type', 'name', 'isin', 'ticker', 'quantity', 'price', 'amountEUR', 'amountLocal', 'currency', 'costs', 'withheld', 'account'];
  const importable = (r: ImportRow) => r.include && r.type !== 'negeer' && !!r.date && !!r.quantity && r.amountEUR !== undefined && !isDuplicate(r);
  const usable = trades.filter(importable).length + starts.filter((s) => s.include && s.pricePerUnitEUR).length;
  const missingAmount = trades.filter((r) => r.include && r.type !== 'negeer' && r.amountEUR === undefined && !isDuplicate(r)).length;
  const ignored = trades.filter((r) => r.type === 'negeer').length;
  const visibleTrades = trades.map((r, i) => ({ r, i })).filter(({ r }) => showIgnored || r.type !== 'negeer');

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Importeren">
        <header className="card-head">
          <h2>{mode === 'start' ? 'Posities 31/12/2025 importeren' : 'Transacties importeren'}</h2>
          <button className="icon" onClick={onClose} aria-label="Sluiten">
            ✕
          </button>
        </header>
        {!parsed ? (
          <div className="stack">
            <p>
              {mode === 'start'
                ? 'Kopieer de tabel uit het jaaroverzicht/de waardestaat van je broker (of uit Excel) en plak ze hier. Kolommen die herkend worden: naam/product, ISIN, ticker, aantal, koers of waarde.'
                : 'Upload het exportbestand van je broker (CSV of Excel) of plak een tabel. Het formaat van DEGIRO, Revolut, Bitvavo, Coinbase, Robinhood en Interactive Brokers/MEXEM wordt automatisch herkend; andere tabellen (Curvo, MeDirect, je bank…) worden op kolomnamen gekoppeld.'}
            </p>
            {mode === 'transacties' && (
              <label className="inline">
                Platform:
                <select value={brokerId} onChange={(e) => pickBroker(e.target.value as BrokerId | '')}>
                  <option value="">— kies voor uitleg (optioneel) —</option>
                  {BROKERS.filter((b) => b.howTo).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {broker?.howTo && (
              <p className="howto">
                <strong>Export maken bij {broker.name}:</strong> {broker.howTo}
              </p>
            )}
            <input type="file" accept=".csv,.txt,.tsv,.xlsx,.xls" aria-label="Exportbestand kiezen" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <textarea rows={8} placeholder="…of plak hier (Ctrl+V)" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="row-end">
              <button disabled={!text.trim()} onClick={() => analyse(text)}>
                Analyseren
              </button>
            </div>
            {msg && <p className="warn-text">{msg}</p>}
          </div>
        ) : (
          <div className="stack">
            {(parsed.brokerId || parsed.periodNote) && (
              <p className="muted small">
                {parsed.brokerId && (
                  <span className="badge">Herkend: {brokerById(parsed.brokerId)?.name}</span>
                )}{' '}
                {parsed.periodNote}
              </p>
            )}
            <label className="inline">
              Rekening:
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value={NEW_ACCOUNT}>+ Nieuwe rekening “{newAccountName}”</option>
              </select>
            </label>
            {accountId === NEW_ACCOUNT && (
              <p className="muted small">
                Wordt aangemaakt bij het importeren
                {broker ? (broker.withholds ? ' (Belgische bank: houdt 10% in bij verkoop)' : ' (houdt geen meerwaardebelasting in)') : ''}. Aanpassen kan later bij
                Instellingen.
              </p>
            )}
            {parsed.kind === 'generiek' && (
              <details className="help" open={trades.length + starts.length === 0 || undefined}>
                <summary>Kolommen koppelen (automatisch herkend — pas aan indien nodig)</summary>
                <div className="map-grid">
                  {fields.map((f) => (
                    <label key={f}>
                      {FIELD_LABELS[f]}
                      <select value={parsed.mapping[f] ?? ''} onChange={(e) => remap(f, e.target.value === '' ? undefined : Number(e.target.value))}>
                        <option value="">—</option>
                        {parsed.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </details>
            )}
            {busy && <p className="muted">Wisselkoersen ophalen…</p>}
            {trades.length > 0 && (
              <div className="table-wrap tall">
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Datum</th>
                      <th>Type</th>
                      <th>Effect</th>
                      <th className="r">Aantal</th>
                      <th className="r">Bedrag €</th>
                      <th>Opmerking</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTrades.map(({ r, i }) => {
                      const dup = isDuplicate(r);
                      const set = (patch: Partial<ImportRow>) => setTrades((ts) => ts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                      return (
                        <tr key={i} className={!r.include || r.type === 'negeer' ? 'dim' : ''}>
                          <td>
                            <input type="checkbox" checked={r.include && !dup} disabled={dup} onChange={(e) => set({ include: e.target.checked })} />
                          </td>
                          <td>{fmtDate(r.date)}</td>
                          <td>
                            <select value={r.type} onChange={(e) => set({ type: e.target.value as ImportRow['type'], include: e.target.value !== 'negeer' })}>
                              <option value="koop">koop</option>
                              <option value="verkoop">verkoop</option>
                              <option value="negeer">negeer</option>
                            </select>
                          </td>
                          <td>
                            {r.name}
                            <div className="muted small">{[r.ticker, r.isin].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td className="r">{fmtNum(r.quantity)}</td>
                          <td className="r">
                            {r.type === 'negeer' ? (
                              fmtEUR(r.amountEUR)
                            ) : (
                              <NumInput
                                value={r.amountEUR !== undefined ? Math.round(r.amountEUR * 100) / 100 : undefined}
                                onChange={(v) => set({ amountEUR: v, issues: v === undefined ? r.issues : r.issues.filter((x) => !x.includes('EUR-koers niet gevonden')) })}
                                className="amount-input"
                                placeholder="€"
                                ariaLabel="Bedrag in euro"
                              />
                            )}
                          </td>
                          <td className="small">{dup ? 'staat er al' : r.issues.join('; ')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {starts.length > 0 && (
              <div className="table-wrap tall">
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Effect</th>
                      <th className="r">Aantal</th>
                      <th className="r">Koers 31/12/2025 €</th>
                      <th className="r">Historische kost €</th>
                      <th>Opmerking</th>
                    </tr>
                  </thead>
                  <tbody>
                    {starts.map((s, i) => (
                      <tr key={i} className={s.include ? '' : 'dim'}>
                        <td>
                          <input type="checkbox" checked={s.include} onChange={(e) => setStarts((ss) => ss.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} />
                        </td>
                        <td>
                          {s.name}
                          <div className="muted small">{[s.ticker, s.isin].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="r">{fmtNum(s.quantity)}</td>
                        <td className="r">{fmtEUR(s.pricePerUnitEUR)}</td>
                        <td className="r">{fmtEUR(s.historicalCostEUR)}</td>
                        <td className="small">{s.issues.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {ignored > 0 && (
              <button className="link" onClick={() => setShowIgnored((v) => !v)}>
                {showIgnored ? 'Verberg' : 'Toon'} {ignored === 1 ? '1 rij die geen aan- of verkoop is' : `${ignored} rijen die geen aan- of verkoop zijn`} (dividend, storting, kosten…)
              </button>
            )}
            {trades.length === 0 && starts.length === 0 && <p className="warn-text">Niets herkend. Koppel de kolommen hierboven.</p>}
            {missingAmount > 0 && (
              <p className="warn-text">
                {missingAmount === 1 ? '1 rij heeft' : `${missingAmount} rijen hebben`} nog geen bedrag in euro en {missingAmount === 1 ? 'wordt' : 'worden'} niet geïmporteerd tot je het invult.
              </p>
            )}
            {msg && <p className="warn-text">{msg}</p>}
            <div className="row-end">
              <button className="secondary" onClick={() => { setParsed(null); setTrades([]); setStarts([]); }}>
                Terug
              </button>
              <button disabled={!usable || busy} onClick={commit}>
                {usable} {usable === 1 ? 'rij' : 'rijen'} importeren
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function rowsToStarts(p: ParsedImport): StartRow[] {
  const m = p.mapping;
  const get = (r: string[], f: Field) => (m[f] !== undefined ? r[m[f]!] : undefined);
  return p.rows
    .map((r) => {
      const q = parseNumber(get(r, 'quantity'));
      const price = parseNumber(get(r, 'price'));
      const value = parseNumber(get(r, 'amountEUR'));
      const unit = price ?? (value !== undefined && q ? value / q : undefined);
      const issues: string[] = [];
      if (!unit) issues.push('koers of waarde ontbreekt');
      return {
        include: !!q && !!unit,
        name: get(r, 'name') || get(r, 'ticker') || get(r, 'isin') || '',
        isin: get(r, 'isin')?.toUpperCase(),
        ticker: get(r, 'ticker')?.toUpperCase(),
        quantity: Math.abs(q ?? 0),
        pricePerUnitEUR: unit !== undefined ? Math.abs(unit) : undefined,
        currency: 'EUR',
        issues,
      } as StartRow;
    })
    .filter((s) => s.name || s.quantity);
}
