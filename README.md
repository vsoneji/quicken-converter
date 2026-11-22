# Bank Statement to QIF Converter

A **100% client-side, offline-capable** web application that converts downloaded financial statements (`.csv`, `.xls`, `.xlsx`, and unencrypted `.pdf`) into verified **Quicken Interchange Format (`.qif`)** files.

Built with React, TypeScript, Vite, Tailwind CSS, and browser-native IndexedDB — ready to deploy on **GitHub Pages** or run locally with zero backend server.

## Privacy & Offline Guarantee

- **Zero uploads**: Your files are read via the browser `File` API and parsed completely on your device. No statement data is ever sent over the network (verifiable in browser DevTools → Network).
- **Zero external CDNs or telemetry**: All scripts, styles, icons, and parsers are bundled locally.
- **Offline-ready (PWA)**: After first load, the Service Worker caches the application so it works even with Wi-Fi disconnected.

## Key Features

- **Single-File-at-a-Time Import**: Supports `.csv`, legacy binary `.xls`, modern `.xlsx`, and unencrypted text-based `.pdf` (encrypted and scanned image-only PDFs are rejected cleanly).
- **Priority-Ordered 3-Tier Parsing Pipeline**:
  1. **User-Saved Templates**: Matches previously saved column mappings automatically.
  2. **Built-in Statement Parsers**: Handles noisy monthly CSVs (boilerplate headers, `B/F` rows, trailing summaries), detailed search-criteria spreadsheets/PDFs, non-transaction deposit summaries, multi-account statements, and investment holdings snapshot PDFs.
  3. **Generic Heuristic Fallback**: Synonym-based column detection for format drift and unregistered statement layouts.
  4. **Interactive Column Mapper**: Visually select the worksheet & header row, map columns (supports split incoming/outgoing columns, single signed `+/-` with optional sign inversion, and `Amount + Dr/Cr`), and save reusable templates.
- **Multi-Account & Holdings Preview**: Pick which account to export, customize Quicken Account Name/Type (`Bank`, `CCard`, `Cash`, `Invst`, `Oth A`, `Oth L`), edit Payee/Memo/Category inline, toggle rows, and inspect skipped non-transaction rows.
- **Investment Holdings Snapshots**: Export `!Type:Prices` (update prices safely) or `!Type:Invst` (`ShrsIn` + `!Type:Prices`) for new holdings.
- **Pre-Export QIF Integrity Check**: Independently re-parses generated `.qif` output before download to verify syntax, delimiter safety, and exact cent-level totals reconciliation.
- **Global Config & JSON Backup/Restore**: Configure currency, QIF date format, default input date order (`DMY`/`MDY`), `!Account` header, cleared status, and line endings — and export/import your settings, account mappings, and templates as `.json`.

## Local Development

```bash
npm install
npm run dev
```

### Scripts

- `npm run dev` — Start local Vite dev server
- `npm run typecheck` — Run strict TypeScript checks
- `npm test` — Run Vitest unit & integration suite
- `npm run build` — Typecheck and build static production bundle into `dist/`
- `npm run preview` — Preview production build locally

## Deploying to GitHub Pages

1. Push this repository to GitHub (branch `main`).
2. In your repository settings, go to **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
3. The included `.github/workflows/deploy.yml` workflow will automatically run tests, build `dist/` with the repository base path, and publish to GitHub Pages.

## Disclaimers

- **Financial Accuracy**: Always review the transaction/holdings preview and keep a backup of your Quicken data file before importing generated `.qif` files.
- **Trademarks**: "Quicken" and "QIF" are referenced strictly for file-format interoperability. This open-source project is not affiliated with or endorsed by Quicken Inc.

## License

[MIT](LICENSE)
