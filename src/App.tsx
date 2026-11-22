import { useEffect, useState } from 'react';
import { Info, RotateCcw, Settings } from 'lucide-react';
import {
  DEFAULT_CONFIG,
  type AccountRecord,
  type ActiveImport,
  type AppConfig,
  type HoldingRecord,
  type MappingTemplate,
  type ParsedFileInput,
  type SkippedRowRecord,
  type TransactionRecord,
} from './types/models';
import { readStatementBuffer } from './readers';
import { runParsingPipeline } from './parsers/pipeline';
import { parseWithTemplate } from './parsers/templateParser';
import { makeId } from './parsers/normalizers';
import type { ParseOutput } from './parsers/types';
import {
  clearActiveWorkspace,
  deleteTemplate,
  getActiveWorkspace,
  getAllAccounts,
  getAllTemplates,
  loadConfig,
  saveActiveWorkspace,
  saveConfig,
  saveTemplate,
  updateAccount,
  updateHolding,
  updateTransaction,
  upsertAccount,
} from './storage/db';
import { UploadPage } from './pages/UploadPage';
import { ColumnMapperPage } from './pages/ColumnMapperPage';
import { PreviewPage } from './pages/PreviewPage';
import { ConfigPage } from './pages/ConfigPage';
import { AboutPage } from './pages/AboutPage';

type ViewName = 'upload' | 'mapper' | 'preview' | 'config' | 'about';

export function App() {
  const [view, setView] = useState<ViewName>('upload');
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [templates, setTemplates] = useState<MappingTemplate[]>([]);
  const [activeImport, setActiveImport] = useState<ActiveImport | null>(null);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [holdings, setHoldings] = useState<HoldingRecord[]>([]);
  const [skippedRows, setSkippedRows] = useState<SkippedRowRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((curr) => (curr === msg ? null : curr));
    }, 3000);
  };

  // Hydrate persisted config, accounts, templates, and active workspace from IndexedDB
  const hydrateAll = async () => {
    const [cfg, accs, tpls, ws] = await Promise.all([
      loadConfig(),
      getAllAccounts(),
      getAllTemplates(),
      getActiveWorkspace(),
    ]);
    setConfig(cfg);
    setAccounts(accs);
    setTemplates(tpls);
    setActiveImport(ws.activeImport);
    setTransactions(ws.transactions);
    setHoldings(ws.holdings);
    setSkippedRows(ws.skippedRows);
    if (ws.activeImport) {
      setView(ws.activeImport.status === 'needs_mapping' ? 'mapper' : 'preview');
    }
  };

  useEffect(() => {
    hydrateAll().catch(() => {
      // Fallback to empty defaults if IndexedDB is unavailable
    });
  }, []);

  const persistParseOutput = async (
    parsedInput: ParsedFileInput,
    importId: string,
    output: ParseOutput
  ) => {
    const now = new Date().toISOString();
    const idRemap = new Map<string, string>();
    const persistedAccountIds: string[] = [];

    for (const draft of output.accounts) {
      const saved = await upsertAccount({
        id: draft.id,
        accountKey: draft.accountKey,
        accountNumberMasked: draft.accountNumberMasked,
        detectedType: draft.detectedType,
        currency: draft.currency,
        quickenName: draft.defaultQuickenName,
        quickenType: draft.defaultQuickenType,
        createdAt: now,
        updatedAt: now,
      });
      idRemap.set(draft.id, saved.id);
      persistedAccountIds.push(saved.id);
    }

    const mappedTxs = output.transactions.map((t) => ({
      ...t,
      accountId: idRemap.get(t.accountId) ?? t.accountId,
    }));
    const mappedHoldings = output.holdings.map((h) => ({
      ...h,
      accountId: idRemap.get(h.accountId) ?? h.accountId,
    }));

    const nextImport: ActiveImport = {
      id: importId,
      filename: parsedInput.filename,
      fileSize: parsedInput.fileSize,
      fileType: parsedInput.fileType,
      importKind: output.importKind,
      detectedFormat: output.detectedFormat,
      parserTier: output.parserTier,
      status: output.status,
      accountIds: persistedAccountIds,
      warnings: output.warnings,
      summaryTable: output.summaryTable,
      rawSheets: parsedInput.sheets.length > 0 ? parsedInput.sheets : undefined,
      uploadedAt: now,
    };

    await saveActiveWorkspace({
      activeImport: nextImport,
      transactions: mappedTxs,
      holdings: mappedHoldings,
      skippedRows: output.skippedRows,
    });

    const refreshedAccounts = await getAllAccounts();
    setAccounts(refreshedAccounts);
    setActiveImport(nextImport);
    setTransactions(mappedTxs);
    setHoldings(mappedHoldings);
    setSkippedRows(output.skippedRows);

    if (output.status === 'needs_mapping') {
      setView('mapper');
      showToast('Unrecognized headers — opened Interactive Column Mapper');
    } else {
      setView('preview');
      showToast(`Loaded ${parsedInput.filename}`);
    }
  };

  const handleFileSelected = async (file: File) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const buffer = await file.arrayBuffer();
      const parsedInput = await readStatementBuffer(file.name, buffer);
      const importId = makeId('imp');
      const output = runParsingPipeline(parsedInput, {
        importId,
        config,
        savedTemplates: templates,
      });
      await persistParseOutput(parsedInput, importId, output);
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || 'Failed to parse file.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyColumnMapping = async (tpl: MappingTemplate, saveForReuse: boolean) => {
    if (!activeImport || !activeImport.rawSheets) return;
    if (saveForReuse) {
      await saveTemplate(tpl);
      setTemplates(await getAllTemplates());
    }
    const parsedInput: ParsedFileInput = {
      filename: activeImport.filename,
      fileSize: activeImport.fileSize,
      fileType: activeImport.fileType,
      sheets: activeImport.rawSheets,
    };
    const importId = makeId('imp');
    const output = parseWithTemplate(parsedInput, tpl, {
      importId,
      config,
      savedTemplates: templates,
    });
    await persistParseOutput(parsedInput, importId, output);
    if (saveForReuse) {
      showToast(`Applied mapping & saved template "${tpl.name}"`);
    }
  };

  const handleStartNewImport = async () => {
    await clearActiveWorkspace();
    setActiveImport(null);
    setTransactions([]);
    setHoldings([]);
    setSkippedRows([]);
    setErrorMessage(null);
    setView('upload');
    showToast('Workspace cleared — ready for a new import');
  };

  const handleChangeConfig = async (next: AppConfig) => {
    setConfig(next);
    await saveConfig(next);
  };

  const handleDeleteTemplate = async (id: string) => {
    await deleteTemplate(id);
    setTemplates(await getAllTemplates());
    showToast('Template deleted');
  };

  const handleUpdateAccount = async (acc: AccountRecord) => {
    setAccounts((prev) => prev.map((a) => (a.id === acc.id ? acc : a)));
    await updateAccount(acc);
  };

  const handleUpdateTransaction = async (tx: TransactionRecord) => {
    setTransactions((prev) => prev.map((t) => (t.id === tx.id ? tx : t)));
    await updateTransaction(tx);
  };

  const handleBulkToggleTransactions = async (ids: string[], included: boolean) => {
    const idSet = new Set(ids);
    const updated: TransactionRecord[] = [];
    setTransactions((prev) =>
      prev.map((t) => {
        if (!idSet.has(t.id)) return t;
        const next = { ...t, isIncluded: included };
        updated.push(next);
        return next;
      })
    );
    await Promise.all(updated.map((t) => updateTransaction(t)));
  };

  const handleUpdateHolding = async (h: HoldingRecord) => {
    setHoldings((prev) => prev.map((x) => (x.id === h.id ? h : x)));
    await updateHolding(h);
  };

  const handleBulkToggleHoldings = async (ids: string[], included: boolean) => {
    const idSet = new Set(ids);
    const updated: HoldingRecord[] = [];
    setHoldings((prev) =>
      prev.map((h) => {
        if (!idSet.has(h.id)) return h;
        const next = { ...h, isIncluded: included };
        updated.push(next);
        return next;
      })
    );
    await Promise.all(updated.map((h) => updateHolding(h)));
  };

  const navBtnClass = (v: ViewName) =>
    `px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
      view === v
        ? 'bg-indigo-600 text-white'
        : 'text-slate-400 hover:text-slate-100'
    }`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-6 py-3">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">
              Q
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold tracking-tight text-slate-100">
                  Bank Statement → QIF Converter
                </h1>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  100% Offline
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Client-side CSV, XLS, XLSX &amp; PDF → Verified QIF
              </p>
            </div>
          </div>

          {/* Nav Tabs */}
          <nav className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button onClick={() => setView('upload')} className={navBtnClass('upload')}>
              1. Upload
            </button>
            {activeImport?.rawSheets && activeImport.rawSheets.length > 0 && (
              <button onClick={() => setView('mapper')} className={navBtnClass('mapper')}>
                2. Mapper
              </button>
            )}
            {activeImport && activeImport.status !== 'needs_mapping' && (
              <button onClick={() => setView('preview')} className={navBtnClass('preview')}>
                Preview &amp; Export
              </button>
            )}
            <button onClick={() => setView('config')} className={navBtnClass('config')}>
              <Settings className="w-3.5 h-3.5" />
              Config
            </button>
            <button onClick={() => setView('about')} className={navBtnClass('about')}>
              <Info className="w-3.5 h-3.5" />
              About
            </button>
          </nav>

          {/* Start a New Import */}
          <div>
            {activeImport && (
              <button
                onClick={handleStartNewImport}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Start a New Import
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-6">
        {view === 'upload' && (
          <UploadPage
            config={config}
            isLoading={isLoading}
            errorMessage={errorMessage}
            onFileSelected={handleFileSelected}
            onOpenConfig={() => setView('config')}
          />
        )}

        {view === 'mapper' && activeImport?.rawSheets && (
          <ColumnMapperPage
            filename={activeImport.filename}
            sheets={activeImport.rawSheets}
            onApplyMapping={handleApplyColumnMapping}
          />
        )}

        {view === 'preview' && activeImport && (
          <PreviewPage
            activeImport={activeImport}
            accounts={accounts}
            transactions={transactions}
            holdings={holdings}
            skippedRows={skippedRows}
            config={config}
            onUpdateAccount={handleUpdateAccount}
            onUpdateTransaction={handleUpdateTransaction}
            onBulkToggleTransactions={handleBulkToggleTransactions}
            onUpdateHolding={handleUpdateHolding}
            onBulkToggleHoldings={handleBulkToggleHoldings}
            onOpenMapper={() => setView('mapper')}
            onStartNewImport={handleStartNewImport}
            onToast={showToast}
          />
        )}

        {view === 'config' && (
          <ConfigPage
            config={config}
            templates={templates}
            onChangeConfig={handleChangeConfig}
            onDeleteTemplate={handleDeleteTemplate}
            onBackupRestored={async (summary) => {
              await hydrateAll();
              showToast(summary);
            }}
            onToast={showToast}
          />
        )}

        {view === 'about' && <AboutPage onGetStarted={() => setView('upload')} />}
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-700 shadow-xl text-xs font-medium text-slate-100 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
export default App;
