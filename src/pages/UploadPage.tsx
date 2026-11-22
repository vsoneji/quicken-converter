import { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, ShieldCheck, AlertCircle, Settings } from 'lucide-react';
import type { AppConfig } from '../types/models';
import { MAX_RECOMMENDED_FILE_BYTES } from '../readers';
import { formatBytes } from '../utils/format';

interface UploadPageProps {
  config: AppConfig;
  isLoading: boolean;
  errorMessage: string | null;
  onFileSelected: (file: File) => void;
  onOpenConfig: () => void;
}

export function UploadPage({
  config,
  isLoading,
  errorMessage,
  onFileSelected,
  onOpenConfig,
}: UploadPageProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_RECOMMENDED_FILE_BYTES) {
      setSizeWarning(
        `Large file detected (${formatBytes(file.size)}). Processing runs in browser memory and may take a moment.`
      );
    } else {
      setSizeWarning(null);
    }
    onFileSelected(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Import Financial Statement</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Drop or browse one file at a time (<code>.csv</code>, <code>.xls</code>, <code>.xlsx</code>, or unencrypted <code>.pdf</code>).
          </p>
        </div>
        <button
          onClick={onOpenConfig}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:border-indigo-500 transition flex items-center gap-2 cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400">Active Config:</span>
          <span className="font-medium text-slate-200">
            {config.currency} · {config.qifDateFormat} · !Account {config.includeAccountHeader ? 'On' : 'Off'}
          </span>
        </button>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-200 text-xs flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Unable to Import File</p>
            <p className="text-rose-300 mt-0.5">{errorMessage}</p>
          </div>
        </div>
      )}

      {sizeWarning && (
        <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/70 text-amber-200 text-xs">
          {sizeWarning}
        </div>
      )}

      {/* Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          handleFile(file);
        }}
        className={`rounded-2xl border-2 border-dashed p-12 text-center transition space-y-4 ${
          isDragging
            ? 'border-indigo-400 bg-indigo-950/30'
            : 'border-slate-700 bg-slate-900/70 hover:border-indigo-500/70'
        }`}
      >
        <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 mx-auto flex items-center justify-center">
          <Upload className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-100">
            {isLoading ? 'Parsing statement locally…' : 'Drag & drop a single statement file here'}
          </p>
          <p className="text-xs text-slate-400">
            Supports <code>.CSV</code>, <code>.XLS</code> (BIFF8), <code>.XLSX</code>, and unencrypted text-based <code>.PDF</code>
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xls,.xlsx,.pdf"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <div className="pt-1">
          <button
            disabled={isLoading}
            onClick={() => inputRef.current?.click()}
            className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition cursor-pointer"
          >
            {isLoading ? 'Processing…' : 'Browse Local File…'}
          </button>
        </div>

        <p className="text-xs text-slate-500 pt-2">
          Single-file mode prevents mixing incompatible statement formats in one import.
        </p>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-3">
          <FileSpreadsheet className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-xs font-semibold text-slate-200">3-Tier Intelligent Parsing</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Automatically checks your saved templates first, then built-in parsers (noisy CSVs, detailed spreadsheets, bank &amp; holdings PDFs), then generic heuristics — or opens the Column Mapper for unknown layouts.
            </p>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-xs font-semibold text-slate-200">100% Browser-Local Privacy</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Files are parsed completely inside your browser with zero uploads. Settings, account mappings, and column templates are saved locally in IndexedDB with JSON backup/restore.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
