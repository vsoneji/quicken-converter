import { DEFAULT_CONFIG, type BackupPayload } from '../types/models';
import {
  getAllAccounts,
  getAllTemplates,
  loadConfig,
  saveConfig,
  saveTemplate,
  upsertAccount,
} from './db';

export async function exportBackupJson(): Promise<string> {
  const [config, accounts, mappingTemplates] = await Promise.all([
    loadConfig(),
    getAllAccounts(),
    getAllTemplates(),
  ]);

  const payload: BackupPayload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    config,
    accounts,
    mappingTemplates,
  };

  return JSON.stringify(payload, null, 2);
}

export async function importBackupJson(jsonText: string): Promise<{
  accountsRestored: number;
  templatesRestored: number;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Invalid JSON file. Could not parse backup content.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid backup format: expected a JSON object.');
  }

  const data = parsed as Partial<BackupPayload>;
  if (data.schemaVersion !== 1) {
    throw new Error(`Unsupported backup schemaVersion: ${String(data.schemaVersion)}. Expected 1.`);
  }

  if (data.config && typeof data.config === 'object') {
    await saveConfig({ ...DEFAULT_CONFIG, ...data.config });
  }

  let accountsRestored = 0;
  if (Array.isArray(data.accounts)) {
    for (const acc of data.accounts) {
      if (acc && typeof acc.accountKey === 'string' && typeof acc.quickenName === 'string') {
        await upsertAccount(acc);
        accountsRestored++;
      }
    }
  }

  let templatesRestored = 0;
  if (Array.isArray(data.mappingTemplates)) {
    for (const tpl of data.mappingTemplates) {
      if (tpl && typeof tpl.id === 'string' && typeof tpl.name === 'string' && typeof tpl.headerSignature === 'string') {
        await saveTemplate(tpl);
        templatesRestored++;
      }
    }
  }

  return { accountsRestored, templatesRestored };
}
