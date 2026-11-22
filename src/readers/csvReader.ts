import Papa from 'papaparse';
import type { RawSheet } from '../types/models';

export function decodeCsvBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}

export function readCsvBuffer(buffer: ArrayBuffer): RawSheet[] {
  const text = decodeCsvBytes(buffer);
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: false,
    dynamicTyping: false,
  });

  const rows: string[][] = (parsed.data || []).map((row) =>
    Array.isArray(row) ? row.map((cell) => (cell == null ? '' : String(cell))) : []
  );

  return [{ name: 'CSV', rows }];
}
