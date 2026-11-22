import { useMemo, useState } from 'react';
import { Sliders, ArrowRight } from 'lucide-react';
import type { AmountMode, ColumnRole, MappingTemplate, RawSheet } from '../types/models';
import { makeId, normalizeHeaderSignature } from '../parsers/normalizers';

interface ColumnMapperPageProps {
  filename: string;
  sheets: RawSheet[];
  onApplyMapping: (template: MappingTemplate, saveForReuse: boolean) => void;
}

const ROLE_OPTIONS: { value: ColumnRole; label: string }[] = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'date', label: 'Date' },
  { value: 'description', label: 'Description / Memo' },
  { value: 'amount', label: 'Signed Amount (+/-)' },
  { value: 'deposit', label: 'Deposit / Incoming' },
  { value: 'withdrawal', label: 'Withdrawal / Outgoing' },
  { value: 'drcr', label: 'Dr/Cr Indicator' },
  { value: 'balance', label: 'Balance' },
  { value: 'ref', label: 'Check / Ref #' },
  { value: 'mode', label: 'Payment Mode' },
];

export function ColumnMapperPage({
  filename,
  sheets,
  onApplyMapping,
}: ColumnMapperPageProps) {
  const [sheetIndex, setSheetIndex] = useState(0);
  const currentSheet = sheets[sheetIndex] ?? { name: 'Sheet1', rows: [] };
  const previewRows = useMemo(() => currentSheet.rows.slice(0, 25), [currentSheet]);

  // Guess initial header row: first row with >= 3 non-empty cells
  const defaultHeaderRow = useMemo(() => {
    const idx = previewRows.findIndex((r) => r.filter((c) => c.trim()).length >= 3);
    return idx >= 0 ? idx : 0;
  }, [previewRows]);

  const [headerRowIndex, setHeaderRowIndex] = useState(defaultHeaderRow);
  const [amountMode, setAmountMode] = useState<AmountMode>('signed');
  const [invertSign, setInvertSign] = useState(false);
  const [dateFormat, setDateFormat] = useState('AUTO');
  const [skipPatternsText, setSkipPatternsText] = useState('B/F, Opening Balance, Brought Forward, Total');
  const [templateName, setTemplateName] = useState(`${filename.replace(/\.[^.]+$/, '')} Template`);
  const [accountName, setAccountName] = useState(`${filename.replace(/\.[^.]+$/, '')} Account`);
  const [saveForReuse, setSaveForReuse] = useState(true);
  const [validationErr, setValidationErr] = useState<string | null>(null);

  const maxCols = useMemo(
    () => previewRows.reduce((max, r) => Math.max(max, r.length), 0),
    [previewRows]
  );

  const [columnMap, setColumnMap] = useState<Record<number, ColumnRole>>({});

  const headerCells = currentSheet.rows[headerRowIndex] ?? [];
  const signature = normalizeHeaderSignature(headerCells);

  const handleApply = () => {
    const roles = Object.values(columnMap);
    const hasDate = roles.includes('date');
    const hasAmount =
      amountMode === 'signed'
        ? roles.includes('amount')
        : amountMode === 'drcr'
          ? roles.includes('amount') && roles.includes('drcr')
          : roles.includes('deposit') || roles.includes('withdrawal');

    if (!hasDate) {
      setValidationErr('Please assign at least one column as "Date".');
      return;
    }
    if (!hasAmount) {
      setValidationErr(
        amountMode === 'signed'
          ? 'Please assign a "Signed Amount (+/-)" column.'
          : amountMode === 'drcr'
            ? 'Please assign both an "Amount" column and a "Dr/Cr Indicator" column.'
            : 'Please assign at least one "Deposit / Incoming" or "Withdrawal / Outgoing" column.'
      );
      return;
    }

    setValidationErr(null);
    const now = new Date().toISOString();
    const tpl: MappingTemplate = {
      id: makeId('tpl'),
      name: templateName.trim() || 'Custom Template',
      headerSignature: signature || `custom-${Date.now()}`,
      headerRowIndex,
      sheetIndex,
      columnMap,
      amountMode,
      invertSign: amountMode === 'signed' ? invertSign : false,
      dateFormat: dateFormat === 'AUTO' ? '' : dateFormat,
      skipPatterns: skipPatternsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      defaultAccountName: accountName.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    onApplyMapping(tpl, saveForReuse);
  };

  return (
    <div className="space-y-5">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-slate-100">{filename}</h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
                Tier 3 · Column Mapper
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Select the header row, choose your amount layout, map each column below, and optionally save as a reusable template.
            </p>
          </div>
        </div>
        <button
          onClick={handleApply}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 cursor-pointer"
        >
          Apply Mapping &amp; Preview
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {validationErr && (
        <div className="p-3.5 rounded-lg bg-rose-950/50 border border-rose-800 text-rose-200 text-xs">
          {validationErr}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Row & Amount Layout */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            1. Sheet, Header &amp; Amount Layout
          </h3>

          {sheets.length > 1 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Worksheet</label>
              <select
                value={sheetIndex}
                onChange={(e) => {
                  setSheetIndex(Number(e.target.value));
                  setHeaderRowIndex(0);
                }}
                className="w-full px-2.5 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
              >
                {sheets.map((s, idx) => (
                  <option key={idx} value={idx}>
                    {s.name} ({s.rows.length} rows)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1">Header Row</label>
            <select
              value={headerRowIndex}
              onChange={(e) => setHeaderRowIndex(Number(e.target.value))}
              className="w-full px-2.5 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
            >
              {previewRows.map((r, idx) => (
                <option key={idx} value={idx}>
                  Row {idx + 1}: {r.filter((c) => c.trim()).slice(0, 4).join(', ') || '(blank)'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Amount Column Layout</label>
            <select
              value={amountMode}
              onChange={(e) => setAmountMode(e.target.value as AmountMode)}
              className="w-full px-2.5 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
            >
              <option value="signed">Single Signed Column (+/-)</option>
              <option value="split">Two Columns (Incoming / Outgoing)</option>
              <option value="drcr">Single Amount + Dr/Cr Column</option>
            </select>
          </div>

          {amountMode === 'signed' && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={invertSign}
                onChange={(e) => setInvertSign(e.target.checked)}
                className="accent-indigo-500"
              />
              <span className="text-xs text-slate-400">
                Invert sign (e.g., credit cards where charges are positive)
              </span>
            </label>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1">Source Date Format</label>
            <select
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
            >
              <option value="AUTO">Auto-detect (uses Config DMY/MDY tie-breaker)</option>
              <option value="DD/MM/YYYY">Day-first (DD/MM/YYYY, DD-MM-YYYY)</option>
              <option value="MM/DD/YYYY">Month-first (MM/DD/YYYY)</option>
              <option value="YYYY-MM-DD">ISO (YYYY-MM-DD, YYYY/MM/DD)</option>
            </select>
          </div>
        </div>

        {/* Right: Skip Rules & Save Template */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            2. Skip Rules &amp; Save Template for Later Use
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Template Name</label>
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Default Account Label</label>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Skip Rows Containing (comma-separated)
            </label>
            <input
              type="text"
              value={skipPatternsText}
              onChange={(e) => setSkipPatternsText(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-md text-xs bg-slate-950 border border-slate-700 text-slate-100"
            />
          </div>

          <label className="flex items-start gap-2 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={saveForReuse}
              onChange={(e) => setSaveForReuse(e.target.checked)}
              className="accent-indigo-500 mt-0.5"
            />
            <span className="text-xs text-slate-300">
              Save column signature (<code className="text-indigo-300">{signature || 'n/a'}</code>) in IndexedDB to auto-apply on future uploads
            </span>
          </label>
        </div>
      </div>

      {/* Raw Preview Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            3. Map Columns on Raw File Preview (first {previewRows.length} rows)
          </h3>
          <span className="text-xs text-slate-500">Rows above the header row are skipped automatically</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-950 border-b border-slate-800">
              <tr>
                <th className="px-3 py-2 text-left text-slate-500 w-14">Row</th>
                {Array.from({ length: maxCols }).map((_, cIdx) => (
                  <th key={cIdx} className="px-3 py-2 text-left min-w-40">
                    <select
                      value={columnMap[cIdx] ?? 'ignore'}
                      onChange={(e) =>
                        setColumnMap((prev) => ({ ...prev, [cIdx]: e.target.value as ColumnRole }))
                      }
                      className="w-full px-2 py-1 rounded text-xs bg-slate-900 border border-slate-700 text-slate-100 font-medium"
                    >
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 font-mono">
              {previewRows.map((row, rIdx) => {
                const isSkipped = rIdx < headerRowIndex;
                const isHeader = rIdx === headerRowIndex;
                return (
                  <tr
                    key={rIdx}
                    className={
                      isHeader
                        ? 'bg-indigo-950/50 text-indigo-200 font-semibold'
                        : isSkipped
                          ? 'opacity-35 line-through text-slate-400'
                          : 'text-slate-300'
                    }
                  >
                    <td className="px-3 py-2 text-slate-500">
                      {rIdx + 1}
                      {isHeader ? ' ★' : ''}
                    </td>
                    {Array.from({ length: maxCols }).map((__, cIdx) => (
                      <td key={cIdx} className="px-3 py-2 whitespace-nowrap max-w-xs truncate">
                        {row[cIdx] || <span className="opacity-30">—</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
