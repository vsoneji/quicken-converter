import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Download, X } from 'lucide-react';
import type { QifValidationResult } from '../qif/validator';
import { formatMoney, saveTextFile } from '../utils/format';

interface SaveAsModalProps {
  isOpen: boolean;
  defaultFilename: string;
  subtitle: string;
  qifText: string;
  validation: QifValidationResult;
  currency: string;
  isHoldings: boolean;
  onClose: () => void;
  onSaved: (filename: string) => void;
}

export function SaveAsModal({
  isOpen,
  defaultFilename,
  subtitle,
  qifText,
  validation,
  currency,
  isHoldings,
  onClose,
  onSaved,
}: SaveAsModalProps) {
  const [filename, setFilename] = useState(defaultFilename);

  useEffect(() => {
    if (isOpen) {
      setFilename(defaultFilename);
    }
  }, [isOpen, defaultFilename]);

  if (!isOpen) return null;

  const handleDownload = async () => {
    if (!validation.isValid || !qifText.trim()) return;
    const cleanName = filename.trim().endsWith('.qif')
      ? filename.trim()
      : `${filename.trim() || 'export'}.qif`;
    const saved = await saveTextFile(
      qifText,
      cleanName,
      'Quicken Interchange Format (.qif)',
      '.qif',
      'application/qif'
    );
    if (saved) {
      onSaved(cleanName);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Save As — QIF Export Preview</h3>
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 p-1 rounded cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Integrity Verification Banner */}
          <div
            className={`px-4 py-3 rounded-lg border text-xs space-y-1 ${
              validation.isValid
                ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-200'
                : 'bg-rose-950/40 border-rose-800/70 text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              {validation.isValid ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>QIF Integrity Verified (Round-Trip Passed)</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>QIF Validation Failed — Export Blocked</span>
                </>
              )}
            </div>
            {validation.isValid ? (
              <p className="text-emerald-300/90 pl-6">
                {isHoldings
                  ? `Syntax valid · ${validation.priceRecordCount} price updates · Value ${formatMoney(validation.holdingsValueCents / 100, currency)} · Delimiter-safe`
                  : `Syntax valid · ${validation.recordCount} records reconciled · Net ${validation.netCents >= 0 ? '+' : ''}${formatMoney(validation.netCents / 100, currency)} · Delimiter-safe`}
              </p>
            ) : (
              <ul className="list-disc pl-9 space-y-0.5 text-rose-300">
                {validation.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-400 shrink-0">Filename:</label>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="flex-1 px-3 py-1.5 rounded-md text-xs font-mono bg-slate-950 border border-slate-700 text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 max-h-72 overflow-y-auto leading-relaxed">
            {qifText || '(No records selected for export)'}
          </pre>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md text-xs font-medium border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            disabled={!validation.isValid || !qifText.trim()}
            className="px-4 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Save .QIF File
          </button>
        </div>
      </div>
    </div>
  );
}
