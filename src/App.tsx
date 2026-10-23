import { useMemo, useState } from 'react';
import { usePersistentData } from './store';
import { runEngine, holdingsFrom, todayISO } from './engine/tax';
import type { AppData } from './engine/types';
import Overview from './components/Overview';
import StartPositions from './components/StartPositions';
import Transactions from './components/Transactions';
import Prices from './components/Prices';
import Planner from './components/Planner';
import YearReport from './components/YearReport';
import SettingsPanel from './components/SettingsPanel';

export type Tab = 'overzicht' | 'start' | 'transacties' | 'koersen' | 'planner' | 'jaar' | 'instellingen';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overzicht', label: 'Overzicht' },
  { id: 'start', label: '1 · Posities 31/12/2025' },
  { id: 'transacties', label: '2 · Aan- & verkopen' },
  { id: 'koersen', label: '3 · Koersen' },
  { id: 'planner', label: 'Planner' },
  { id: 'jaar', label: 'Aangifte' },
  { id: 'instellingen', label: 'Instellingen' },
];

export interface Ctx {
  data: AppData;
  update: (fn: (d: AppData) => AppData) => void;
  engine: ReturnType<typeof runEngine>;
  holdings: ReturnType<typeof holdingsFrom>;
  today: string;
  go: (t: Tab) => void;
}

export default function App() {
  const [data, setData, savedAt] = usePersistentData();
  const [tab, setTab] = useState<Tab>(() => (data.accounts.length === 0 ? 'instellingen' : 'overzicht'));
  const today = todayISO();
  const engine = useMemo(() => runEngine(data), [data]);
  const holdings = useMemo(() => holdingsFrom(data, engine.lots, today), [data, engine, today]);
  const ctx: Ctx = { data, update: (fn) => setData((d) => fn(structuredClone(d))), engine, holdings, today, go: setTab };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            %
          </span>
          <div>
            <h1>Meerwaarde</h1>
            <p>Belgische meerwaardebelasting · persoonlijke opvolging</p>
          </div>
        </div>
        <div className="saved">{savedAt ? 'Lokaal bewaard' : 'Niet bewaard (opslag geblokkeerd)'}</div>
      </header>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'overzicht' && <Overview {...ctx} />}
        {tab === 'start' && <StartPositions {...ctx} />}
        {tab === 'transacties' && <Transactions {...ctx} />}
        {tab === 'koersen' && <Prices {...ctx} />}
        {tab === 'planner' && <Planner {...ctx} />}
        {tab === 'jaar' && <YearReport {...ctx} />}
        {tab === 'instellingen' && <SettingsPanel {...ctx} />}
      </main>
      <footer className="foot">
        Schatting voor persoonlijk gebruik, geen fiscaal advies. Regels: 10% op gerealiseerde meerwaarden sinds 1/1/2026, vrijstelling
        €10.000/jaar (+ max. €1.000 overdraagbaar), FIFO, kosten niet aftrekbaar. Je gegevens blijven in deze browser.
      </footer>
    </div>
  );
}
