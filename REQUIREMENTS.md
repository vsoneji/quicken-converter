# Bank Statement to QIF Converter — Requirements Specification

## 1. Overview & Purpose

Build a **100% client-side, fully offline-capable** web application (deployable as a static site on **GitHub Pages** and runnable locally) that enables users to drag-and-drop or upload a financial statement file in `.csv`, `.xls`, `.xlsx`, or unencrypted `.pdf` format, intelligently parse and normalize the transactions or investment holdings snapshot (including files containing multiple accounts or extraneous non-transaction content), preview and refine the imported data, and export a standard **Quicken Interchange Format (`.qif`)** file via a Save-As workflow.

All file parsing, intermediate storage, QIF generation, and integrity verification run **100% inside the user's browser** with zero backend servers and zero outbound data transmission so sensitive financial files never leave the user's device.

---

## 2. Tech Stack & Runtime Architecture

| Layer | Technology | Notes |
| --- | --- | --- |
| **Architecture** | 100% Client-Side Static SPA | No backend server; deployable directly to **GitHub Pages** (via GitHub Actions) and runnable locally via Vite |
| **Language** | TypeScript (strict mode) | End-to-end typed parsers, storage layer, QIF generator/validator, and UI |
| **Frontend & Build** | React + Vite + TypeScript | All assets (styles, icons, workers) bundled locally with zero external CDN dependencies |
| **Browser Storage** | IndexedDB (via `idb`) | Fast, browser-native local storage for staging the active import, global config settings, saved account mappings, and reusable column-mapping templates — with **JSON Export/Import backup & restore** |
| **File Parsing** | In-browser CSV, Excel (`.xls`/`.xlsx`), and `pdfjs-dist` | Runs completely client-side (using Web Workers where helpful to keep UI responsive); supports `.csv`, BIFF8 `.xls`, OOXML `.xlsx`, and unencrypted text-based `.pdf` |
| **Offline / PWA** | Service Worker + Web App Manifest | Caches all static assets after first load so the app works completely offline with network disconnected |

### Offline & Privacy Guarantee
- Zero backend server — uploaded files are read via the browser `File` API and never transmitted over the network (verifiable in browser DevTools Network tab).
- No external CDNs (Google Fonts, icon packs, analytics, telemetry, etc.).
- Works both hosted on **GitHub Pages** (offline-capable after first load via PWA Service Worker) and locally via `npm run dev` / `npm run preview`.

---

## 3. Functional Requirements

### 3.1 Global Config Screen
Provide a dedicated global **Config** screen accessible from the main navigation bar whose values persist in IndexedDB across sessions:
- **Currency**: Select the currency used for formatting/display and account metadata (e.g., `INR`, `USD`, `EUR`, `GBP`, etc.).
- **Output QIF Date Format**: Select the exported QIF date format (`MM/DD/YYYY`, `DD/MM/YYYY`, `MM/DD'YY`, `YYYY-MM-DD`) with a live QIF preview.
- **Default Input Date Order**: Select `DMY` (day-first, e.g., `03/04/2025` = Apr 3) or `MDY` (month-first) as the tie-breaker when all numeric dates in an uploaded file have day ≤ 12.
- **QIF Export Defaults**:
  - Include `!Account` header block (on/off).
  - Default cleared status (`C` field: None, `c` Cleared, or `X` Reconciled).
  - Line endings (`CRLF` or `LF`).
- **Saved Column-Mapping Templates**: View and delete user-saved column-mapping templates.
- **Backup & Restore (JSON)**:
  - **Export Backup (`.json`)**: Downloads a portable JSON snapshot of the user's global Config, saved Account Mappings, and saved Column-Mapping Templates (never includes staged transaction data).
  - **Import Backup (`.json`)**: Validates and restores settings, account mappings, and templates from a previously exported JSON file (useful across browsers/devices or after clearing browser data).

### 3.2 Single-File Upload & Import Lifecycle
- **Single-File-at-a-Time**: Support dragging and dropping or selecting **one file at a time** (`.csv`, `.xls`, `.xlsx`, or `.pdf`, case-insensitive) to avoid mixing incompatible input formats in a single import session.
- **Input Guardrails & PDF Rejection Rules**:
  - **Encrypted PDFs**: PDFs are expected to be unencrypted; encrypted/password-protected PDFs are rejected immediately with a clear, actionable error message.
  - **Scanned (Image-Only) PDFs**: PDFs with zero extractable text items are detected and rejected with a clear message explaining that OCR is not supported offline.
  - **File Size Guardrail**: Warn or guard against oversized files (e.g., > 25 MB) and handle empty/corrupted files gracefully without crashing.
- **File Status & Summary**: Display the loaded filename, file size, detected document format/parser tier, parsing status (`Parsed`, `Needs Mapping`, `No Transactions`, `Warning`, `Error`), detected account(s), date range, and transaction or holdings count.
- **Start a New Import**:
  - Provide a prominent **"Start a New Import"** action in the workspace header.
  - Clicking it clears the active import's staged file, transactions, holdings, and skipped-row diagnostics from IndexedDB and returns the user to the clean upload screen.
  - **Preserved Data**: Global Config settings, saved Account Mappings, and saved Column-Mapping Templates remain persisted across imports.
- **Workspace Persistence (Nice-to-Have)**:
  - Because intermediate data is staged locally in IndexedDB, refreshing the page or reopening the browser tab automatically restores the in-progress import until the user explicitly clicks **"Start a New Import"**.

### 3.3 Intelligent Parsing & Format Resilience
The parser must **not** rely on hardcoded row numbers or be locked into a single statement template. It uses an explicit **priority-ordered offline parsing pipeline**:

1. **Priority 1 — User-Saved Mapping Templates**:
   - Checks uploaded tabular files against saved `mapping_templates` in IndexedDB by normalized header signature first, ensuring user-defined templates always override built-in parsers if a format changes.
2. **Priority 2 (Tier 1) — Plug-in Statement Parsers (Known Complex Layouts)**:
   - Isolated parser modules implementing a common `StatementParser` interface (`canParse(input) → confidence`, `parse(input)`).
   - Handles complex statement structures cleanly, including:
     - **Monthly Statement CSVs** with extensive repeated boilerplate headers, address blocks, embedded account/deposit summary tables, `B/F` (Brought Forward) opening-balance rows, and trailing summary/footer sections.
     - **Detailed Statement Spreadsheets & Bank Statement PDFs** (legacy binary BIFF8 `.xls`, modern `.xlsx`, and unencrypted text-based `.pdf`) with leading search-criteria/filter metadata blocks, multi-line wrapped remarks, X-coordinate column alignment (for PDFs), and trailing legends/footnotes.
     - **Investment / Demat Holdings Snapshot PDFs**: Extracts security holdings (`ISIN`, `Security Name`, `Quantity`, `Unit Price`, `Total Value`, `As-Of Date`) from holdings tables while ignoring disclaimers and future/expected benefit notices.
     - **Non-Transaction Deposit Summary Exports** (e.g., Fixed/Term Deposit summary spreadsheets with merged columns and no transaction ledger) — detected gracefully as `No Transactions` without throwing errors or producing invalid rows.
     - **Multi-Account Files** containing multiple transaction sections within a single file or across multiple worksheets.
3. **Priority 3 (Tier 2) — Generic Heuristic Fallback (Format Drift & Unregistered Layouts)**:
   - When no saved template or built-in parser matches with high confidence, a generic parser scans each worksheet/CSV (including repeated header blocks for multi-account CSVs) to locate the transaction table by scoring candidate header rows against common column synonyms:
     - *Date*: `Date`, `Txn Date`, `Transaction Date`, `Value Date`, `Posting Date`
     - *Description*: `Particulars`, `Transaction Remarks`, `Narration`, `Description`, `Memo`, `Details`
     - *Amounts*: Two separate columns (`Withdrawal`/`Deposit` or `Debit`/`Credit`), a single signed `Amount` column (`+`/`-`), or a single unsigned `Amount` column paired with a `Dr`/`Cr` indicator
     - *Optional*: `Balance`, `Cheque/Ref No.`, `Mode`
4. **Priority 4 (Tier 3) — Interactive Column Mapper & Template Saver (Unknown Formats)**:
   - If a file cannot be parsed confidently (or the user clicks **"Remap Columns"**), the UI displays a raw-row preview where the user:
     - Selects the **worksheet** (for multi-sheet `.xls`/`.xlsx` workbooks) and **header row** (rows above are skipped automatically).
     - Maps each column to its role: `Date`, `Description / Memo`, `Deposit / Credit`, `Withdrawal / Debit`, `Signed Amount (+/-)`, `Dr/Cr Indicator`, `Balance`, `Check / Ref #`, or `Ignore`.
     - Supports all three amount layouts (**split incoming/outgoing columns**, **single signed column** with optional sign-inversion for credit card statements, and **amount + Dr/Cr column**).
     - Configures the **source date format** and optional **skip patterns** (e.g., `B/F`, `Opening Balance`, `Total`).
   - **Save for Later Use**: Once satisfied, the user can save the mapping as a named template in IndexedDB for automatic reuse on future uploads.

#### Normalization & Data Hygiene
- **Character Encoding & BOM**: Strip UTF-8 BOM from CSVs and decode legacy Windows-1252 / ISO-8859-1 files cleanly when invalid UTF-8 sequences are detected.
- **Date Parsing**: Normalize common date formats (`DD-MM-YYYY`, `DD/MM/YYYY`, `DD.MM.YYYY`, `DD/MM/YY`, `DD-MMM-YYYY`, `DD MMM YYYY`, `YYYY-MM-DD`, `YYYY/MM/DD`, `MM/DD/YYYY`, and Excel serial dates) into canonical ISO dates (`YYYY-MM-DD`). For ambiguous numeric dates (`03/04/2025`), infer order from unambiguous dates (> 12) in the same file, falling back to Config's **Default Input Date Order**. Prefer `Transaction Date` when both `Value Date` and `Transaction Date` exist.
- **Amount Parsing**: Strip currency symbols, commas, and whitespace. Normalize all supported amount layouts into a single signed decimal (`+` for deposits/inflows, `-` for withdrawals/outflows).
- **Extraneous Row Filtering**: Automatically skip blank rows, repeated headers, `B/F` / `Opening Balance` rows, `Total` / summary rows, and footer disclaimers. Retain diagnostic visibility into skipped rows so the user can inspect what was ignored.
- **Payee & Memo Extraction**:
  - Preserve the raw description/remarks in the QIF Memo (`M`) field.
  - Apply optional, transparent heuristics to derive a cleaner Payee (`P`) from structured transaction remarks while allowing the user to edit or revert to raw remarks.
- **Balance Continuity Check (Advisory)**:
  - Where a running balance column is present, verify `previous_balance + amount == current_balance` and surface discrepancies as non-blocking warnings in the preview.

### 3.4 Preview & Review Interface
Before exporting, users must have a clear, interactive preview of the imported file:
- **Summary Overview**: Loaded file name, detected format & parser tier, accounts found, total transactions (or holdings), total inflows/outflows (or total portfolio value formatted using the configured currency), date span, and any parser warnings.
- **Account Selector & Mapping (Multi-Account Support)**:
  - When a file contains multiple accounts, present a clear **account selector** allowing the user to choose which account to preview and export (with an optional "All Accounts" combined export).
  - For each detected account, allow editing the **Quicken Account Name** and **Quicken Account Type** (`Bank`, `CCard`, `Cash`, `Invst`, `Oth A`, `Oth L`).
  - Persist account mappings in IndexedDB so future imports for the same account identifier auto-populate the user's preferred Quicken account name and type.
- **Transaction Preview Table** *(for bank/card statements)*:
  - Filter by Account (when multiple accounts exist), Date Range, Transaction Type (Deposit / Withdrawal), Search query (Payee/Memo/Ref), and Status (Included / Excluded).
  - Sort by Date, Amount, or Payee.
  - Checkbox selection to include/exclude individual transactions (or bulk include/exclude).
  - Inline editing for Payee, Memo, Category, Check/Ref Number, and Cleared Status.
- **Holdings Preview Table** *(for investment holdings snapshots)*:
  - Displays `ISIN`, `Security Name / Symbol` (editable), `Quantity` (editable), `Unit Price` (editable), `Market Value`, and `As-Of Date`.
  - Checkbox selection and per-export mode toggle (`Prices Only (!Type:Prices)` vs. `Add Holdings + Prices (!Type:Invst ShrsIn + !Type:Prices)`).
- **Parser Diagnostics / Ignored Rows Drawer**:
  - Expandable view showing detected file metadata and rows skipped as non-transactions (e.g., `B/F`, summaries, preamble headers) so the user can verify nothing important was missed.

### 3.5 QIF Export ("Save As")
- **Account Choice for Export**:
  - For single-account files, **Save As** exports that account directly.
  - For multi-account files, the user picks **which account to export** (with an optional choice to export all accounts into a single combined QIF if desired).
- **Holdings Snapshot Export (Investments)**:
  - **Update Prices (`!Type:Prices`)**: Exports latest unit prices for selected holdings to update market values in Quicken without altering share counts.
  - **Add / Update Holdings (`!Type:Invst` `ShrsIn` + `!Type:Prices`)**: Exports share additions (`ShrsIn`) for newly added holdings (or user-selected rows) alongside price updates.
- **Save-As Behavior**:
  - Clicking **Save As** opens a save dialog allowing the user to choose the destination path and filename (using the browser File System Access API `showSaveFilePicker` where supported, with seamless fallback to standard browser `.qif` file download).
  - Sensible default filename (e.g., `<AccountName>-YYYY-MM-DD.qif` or `<SourceFilename>.qif`).
- **Config Integration**:
  - QIF dates, `!Account` header inclusion, default cleared status, and line endings are applied from the global **Config** screen settings.
- **Pre-Export QIF Validation & Round-Trip Integrity Check**:
  - Before saving, the generated `.qif` content is automatically re-parsed and verified by an independent offline validator:
    - **Syntax & Delimiter Safety**: Validates `!Account` / `!Type` headers (`Bank`, `CCard`, `Cash`, `Invst`, `Oth A`, `Oth L`, `Prices`), valid `D` (date) and `T` (numeric amount) tags, investment tags (`N`, `Y`, `I`, `Q`, `T`) and `!Type:Prices` CSV lines (`"Symbol",Price,"Date"`), proper `^` record terminators, consistent line endings, no UTF-8 BOM, and sanitization of embedded newlines or stray `^` characters inside text fields.
    - **Financial Round-Trip Reconciliation**:
      - *Transactions*: Verifies re-parsed QIF record count, total deposits, total withdrawals, and net change exactly match the selected staged transactions (using integer minor-unit arithmetic to prevent floating-point drift).
      - *Holdings*: Verifies re-parsed price/holding record counts and total market value exactly match the selected staged holdings.
    - **User-Facing Integrity Summary**: Displays a pass/warning verification summary inside the Save-As preview dialog before download; any structural error blocks export until resolved.

### 3.6 About Page
Provide an accessible **About** page in the main navigation bar designed for first-time visitors:
- **Purpose & Overview**: Plain-language explanation of what the application does (converting `.csv`, `.xls`, `.xlsx`, and unencrypted `.pdf` financial statements and investment holdings snapshots into verified Quicken `.qif` files).
- **How It Works**: Concise step-by-step walkthrough (Upload → Auto-Parse or Map Columns → Preview & Select Account → Verify & Save As `.qif`).
- **Privacy & Offline Guarantee**: Summarizes the 100% in-browser, zero-upload guarantee (see Section 2).
- **Supported Input/Output Summary**: Supported file formats, amount column styles (split, signed, Dr/Cr), multi-account & holdings snapshot export support, JSON config backup/restore, and QIF integrity verification.

---

## 4. QIF Format Specification

Each exported QIF file follows the standard Quicken Interchange Format:

### Bank / Card Transaction Output
```text
!Account
N<Quicken Account Name>
T<Account Type: Bank | CCard | Cash | Oth A | Oth L>
^
!Type:Bank
D09/30/2024
T975.00
PInterest Paid
MQuarterly Interest Credit 01-Jul to 30-Sep
^
D11/09/2024
T-1158.00
POnline Store
MPOS PURCHASE ORDER #431416257038
^
```

*(If `!Account` header inclusion is disabled in Config for a single-account export, the file starts directly at `!Type:Bank`.)*

### Investment Holdings & Price Update Output (`!Type:Prices` / `!Type:Invst`)
```text
!Type:Prices
"ACME CORP EQ",350.50,"03/31/2026"
^
!Account
NInvestment Account
TInvst
^
!Type:Invst
D03/31/2026
NShrsIn
YACME CORP EQ
I350.50
Q100
T35050.00
MISIN: INE000A01011
^
```

### Bank Field Mapping
| QIF Tag | Meaning | Source / Rule |
| --- | --- | --- |
| `D` | Date | Formatted per the global Config date format |
| `T` | Amount | Positive for deposits/credits, negative for withdrawals/debits (2 decimal places, no currency symbols) |
| `P` | Payee | Extracted/edited payee name (fallback to remarks if empty) |
| `M` | Memo | Full original transaction description/remarks |
| `N` | Check / Ref Number | Cheque number or transaction reference if present |
| `L` | Category | Optional user-assigned Quicken category |
| `C` | Cleared Status | Optional (`c`, `X`, or omitted per Config/row override) |
| `^` | End of Entry | Required record terminator |

---

## 5. Local Browser Storage Data Model (IndexedDB)

Intermediate and configuration data is stored locally in IndexedDB (never transmitted externally):

- **`active_import`**: `id`, `filename`, `file_type` (`csv|xls|xlsx|pdf`), `import_kind` (`transactions|holdings|summary_only`), `detected_format`, `parser_tier`, `status`, `summary_json`, `uploaded_at` *(holds the single currently loaded file; cleared on "Start a New Import")*
- **`accounts`**: `id`, `account_key` (normalized source account identifier), `account_number_masked`, `detected_type`, `currency`, `quicken_name`, `quicken_type`, `created_at`, `updated_at` *(persisted across imports; included in JSON backup/restore)*
- **`transactions`**: `id`, `import_id`, `account_id`, `row_index`, `tx_date` (`YYYY-MM-DD`), `value_date`, `amount`, `balance`, `mode`, `cheque_number`, `raw_remarks`, `payee`, `memo`, `category`, `cleared_status`, `is_included`, `warnings_json` *(cleared on "Start a New Import")*
- **`holdings`**: `id`, `import_id`, `account_id`, `isin`, `security_name`, `quantity`, `unit_price`, `market_value`, `as_of_date`, `is_included` *(for investment holdings snapshot imports; cleared on "Start a New Import")*
- **`skipped_rows`**: `id`, `import_id`, `row_index`, `reason`, `raw_content` *(for parser transparency in the preview UI; cleared on "Start a New Import")*
- **`mapping_templates`**: `id`, `name`, `header_signature`, `header_row_index`, `column_map_json`, `amount_mode`, `invert_sign`, `date_format`, `skip_patterns_json`, `created_at`, `updated_at` *(persisted user-defined column-mapping templates; included in JSON backup/restore)*
- **`settings`**: `key`, `value` *(persisted global Config: currency, QIF date format, default input date order, include `!Account` header, default cleared status, line endings; included in JSON backup/restore)*

---

## 6. Non-Functional & Open-Source Requirements

- **Privacy & Security**:
  - 100% client-side execution; zero network requests after initial page load.
  - Real statement files (`samples/do-not-commit/`) and generated `.qif` files must be excluded from version control via `.gitignore`. Anonymized synthetic fixtures in `samples/` may be safely committed for testing.
- **Deployment (GitHub Pages)**:
  - Vite configured with repo-aware `base` path and a GitHub Actions workflow (`.github/workflows/deploy.yml`) to build and publish `dist/` to GitHub Pages automatically.
- **Open-Source Readiness**:
  - Permissive license (`MIT` or `Apache-2.0`) with standard *"AS IS / NO WARRANTY"* clause and permissive third-party dependencies.
  - Clear `README.md` with offline/privacy statement, financial verification disclaimer, and non-affiliation trademark note.
- **Performance**:
  - Parse and load a multi-year statement file (hundreds to thousands of transactions) in under 1 second without freezing the browser UI.
  - Preview table remains responsive with filtering/sorting.
- **Extensibility**:
  - Parser architecture uses the priority-ordered pipeline (User-Saved Templates → Tier 1 Plug-in `StatementParser` modules → Tier 2 Generic Heuristic Parser → Tier 3 Interactive Column Mapper), ensuring the app is never locked into a single institution or static template.
- **Testability**:
  - Automated unit and integration tests (Vitest) covering CSV, XLS, XLSX, and PDF parsing, encoding/BOM handling, ambiguous date disambiguation, extraneous-row stripping, split vs. signed amount normalization, multi-account selection, custom mapping templates, holdings snapshots, JSON backup/restore, and round-trip QIF validation using anonymized test fixtures.
