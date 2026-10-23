// Datamodel van de app. Alle bedragen in EUR, tenzij anders vermeld.

export type AssetType = 'ETF' | 'Aandeel' | 'Obligatie' | 'Fonds' | 'Crypto' | 'Andere';

export interface Asset {
  id: string;
  name: string;
  isin?: string;
  ticker?: string;
  type: AssetType;
  /** TOB-tarief in % (0.12, 0.35, 1.32 of 0 voor crypto). Enkel voor kostenschatting in de planner. */
  tobRate?: number;
  /** Huidige koers per eenheid in EUR (manueel bijgewerkt). */
  currentPrice?: number;
  priceDate?: string; // YYYY-MM-DD
}

export interface Account {
  id: string;
  name: string;
  broker?: string;
  /** Belgische bank/broker die 10% roerende voorheffing inhoudt bij verkoop (geen opt-out). */
  withholds: boolean;
  notes?: string;
}

/** Positie zoals ze stond op 31/12/2025 ("fotomoment"). */
export interface StartPosition {
  id: string;
  accountId: string;
  assetId: string;
  quantity: number;
  /** Slotkoers per eenheid op 31/12/2025, in EUR. */
  value20251231PerUnit: number;
  /** Optioneel: werkelijke historische aankoopprijs (totaal, EUR) van deze hoeveelheid. Enkel nuttig als die hoger is dan de waarde op 31/12/2025 (regel tot 31/12/2030). */
  historicalCostTotal?: number;
}

export type TxType = 'koop' | 'verkoop' | 'transfer';

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD (transactiedatum, niet valutadatum)
  type: TxType;
  accountId: string;
  /** Enkel voor transfer: naar welke eigen rekening. */
  toAccountId?: string;
  assetId: string;
  quantity: number; // altijd positief
  /** Brutobedrag in EUR = aantal x koers, ZONDER kosten en taksen. */
  amountEUR: number;
  /** Makelaarsloon + TOB in EUR (informatief: fiscaal niet aftrekbaar). */
  costsEUR?: number;
  /** Door de bank ingehouden meerwaardebelasting (10%) in EUR. */
  withheldEUR?: number;
  /** Originele munt en bedrag, als niet in EUR. */
  currency?: string;
  amountOriginal?: number;
  fxRate?: number; // 1 eenheid vreemde munt = fxRate EUR
  note?: string;
  source?: string; // bv. bestandsnaam van import
}

export type FifoScope = 'belastingplichtige' | 'rekening';

export interface Settings {
  taxRate: number; // 10
  /** Basisvrijstelling per inkomstenjaar. Ontbrekende jaren nemen de laatst gekende waarde over. */
  exemptionByYear: Record<string, number>;
  /** Max. overdraagbaar onbenut deel per jaar (1.000). */
  carryPerYear: number;
  /** Hoeveel jaar een overgedragen schijf geldig blijft (5). */
  carryYears: number;
  /** Laatste verkoopdatum waarop de hogere historische aanschaffingswaarde nog mag gebruikt worden. */
  historicalCostDeadline: string; // '2030-12-31'
  fifoScope: FifoScope;
  /** Standaard makelaarsloon per order voor de planner. */
  defaultOrderFee: number;
  /** Standaard spread in % voor de planner. */
  defaultSpreadPct: number;
}

export interface AppData {
  version: 2;
  accounts: Account[];
  assets: Asset[];
  startPositions: StartPosition[];
  transactions: Transaction[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  taxRate: 10,
  exemptionByYear: { '2026': 10000 },
  carryPerYear: 1000,
  carryYears: 5,
  historicalCostDeadline: '2030-12-31',
  fifoScope: 'belastingplichtige',
  defaultOrderFee: 2,
  defaultSpreadPct: 0.1,
};

export const emptyData = (): AppData => ({
  version: 2,
  accounts: [],
  assets: [],
  startPositions: [],
  transactions: [],
  settings: { ...DEFAULT_SETTINGS, exemptionByYear: { ...DEFAULT_SETTINGS.exemptionByYear } },
});

export const TOB_PRESETS: { label: string; rate: number; cap: number }[] = [
  { label: '0,12% – ETF distribuerend of niet in BE geregistreerd, obligaties', rate: 0.12, cap: 1300 },
  { label: '0,35% – aandelen', rate: 0.35, cap: 1600 },
  { label: '1,32% – kapitaliserend fonds/ETF geregistreerd in BE', rate: 1.32, cap: 4000 },
  { label: '0% – crypto / geen TOB', rate: 0, cap: 0 },
];

export function defaultTobRate(type: AssetType): number {
  switch (type) {
    case 'Crypto':
      return 0;
    case 'Obligatie':
      return 0.12;
    case 'ETF':
    case 'Fonds':
      return 0.12;
    default:
      return 0.35;
  }
}
