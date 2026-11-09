// CSV ndogo ya kivinjari: inasoma faili lililohifadhiwa kutoka Excel ("Save as CSV").
// Inakubali , au ; (Excel ya mipangilio ya Ulaya), BOM ya UTF-8 na nukuu ("...").

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/** Badilisha mistari kuwa vitu kwa kutumia vichwa (vichwa vya Kiswahili au Kiingereza). */
export function rowsToObjects(rows: string[][], aliases: Record<string, string[]>): { data: Record<string, string>[]; unknown: string[]; missing: string[] } {
  const [head, ...body] = rows;
  if (!head) return { data: [], unknown: [], missing: Object.keys(aliases) };
  const map: (string | null)[] = head.map((h) => {
    const n = norm(h);
    for (const [key, names] of Object.entries(aliases)) if (names.some((a) => norm(a) === n)) return key;
    return null;
  });
  const unknown = head.filter((_, i) => !map[i] && head[i].trim());
  const missing = Object.keys(aliases).filter((k) => !map.includes(k));
  const data = body.map((r) => {
    const o: Record<string, string> = {};
    map.forEach((k, i) => { if (k) o[k] = (r[i] ?? '').trim(); });
    return o;
  });
  return { data, unknown, missing };
}

/** Pakua CSV (kiolezo au ripoti) — inafunguka vizuri kwenye Excel (BOM + ;?) */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => { const s = String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
