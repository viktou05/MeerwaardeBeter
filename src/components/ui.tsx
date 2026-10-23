import { useEffect, useId, useState, type ReactNode } from 'react';
import { readNum, fmtNum } from '../format';
import type { Asset } from '../engine/types';

export function NumInput(props: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const toStr = (v: number | undefined) => (v === undefined ? '' : String(Math.round(v * 1e8) / 1e8).replace('.', ','));
  const [s, setS] = useState(toStr(props.value));
  useEffect(() => {
    if (readNum(s) !== props.value) setS(toStr(props.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      className={`num ${props.className ?? ''}`}
      value={s}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      autoFocus={props.autoFocus}
      onChange={(e) => {
        setS(e.target.value);
        props.onChange(readNum(e.target.value));
      }}
    />
  );
}

/** Effect kiezen of nieuw typen (naam, ticker of ISIN). */
export function AssetInput(props: { assets: Asset[]; value: string; onChange: (text: string) => void; placeholder?: string }) {
  const id = useId();
  return (
    <>
      <input
        type="text"
        list={id}
        value={props.value}
        placeholder={props.placeholder ?? 'Naam, ticker of ISIN'}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <datalist id={id}>
        {props.assets.map((a) => (
          <option key={a.id} value={a.name}>
            {[a.ticker, a.isin].filter(Boolean).join(' · ')}
          </option>
        ))}
      </datalist>
    </>
  );
}

export function Card(props: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${props.className ?? ''}`}>
      {(props.title || props.actions) && (
        <header className="card-head">
          {props.title && <h2>{props.title}</h2>}
          {props.actions && <div className="card-actions">{props.actions}</div>}
        </header>
      )}
      {props.children}
    </section>
  );
}

export function Stat(props: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'pos' | 'neg' | 'accent' | '' }) {
  return (
    <div className={`stat ${props.tone ?? ''}`}>
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      {props.sub && <div className="stat-sub">{props.sub}</div>}
    </div>
  );
}

export function Help(props: { title: string; children: ReactNode }) {
  return (
    <details className="help">
      <summary>{props.title}</summary>
      <div>{props.children}</div>
    </details>
  );
}

export function Qty({ n }: { n: number }) {
  return <>{fmtNum(n)}</>;
}
