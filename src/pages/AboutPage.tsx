import { ArrowRight, ShieldCheck, Layers } from 'lucide-react';

interface AboutPageProps {
  onGetStarted: () => void;
}

export function AboutPage({ onGetStarted }: AboutPageProps) {
  return (
    <div className="space-y-5">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            100% Client-Side &amp; Offline
          </span>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
            CSV · XLS · XLSX · PDF → QIF
          </span>
        </div>
        <h2 className="text-xl font-semibold text-slate-100">About Bank Statement → QIF Converter</h2>
        <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
          This browser-local web application converts downloaded financial statements (<code>.csv</code>, legacy binary <code>.xls</code>, modern <code>.xlsx</code>, and unencrypted text-based <code>.pdf</code>) as well as investment holdings snapshots into verified <strong>Quicken Interchange Format (<code>.qif</code>)</strong> files. It automatically strips boilerplate headers, summary tables, and brought-forward rows, supports multi-account exports, and lets you map and save reusable column templates for any institution.
        </p>
      </div>

      {/* 4-Step Walkthrough */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">How It Works</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[
            {
              step: '1',
              title: 'Upload One Statement',
              desc: 'Drop a single .csv, .xls, .xlsx, or unencrypted .pdf file at a time to avoid mixing incompatible formats.',
            },
            {
              step: '2',
              title: 'Smart Parse or Map',
              desc: 'Saved templates, built-in parsers, and heuristics auto-detect columns — or use the Column Mapper to define and save a new layout.',
            },
            {
              step: '3',
              title: 'Preview & Refine',
              desc: 'Pick which account to export, edit Payee/Category or holdings inline, inspect skipped rows, and customize Quicken account mapping.',
            },
            {
              step: '4',
              title: 'Verify & Save As',
              desc: 'Every generated .qif passes an automatic round-trip syntax and financial totals integrity check before saving.',
            },
          ].map((item) => (
            <div
              key={item.step}
              className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5"
            >
              <span className="inline-flex w-6 h-6 rounded-full bg-indigo-600 text-white items-center justify-center text-xs font-bold">
                {item.step}
              </span>
              <h4 className="text-xs font-semibold text-slate-100">{item.title}</h4>
              <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Privacy & Capabilities */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-2.5">
          <div className="flex items-center gap-2 text-emerald-400">
            <ShieldCheck className="w-4 h-4" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Privacy &amp; Offline Guarantee
            </h3>
          </div>
          <ul className="space-y-2 text-xs text-slate-400 list-disc pl-4">
            <li>
              <strong className="text-slate-200">Zero uploads:</strong> Statements are parsed locally inside your browser and never leave your computer.
            </li>
            <li>
              <strong className="text-slate-200">Zero external CDNs or tracking:</strong> Works completely offline via PWA caching after first load.
            </li>
            <li>
              <strong className="text-slate-200">Local IndexedDB + JSON Backup:</strong> Settings, account mappings, and column templates are stored locally with 1-click JSON export/import.
            </li>
          </ul>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-2.5">
          <div className="flex items-center gap-2 text-indigo-400">
            <Layers className="w-4 h-4" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Key Capabilities
            </h3>
          </div>
          <ul className="space-y-2 text-xs text-slate-400 list-disc pl-4">
            <li>
              <strong className="text-slate-200">Flexible amount layouts:</strong> Split incoming/outgoing columns, single signed (<code>+/-</code>) with optional sign inversion, or amount + <code>Dr/Cr</code>.
            </li>
            <li>
              <strong className="text-slate-200">Multi-account &amp; Holdings snapshots:</strong> Export a single account, combined accounts, or investment <code>!Type:Prices</code> / <code>!Type:Invst</code> updates.
            </li>
            <li>
              <strong className="text-slate-200">Pre-export integrity check:</strong> Re-parses every QIF file to verify syntax, delimiter safety, and exact cent-level totals.
            </li>
          </ul>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onGetStarted}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 cursor-pointer"
        >
          Get Started — Upload a File
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
