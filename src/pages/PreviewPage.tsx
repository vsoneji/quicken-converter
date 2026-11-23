import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Eye,
  Info,
  RotateCcw,
  Sliders,
} from 'lucide-react';
import type {
  AccountRecord,
  ActiveImport,
  AppConfig,
  HoldingRecord,
  HoldingsExportMode,
  QuickenAccountType,
  SkippedRowRecord,
  TransactionRecord,
} from '../types/models';
import { formatQifDate, generateHoldingsQif, generateTransactionsQif } from '../qif/generator';
import { validateHoldingsQif, validateTransactionsQif } from '../qif/validator';
import { SaveAsModal } from '../components/SaveAsModal';
import {
  formatBytes,
  formatFilenameTimestamp,
  formatMoney,
  slugifyFilename,
} from '../utils/format';

interface PreviewPageProps {
  activeImport: ActiveImport;
  accounts: AccountRecord[];
  transactions: TransactionRecord[];
  holdings: HoldingRecord[];
  skippedRows: SkippedRowRecord[];
  config: AppConfig;
  onUpdateAccount: (account: AccountRecord) => void;
  onUpdateTransaction: (tx: TransactionRecord) => void;
  onBulkToggleTransactions: (ids: string[], included: boolean) => void;
  onUpdateHolding: (holding: HoldingRecord) => void;
  onBulkToggleHoldings: (ids: string[], included: boolean) => void;
  onOpenMapper: () => void;
  onStartNewImport: () => void;
  onToast: (msg: string) => void;
}

const TIER_LABELS: Record<string, string> = {
  template: 'Saved Template',
  tier1: 'Tier 1 · Built-in',
  tier2: 'Tier 2 · Heuristic',
  tier3: 'Tier 3 · Custom Map',
};

export function PreviewPage({
  activeImport,
  accounts,
  transactions,
  holdings,
  skippedRows,
  config,
  onUpdateAccount,
  onUpdateTransaction,
  onBulkToggleTransactions,
  onUpdateHolding,
  onBulkToggleHoldings,
  onOpenMapper,
  onStartNewImport,
  onToast,
}: PreviewPageProps) {
  const importAccounts = useMemo(
    () => accounts.filter((a) => activeImport.accountIds.includes(a.id)),
    [accounts, activeImport.accountIds]
  );

  // Deduplicated list of previously saved Quicken accounts (most recently updated first)
  const savedAccountPresets = useMemo(() => {
    const sorted = [...accounts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const seen = new Set<string>();
    return sorted.filter((a) => {
      const key = `${a.quickenName.trim().toLowerCase()}|${a.quickenType}`;
      if (!a.quickenName.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [accounts]);

  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    importAccounts[0]?.id ?? 'ALL'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'deposit' | 'withdrawal'>('all');
  const [showSkipped, setShowSkipped] = useState(false);
  const [holdingsExportMode, setHoldingsExportMode] =
    useState<HoldingsExportMode>('prices_only');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [exportTimestamp, setExportTimestamp] = useState(() => formatFilenameTimestamp());

  // Ensure selectedAccountId stays valid if import changes
  const effectiveAccountId =
    selectedAccountId === 'ALL' || importAccounts.some((a) => a.id === selectedAccountId)
      ? selectedAccountId
      : (importAccounts[0]?.id ?? 'ALL');

  const activeAccount =
    effectiveAccountId === 'ALL'
      ? null
      : (importAccounts.find((a) => a.id === effectiveAccountId) ?? null);

  const visibleTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (effectiveAccountId !== 'ALL' && tx.accountId !== effectiveAccountId) return false;
      if (typeFilter === 'deposit' && tx.amount < 0) return false;
      if (typeFilter === 'withdrawal' && tx.amount >= 0) return false;
      if (q) {
        const hay = `${tx.payee} ${tx.memo} ${tx.category} ${tx.chequeNumber ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, effectiveAccountId, typeFilter, searchQuery]);

  const visibleHoldings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return holdings.filter((h) => {
      if (!q) return true;
      return `${h.isin} ${h.securityName}`.toLowerCase().includes(q);
    });
  }, [holdings, searchQuery]);

  const scopedTxs = useMemo(
    () =>
      transactions.filter(
        (t) => effectiveAccountId === 'ALL' || t.accountId === effectiveAccountId
      ),
    [transactions, effectiveAccountId]
  );

  const includedTxs = useMemo(() => scopedTxs.filter((t) => t.isIncluded), [scopedTxs]);
  const totalDeposits = useMemo(
    () => includedTxs.filter((t) => t.amount >= 0).reduce((s, t) => s + t.amount, 0),
    [includedTxs]
  );
  const totalWithdrawals = useMemo(
    () => includedTxs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0),
    [includedTxs]
  );
  const netChange = totalDeposits + totalWithdrawals;

  const includedHoldings = useMemo(() => holdings.filter((h) => h.isIncluded), [holdings]);
  const totalHoldingsValue = useMemo(
    () => includedHoldings.reduce((s, h) => s + h.marketValue, 0),
    [includedHoldings]
  );

  // Build QIF & run round-trip validation when modal is open
  const exportBundle = useMemo(() => {
    if (activeImport.importKind === 'holdings') {
      const acc = importAccounts[0];
      if (!acc) return null;
      const qif = generateHoldingsQif(acc, holdings, holdingsExportMode, config);
      const validation = validateHoldingsQif(qif, holdings, holdingsExportMode, config.qifDateFormat);
      const safeName = slugifyFilename(acc.quickenName);
      return {
        qif,
        validation,
        filename: `${safeName}-${holdingsExportMode === 'prices_only' ? 'prices' : 'holdings'}-${exportTimestamp}.qif`,
        subtitle: `${acc.quickenName} · ${holdingsExportMode === 'prices_only' ? 'Prices Only (!Type:Prices)' : 'Add Holdings + Prices (!Type:Invst)'} · Date: ${config.qifDateFormat}`,
        isHoldings: true,
      };
    }

    const accountsToExport =
      effectiveAccountId === 'ALL'
        ? importAccounts
        : importAccounts.filter((a) => a.id === effectiveAccountId);
    const qif = generateTransactionsQif(accountsToExport, transactions, config);
    const expectedTxs = transactions.filter((t) =>
      accountsToExport.some((a) => a.id === t.accountId)
    );
    const validation = validateTransactionsQif(qif, expectedTxs, config.qifDateFormat);
    const safeName = slugifyFilename(
      accountsToExport.length === 1 ? accountsToExport[0].quickenName : 'combined-accounts'
    );

    return {
      qif,
      validation,
      filename: `${safeName}-${exportTimestamp}.qif`,
      subtitle: `Exporting ${accountsToExport.map((a) => a.quickenName).join(' + ')} · Date: ${config.qifDateFormat} · EOL: ${config.lineEnding}`,
      isHoldings: false,
    };
  }, [
    activeImport.importKind,
    importAccounts,
    effectiveAccountId,
    transactions,
    holdings,
    holdingsExportMode,
    config,
    exportTimestamp,
  ]);

  const canRemap =
    (activeImport.fileType === 'csv' ||
      activeImport.fileType === 'xls' ||
      activeImport.fileType === 'xlsx') &&
    (activeImport.rawSheets?.length ?? 0) > 0;

  return (
    <div className="space-y-5">
      {/* Loaded File Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center font-mono text-xs font-bold text-indigo-300 uppercase">
            .{activeImport.fileType}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-slate-100">{activeImport.filename}</h2>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  activeImport.importKind === 'summary_only'
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-emerald-500/15 text-emerald-300'
                }`}
              >
                {activeImport.importKind === 'summary_only' ? 'No Transactions' : 'Parsed'}
              </span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-950 border border-slate-700 text-slate-400">
                {TIER_LABELS[activeImport.parserTier] ?? activeImport.parserTier}
              </span>
              <span className="text-xs text-slate-400">{activeImport.detectedFormat}</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {formatBytes(activeImport.fileSize)} · {importAccounts.length} account(s) ·{' '}
              {activeImport.importKind === 'holdings'
                ? `${holdings.length} holdings`
                : `${transactions.length} transactions`}{' '}
              · {skippedRows.length} ignored rows
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {canRemap && (
            <button
              onClick={onOpenMapper}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 bg-slate-950 text-slate-200 hover:border-indigo-500 flex items-center gap-1.5 cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
              Remap Columns
            </button>
          )}
          <button
            onClick={() => setShowSkipped((v) => !v)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 bg-slate-950 text-slate-200 hover:border-indigo-500 flex items-center gap-1.5 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            Skipped Rows ({skippedRows.length})
          </button>
          {activeImport.importKind !== 'summary_only' && (
            <button
              onClick={() => {
                setExportTimestamp(formatFilenameTimestamp());
                setIsModalOpen(true);
              }}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Save As (.qif)
            </button>
          )}
        </div>
      </div>

      {/* Skipped Rows Drawer */}
      {showSkipped && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Parser Diagnostics — Ignored Non-Transaction Rows ({skippedRows.length})
            </h3>
            <button
              onClick={() => setShowSkipped(false)}
              className="text-xs text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              Close ✕
            </button>
          </div>
          {skippedRows.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No rows were skipped.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-1.5 text-xs font-mono">
              {skippedRows.map((s) => (
                <div
                  key={s.id}
                  className="px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-400 flex flex-wrap justify-between gap-2"
                >
                  <span className="truncate max-w-2xl">
                    Row {s.rowIndex}: {s.rawContent}
                  </span>
                  <span className="text-amber-400/90 shrink-0">{s.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Non-Transaction Summary Only View */}
      {activeImport.importKind === 'summary_only' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center space-y-4">
          <div className="w-11 h-11 rounded-full bg-amber-500/15 text-amber-400 mx-auto flex items-center justify-center">
            <Info className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-semibold text-slate-100">No Exportable Transactions Found</h3>
          <p className="text-xs text-slate-400 max-w-lg mx-auto">
            {activeImport.warnings[0] ??
              'This file appears to be an account or deposit summary without a transaction ledger.'}
          </p>

          {activeImport.summaryTable && activeImport.summaryTable.rows.length > 0 && (
            <div className="max-w-3xl mx-auto overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 text-left">
              <table className="w-full text-xs">
                <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                  <tr>
                    {activeImport.summaryTable.headers.map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 tabular-nums text-slate-300">
                  {activeImport.summaryTable.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-3 py-2 whitespace-nowrap">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={onStartNewImport}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Start a New Import
            </button>
          </div>
        </div>
      )}

      {/* ==================== TRANSACTIONS WORKSPACE ==================== */}
      {activeImport.importKind === 'transactions' && (
        <div className="space-y-5">
          {/* Account Selector & Quicken Mapping */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Select Account to Preview &amp; Export
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Choose a specific account (or All Accounts Combined) and customize its Quicken name and type.
                </p>
              </div>
              <span className="text-xs text-slate-500">Account mappings persist in IndexedDB</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {importAccounts.map((acc) => {
                const count = transactions.filter((t) => t.accountId === acc.id).length;
                const active = effectiveAccountId === acc.id;
                return (
                  <button
                    key={acc.id}
                    onClick={() => setSelectedAccountId(acc.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                      active
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-indigo-500'
                    }`}
                  >
                    {acc.quickenName} <span className="opacity-75">({count})</span>
                  </button>
                );
              })}
              {importAccounts.length > 1 && (
                <button
                  onClick={() => setSelectedAccountId('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                    effectiveAccountId === 'ALL'
                      ? 'bg-indigo-600 text-white border-indigo-500'
                      : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-indigo-500'
                  }`}
                >
                  All Accounts Combined <span className="opacity-75">({transactions.length})</span>
                </button>
              )}
            </div>

            {activeAccount && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-slate-800">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Detected Source Account</label>
                  <input
                    type="text"
                    disabled
                    value={`${activeAccount.detectedType} (${activeAccount.accountNumberMasked})`}
                    className="w-full px-2.5 py-1.5 rounded-md text-xs font-mono bg-slate-950 border border-slate-800 text-slate-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Quicken Account Name (<code>N</code>)
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      list="saved-quicken-accounts"
                      value={activeAccount.quickenName}
                      onChange={(e) =>
                        onUpdateAccount({ ...activeAccount, quickenName: e.target.value })
                      }
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                    {savedAccountPresets.length > 0 && (
                      <select
                        aria-label="Pick saved Quicken account"
                        value=""
                        onChange={(e) => {
                          const picked = savedAccountPresets.find((p) => p.id === e.target.value);
                          if (picked) {
                            onUpdateAccount({
                              ...activeAccount,
                              quickenName: picked.quickenName,
                              quickenType: picked.quickenType,
                            });
                          }
                        }}
                        className="px-2 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-300 max-w-28 cursor-pointer"
                        title="Quick-pick a previously used Quicken account"
                      >
                        <option value="">Saved…</option>
                        {savedAccountPresets.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.quickenName} ({p.quickenType})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <datalist id="saved-quicken-accounts">
                    {savedAccountPresets.map((p) => (
                      <option key={p.id} value={p.quickenName} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Quicken Account Type (<code>T</code>)
                  </label>
                  <select
                    value={activeAccount.quickenType}
                    onChange={(e) =>
                      onUpdateAccount({
                        ...activeAccount,
                        quickenType: e.target.value as QuickenAccountType,
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
                  >
                    <option value="Bank">Bank (Checking / Savings)</option>
                    <option value="CCard">CCard (Credit Card)</option>
                    <option value="Cash">Cash</option>
                    <option value="Invst">Invst (Investment)</option>
                    <option value="Oth A">Oth A (Other Asset)</option>
                    <option value="Oth L">Oth L (Other Liability)</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* KPI Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
              <p className="text-xs text-slate-400">Selected for Export</p>
              <p className="text-lg font-semibold tabular-nums text-slate-100 mt-0.5">
                {includedTxs.length} / {scopedTxs.length}
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
              <p className="text-xs text-slate-400">Total Deposits</p>
              <p className="text-lg font-semibold tabular-nums text-emerald-400 mt-0.5">
                +{formatMoney(totalDeposits, config.currency)}
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
              <p className="text-xs text-slate-400">Total Withdrawals</p>
              <p className="text-lg font-semibold tabular-nums text-rose-400 mt-0.5">
                {formatMoney(totalWithdrawals, config.currency)}
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
              <p className="text-xs text-slate-400">Net Change</p>
              <p className="text-lg font-semibold tabular-nums text-slate-100 mt-0.5">
                {netChange >= 0 ? '+' : ''}
                {formatMoney(netChange, config.currency)}
              </p>
            </div>
          </div>

          {/* Transaction Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="p-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Search payee, memo, ref…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-3 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100 w-56 focus:outline-none focus:border-indigo-500"
                />
                <select
                  value={typeFilter}
                  onChange={(e) =>
                    setTypeFilter(e.target.value as 'all' | 'deposit' | 'withdrawal')
                  }
                  className="px-2.5 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
                >
                  <option value="all">All Types</option>
                  <option value="deposit">Deposits Only</option>
                  <option value="withdrawal">Withdrawals Only</option>
                </select>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() =>
                    onBulkToggleTransactions(
                      visibleTransactions.map((t) => t.id),
                      true
                    )
                  }
                  className="px-2.5 py-1 rounded border border-slate-700 bg-slate-950 text-slate-300 hover:border-indigo-500 cursor-pointer"
                >
                  Select All
                </button>
                <button
                  onClick={() =>
                    onBulkToggleTransactions(
                      visibleTransactions.map((t) => t.id),
                      false
                    )
                  }
                  className="px-2.5 py-1 rounded border border-slate-700 bg-slate-950 text-slate-300 hover:border-indigo-500 cursor-pointer"
                >
                  Deselect All
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2.5 text-center w-10">Incl.</th>
                    <th className="px-3 py-2.5 text-left w-28">Date</th>
                    <th className="px-3 py-2.5 text-left w-44">Payee (Editable)</th>
                    <th className="px-3 py-2.5 text-left">Original Remarks / Memo</th>
                    <th className="px-3 py-2.5 text-left w-36">Category (Editable)</th>
                    <th className="px-3 py-2.5 text-right w-28">Amount</th>
                    <th className="px-3 py-2.5 text-right w-28">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {visibleTransactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className={`${tx.isIncluded ? '' : 'opacity-40'} hover:bg-slate-950/60`}
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={tx.isIncluded}
                          onChange={() =>
                            onUpdateTransaction({ ...tx, isIncluded: !tx.isIncluded })
                          }
                          className="accent-indigo-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                        {formatQifDate(tx.txDate, config.qifDateFormat)}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={tx.payee}
                          onChange={(e) =>
                            onUpdateTransaction({ ...tx, payee: e.target.value })
                          }
                          className="w-full px-2 py-1 rounded bg-transparent border border-transparent hover:border-slate-700 focus:border-indigo-500 focus:bg-slate-950 focus:outline-none text-xs text-slate-100"
                        />
                      </td>
                      <td className="px-3 py-2 text-slate-400 font-mono max-w-xs">
                        <div className="truncate" title={tx.memo}>
                          {tx.memo}
                        </div>
                        {tx.warnings.length > 0 && (
                          <div className="flex items-center gap-1 text-amber-400 text-[11px] font-sans mt-0.5">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>{tx.warnings[0]}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={tx.category}
                          placeholder="Optional"
                          onChange={(e) =>
                            onUpdateTransaction({ ...tx, category: e.target.value })
                          }
                          className="w-full px-2 py-1 rounded bg-transparent border border-transparent hover:border-slate-700 focus:border-indigo-500 focus:bg-slate-950 focus:outline-none text-xs text-slate-200 placeholder:text-slate-600"
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums font-medium whitespace-nowrap ${
                          tx.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {tx.amount >= 0 ? '+' : ''}
                        {formatMoney(tx.amount, config.currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap">
                        {tx.balance !== undefined ? formatMoney(tx.balance, config.currency) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== HOLDINGS SNAPSHOT WORKSPACE ==================== */}
      {activeImport.importKind === 'holdings' && (
        <div className="space-y-5">
          {/* Investment Account & Export Mode */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {importAccounts[0] && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Quicken Investment Account Name (<code>N</code>)
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      list="saved-quicken-invst-accounts"
                      value={importAccounts[0].quickenName}
                      onChange={(e) =>
                        onUpdateAccount({ ...importAccounts[0], quickenName: e.target.value })
                      }
                      className="flex-1 min-w-0 px-3 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
                    />
                    {savedAccountPresets.length > 0 && (
                      <select
                        aria-label="Pick saved investment account"
                        value=""
                        onChange={(e) => {
                          const picked = savedAccountPresets.find((p) => p.id === e.target.value);
                          if (picked) {
                            onUpdateAccount({
                              ...importAccounts[0],
                              quickenName: picked.quickenName,
                            });
                          }
                        }}
                        className="px-2 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-300 max-w-28 cursor-pointer"
                      >
                        <option value="">Saved…</option>
                        {savedAccountPresets.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.quickenName}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <datalist id="saved-quicken-invst-accounts">
                    {savedAccountPresets.map((p) => (
                      <option key={p.id} value={p.quickenName} />
                    ))}
                  </datalist>
                </div>
              )}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Holdings QIF Export Mode</label>
                <select
                  value={holdingsExportMode}
                  onChange={(e) => setHoldingsExportMode(e.target.value as HoldingsExportMode)}
                  className="w-full px-3 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
                >
                  <option value="prices_only">
                    Update Prices Only (!Type:Prices — safe for existing Quicken holdings)
                  </option>
                  <option value="shrs_in_and_prices">
                    Add Holdings + Prices (!Type:Invst ShrsIn + !Type:Prices — for new holdings)
                  </option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
              <div>
                <p className="text-xs text-slate-400">Selected Securities</p>
                <p className="text-lg font-semibold tabular-nums text-slate-100">
                  {includedHoldings.length} / {holdings.length}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Total Selected Market Value</p>
                <p className="text-lg font-semibold tabular-nums text-emerald-400">
                  {formatMoney(totalHoldingsValue, config.currency)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="p-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <input
                type="text"
                placeholder="Search ISIN or security name…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100 w-64"
              />
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() =>
                    onBulkToggleHoldings(
                      visibleHoldings.map((h) => h.id),
                      true
                    )
                  }
                  className="px-2.5 py-1 rounded border border-slate-700 bg-slate-950 text-slate-300 cursor-pointer"
                >
                  Select All
                </button>
                <button
                  onClick={() =>
                    onBulkToggleHoldings(
                      visibleHoldings.map((h) => h.id),
                      false
                    )
                  }
                  className="px-2.5 py-1 rounded border border-slate-700 bg-slate-950 text-slate-300 cursor-pointer"
                >
                  Deselect All
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2.5 text-center w-10">Incl.</th>
                    <th className="px-3 py-2.5 text-left w-36">ISIN</th>
                    <th className="px-3 py-2.5 text-left">Security Name (Editable)</th>
                    <th className="px-3 py-2.5 text-right w-24">Quantity</th>
                    <th className="px-3 py-2.5 text-right w-28">Unit Price</th>
                    <th className="px-3 py-2.5 text-right w-32">Market Value</th>
                    <th className="px-3 py-2.5 text-left w-28">As-Of Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {visibleHoldings.map((h) => (
                    <tr
                      key={h.id}
                      className={`${h.isIncluded ? '' : 'opacity-40'} hover:bg-slate-950/60`}
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={h.isIncluded}
                          onChange={() => onUpdateHolding({ ...h, isIncluded: !h.isIncluded })}
                          className="accent-indigo-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-400">{h.isin}</td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={h.securityName}
                          onChange={(e) =>
                            onUpdateHolding({ ...h, securityName: e.target.value })
                          }
                          className="w-full px-2 py-1 rounded bg-transparent border border-transparent hover:border-slate-700 focus:border-indigo-500 focus:bg-slate-950 focus:outline-none text-xs text-slate-100"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-200">
                        {h.quantity}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-200">
                        {formatMoney(h.unitPrice, config.currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-400 font-medium">
                        {formatMoney(h.marketValue, config.currency)}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-400">
                        {formatQifDate(h.asOfDate, config.qifDateFormat)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Save As Modal */}
      {exportBundle && (
        <SaveAsModal
          isOpen={isModalOpen}
          defaultFilename={exportBundle.filename}
          subtitle={exportBundle.subtitle}
          qifText={exportBundle.qif}
          validation={exportBundle.validation}
          currency={config.currency}
          isHoldings={exportBundle.isHoldings}
          onClose={() => setIsModalOpen(false)}
          onSaved={(savedName) => {
            setIsModalOpen(false);
            onToast(`Saved ${savedName}`);
          }}
        />
      )}
    </div>
  );
}
