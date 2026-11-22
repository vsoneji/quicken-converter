import type {
  HoldingRecord,
  HoldingsExportMode,
  QifDateFormat,
  TransactionRecord,
} from '../types/models';

export interface QifValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  recordCount: number;
  priceRecordCount: number;
  depositsCents: number;
  withdrawalsCents: number;
  netCents: number;
  holdingsValueCents: number;
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function isValidQifDate(raw: string, format: QifDateFormat): boolean {
  if (format === 'MM/DD/YYYY' || format === 'DD/MM/YYYY') {
    return /^\d{2}\/\d{2}\/\d{4}$/.test(raw);
  }
  if (format === "MM/DD'YY") {
    return /^\d{2}\/\d{2}'\d{2}$/.test(raw);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

const VALID_TYPES = new Set([
  '!Type:Bank',
  '!Type:CCard',
  '!Type:Cash',
  '!Type:Invst',
  '!Type:Oth A',
  '!Type:Oth L',
  '!Type:Prices',
]);

export function validateTransactionsQif(
  qifText: string,
  expectedTransactions: TransactionRecord[],
  dateFormat: QifDateFormat
): QifValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const included = expectedTransactions.filter((t) => t.isIncluded);

  if (qifText.charCodeAt(0) === 0xfeff) {
    errors.push('Output contains a UTF-8 BOM, which can break older Quicken importers.');
  }

  if (included.length === 0) {
    return {
      isValid: qifText.trim() === '',
      errors: qifText.trim() === '' ? [] : ['Expected empty QIF when no transactions are selected.'],
      warnings: ['No transactions selected for export.'],
      recordCount: 0,
      priceRecordCount: 0,
      depositsCents: 0,
      withdrawalsCents: 0,
      netCents: 0,
      holdingsValueCents: 0,
    };
  }

  const lines = qifText.replace(/\r\n/g, '\n').split('\n');
  let mode: 'none' | 'account' | 'tx' = 'none';
  let currentDate: string | null = null;
  let currentAmount: number | null = null;
  let recordCount = 0;
  let depositsCents = 0;
  let withdrawalsCents = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;

    if (line === '!Account') {
      mode = 'account';
      continue;
    }
    if (line.startsWith('!Type:')) {
      if (!VALID_TYPES.has(line)) {
        errors.push(`Line ${i + 1}: Unsupported QIF header "${line}".`);
      }
      mode = 'tx';
      continue;
    }

    if (line === '^') {
      if (mode === 'tx') {
        if (!currentDate) errors.push(`Line ${i + 1}: Transaction record missing D (Date) tag.`);
        if (currentAmount === null) errors.push(`Line ${i + 1}: Transaction record missing T (Amount) tag.`);
        if (currentAmount !== null) {
          const cents = toCents(currentAmount);
          if (cents >= 0) depositsCents += cents;
          else withdrawalsCents += cents;
        }
        recordCount++;
        currentDate = null;
        currentAmount = null;
      }
      continue;
    }

    if (mode === 'tx') {
      const tag = line[0];
      const val = line.slice(1);
      if (tag === 'D') {
        if (!isValidQifDate(val, dateFormat)) {
          errors.push(`Line ${i + 1}: Date "${val}" does not match configured format ${dateFormat}.`);
        }
        currentDate = val;
      } else if (tag === 'T') {
        const parsed = Number(val);
        if (!Number.isFinite(parsed) || !/^-?\d+(\.\d{2})?$/.test(val)) {
          errors.push(`Line ${i + 1}: Invalid numeric amount "${val}".`);
        } else {
          currentAmount = parsed;
        }
      }
    }
  }

  const expectedDepCents = included
    .filter((t) => t.amount >= 0)
    .reduce((sum, t) => sum + toCents(t.amount), 0);
  const expectedWdrCents = included
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + toCents(t.amount), 0);

  if (recordCount !== included.length) {
    errors.push(`Record count mismatch: QIF has ${recordCount}, expected ${included.length}.`);
  }
  if (depositsCents !== expectedDepCents) {
    errors.push(
      `Deposits total mismatch: QIF has ${(depositsCents / 100).toFixed(2)}, expected ${(expectedDepCents / 100).toFixed(2)}.`
    );
  }
  if (withdrawalsCents !== expectedWdrCents) {
    errors.push(
      `Withdrawals total mismatch: QIF has ${(withdrawalsCents / 100).toFixed(2)}, expected ${(expectedWdrCents / 100).toFixed(2)}.`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    recordCount,
    priceRecordCount: 0,
    depositsCents,
    withdrawalsCents,
    netCents: depositsCents + withdrawalsCents,
    holdingsValueCents: 0,
  };
}

export function validateHoldingsQif(
  qifText: string,
  expectedHoldings: HoldingRecord[],
  mode: HoldingsExportMode,
  dateFormat: QifDateFormat
): QifValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const included = expectedHoldings.filter((h) => h.isIncluded);

  if (qifText.charCodeAt(0) === 0xfeff) {
    errors.push('Output contains a UTF-8 BOM.');
  }

  const lines = qifText.replace(/\r\n/g, '\n').split('\n');
  let section: 'none' | 'prices' | 'account' | 'invst' = 'none';
  let priceRecordCount = 0;
  let invstRecordCount = 0;
  let holdingsValueCents = 0;
  let hasAction = false;
  let hasSec = false;
  let hasQty = false;
  let currentTotal: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (line === '!Type:Prices') { section = 'prices'; continue; }
    if (line === '!Account') { section = 'account'; continue; }
    if (line === '!Type:Invst') { section = 'invst'; continue; }

    if (line === '^') {
      if (section === 'invst') {
        if (!hasAction || !hasSec || !hasQty) {
          errors.push(`Line ${i + 1}: Incomplete !Type:Invst record (requires N, Y, Q).`);
        }
        if (currentTotal !== null) holdingsValueCents += toCents(currentTotal);
        invstRecordCount++;
        hasAction = false;
        hasSec = false;
        hasQty = false;
        currentTotal = null;
      }
      continue;
    }

    if (section === 'prices') {
      const m = /^"[^"]+",(\d+(?:\.\d{2})?),"([^"]+)"$/.exec(line);
      if (!m) {
        errors.push(`Line ${i + 1}: Malformed !Type:Prices entry "${line}".`);
      } else {
        if (!isValidQifDate(m[2], dateFormat)) {
          errors.push(`Line ${i + 1}: Price date "${m[2]}" does not match ${dateFormat}.`);
        }
        priceRecordCount++;
      }
    } else if (section === 'invst') {
      const tag = line[0];
      const val = line.slice(1);
      if (tag === 'N') hasAction = val.length > 0;
      else if (tag === 'Y') hasSec = val.length > 0;
      else if (tag === 'Q') hasQty = Number.isFinite(Number(val)) && Number(val) > 0;
      else if (tag === 'T') currentTotal = Number(val);
    }
  }

  if (priceRecordCount !== included.length) {
    errors.push(`Price count mismatch: QIF has ${priceRecordCount}, expected ${included.length}.`);
  }

  const expectedValCents = included.reduce((s, h) => s + toCents(h.marketValue), 0);

  if (mode === 'shrs_in_and_prices') {
    if (invstRecordCount !== included.length) {
      errors.push(`Investment record count mismatch: QIF has ${invstRecordCount}, expected ${included.length}.`);
    }
    if (holdingsValueCents !== expectedValCents) {
      errors.push(
        `Holdings value mismatch: QIF has ${(holdingsValueCents / 100).toFixed(2)}, expected ${(expectedValCents / 100).toFixed(2)}.`
      );
    }
  } else {
    holdingsValueCents = expectedValCents;
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    recordCount: mode === 'shrs_in_and_prices' ? invstRecordCount : priceRecordCount,
    priceRecordCount,
    depositsCents: 0,
    withdrawalsCents: 0,
    netCents: 0,
    holdingsValueCents,
  };
}
