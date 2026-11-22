import * as XLSX from 'xlsx';
import type { RawSheet } from '../types/models';

export function readExcelBuffer(buffer: ArrayBuffer): RawSheet[] {
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: 'array',
    cellDates: false,
    raw: false,
  });

  const sheets: RawSheet[] = [];
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: '',
      blankrows: true,
      raw: false,
    });
    const rows: string[][] = rawRows.map((row) =>
      Array.isArray(row) ? row.map((cell) => (cell == null ? '' : String(cell))) : []
    );
    sheets.push({ name: sheetName, rows });
  }
  return sheets;
}
