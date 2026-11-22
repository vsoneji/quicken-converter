import type { ParsedFileInput, SkippedRowRecord, TransactionRecord } from '../../types/models';
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

function isMonthlyHeaderRow(row: string[]): boolean {
  const cells = row.map((c) => c.trim().toLowerCase());
  return (
    cells[0] === 'date' &&
    cells.includes('particulars') &&
    cells.includes('deposits') &&
    cells.includes('withdrawals')
  );
}

export const monthlyCsvParser: StatementParser = {
  id: 'tier1-monthly-csv',
  name: 'Monthly Statement CSV (Boilerplate + Sections)',

  canParse(input: ParsedFileInput): number {
    if (input.fileType !== 'csv' || input.sheets.length === 0) return 0;
    const rows = input.sheets[0].rows;
    let hasHeader = false;
    let hasBanner = false;
    for (let i = 0; i < rows.length; i++) {
      if (isMonthlyHeaderRow(rows[i])) hasHeader = true;
      const line = rows[i].join(' ');
      if (/statement of transactions in/i.test(line)) hasBanner = true;
    }
    if (hasHeader && hasBanner) return 0.96;
    if (hasHeader) return 0.85;
    return 0;
  },

  parse(input: ParsedFileInput, ctx: ParseContext): ParseOutput {
    const rows = input.sheets[0].rows;
    const skippedRows: SkippedRowRecord[] = [];
    const accounts: ParsedAccountDraft[] = [];
    const transactions: TransactionRecord[] = [];
    const warnings: string[] = [];

    let i = 0;
    let boilerplateSkippedCount = 0;

    while (i < rows.length) {
      if (!isMonthlyHeaderRow(rows[i])) {
        const line = rows[i].filter((c) => c.trim()).join(' | ');
        if (line) {
          boilerplateSkippedCount++;
          if (skippedRows.length < 40) {
            skippedRows.push({
              id: makeId('skip'),
              importId: ctx.importId,
              rowIndex: i + 1,
              reason: 'Non-transaction header / summary / boilerplate row',
              rawContent: line,
            });
          }
        }
        i++;
        continue;
      }

      // Look back up to 3 lines for account banner
      let accountNum = 'Account';
      let accountType = 'Savings';
      let currency = ctx.config.currency;
      for (let back = 1; back <= 3 && i - back >= 0; back++) {
        const banner = rows[i - back].join(' ');
        const acctMatch = /(?:SavingsNumber|Account\s*No\.?|A\/c)\s*:?\s*([X*\d]{4,})/i.exec(banner);
        if (acctMatch) accountNum = acctMatch[1];
        const currMatch = /\bin\s+(INR|USD|EUR|GBP)\b/i.exec(banner);
        if (currMatch) currency = currMatch[1].toUpperCase();
        if (/NRE/i.test(banner)) accountType = 'Savings - NRE';
        else if (/NRO/i.test(banner)) accountType = 'Savings - NRO';
      }

      // Also check ACCOUNT DETAILS section earlier in file for NRE/NRO label
      for (let k = 0; k < i; k++) {
        const line = rows[k].join(' ');
        if (accountNum !== 'Account' && line.includes(accountNum)) {
          if (/NRE/i.test(line)) accountType = 'Savings - NRE';
          else if (/NRO/i.test(line)) accountType = 'Savings - NRO';
        }
      }

      const headerRow = rows[i].map((c) => c.trim().toLowerCase());
      const dateCol = headerRow.indexOf('date');
      const modeCol = headerRow.indexOf('mode');
      const partCol = headerRow.indexOf('particulars');
      const depCol = headerRow.indexOf('deposits');
      const wdrCol = headerRow.indexOf('withdrawals');
      const balCol = headerRow.indexOf('balance');

      const accountId = makeId('acc');
      const accountKey = `MONTHLY-${accountNum}`;
      accounts.push({
        id: accountId,
        accountKey,
        accountNumberMasked: accountNum,
        detectedType: accountType,
        currency,
        defaultQuickenName: `${accountType} (${accountNum.slice(-4)})`,
        defaultQuickenType: 'Bank',
      });

      // Collect block rows until blank/non-date section break
      const blockRows: { rowNumber: number; cells: string[] }[] = [];
      let j = i + 1;
      while (j < rows.length) {
        const cells = rows[j];
        const joined = cells.filter((c) => c.trim()).join(' ').trim();
        if (!joined) {
          j++;
          // Stop block if next non-empty line is a new summary section
          if (j < rows.length && /summary of|account related|statement of transactions/i.test(rows[j].join(' '))) {
            break;
          }
          continue;
        }
        if (/summary of|account related|statement of transactions/i.test(joined) || isMonthlyHeaderRow(cells)) {
          break;
        }
        blockRows.push({ rowNumber: j + 1, cells });
        j++;
      }

      const dateSamples = blockRows.map((b) => b.cells[dateCol] ?? '');
      const dateOrder = inferDateOrderFromSamples(dateSamples, ctx.config.defaultInputDateOrder);

      for (const item of blockRows) {
        const rawLine = item.cells.filter((c) => c.trim()).join(' | ');
        const skipReason = matchSkipPattern(item.cells);
        if (skipReason) {
          skippedRows.push({
            id: makeId('skip'),
            importId: ctx.importId,
            rowIndex: item.rowNumber,
            reason: skipReason,
            rawContent: rawLine,
          });
          continue;
        }

        const isoDate = parseDateToIso(item.cells[dateCol] ?? '', dateOrder);
        if (!isoDate) {
          skippedRows.push({
            id: makeId('skip'),
            importId: ctx.importId,
            rowIndex: item.rowNumber,
            reason: 'Non-transaction row (invalid date)',
            rawContent: rawLine,
          });
          continue;
        }

        const dep = depCol >= 0 ? parseAmount(item.cells[depCol] ?? '') ?? 0 : 0;
        const wdr = wdrCol >= 0 ? parseAmount(item.cells[wdrCol] ?? '') ?? 0 : 0;
        const amount = Math.round((dep - Math.abs(wdr)) * 100) / 100;
        const balance = balCol >= 0 ? parseAmount(item.cells[balCol] ?? '') ?? undefined : undefined;
        const rawRemarks = partCol >= 0 ? (item.cells[partCol] ?? '').trim() : '';
        const mode = modeCol >= 0 ? (item.cells[modeCol] ?? '').trim() || undefined : undefined;

        transactions.push({
          id: makeId('tx'),
          importId: ctx.importId,
          accountId,
          rowIndex: item.rowNumber,
          txDate: isoDate,
          amount,
          balance,
          mode,
          rawRemarks,
          payee: derivePayee(rawRemarks),
          memo: rawRemarks,
          category: '',
          clearedStatus: ctx.config.defaultClearedStatus,
          isIncluded: true,
          warnings: [],
        });
      }

      i = j;
    }

    if (boilerplateSkippedCount > 40) {
      skippedRows.push({
        id: makeId('skip'),
        importId: ctx.importId,
        rowIndex: 0,
        reason: `Truncated diagnostics (${boilerplateSkippedCount - 40} additional boilerplate rows skipped)`,
        rawContent: '...',
      });
    }

    checkBalanceContinuity(transactions);

    return {
      importKind: transactions.length > 0 ? 'transactions' : 'summary_only',
      detectedFormat: 'Monthly Statement CSV',
      parserTier: 'tier1',
      status: transactions.length > 0 ? 'parsed' : 'no_transactions',
      accounts,
      transactions,
      holdings: [],
      skippedRows,
      warnings,
    };
  },
};
