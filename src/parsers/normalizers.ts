import type { InputDateOrder, TransactionRecord } from '../types/models';

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export function normalizeHeaderSignature(cells: string[]): string {
  return cells
    .map((c) => c.trim().replace(/\s+/g, ' ').toLowerCase())
    .filter((c) => c.length > 0)
    .join('|');
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function expandTwoDigitYear(yy: number): number {
  return yy >= 70 ? 1900 + yy : 2000 + yy;
}

export function inferDateOrderFromSamples(
  samples: string[],
  fallback: InputDateOrder
): InputDateOrder {
  let dmyVotes = 0;
  let mdyVotes = 0;
  for (const s of samples) {
    const trimmed = s.trim();
    const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(trimmed);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a > 12 && b <= 12) dmyVotes++;
    else if (b > 12 && a <= 12) mdyVotes++;
  }
  if (dmyVotes > mdyVotes) return 'DMY';
  if (mdyVotes > dmyVotes) return 'MDY';
  return fallback;
}

export function parseDateToIso(
  raw: string,
  order: InputDateOrder = 'DMY',
  explicitFormat?: string
): string | null {
  const s = raw.trim();
  if (!s) return null;

  // Excel serial number (e.g., 45605)
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial > 20000 && serial < 70000) {
      const utcMs = (serial - 25569) * 86400 * 1000;
      const dt = new Date(utcMs);
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth() + 1;
      const d = dt.getUTCDate();
      if (isValidYmd(y, m, d)) return `${y}-${pad2(m)}-${pad2(d)}`;
    }
  }

  // ISO or YYYY/MM/DD
  let m = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(s);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    return isValidYmd(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }

  // DD-MMM-YYYY, DD MMM YYYY, DD,MMM,YYYY, DD/MMM/YYYY, or 2-digit year
  m = /^(\d{1,2})[\s/.,-]+([A-Za-z]{3,9})[\s/.,-]+(\d{2,4})$/.exec(s);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = MONTH_MAP[m[2].toLowerCase()];
    const rawY = parseInt(m[3], 10);
    const y = m[3].length === 2 ? expandTwoDigitYear(rawY) : rawY;
    return mo && isValidYmd(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }

  // MMM DD, YYYY or Month DD YYYY
  m = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTH_MAP[m[1].toLowerCase()];
    const d = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    return mo && isValidYmd(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }

  // Numeric DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY / MM/DD/YYYY / DD/MM/YY
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const rawY = parseInt(m[3], 10);
    const y = m[3].length === 2 ? expandTwoDigitYear(rawY) : rawY;

    const effectiveOrder: InputDateOrder =
      explicitFormat?.toUpperCase().startsWith('MM') ? 'MDY' :
      explicitFormat?.toUpperCase().startsWith('DD') ? 'DMY' :
      order;

    if (effectiveOrder === 'DMY') {
      if (isValidYmd(y, b, a)) return `${y}-${pad2(b)}-${pad2(a)}`;
      if (isValidYmd(y, a, b)) return `${y}-${pad2(a)}-${pad2(b)}`;
    } else {
      if (isValidYmd(y, a, b)) return `${y}-${pad2(a)}-${pad2(b)}`;
      if (isValidYmd(y, b, a)) return `${y}-${pad2(b)}-${pad2(a)}`;
    }
  }

  return null;
}

export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s || s === '-' || s === '--' || s.toLowerCase() === 'na') return null;

  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  // Strip currency codes/symbols and spaces
  s = s.replace(/(?:INR|USD|EUR|GBP|Rs\.?|₹|\$|£|€)/gi, '').replace(/,/g, '').replace(/\s+/g, '');
  if (!s) return null;

  const num = Number(s);
  if (!Number.isFinite(num)) return null;
  const result = negative ? -Math.abs(num) : num;
  return Math.round(result * 100) / 100;
}

export function derivePayee(rawRemarks: string): string {
  const cleaned = rawRemarks
    .replace(/\s+/g, ' ')
    .replace(/^(?:VISA|Credit|Debit)\s+trxn\s+/i, '')
    .trim();
  if (!cleaned) return 'Transaction';

  if (/int\.?\s*pd|credit interest/i.test(cleaned)) return 'Interest Paid';
  if (/wtax\.?\s*pd|tds/i.test(cleaned)) return 'Tax Withheld (TDS)';
  if (/dcardfee|annual fee/i.test(cleaned)) return 'Debit Card Fee';

  // VSI/MERCHANT/... or VIN/MERCHANT/...
  const slashCard = /^(?:VSI|VIN|VPS|IPS)\/([^/]+)/i.exec(cleaned);
  if (slashCard && slashCard[1].trim()) {
    return toTitleCase(slashCard[1].trim());
  }

  // BIL/NEFT/REF/... or BIL/INFT/REF/...
  const bilMatch = /^BIL\/(?:NEFT|INFT|IMPS)\/[^/]+\/(?:[^/]*\/)*([^/]+)$/i.exec(cleaned);
  if (bilMatch && bilMatch[1].trim()) {
    return toTitleCase(bilMatch[1].trim());
  }

  // UPI-MERCHANT-... or UPI/MERCHANT/...
  const upiDash = /^UPI[-/]([^-/]+)/i.exec(cleaned);
  if (upiDash && upiDash[1].trim() && !/^(DR|CR|\d+)$/i.test(upiDash[1].trim())) {
    return toTitleCase(upiDash[1].trim());
  }

  // Fallback: first 40 chars cleaned up
  return cleaned.length > 44 ? `${cleaned.slice(0, 44).trim()}...` : cleaned;
}

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

const DEFAULT_SKIP_TERMS = [
  'b/f',
  'brought forward',
  'opening balance',
  'closing balance',
  'carried forward',
  'c/f',
  'grand total',
];

export function matchSkipPattern(rowCells: string[], customPatterns: string[] = []): string | null {
  const nonEmpty = rowCells.map((c) => c.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return 'Blank row';

  const joined = nonEmpty.join(' ').toLowerCase();

  // Exact cell matches for B/F or Total
  for (const cell of nonEmpty) {
    const lc = cell.toLowerCase();
    if (lc === 'b/f' || lc === 'total' || lc === 'total:') {
      return `Summary / non-transaction row (${cell})`;
    }
  }

  const allPatterns = [...DEFAULT_SKIP_TERMS, ...customPatterns.map((p) => p.trim().toLowerCase()).filter(Boolean)];
  for (const pat of allPatterns) {
    if (pat === 'total') {
      if (nonEmpty[0]?.toLowerCase().startsWith('total')) return 'Total summary row';
    } else if (joined.includes(pat)) {
      return `Matched skip rule: "${pat}"`;
    }
  }
  return null;
}

export function checkBalanceContinuity(transactions: TransactionRecord[]): void {
  const byAccount = new Map<string, TransactionRecord[]>();
  for (const tx of transactions) {
    const arr = byAccount.get(tx.accountId) ?? [];
    arr.push(tx);
    byAccount.set(tx.accountId, arr);
  }

  for (const list of byAccount.values()) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];
      if (prev.balance === undefined || curr.balance === undefined) continue;
      const expected = Math.round((prev.balance + curr.amount) * 100) / 100;
      if (Math.abs(expected - curr.balance) > 0.02) {
        // Also check reverse chronological order (newest-first statements)
        const expectedReverse = Math.round((curr.balance + prev.amount) * 100) / 100;
        if (Math.abs(expectedReverse - prev.balance) > 0.02) {
          curr.warnings.push(
            `Balance discontinuity: expected ${expected.toFixed(2)}, found ${curr.balance.toFixed(2)}`
          );
        }
      }
    }
  }
}

export function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildNormalizedAccountKey(
  kind: 'BANK' | 'INVST',
  rawAccountNum: string,
  fallback: string
): string {
  const digits = rawAccountNum.replace(/\D/g, '');
  if (digits.length >= 4) {
    return `${kind}-${digits.slice(-4)}`;
  }
  const slug = fallback.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${kind}-${slug || 'default'}`;
}
