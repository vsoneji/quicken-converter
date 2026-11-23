import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/types/models';
import {
  clearActiveWorkspace,
  getActiveWorkspace,
  getAllAccounts,
  getAllTemplates,
  loadConfig,
  resetDbConnectionForTests,
  saveActiveWorkspace,
  saveConfig,
  saveTemplate,
  upsertAccount,
} from '../src/storage/db';
import { exportBackupJson, importBackupJson } from '../src/storage/backup';

describe('IndexedDB storage and JSON backup/restore', () => {
  beforeEach(() => {
    resetDbConnectionForTests();
  });

  it('persists config, accounts, and templates across "Start a New Import" clears', async () => {
    await saveConfig({ ...DEFAULT_CONFIG, currency: 'USD', qifDateFormat: 'DD/MM/YYYY' });
    await upsertAccount({
      id: 'a1',
      accountKey: 'BANK-9999',
      accountNumberMasked: 'XXXX9999',
      detectedType: 'Savings',
      currency: 'USD',
      quickenName: 'My Savings',
      quickenType: 'Bank',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    await saveTemplate({
      id: 't1',
      name: 'Custom CSV',
      headerSignature: 'a|b|c',
      headerRowIndex: 0,
      columnMap: { 0: 'date', 1: 'description', 2: 'amount' },
      amountMode: 'signed',
      invertSign: false,
      dateFormat: 'YYYY-MM-DD',
      skipPatterns: ['Total'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    await saveActiveWorkspace({
      activeImport: {
        id: 'imp-1',
        filename: 'test.csv',
        fileSize: 123,
        fileType: 'csv',
        importKind: 'transactions',
        detectedFormat: 'Test',
        parserTier: 'tier2',
        status: 'parsed',
        accountIds: ['a1'],
        warnings: [],
        uploadedAt: '2026-01-01T00:00:00Z',
      },
      transactions: [],
      holdings: [],
      skippedRows: [],
    });

    await clearActiveWorkspace();
    const ws = await getActiveWorkspace();
    expect(ws.activeImport).toBeNull();

    // Persistent data survives workspace reset
    expect((await loadConfig()).currency).toBe('USD');
    expect(await getAllAccounts()).toHaveLength(1);
    expect(await getAllTemplates()).toHaveLength(1);

    // Re-importing the same account key must preserve user's custom Quicken name/type
    const reimported = await upsertAccount({
      id: 'a2-new-import',
      accountKey: 'BANK-9999',
      accountNumberMasked: 'XXXX9999',
      detectedType: 'Savings',
      currency: 'USD',
      quickenName: 'Default Parser Name (9999)',
      quickenType: 'Cash',
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    });
    expect(reimported.quickenName).toBe('My Savings');
    expect(reimported.quickenType).toBe('Bank');

    // JSON Backup & Restore round-trip
    const backupText = await exportBackupJson();
    await saveConfig(DEFAULT_CONFIG);
    const restoreStats = await importBackupJson(backupText);
    expect(restoreStats.accountsRestored).toBe(1);
    expect(restoreStats.templatesRestored).toBe(1);
    expect((await loadConfig()).currency).toBe('USD');
  });
});
