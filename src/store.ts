import { useEffect, useState } from 'react';
import { emptyData, DEFAULT_SETTINGS, defaultTobRate, type AppData, type Asset, type AssetType } from './engine/types';

const KEY = 'meerwaarde.v2';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    return normalize(JSON.parse(raw));
  } catch {
    return emptyData();
  }
}

export function normalize(d: Partial<AppData>): AppData {
  const e = emptyData();
  return {
    version: 2,
    accounts: d.accounts ?? e.accounts,
    assets: d.assets ?? e.assets,
    startPositions: d.startPositions ?? e.startPositions,
    transactions: d.transactions ?? e.transactions,
    settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}), exemptionByYear: { ...DEFAULT_SETTINGS.exemptionByYear, ...(d.settings?.exemptionByYear ?? {}) } },
  };
}

export function usePersistentData() {
  const [data, setData] = useState<AppData>(loadData);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      setSavedAt(new Date());
    } catch {
      setSavedAt(null);
    }
  }, [data]);
  return [data, setData, savedAt] as const;
}

/** Zoek een bestaand effect op ISIN, ticker of naam; anders maak een nieuw aan. */
export function findOrCreateAsset(
  assets: Asset[],
  p: { name?: string; isin?: string; ticker?: string; type?: AssetType },
): { asset: Asset; created: boolean } {
  const isin = p.isin?.trim().toUpperCase();
  const ticker = p.ticker?.trim().toUpperCase();
  const name = (p.name || '').trim();
  const found =
    (isin && assets.find((a) => a.isin === isin)) ||
    (ticker && assets.find((a) => a.ticker === ticker)) ||
    (name && assets.find((a) => a.name.toLowerCase() === name.toLowerCase()));
  if (found) return { asset: found, created: false };
  const type = p.type ?? guessAssetType(isin, name, ticker);
  return {
    asset: { id: uid(), name: name || ticker || isin || 'Onbekend', isin, ticker, type, tobRate: defaultTobRate(type) },
    created: true,
  };
}

const CRYPTO = ['BTC', 'ETH', 'SOL', 'ADA', 'XRP', 'DOT', 'DOGE', 'USDC', 'USDT', 'LINK', 'AVAX', 'MATIC', 'BNB', 'LTC'];

export function guessAssetType(isin?: string, name?: string, ticker?: string): AssetType {
  const n = (name || '').toLowerCase();
  if (ticker && CRYPTO.includes(ticker)) return 'Crypto';
  if (/bitcoin|ethereum|solana|crypto/.test(n)) return 'Crypto';
  if (/\betf\b|ishares|vanguard|spdr|xtrackers|amundi|ucits|lyxor|invesco/.test(n)) return 'ETF';
  if (/obligatie|bond|staatsbon/.test(n)) return 'Obligatie';
  if (isin && /^(IE|LU)/.test(isin)) return 'ETF';
  return 'Aandeel';
}

export function demoData(): AppData {
  const d = emptyData();
  d.accounts = [
    { id: 'acc1', name: 'Bolero', broker: 'Bolero (BE)', withholds: true },
    { id: 'acc2', name: 'DEGIRO', broker: 'DEGIRO (NL)', withholds: false },
    { id: 'acc3', name: 'Bitvavo', broker: 'Bitvavo', withholds: false },
  ];
  d.assets = [
    { id: 'a1', name: 'iShares Core MSCI World', isin: 'IE00B4L5Y983', ticker: 'IWDA', type: 'ETF', tobRate: 0.12, currentPrice: 112, priceDate: '2026-10-01' },
    { id: 'a2', name: 'NVIDIA', isin: 'US67066G1040', ticker: 'NVDA', type: 'Aandeel', tobRate: 0.35, currentPrice: 160, priceDate: '2026-10-01' },
    { id: 'a3', name: 'Bitcoin', ticker: 'BTC', type: 'Crypto', tobRate: 0, currentPrice: 98000, priceDate: '2026-10-01' },
    { id: 'a4', name: 'Apple', isin: 'US0378331005', ticker: 'AAPL', type: 'Aandeel', tobRate: 0.35, currentPrice: 250, priceDate: '2026-10-01' },
  ];
  d.startPositions = [
    { id: 's1', accountId: 'acc1', assetId: 'a1', quantity: 200, value20251231PerUnit: 100 },
    { id: 's2', accountId: 'acc2', assetId: 'a2', quantity: 80, value20251231PerUnit: 120 },
    { id: 's3', accountId: 'acc3', assetId: 'a3', quantity: 0.25, value20251231PerUnit: 80000 },
    { id: 's4', accountId: 'acc2', assetId: 'a4', quantity: 20, value20251231PerUnit: 230, historicalCostTotal: 5200 },
  ];
  d.transactions = [
    { id: 't1', date: '2026-02-10', type: 'koop', accountId: 'acc1', assetId: 'a1', quantity: 50, amountEUR: 5250, costsEUR: 6.3 },
    { id: 't2', date: '2026-05-20', type: 'verkoop', accountId: 'acc2', assetId: 'a2', quantity: 30, amountEUR: 4500, costsEUR: 2 },
    { id: 't3', date: '2026-06-15', type: 'verkoop', accountId: 'acc3', assetId: 'a3', quantity: 0.05, amountEUR: 4700, costsEUR: 11 },
  ];
  return d;
}
