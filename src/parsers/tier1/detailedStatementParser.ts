import type {
  ParsedFileInput,
  PdfPageData,
  PdfTextItem,
  SkippedRowRecord,
  TransactionRecord,
} from '../../types/models';
import {
  buildNormalizedAccountKey,
  checkBalanceContinuity,
  derivePayee,
  inferDateOrderFromSamples,
  makeId,
  matchSkipPattern,
  parseAmount,
  parseDateToIso,
} from '../normalizers';
import type { ParseContext, ParsedAccountDraft, ParseOutput, StatementParser } from '../types';

interface PdfLine {
  y: number;
  items: PdfTextItem[];
  text: string;
}

function groupPdfPageLines(page: PdfPageData, yTolerance = 4): PdfLine[] {
  const sorted = [...page.items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfLine[] = [];

  for (const item of sorted) {
    const existing = lines.find((l) => Math.abs(l.y - item.y) <= yTolerance);
    if (existing) {
      existing.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item], text: '' });
    }
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = line.items.map((it) => it.str).join(' ');
  }

  return lines;
}

function findDetailedSheetHeader(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const joined = rows[i].map((c) => c.trim().toLowerCase()).join('|');
    if (
      joined.includes('transaction date') &&
      joined.includes('transaction remarks') &&
      (joined.includes('withdrawal') || joined.includes('deposit'))
    ) {
      return i;
    }
  }
  return -1;
}

function parseDetailedExcel(input: ParsedFileInput, ctx: ParseContext): ParseOutput {
  const accounts: ParsedAccountDraft[] = [];
  const transactions: TransactionRecord[] = [];
  const skippedRows: SkippedRowRecord[] = [];
  const warnings: string[] = [];

  for (const sheet of input.sheets) {
    const rows = sheet.rows;
    const headerIdx = findDetailedSheetHeader(rows);
    if (headerIdx === -1) continue;

    // Extract account number from preamble
    let accountNum = sheet.name || 'Account';
    let currency = ctx.config.currency;
    for (let i = 0; i < headerIdx; i++) {
      const line = rows[i].filter((c) => c.trim()).join(' | ');
      if (line) {
        skippedRows.push({
          id: makeId('skip'),
          importId: ctx.importId,
          rowIndex: i + 1,
          reason: 'Search criteria / statement preamble',
          rawContent: line,
        });
      }
      const joined = rows[i].join(' ');
      if (/account number/i.test(joined)) {
        const m = /([X*\d]{6,})\s*(?:\(\s*(INR|USD|EUR|GBP)\s*\))?/i.exec(joined);
        if (m) {
          accountNum = m[1];
          if (m[2]) currency = m[2].toUpperCase();
        }
      }
    }

    const header = rows[headerIdx].map((c) => c.trim().toLowerCase());
    const txDateCol = header.findIndex((h) => h.includes('transaction date'));
    const valDateCol = header.findIndex((h) => h.includes('value date'));
    const chqCol = header.findIndex((h) => h.includes('cheque'));
    const remCol = header.findIndex((h) => h.includes('remarks'));
    const wdrCol = header.findIndex((h) => h.includes('withdrawal'));
    const depCol = header.findIndex((h) => h.includes('deposit'));
    const balCol = header.findIndex((h) => h.includes('balance'));

    const masked = accountNum.length > 4 ? `XXXX${accountNum.slice(-4)}` : accountNum;
    const accountId = makeId('acc');
    accounts.push({
      id: accountId,
      accountKey: buildNormalizedAccountKey('BANK', accountNum, sheet.name || 'detailed'),
      accountNumberMasked: masked,
      detectedType: 'Bank Account',
      currency,
      defaultQuickenName: `Savings (${accountNum.slice(-4)})`,
      defaultQuickenType: 'Bank',
    });

    const dataRows = rows.slice(headerIdx + 1);
    const dateSamples = dataRows.map((r) => (txDateCol >= 0 ? r[txDateCol] ?? '' : ''));
    const dateOrder = inferDateOrderFromSamples(dateSamples, ctx.config.defaultInputDateOrder);

    for (let idx = 0; idx < dataRows.length; idx++) {
      const r = dataRows[idx];
      const rowNumber = headerIdx + 2 + idx;
      const rawLine = r.filter((c) => c.trim()).join(' | ');
      if (!rawLine) continue;

      if (/legends used|end of statement|system generated/i.test(rawLine)) {
        skippedRows.push({
          id: makeId('skip'),
          importId: ctx.importId,
          rowIndex: rowNumber,
          reason: 'Footer / legend row',
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

      const rawTxDate = txDateCol >= 0 ? (r[txDateCol] ?? '') : '';
      const isoDate = parseDateToIso(rawTxDate, dateOrder);
      if (!isoDate) {
        skippedRows.push({
          id: makeId('skip'),
          importId: ctx.importId,
          rowIndex: rowNumber,
          reason: 'Non-transaction row (no valid date)',
          rawContent: rawLine,
        });
        continue;
      }

      const valueDate = valDateCol >= 0 ? parseDateToIso(r[valDateCol] ?? '', dateOrder) ?? undefined : undefined;
      const dep = depCol >= 0 ? parseAmount(r[depCol] ?? '') ?? 0 : 0;
      const wdr = wdrCol >= 0 ? parseAmount(r[wdrCol] ?? '') ?? 0 : 0;
      const amount = Math.round((dep - Math.abs(wdr)) * 100) / 100;
      const balance = balCol >= 0 ? parseAmount(r[balCol] ?? '') ?? undefined : undefined;
      const rawRemarks = remCol >= 0 ? (r[remCol] ?? '').trim() : '';
      const chequeNumber = chqCol >= 0 ? (r[chqCol] ?? '').trim() || undefined : undefined;

      transactions.push({
        id: makeId('tx'),
        importId: ctx.importId,
        accountId,
        rowIndex: rowNumber,
        txDate: isoDate,
        valueDate,
        amount,
        balance,
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

  checkBalanceContinuity(transactions);

  return {
    importKind: transactions.length > 0 ? 'transactions' : 'summary_only',
    detectedFormat: 'Detailed Statement Workbook',
    parserTier: 'tier1',
    status: transactions.length > 0 ? 'parsed' : 'no_transactions',
    accounts,
    transactions,
    holdings: [],
    skippedRows,
    warnings,
  };
}

function parseBankStatementPdf(input: ParsedFileInput, ctx: ParseContext): ParseOutput {
  const pages = input.pdfPages ?? [];
  const skippedRows: SkippedRowRecord[] = [];
  const transactions: TransactionRecord[] = [];
  const warnings: string[] = [];

  // Extract account number & currency from page 1 text
  let accountNum = 'PDF-Account';
  let currency = ctx.config.currency;
  const fullText = pages.map((p) => p.items.map((it) => it.str).join(' ')).join(' ');
  const acctMatch = /(?:Account\s*no\.?|Saving\s*Account\s*no\.?|A\/c\s*No\.?)\s*:?\s*([X*\d]{6,})/i.exec(fullText);
  if (acctMatch) accountNum = acctMatch[1];
  const currMatch = /\bin\s+(INR|USD|EUR|GBP)\b/i.exec(fullText);
  if (currMatch) currency = currMatch[1].toUpperCase();

  const masked = accountNum.length > 4 ? `XXXX${accountNum.slice(-4)}` : accountNum;
  const accountId = makeId('acc');
  const accountDraft: ParsedAccountDraft = {
    id: accountId,
    accountKey: buildNormalizedAccountKey('BANK', accountNum, 'pdf-bank'),
    accountNumberMasked: masked,
    detectedType: 'Bank Account (PDF)',
    currency,
    defaultQuickenName: `Savings (${accountNum.slice(-4)})`,
    defaultQuickenType: 'Bank',
  };

  let withdrawalX = 400;
  let depositX = 475;
  let balanceX = 545;
  let remarksMinX = 180;
  let remarksMaxX = 385;
  let chequeEndX = -1;
  let headerDetected = false;
  let rowCounter = 0;

  const isDateLine = (line: PdfLine): { date: string; x: number } | null => {
    for (const it of line.items) {
      if (it.x < remarksMinX) {
        const parsed = parseDateToIso(it.str, ctx.config.defaultInputDateOrder);
        if (parsed) return { date: parsed, x: it.x };
      }
    }
    return null;
  };

  for (const page of pages) {
    const lines = groupPdfPageLines(page, 3.5);
    let inTable = headerDetected;
    let pendingPrefixRemarks = '';

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const lower = line.text.toLowerCase();

      // Detect footer / legends -> stop parsing table
      if (/legends for transactions|system generated statement|never share your otp|sincer/i.test(lower)) {
        skippedRows.push({
          id: makeId('skip'),
          importId: ctx.importId,
          rowIndex: rowCounter + 1,
          reason: `Page ${page.pageNumber} footer / legend`,
          rawContent: line.text,
        });
        inTable = false;
        break;
      }

      // Detect column header band (may span 2-3 closely stacked lines like y=619, 614, 609)
      if (
        (lower.includes('transaction') && (lower.includes('remarks') || lower.includes('withdrawal'))) ||
        (lower.includes('withdrawal') && lower.includes('deposit') && lower.includes('balance')) ||
        (lower.includes('s no.') && lower.includes('cheque'))
      ) {
        for (const it of line.items) {
          const t = it.str.toLowerCase();
          if (t.includes('withdrawal')) withdrawalX = it.x;
          else if (t.includes('deposit')) depositX = it.x;
          else if (t.includes('balance')) balanceX = it.x;
          else if (t.includes('cheque')) chequeEndX = it.x + it.width;
          else if (t.includes('remarks') || t.includes('particulars')) {
            // Centered header sits to the right of left-aligned remarks; anchor to cheque column if known
            remarksMinX = chequeEndX > 0 ? Math.min(it.x - 15, chequeEndX + 2) : Math.min(it.x - 15, 185);
          }
        }
        if (chequeEndX > 0 && remarksMinX > chequeEndX + 4) {
          remarksMinX = chequeEndX + 2;
        }
        remarksMaxX = withdrawalX - 8;
        headerDetected = true;
        inTable = true;
        skippedRows.push({
          id: makeId('skip'),
          importId: ctx.importId,
          rowIndex: rowCounter + 1,
          reason: `Page ${page.pageNumber} column header`,
          rawContent: line.text,
        });
        continue;
      }

      if (!inTable) {
        if (skippedRows.length < 30) {
          skippedRows.push({
            id: makeId('skip'),
            importId: ctx.importId,
            rowIndex: li + 1,
            reason: `Page ${page.pageNumber} header / metadata`,
            rawContent: line.text,
          });
        }
        continue;
      }

      // Skip sub-header continuation lines like "Date Amount (INR) Amount (INR) (INR)"
      if (/^(date|amount|inr|\(|\)|\s)+$/i.test(line.text.trim())) continue;

      const dateHit = isDateLine(line);

      if (dateHit) {
        rowCounter++;
        const remarkParts: string[] = [];
        if (pendingPrefixRemarks) {
          remarkParts.push(pendingPrefixRemarks);
          pendingPrefixRemarks = '';
        }
        let withdrawalVal: number | null = null;
        let depositVal: number | null = null;
        let balanceVal: number | undefined;
        let chequeNumber: string | undefined;

        for (const it of line.items) {
          if (it.x === dateHit.x && parseDateToIso(it.str, ctx.config.defaultInputDateOrder)) continue;
          if (it.x < dateHit.x - 5 && /^\d+$/.test(it.str)) continue; // S No.

          // Numeric column zone
          if (it.x >= remarksMaxX - 5) {
            const num = parseAmount(it.str);
            if (num !== null) {
              const dW = Math.abs(it.x - withdrawalX);
              const dD = Math.abs(it.x - depositX);
              const dB = Math.abs(it.x - balanceX);
              if (dB <= dW && dB <= dD) balanceVal = num;
              else if (dW <= dD) withdrawalVal = num;
              else depositVal = num;
              continue;
            }
          }

          if (it.x >= dateHit.x + 35 && it.x < remarksMinX && /^\d{4,}$/.test(it.str)) {
            chequeNumber = it.str;
            continue;
          }

          if (it.x >= remarksMinX - 5 && it.x < remarksMaxX) {
            remarkParts.push(it.str);
          }
        }

        const amount = Math.round(((depositVal ?? 0) - Math.abs(withdrawalVal ?? 0)) * 100) / 100;
        const rawRemarks = remarkParts.join(' ').trim();

        transactions.push({
          id: makeId('tx'),
          importId: ctx.importId,
          accountId,
          rowIndex: rowCounter,
          txDate: dateHit.date,
          amount,
          balance: balanceVal,
          chequeNumber,
          rawRemarks,
          payee: derivePayee(rawRemarks),
          memo: rawRemarks,
          category: '',
          clearedStatus: ctx.config.defaultClearedStatus,
          isIncluded: true,
          warnings: [],
        });
      } else {
        // Wrapped multi-line remarks: check if this line sits just ABOVE the next date line (vertically-centered row)
        const textInRemarksZone = line.items
          .filter((it) => it.x >= remarksMinX - 5 && it.x < remarksMaxX + 15)
          .map((it) => it.str)
          .join(' ')
          .trim();

        if (!textInRemarksZone || /^(page\s+\d+|sincer|team\s)/i.test(textInRemarksZone)) continue;

        const nextLine = lines[li + 1];
        const nextIsDate = nextLine ? isDateLine(nextLine) !== null : false;
        const distToNext = nextLine ? Math.abs(line.y - nextLine.y) : 999;

        if (nextIsDate && distToNext <= 7) {
          pendingPrefixRemarks = pendingPrefixRemarks
            ? `${pendingPrefixRemarks} ${textInRemarksZone}`
            : textInRemarksZone;
        } else if (transactions.length > 0) {
          const prev = transactions[transactions.length - 1];
          prev.rawRemarks = prev.rawRemarks
            ? `${prev.rawRemarks} ${textInRemarksZone}`
            : textInRemarksZone;
          prev.memo = prev.rawRemarks;
          prev.payee = derivePayee(prev.rawRemarks);
        }
      }
    }
  }

  checkBalanceContinuity(transactions);

  return {
    importKind: transactions.length > 0 ? 'transactions' : 'summary_only',
    detectedFormat: 'Bank Statement PDF',
    parserTier: 'tier1',
    status: transactions.length > 0 ? 'parsed' : 'no_transactions',
    accounts: transactions.length > 0 ? [accountDraft] : [],
    transactions,
    holdings: [],
    skippedRows,
    warnings,
  };
}

export const detailedStatementParser: StatementParser = {
  id: 'tier1-detailed-statement',
  name: 'Detailed Statement (Excel / Bank PDF)',

  canParse(input: ParsedFileInput): number {
    if (input.fileType === 'pdf' && input.pdfPages && input.pdfPages.length > 0) {
      const text = input.pdfPages[0].items.map((it) => it.str).join(' ').toLowerCase();
      if (
        (text.includes('transaction remarks') || text.includes('statement of transactions')) &&
        (text.includes('withdrawal') || text.includes('deposit'))
      ) {
        return 0.94;
      }
      return 0;
    }

    if ((input.fileType === 'xls' || input.fileType === 'xlsx') && input.sheets.length > 0) {
      for (const sheet of input.sheets) {
        if (findDetailedSheetHeader(sheet.rows) >= 0) {
          return 0.95;
        }
      }
    }
    return 0;
  },

  parse(input: ParsedFileInput, ctx: ParseContext): ParseOutput {
    if (input.fileType === 'pdf') {
      return parseBankStatementPdf(input, ctx);
    }
    return parseDetailedExcel(input, ctx);
  },
};
