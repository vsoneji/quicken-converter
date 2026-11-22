export type SupportedFileType = 'csv' | 'xls' | 'xlsx' | 'pdf';

export type ImportKind = 'transactions' | 'holdings' | 'summary_only' | 'needs_mapping';

export type ParserTier = 'template' | 'tier1' | 'tier2' | 'tier3';

export type ImportStatus = 'parsed' | 'needs_mapping' | 'no_transactions' | 'warning' | 'error';

export type QuickenAccountType = 'Bank' | 'CCard' | 'Cash' | 'Invst' | 'Oth A' | 'Oth L';

export type QifDateFormat = 'MM/DD/YYYY' | 'DD/MM/YYYY' | "MM/DD'YY" | 'YYYY-MM-DD';

export type InputDateOrder = 'DMY' | 'MDY';

export type ClearedStatus = '' | 'c' | 'X';

export type LineEnding = 'CRLF' | 'LF';

export type AmountMode = 'split' | 'signed' | 'drcr';

export type HoldingsExportMode = 'prices_only' | 'shrs_in_and_prices';

export type ColumnRole =
  | 'ignore'
  | 'date'
  | 'description'
  | 'amount'
  | 'deposit'
  | 'withdrawal'
  | 'drcr'
  | 'balance'
  | 'ref'
  | 'mode';

export interface AppConfig {
  currency: string;
  qifDateFormat: QifDateFormat;
  defaultInputDateOrder: InputDateOrder;
  includeAccountHeader: boolean;
  defaultClearedStatus: ClearedStatus;
  lineEnding: LineEnding;
}

export const DEFAULT_CONFIG: AppConfig = {
  currency: 'INR',
  qifDateFormat: 'MM/DD/YYYY',
  defaultInputDateOrder: 'DMY',
  includeAccountHeader: true,
  defaultClearedStatus: '',
  lineEnding: 'CRLF',
};

export interface AccountRecord {
  id: string;
  accountKey: string;
  accountNumberMasked: string;
  detectedType: string;
  currency: string;
  quickenName: string;
  quickenType: QuickenAccountType;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionRecord {
  id: string;
  importId: string;
  accountId: string;
  rowIndex: number;
  txDate: string; // YYYY-MM-DD
  valueDate?: string;
  amount: number; // + deposit, - withdrawal
  balance?: number;
  mode?: string;
  chequeNumber?: string;
  rawRemarks: string;
  payee: string;
  memo: string;
  category: string;
  clearedStatus: ClearedStatus;
  isIncluded: boolean;
  warnings: string[];
}

export interface HoldingRecord {
  id: string;
  importId: string;
  accountId: string;
  isin: string;
  securityName: string;
  quantity: number;
  unitPrice: number;
  marketValue: number;
  asOfDate: string; // YYYY-MM-DD
  isIncluded: boolean;
}

export interface SkippedRowRecord {
  id: string;
  importId: string;
  rowIndex: number;
  reason: string;
  rawContent: string;
}

export interface MappingTemplate {
  id: string;
  name: string;
  headerSignature: string;
  headerRowIndex: number;
  sheetIndex?: number;
  columnMap: Record<number, ColumnRole>;
  amountMode: AmountMode;
  invertSign: boolean;
  dateFormat: string;
  skipPatterns: string[];
  defaultAccountName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RawSheet {
  name: string;
  rows: string[][];
}

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

export interface PdfPageData {
  pageNumber: number;
  items: PdfTextItem[];
}

export interface ParsedFileInput {
  filename: string;
  fileSize: number;
  fileType: SupportedFileType;
  sheets: RawSheet[];
  pdfPages?: PdfPageData[];
}

export interface SummaryTableData {
  title: string;
  headers: string[];
  rows: string[][];
}

export interface ActiveImport {
  id: string;
  filename: string;
  fileSize: number;
  fileType: SupportedFileType;
  importKind: ImportKind;
  detectedFormat: string;
  parserTier: ParserTier;
  status: ImportStatus;
  accountIds: string[];
  warnings: string[];
  summaryTable?: SummaryTableData;
  rawSheets?: RawSheet[];
  uploadedAt: string;
}

export interface BackupPayload {
  schemaVersion: 1;
  exportedAt: string;
  config: AppConfig;
  accounts: AccountRecord[];
  mappingTemplates: MappingTemplate[];
}
