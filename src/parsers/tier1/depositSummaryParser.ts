import type { ParsedFileInput, SkippedRowRecord } from '../../types/models';
import { makeId } from '../normalizers';
import type { ParseContext, ParseOutput, StatementParser } from '../types';

export const depositSummaryParser: StatementParser = {
  id: 'tier1-deposit-summary',
  name: 'Term / Fixed Deposit Account Summary',

  canParse(input: ParsedFileInput): number {
    if (input.sheets.length === 0) return 0;
    for (const sheet of input.sheets) {
      const topText = sheet.rows
        .slice(0, 20)
        .map((r) => r.join(' '))
        .join(' ')
        .toLowerCase();
      const hasFdTitle = topText.includes('fd account summary') || topText.includes('fixed deposit number');
      const hasMaturity = topText.includes('maturity amount') && topText.includes('maturity date');
      const hasTxCols = topText.includes('transaction date') || topText.includes('withdrawal') || topText.includes('particulars');
      if (hasFdTitle && hasMaturity && !hasTxCols) {
        return 0.98;
      }
    }
    return 0;
  },

  parse(input: ParsedFileInput, ctx: ParseContext): ParseOutput {
    const sheet = input.sheets[0];
    const rows = sheet?.rows ?? [];
    const skippedRows: SkippedRowRecord[] = [];

    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const joined = rows[i].join(' ').toLowerCase();
      if (joined.includes('deposit number') && joined.includes('maturity')) {
        headerIdx = i;
        break;
      }
    }

    let headers: string[] = [];
    const summaryRows: string[][] = [];

    if (headerIdx >= 0) {
      const colIndices: number[] = [];
      rows[headerIdx].forEach((cell, idx) => {
        if (cell.trim()) {
          colIndices.push(idx);
          headers.push(cell.trim());
        }
      });

      for (let i = 0; i < headerIdx; i++) {
        const raw = rows[i].filter((c) => c.trim()).join(' | ');
        if (raw) {
          skippedRows.push({
            id: makeId('skip'),
            importId: ctx.importId,
            rowIndex: i + 1,
            reason: 'Summary title / banner row',
            rawContent: raw,
          });
        }
      }

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const vals = colIndices.map((ci) => (rows[i][ci] ?? '').trim());
        if (vals.some(Boolean)) {
          summaryRows.push(vals);
          skippedRows.push({
            id: makeId('skip'),
            importId: ctx.importId,
            rowIndex: i + 1,
            reason: 'Non-transaction deposit summary entry',
            rawContent: vals.join(' | '),
          });
        }
      }
    }

    return {
      importKind: 'summary_only',
      detectedFormat: 'Term / Fixed Deposit Account Summary (No Transactions)',
      parserTier: 'tier1',
      status: 'no_transactions',
      accounts: [],
      transactions: [],
      holdings: [],
      skippedRows,
      warnings: [
        'This file contains a deposit balance summary rather than a transaction ledger. No QIF transactions were generated.',
      ],
      summaryTable: {
        title: 'Detected Deposit Summary',
        headers,
        rows: summaryRows,
      },
    };
  },
};
