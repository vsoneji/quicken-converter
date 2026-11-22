import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  type AccountRecord,
  type HoldingRecord,
  type TransactionRecord,
} from '../src/types/models';
import { generateHoldingsQif, generateTransactionsQif } from '../src/qif/generator';
import { validateHoldingsQif, validateTransactionsQif } from '../src/qif/validator';

const ACCOUNT: AccountRecord = {
  id: 'acc-1',
  accountKey: 'TEST-1001',
  accountNumberMasked: 'XXXX1001',
  detectedType: 'Savings',
  currency: 'INR',
  quickenName: 'Primary Savings',
  quickenType: 'Bank',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const TRANSACTIONS: TransactionRecord[] = [
  {
    id: 'tx-1',
    importId: 'imp-1',
    accountId: 'acc-1',
    rowIndex: 1,
    txDate: '2025-09-30',
    amount: 975.25,
    rawRemarks: 'Interest\nLine2^BadCaret',
    payee: 'Interest^Paid',
    memo: 'Interest\nLine2^BadCaret',
    category: 'Interest Income',
    clearedStatus: 'c',
    isIncluded: true,
    warnings: [],
  },
  {
    id: 'tx-2',
    importId: 'imp-1',
    accountId: 'acc-1',
    rowIndex: 2,
    txDate: '2025-11-09',
    amount: -1158.0,
    rawRemarks: 'POS PURCHASE',
    payee: 'Online Store',
    memo: 'POS PURCHASE',
    category: 'Shopping',
    clearedStatus: '',
    isIncluded: true,
    warnings: [],
  },
  {
    id: 'tx-3',
    importId: 'imp-1',
    accountId: 'acc-1',
    rowIndex: 3,
    txDate: '2025-11-10',
    amount: -50.0,
    rawRemarks: 'Excluded row',
    payee: 'Excluded',
    memo: 'Excluded row',
    category: '',
    clearedStatus: '',
    isIncluded: false,
    warnings: [],
  },
];

describe('QIF generator and round-trip validator', () => {
  it('generates valid Bank QIF, sanitizes newlines/carets, and passes round-trip reconciliation', () => {
    const qif = generateTransactionsQif([ACCOUNT], TRANSACTIONS, DEFAULT_CONFIG);
    expect(qif).toContain('!Account\r\nNPrimary Savings\r\nTBank\r\n^\r\n!Type:Bank');
    expect(qif).toContain('D09/30/2025');
    expect(qif).toContain('PInterest Paid');
    expect(qif).toContain('MInterest Line2 BadCaret');
    expect(qif).not.toContain('Excluded');

    const result = validateTransactionsQif(qif, TRANSACTIONS, DEFAULT_CONFIG.qifDateFormat);
    expect(result.isValid).toBe(true);
    expect(result.recordCount).toBe(2);
    expect(result.depositsCents).toBe(97525);
    expect(result.withdrawalsCents).toBe(-115800);
    expect(result.netCents).toBe(-18275);
  });

  it('supports DD/MM/YYYY and LF line endings without !Account header', () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      qifDateFormat: 'DD/MM/YYYY' as const,
      includeAccountHeader: false,
      lineEnding: 'LF' as const,
    };
    const qif = generateTransactionsQif([ACCOUNT], TRANSACTIONS, cfg);
    expect(qif.startsWith('!Type:Bank\nD30/09/2025\n')).toBe(true);
    expect(qif).not.toContain('\r\n');

    const res = validateTransactionsQif(qif, TRANSACTIONS, cfg.qifDateFormat);
    expect(res.isValid).toBe(true);
  });

  it('flags tampered QIF output as invalid', () => {
    const qif = generateTransactionsQif([ACCOUNT], TRANSACTIONS, DEFAULT_CONFIG);
    const tampered = qif.replace('T975.25', 'T999.99');
    const res = validateTransactionsQif(tampered, TRANSACTIONS, DEFAULT_CONFIG.qifDateFormat);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.includes('Deposits total mismatch'))).toBe(true);
  });

  it('generates and validates !Type:Prices and !Type:Invst holdings QIF', () => {
    const invAcc: AccountRecord = { ...ACCOUNT, quickenName: 'Demat', quickenType: 'Invst' };
    const holdings: HoldingRecord[] = [
      {
        id: 'h1',
        importId: 'imp-h',
        accountId: invAcc.id,
        isin: 'INE000A01011',
        securityName: 'ACME TECH EQ',
        quantity: 100,
        unitPrice: 350.5,
        marketValue: 35050,
        asOfDate: '2026-03-31',
        isIncluded: true,
      },
    ];

    const pricesOnly = generateHoldingsQif(invAcc, holdings, 'prices_only', DEFAULT_CONFIG);
    expect(pricesOnly).toContain('!Type:Prices');
    expect(pricesOnly).not.toContain('!Type:Invst');
    const pricesRes = validateHoldingsQif(pricesOnly, holdings, 'prices_only', DEFAULT_CONFIG.qifDateFormat);
    expect(pricesRes.isValid).toBe(true);
    expect(pricesRes.priceRecordCount).toBe(1);

    const full = generateHoldingsQif(invAcc, holdings, 'shrs_in_and_prices', DEFAULT_CONFIG);
    expect(full).toContain('!Type:Invst');
    expect(full).toContain('NShrsIn');
    const fullRes = validateHoldingsQif(full, holdings, 'shrs_in_and_prices', DEFAULT_CONFIG.qifDateFormat);
    expect(fullRes.isValid).toBe(true);
    expect(fullRes.holdingsValueCents).toBe(3505000);
  });
});
