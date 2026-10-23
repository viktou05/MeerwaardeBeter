// Minimale Excel-lezer (.xlsx) zonder externe bibliotheek: pakt het ZIP-bestand uit met de
// ingebouwde DecompressionStream van de browser en leest het eerste werkblad als tabel.
// Oude .xls-bestanden (binair formaat) worden niet ondersteund.

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lees alle bestanden uit een ZIP (via de centrale directory). */
async function unzip(buf: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Geen geldig .xlsx-bestand');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + compSize);
    const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : undefined;
    if (data) out.set(name, dec.decode(data));
  }
  return out;
}

const decodeXml = (s: string) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    const l = e.toLowerCase();
    if (l === 'lt') return '<';
    if (l === 'gt') return '>';
    if (l === 'amp') return '&';
    if (l === 'quot') return '"';
    if (l === 'apos') return "'";
    return String.fromCodePoint(l.startsWith('#x') ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
  });

/** Alle tekst binnen <t>-elementen (ook rich text met meerdere runs). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('');

const colIndex = (ref: string) => {
  const letters = ref.replace(/\d+$/, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** Welke stijlindexen (s="…") zijn datums? */
function dateStyles(stylesXml: string | undefined): Set<number> {
  const res = new Set<number>();
  if (!stylesXml) return res;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), decodeXml(m[2]));
  const xfs = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  [...xfs.matchAll(/<xf\b([^>]*)\/?>/g)].forEach((m, i) => {
    const id = Number(m[1].match(/numFmtId="(\d+)"/)?.[1] ?? 0);
    const code = (custom.get(id) ?? '').replace(/\[[^\]]*\]|"[^"]*"/g, '').toLowerCase();
    if (BUILTIN_DATE_FORMATS.has(id) || (/[dy]/.test(code) && !/^[#0.,% ]*$/.test(code))) res.add(i);
  });
  return res;
}

/** Excel-serienummer → YYYY-MM-DD (met tijd als die er is). */
export function excelSerialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  const iso = d.toISOString();
  return serial % 1 ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : iso.slice(0, 10);
}

/** Zet de eerste (of opgegeven) sheet van een .xlsx-bestand om naar een tabel met tekst. */
export async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(n));
  // Eerste sheet volgens workbook.xml
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  const rid = wb?.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  if (rid && rels) {
    const target = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ??
      rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = files.get(sheetPath) ?? [...files.entries()].find(([k]) => k.startsWith('xl/worksheets/'))?.[1];
  if (!sheet) throw new Error('Geen werkblad gevonden in dit Excel-bestand');
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const dates = dateStyles(files.get('xl/styles.xml'));

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const out: string[] = [];
    let next = 0;
    for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const idx = ref ? colIndex(ref) : next;
      next = idx + 1;
      const t = attrs.match(/\bt="(\w+)"/)?.[1];
      const s = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? -1);
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = textOf(body);
      else if (t === 'str' || t === 'e') val = decodeXml(v ?? '');
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) {
        const num = Number(v);
        val = dates.has(s) && Number.isFinite(num) && num > 1 ? excelSerialToDate(num) : v;
      }
      while (out.length < idx) out.push('');
      out[idx] = val.trim();
    }
    if (out.some((x) => x !== '')) rows.push(out);
  }
  return rows;
}

/** Tabel → tekst met tabs, zodat ze door dezelfde importpijplijn kan als geplakte tekst. */
export function rowsToTsv(rows: string[][]): string {
  const q = (s: string) => (/[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(q).join('\t')).join('\n');
}
