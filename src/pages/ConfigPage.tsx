import { useMemo, useRef } from 'react';
import { Download, Trash2, Upload } from 'lucide-react';
import type {
  AccountRecord,
  AppConfig,
  ClearedStatus,
  InputDateOrder,
  LineEnding,
  MappingTemplate,
  QifDateFormat,
  TransactionRecord,
} from '../types/models';
import { generateTransactionsQif } from '../qif/generator';
import { exportBackupJson, importBackupJson } from '../storage/backup';
import { saveTextFile } from '../utils/format';

interface ConfigPageProps {
  config: AppConfig;
  templates: MappingTemplate[];
  onChangeConfig: (next: AppConfig) => void;
  onDeleteTemplate: (id: string) => void;
  onBackupRestored: (summary: string) => void;
  onToast: (msg: string) => void;
}

const SAMPLE_ACCOUNT: AccountRecord = {
  id: 'sample-acc',
  accountKey: 'SAMPLE',
  accountNumberMasked: 'XXXX1001',
  detectedType: 'Savings',
  currency: 'INR',
  quickenName: 'Savings Account A',
  quickenType: 'Bank',
  createdAt: '',
  updatedAt: '',
};

const SAMPLE_TXS: TransactionRecord[] = [
  {
    id: 'st1',
    importId: 'sample',
    accountId: 'sample-acc',
    rowIndex: 1,
    txDate: '2025-09-30',
    amount: 975.0,
    rawRemarks: 'Quarterly Interest Credit',
    payee: 'Interest Paid',
    memo: 'Quarterly Interest Credit',
    category: 'Interest Income',
    clearedStatus: '',
    isIncluded: true,
    warnings: [],
  },
  {
    id: 'st2',
    importId: 'sample',
    accountId: 'sample-acc',
    rowIndex: 2,
    txDate: '2025-11-09',
    amount: -1158.0,
    rawRemarks: 'POS PURCHASE ORDER #900116257',
    payee: 'Online Store',
    memo: 'POS PURCHASE ORDER #900116257',
    category: 'Shopping',
    clearedStatus: '',
    isIncluded: true,
    warnings: [],
  },
];

export function ConfigPage({
  config,
  templates,
  onChangeConfig,
  onDeleteTemplate,
  onBackupRestored,
  onToast,
}: ConfigPageProps) {
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const liveQif = useMemo(
    () => generateTransactionsQif([SAMPLE_ACCOUNT], SAMPLE_TXS, config),
    [config]
  );

  const handleExportBackup = async () => {
    const json = await exportBackupJson();
    const today = new Date().toISOString().slice(0, 10);
    const saved = await saveTextFile(
      json,
      `qif-converter-backup-${today}.json`,
      'JSON Backup File',
      '.json',
      'application/json'
    );
    if (saved) onToast('Exported settings, accounts & templates backup (.json)');
  };

  const handleImportBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const res = await importBackupJson(text);
      onBackupRestored(
        `Restored config, ${res.accountsRestored} account mapping(s), and ${res.templatesRestored} template(s)`
      );
    } catch (err: unknown) {
      onToast(`Restore failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Global Configuration</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          All settings, account mappings, and column-mapping templates are stored locally in your browser&apos;s IndexedDB.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Format & Export Settings */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Format &amp; Export Defaults
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Display Currency
              </label>
              <select
                value={config.currency}
                onChange={(e) => onChangeConfig({ ...config, currency: e.target.value })}
                className="w-full px-3 py-2 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
              >
                <option value="INR">INR — Indian Rupee (₹)</option>
                <option value="USD">USD — US Dollar ($)</option>
                <option value="GBP">GBP — British Pound (£)</option>
                <option value="EUR">EUR — Euro (€)</option>
                <option value="CAD">CAD — Canadian Dollar (C$)</option>
                <option value="AUD">AUD — Australian Dollar (A$)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Default Input Date Order
              </label>
              <select
                value={config.defaultInputDateOrder}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    defaultInputDateOrder: e.target.value as InputDateOrder,
                  })
                }
                className="w-full px-3 py-2 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
              >
                <option value="DMY">DMY — Day first (03/04 = Apr 3)</option>
                <option value="MDY">MDY — Month first (03/04 = Mar 4)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Output QIF Date Format
            </label>
            <select
              value={config.qifDateFormat}
              onChange={(e) =>
                onChangeConfig({
                  ...config,
                  qifDateFormat: e.target.value as QifDateFormat,
                })
              }
              className="w-full px-3 py-2 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
            >
              <option value="MM/DD/YYYY">MM/DD/YYYY (e.g., 11/09/2025 — Quicken US default)</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY (e.g., 09/11/2025 — Day-first)</option>
              <option value="MM/DD'YY">MM/DD&apos;YY (e.g., 11/09&apos;25 — Classic Quicken)</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD (e.g., 2025-11-09 — ISO)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Default Cleared Status (<code>C</code>)
              </label>
              <select
                value={config.defaultClearedStatus}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    defaultClearedStatus: e.target.value as ClearedStatus,
                  })
                }
                className="w-full px-3 py-2 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
              >
                <option value="">None (Omit C tag)</option>
                <option value="c">c (Cleared)</option>
                <option value="X">X (Reconciled)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Line Endings</label>
              <select
                value={config.lineEnding}
                onChange={(e) =>
                  onChangeConfig({ ...config, lineEnding: e.target.value as LineEnding })
                }
                className="w-full px-3 py-2 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
              >
                <option value="CRLF">CRLF (Windows / Quicken)</option>
                <option value="LF">LF (macOS / Linux)</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2.5 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={config.includeAccountHeader}
              onChange={(e) =>
                onChangeConfig({ ...config, includeAccountHeader: e.target.checked })
              }
              className="accent-indigo-500"
            />
            <span className="text-xs text-slate-300">
              Include <code>!Account</code> header block in exported QIF files
            </span>
          </label>
        </div>

        {/* Live QIF Preview */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Live QIF Format Preview
            </h3>
            <span className="text-xs font-mono text-slate-500">sample.qif</span>
          </div>
          <pre className="flex-1 p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
            {liveQif}
          </pre>
        </div>
      </div>

      {/* Backup & Restore (JSON) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Backup &amp; Restore Settings (JSON)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Export or restore your global Config, saved Account Mappings, and Column-Mapping Templates across browsers or devices. Staged transactions are never included.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={restoreInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              handleImportBackup(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            onClick={handleExportBackup}
            className="px-3.5 py-2 rounded-lg text-xs font-medium border border-slate-700 bg-slate-950 text-slate-200 hover:border-indigo-500 flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Backup (.json)
          </button>
          <button
            onClick={() => restoreInputRef.current?.click()}
            className="px-3.5 py-2 rounded-lg text-xs font-medium border border-slate-700 bg-slate-950 text-slate-200 hover:border-indigo-500 flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Import Backup (.json)
          </button>
        </div>
      </div>

      {/* Saved Column Mapping Templates */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Saved Column-Mapping Templates ({templates.length})
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Matched automatically before built-in parsers whenever an uploaded file has the same header signature.
            </p>
          </div>
        </div>
        {templates.length === 0 ? (
          <p className="text-xs text-slate-500 italic">
            No custom templates saved yet. Use the Column Mapper on an unknown format to save one.
          </p>
        ) : (
          <div className="space-y-2">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-slate-950 border border-slate-800"
              >
                <div>
                  <p className="text-xs font-semibold text-slate-200">
                    {tpl.name}{' '}
                    <span className="font-normal text-slate-400">
                      · {tpl.amountMode}
                      {tpl.invertSign ? ' (inverted)' : ''} · Date: {tpl.dateFormat || 'Auto'}
                    </span>
                  </p>
                  <p className="text-xs font-mono text-slate-500 mt-0.5">{tpl.headerSignature}</p>
                </div>
                <button
                  onClick={() => onDeleteTemplate(tpl.id)}
                  className="px-2.5 py-1 rounded text-xs border border-slate-700 text-rose-400 hover:bg-rose-950/40 flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
