import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  DEFAULT_CONFIG,
  type AccountRecord,
  type ActiveImport,
  type AppConfig,
  type HoldingRecord,
  type MappingTemplate,
  type SkippedRowRecord,
  type TransactionRecord,
} from '../types/models';

const DB_NAME = 'qif-converter-db';
const DB_VERSION = 1;

interface ConverterDBSchema extends DBSchema {
  settings: {
    key: string;
    value: { key: string; value: AppConfig };
  };
  accounts: {
    key: string;
    value: AccountRecord;
    indexes: { 'by-key': string };
  };
  mapping_templates: {
    key: string;
    value: MappingTemplate;
    indexes: { 'by-signature': string };
  };
  active_import: {
    key: string;
    value: ActiveImport;
  };
  transactions: {
    key: string;
    value: TransactionRecord;
    indexes: { 'by-import': string; 'by-account': string };
  };
  holdings: {
    key: string;
    value: HoldingRecord;
    indexes: { 'by-import': string };
  };
  skipped_rows: {
    key: string;
    value: SkippedRowRecord;
    indexes: { 'by-import': string };
  };
}

let dbPromise: Promise<IDBPDatabase<ConverterDBSchema>> | null = null;

export function getDb(): Promise<IDBPDatabase<ConverterDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<ConverterDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('accounts')) {
          const store = db.createObjectStore('accounts', { keyPath: 'id' });
          store.createIndex('by-key', 'accountKey', { unique: true });
        }
        if (!db.objectStoreNames.contains('mapping_templates')) {
          const store = db.createObjectStore('mapping_templates', { keyPath: 'id' });
          store.createIndex('by-signature', 'headerSignature', { unique: false });
        }
        if (!db.objectStoreNames.contains('active_import')) {
          db.createObjectStore('active_import', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('transactions')) {
          const store = db.createObjectStore('transactions', { keyPath: 'id' });
          store.createIndex('by-import', 'importId', { unique: false });
          store.createIndex('by-account', 'accountId', { unique: false });
        }
        if (!db.objectStoreNames.contains('holdings')) {
          const store = db.createObjectStore('holdings', { keyPath: 'id' });
          store.createIndex('by-import', 'importId', { unique: false });
        }
        if (!db.objectStoreNames.contains('skipped_rows')) {
          const store = db.createObjectStore('skipped_rows', { keyPath: 'id' });
          store.createIndex('by-import', 'importId', { unique: false });
        }
      },
    });
  }
  return dbPromise;
}

export function resetDbConnectionForTests(): void {
  dbPromise = null;
}

// ---- Settings ----
export async function loadConfig(): Promise<AppConfig> {
  const db = await getDb();
  const row = await db.get('settings', 'global');
  return row ? { ...DEFAULT_CONFIG, ...row.value } : { ...DEFAULT_CONFIG };
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const db = await getDb();
  await db.put('settings', { key: 'global', value: config });
}

// ---- Accounts (persisted across imports) ----
export async function getAllAccounts(): Promise<AccountRecord[]> {
  const db = await getDb();
  return db.getAll('accounts');
}

export async function upsertAccount(account: AccountRecord): Promise<AccountRecord> {
  const db = await getDb();
  const existing = await db.getFromIndex('accounts', 'by-key', account.accountKey);
  if (existing) {
    const merged: AccountRecord = {
      ...existing,
      accountNumberMasked: account.accountNumberMasked || existing.accountNumberMasked,
      detectedType: account.detectedType || existing.detectedType,
      currency: account.currency || existing.currency,
      quickenName: account.quickenName || existing.quickenName,
      quickenType: account.quickenType || existing.quickenType,
      updatedAt: new Date().toISOString(),
    };
    await db.put('accounts', merged);
    return merged;
  }
  await db.put('accounts', account);
  return account;
}

export async function updateAccount(account: AccountRecord): Promise<void> {
  const db = await getDb();
  await db.put('accounts', { ...account, updatedAt: new Date().toISOString() });
}

// ---- Mapping Templates (persisted across imports) ----
export async function getAllTemplates(): Promise<MappingTemplate[]> {
  const db = await getDb();
  return db.getAll('mapping_templates');
}

export async function saveTemplate(template: MappingTemplate): Promise<void> {
  const db = await getDb();
  await db.put('mapping_templates', template);
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('mapping_templates', id);
}

// ---- Active Import Workspace ----
export async function getActiveWorkspace(): Promise<{
  activeImport: ActiveImport | null;
  transactions: TransactionRecord[];
  holdings: HoldingRecord[];
  skippedRows: SkippedRowRecord[];
}> {
  const db = await getDb();
  const imports = await db.getAll('active_import');
  const activeImport = imports[0] ?? null;
  if (!activeImport) {
    return { activeImport: null, transactions: [], holdings: [], skippedRows: [] };
  }
  const [transactions, holdings, skippedRows] = await Promise.all([
    db.getAllFromIndex('transactions', 'by-import', activeImport.id),
    db.getAllFromIndex('holdings', 'by-import', activeImport.id),
    db.getAllFromIndex('skipped_rows', 'by-import', activeImport.id),
  ]);
  return { activeImport, transactions, holdings, skippedRows };
}

export async function saveActiveWorkspace(payload: {
  activeImport: ActiveImport;
  transactions: TransactionRecord[];
  holdings: HoldingRecord[];
  skippedRows: SkippedRowRecord[];
}): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ['active_import', 'transactions', 'holdings', 'skipped_rows'],
    'readwrite'
  );
  await Promise.all([
    tx.objectStore('active_import').clear(),
    tx.objectStore('transactions').clear(),
    tx.objectStore('holdings').clear(),
    tx.objectStore('skipped_rows').clear(),
  ]);
  await tx.objectStore('active_import').put(payload.activeImport);
  for (const row of payload.transactions) {
    await tx.objectStore('transactions').put(row);
  }
  for (const h of payload.holdings) {
    await tx.objectStore('holdings').put(h);
  }
  for (const s of payload.skippedRows) {
    await tx.objectStore('skipped_rows').put(s);
  }
  await tx.done;
}

export async function updateTransaction(record: TransactionRecord): Promise<void> {
  const db = await getDb();
  await db.put('transactions', record);
}

export async function updateHolding(record: HoldingRecord): Promise<void> {
  const db = await getDb();
  await db.put('holdings', record);
}

export async function clearActiveWorkspace(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ['active_import', 'transactions', 'holdings', 'skipped_rows'],
    'readwrite'
  );
  await Promise.all([
    tx.objectStore('active_import').clear(),
    tx.objectStore('transactions').clear(),
    tx.objectStore('holdings').clear(),
    tx.objectStore('skipped_rows').clear(),
  ]);
  await tx.done;
}
