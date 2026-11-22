import type {
  MappingTemplate,
  ParsedFileInput,
  SkippedRowRecord,
  TransactionRecord,
} from '../types/models';
import {
  checkBalanceContinuity,
  derivePayee,
  inferDateOrderFromSamples,
  makeId,
  matchSkipPattern,
  normalizeHeaderSignature,
  parseAmount,
  parseDateToIso,
} from './normalizers';
import type { ParseContext, ParsedAccountDraft, ParseOutput } from './types';

export function findMatchingTemplate(
  input: ParsedFileInput,
  templates: MappingTemplate[]
): { template: MappingTemplate; sheetIndex: number; headerRowIndex: number } | null {
  if (templates.length === 0 || input.sheets.length === 0) return null;

  for (let sIdx = 0; sIdx < input.sheets.length; sIdx++) {
    const rows = input.sheets[sIdx].rows;
    const scanLimit = Math.min(rows.length, 60);
    for (let rIdx = 0; rIdx < scanLimit; rIdx++) {
      const sig = normalizeHeaderSignature(rows[rIdx]);
      if (!sig) continue;
      const found = templates.find((t) => t.headerSignature === sig);
      if (found) {
        return { template: found, sheetIndex: sIdx, headerRowIndex: rIdx };
      }
    }
  }
  return null;
}

export function parseWithTemplate(
  input: ParsedFileInput,
  template: MappingTemplate,
  ctx: ParseContext,
  overrideSheetIndex?: number,
  overrideHeaderRowIndex?: number
): ParseOutput {
  const sheetIndex = overrideSheetIndex ?? template.sheetIndex ?? 0;
  const sheet = input.sheets[sheetIndex] ?? input.sheets[0];
  const rows = sheet?.rows ?? [];
  const headerRowIndex = overrideHeaderRowIndex ?? template.headerRowIndex;

  const skippedRows: SkippedRowRecord[] = [];
  const transactions: TransactionRecord[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < Math.min(headerRowIndex, rows.length); i++) {
    const raw = rows[i].filter((c) => c.trim()).join(' | ');
    if (raw) {
      skippedRows.push({
        id: makeId('skip'),
        importId: ctx.importId,
        rowIndex: i + 1,
        reason: 'Preamble row above header',
        rawContent: raw,
      });
    }
  }

  // Identify mapped column indices
  const findCol = (role: string): number => {
    for (const [k, v] of Object.entries(template.columnMap)) {
      if (v === role) return Number(k);
    }
    return -1;
  };

  const dateCol = findCol('date');
  const descCol = findCol('description');
  const amountCol = findCol('amount');
  const depCol = findCol('deposit');
  const wdrCol = findCol('withdrawal');
  const drcrCol = findCol('drcr');
  const balCol = findCol('balance');
  const refCol = findCol('ref');
  const modeCol = findCol('mode');

  const dataRows = rows.slice(headerRowIndex + 1);
  const dateSamples = dateCol >= 0 ? dataRows.map((r) => r[dateCol] ?? '') : [];
  const inferredOrder = inferDateOrderFromSamples(dateSamples, ctx.config.defaultInputDateOrder);

  const accountName = template.defaultAccountName?.trim() || `${input.filename.replace(/\.[^.]+$/, '')} Account`;
  const accountId = makeId('acc');
  const accountDraft: ParsedAccountDraft = {
    id: accountId,
    accountKey: `TEMPLATE-${template.id}-${accountName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    accountNumberMasked: accountName,
    detectedType: 'Custom Template',
    currency: ctx.config.currency,
    defaultQuickenName: accountName,
    defaultQuickenType: 'Bank',
  };

  for (let idx = 0; idx < dataRows.length; idx++) {
    const r = dataRows[idx];
    const rowNumber = headerRowIndex + 2 + idx;
    const rawLine = r.filter((c) => c.trim()).join(' | ');
    const skipReason = matchSkipPattern(r, template.skipPatterns);
    if (skipReason) {
      if (rawLine) {
        skippedRows.push({
          id: makeId('skip'),
          importId: ctx.importId,
          rowIndex: rowNumber,
          reason: skipReason,
          rawContent: rawLine,
        });
      }
      continue;
    }

    const rawDate = dateCol >= 0 ? (r[dateCol] ?? '') : '';
    const isoDate = parseDateToIso(rawDate, inferredOrder, template.dateFormat);
    if (!isoDate) {
      if (rawLine) {
        skippedRows.push({
          id: makeId('skip'),
          importId: ctx.importId,
          rowIndex: rowNumber,
          reason: 'No valid date in mapped Date column',
          rawContent: rawLine,
        });
      }
      continue;
    }

    let amount: number | null = null;
    if (template.amountMode === 'signed' && amountCol >= 0) {
      const parsed = parseAmount(r[amountCol] ?? '');
      if (parsed !== null) {
        amount = template.invertSign ? -parsed : parsed;
      }
    } else if (template.amountMode === 'drcr' && amountCol >= 0) {
      const parsed = parseAmount(r[amountCol] ?? '');
      const indicator = (drcrCol >= 0 ? (r[drcrCol] ?? '') : '').trim().toLowerCase();
      if (parsed !== null) {
        const isDebit = /^(dr|debit|d|out|withdrawal)$/i.test(indicator);
        amount = isDebit ? -Math.abs(parsed) : Math.abs(parsed);
      }
    } else {
      const dep = depCol >= 0 ? parseAmount(r[depCol] ?? '') : null;
      const wdr = wdrCol >= 0 ? parseAmount(r[wdrCol] ?? '') : null;
      if (dep !== null || wdr !== null) {
        amount = Math.round(((dep ?? 0) - Math.abs(wdr ?? 0)) * 100) / 100;
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

  checkBalanceContinuity(transactions);

  return {
    importKind: transactions.length > 0 ? 'transactions' : 'summary_only',
    detectedFormat: `Custom Template: ${template.name}`,
    parserTier: 'template',
    status: transactions.length > 0 ? 'parsed' : 'no_transactions',
    accounts: transactions.length > 0 ? [accountDraft] : [],
    transactions,
    holdings: [],
    skippedRows,
    warnings,
  };
}
