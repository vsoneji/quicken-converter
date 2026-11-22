import type {
  ColumnRole,
  ParsedFileInput,
  SkippedRowRecord,
  TransactionRecord,
} from '../../types/models';
import {
  checkBalanceContinuity,
  derivePayee,
  inferDateOrderFromSamples,
  makeId,
  matchSkipPattern,
  parseAmount,
  parseDateToIso,
} from '../normalizers';
import type { ParseContext, ParsedAccountDraft, ParseOutput, StatementParser } from '../types';

interface DetectedHeader {
  rowIndex: number;
  columnMap: Record<number, ColumnRole>;
  score: number;
}

function classifyHeaderCell(cell: string): ColumnRole {
  const s = cell.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return 'ignore';

  if (/^(txn\s*dt|txn\s*date|transaction\s*date|trans\s*date|posting\s*date|date)$/.test(s)) {
    return 'date';
  }
  if (/^(value\s*dt|value\s*date)$/.test(s)) {
    return 'ignore'; // handled separately if no primary date column
  }
  if (/(particulars|remarks|narration|description|details|memo|payee)/.test(s)) {
    return 'description';
  }
  if (/(withdrawal|debit|paid\s*out|dr\.?\s*amt)/.test(s) && !/dr\s*\/\s*cr/.test(s)) {
    return 'withdrawal';
  }
  if (/(deposit|credit|paid\s*in|cr\.?\s*amt)/.test(s) && !/dr\s*\/\s*cr/.test(s)) {
    return 'deposit';
  }
  if (/^(dr\s*\/\s*cr|cr\s*\/\s*dr|type|txn\s*type|indicator)$/.test(s)) {
    return 'drcr';
  }
  if (/(^amt\b|^amount\b|amount\s*\(|amt\s*\()/.test(s)) {
    return 'amount';
  }
  if (/(balance|running\s*bal|closing\s*bal)/.test(s)) {
    return 'balance';
  }
  if (/(cheque|chq|ref\s*no|ref\s*id|utr|reference)/.test(s)) {
    return 'ref';
  }
  if (/(mode|channel|payment\s*channel)/.test(s)) {
    return 'mode';
  }
  return 'ignore';
}

function scoreHeaderRow(row: string[]): DetectedHeader | null {
  const columnMap: Record<number, ColumnRole> = {};
  let hasDate = false;
  let hasDesc = false;
  let hasAmount = false;
  let hasDep = false;
  let hasWdr = false;
  let hasBalance = false;
  let score = 0;

  row.forEach((cell, idx) => {
    const role = classifyHeaderCell(cell);
    if (role !== 'ignore') {
      columnMap[idx] = role;
      if (role === 'date') { hasDate = true; score += 3; }
      else if (role === 'description') { hasDesc = true; score += 2; }
      else if (role === 'deposit') { hasDep = true; score += 2; }
      else if (role === 'withdrawal') { hasWdr = true; score += 2; }
      else if (role === 'amount') { hasAmount = true; score += 2; }
      else if (role === 'balance') { hasBalance = true; score += 1; }
      else score += 1;
    }
  });

  if (!hasDate) return null;
  if (!(hasAmount || hasDep || hasWdr)) return null;
  if (!hasDesc && !hasBalance) return null;

  return { rowIndex: 0, columnMap, score };
}

function findAllHeadersInSheet(rows: string[][]): DetectedHeader[] {
  const results: DetectedHeader[] = [];
  for (let i = 0; i < rows.length; i++) {
    const candidate = scoreHeaderRow(rows[i]);
    if (candidate && candidate.score >= 5) {
      results.push({ ...candidate, rowIndex: i });
    }
  }
  return results;
}

export const heuristicParser: StatementParser = {
  id: 'tier2-heuristic',
  name: 'Generic Heuristic Statement Parser',

  canParse(input: ParsedFileInput): number {
    if (input.sheets.length === 0) return 0;
    for (const sheet of input.sheets) {
      if (findAllHeadersInSheet(sheet.rows).length > 0) {
        return 0.72;
      }
    }
    return 0;
  },

  parse(input: ParsedFileInput, ctx: ParseContext): ParseOutput {
    const accounts: ParsedAccountDraft[] = [];
    const transactions: TransactionRecord[] = [];
    const skippedRows: SkippedRowRecord[] = [];
    const warnings: string[] = [];

    for (let sIdx = 0; sIdx < input.sheets.length; sIdx++) {
      const sheet = input.sheets[sIdx];
      const rows = sheet.rows;
      const headers = findAllHeadersInSheet(rows);
      if (headers.length === 0) continue;

      for (let hIdx = 0; hIdx < headers.length; hIdx++) {
        const hdr = headers[hIdx];
        const nextHdrRow = hIdx + 1 < headers.length ? headers[hIdx + 1].rowIndex : rows.length;
        const preambleStart = hIdx === 0 ? 0 : headers[hIdx - 1].rowIndex + 1;

        // Extract account hint from lines right above this header
        let accountLabel = input.sheets.length > 1 ? sheet.name : `Account ${accounts.length + 1}`;
        let accountNumber = `ACCT-${accounts.length + 1}`;
        let currency = ctx.config.currency;

        const lookbackStart = Math.max(preambleStart, hdr.rowIndex - 8);
        for (let k = lookbackStart; k < hdr.rowIndex; k++) {
          const line = rows[k].filter((c) => c.trim()).join(' ').trim();
          if (!line) continue;
          if (hIdx === 0) {
            skippedRows.push({
              id: makeId('skip'),
              importId: ctx.importId,
              rowIndex: k + 1,
              reason: 'Metadata / header preamble',
              rawContent: line,
            });
          }
          const acctSection = /account\s*section\s*:?\s*(.+)/i.exec(line);
          if (acctSection) accountLabel = acctSection[1].trim();
          const acctNumMatch = /(?:account\s*(?:number|no\.?)|a\/c)\s*:?\s*([X*\d-]{4,})/i.exec(line);
          if (acctNumMatch) accountNumber = acctNumMatch[1];
          const maskedMatch = /(X{4,}\d{3,4})/i.exec(line);
          if (maskedMatch) accountNumber = maskedMatch[1];
          const currMatch = /\b(INR|USD|EUR|GBP)\b/i.exec(line);
          if (currMatch) currency = currMatch[1].toUpperCase();
        }

        const findCol = (role: ColumnRole): number => {
          for (const [k, v] of Object.entries(hdr.columnMap)) {
            if (v === role) return Number(k);
          }
          return -1;
        };

        const dateCol = findCol('date');
        const descCol = findCol('description');
        const depCol = findCol('deposit');
        const wdrCol = findCol('withdrawal');
        const amtCol = findCol('amount');
        const drcrCol = findCol('drcr');
        const balCol = findCol('balance');
        const refCol = findCol('ref');
        const modeCol = findCol('mode');

        const accountId = makeId('acc');
        accounts.push({
          id: accountId,
          accountKey: `HEUR-${accountNumber}-${hIdx}`,
          accountNumberMasked: accountNumber,
          detectedType: 'Bank Account',
          currency,
          defaultQuickenName:
            accountLabel !== `Account ${accounts.length + 1}`
              ? accountLabel
              : `Account (${accountNumber.slice(-4)})`,
          defaultQuickenType: 'Bank',
        });

        const sectionRows = rows.slice(hdr.rowIndex + 1, nextHdrRow);
        const dateSamples = sectionRows.map((r) => (dateCol >= 0 ? r[dateCol] ?? '' : ''));
        const dateOrder = inferDateOrderFromSamples(dateSamples, ctx.config.defaultInputDateOrder);

        for (let rOffset = 0; rOffset < sectionRows.length; rOffset++) {
          const r = sectionRows[rOffset];
          const rowNumber = hdr.rowIndex + 2 + rOffset;
          const rawLine = r.filter((c) => c.trim()).join(' | ');
          if (!rawLine) continue;

          if (/^(statement summary|end of statement|account section)/i.test(rawLine)) {
            skippedRows.push({
              id: makeId('skip'),
              importId: ctx.importId,
              rowIndex: rowNumber,
              reason: 'Section footer / summary boundary',
              rawContent: rawLine,
            });
            break;
          }

          const skipReason = matchSkipPattern(r);
          if (skipReason) {
            skippedRows.push({
              id: makeId('skip'),
              importId: ctx.importId,
              rowIndex: rowNumber,
              reason: skipReason,
              rawContent: rawLine,
            });
            continue;
          }

          const isoDate = dateCol >= 0 ? parseDateToIso(r[dateCol] ?? '', dateOrder) : null;
          if (!isoDate) {
            skippedRows.push({
              id: makeId('skip'),
              importId: ctx.importId,
              rowIndex: rowNumber,
              reason: 'No valid date in detected Date column',
              rawContent: rawLine,
            });
            continue;
          }

          let amount: number | null = null;
          if (depCol >= 0 || wdrCol >= 0) {
            const dep = depCol >= 0 ? parseAmount(r[depCol] ?? '') : null;
            const wdr = wdrCol >= 0 ? parseAmount(r[wdrCol] ?? '') : null;
            if (dep !== null || wdr !== null) {
              amount = Math.round(((dep ?? 0) - Math.abs(wdr ?? 0)) * 100) / 100;
            }
          } else if (amtCol >= 0) {
            const rawAmt = parseAmount(r[amtCol] ?? '');
            if (rawAmt !== null) {
              if (drcrCol >= 0) {
                const ind = (r[drcrCol] ?? '').trim().toLowerCase();
                const isDebit = /^(dr|debit|d|out|withdrawal)$/i.test(ind);
                amount = isDebit ? -Math.abs(rawAmt) : Math.abs(rawAmt);
              } else {
                amount = rawAmt;
              }
            }
          }

          if (amount === null) {
            skippedRows.push({
              id: makeId('skip'),
              importId: ctx.importId,
              rowIndex: rowNumber,
              reason: 'Missing or invalid amount',
              rawContent: rawLine,
            });
            continue;
          }

          const rawRemarks = descCol >= 0 ? (r[descCol] ?? '').trim() : '';
          const balance = balCol >= 0 ? parseAmount(r[balCol] ?? '') ?? undefined : undefined;
          const chequeNumber = refCol >= 0 ? (r[refCol] ?? '').trim() || undefined : undefined;
          const mode = modeCol >= 0 ? (r[modeCol] ?? '').trim() || undefined : undefined;

          transactions.push({
            id: makeId('tx'),
            importId: ctx.importId,
            accountId,
            rowIndex: rowNumber,
            txDate: isoDate,
            amount,
            balance,
            mode,
            chequeNumber,
            rawRemarks,
            payee: derivePayee(rawRemarks),
            memo: rawRemarks,
            category: '',
            clearedStatus: ctx.config.defaultClearedStatus,
            isIncluded: true,
            warnings: [],
          });
        }
      }
    }

    checkBalanceContinuity(transactions);

    return {
      importKind: transactions.length > 0 ? 'transactions' : 'summary_only',
      detectedFormat: 'Generic Statement (Heuristic Match)',
      parserTier: 'tier2',
      status: transactions.length > 0 ? 'parsed' : 'no_transactions',
      accounts: accounts.filter((a) => transactions.some((t) => t.accountId === a.id)),
      transactions,
      holdings: [],
      skippedRows,
      warnings,
    };
  },
};
