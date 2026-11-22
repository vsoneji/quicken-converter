import type {
  AppConfig,
  HoldingRecord,
  ImportKind,
  ImportStatus,
  MappingTemplate,
  ParsedFileInput,
  ParserTier,
  QuickenAccountType,
  SkippedRowRecord,
  SummaryTableData,
  TransactionRecord,
} from '../types/models';

export interface ParseContext {
  importId: string;
  config: AppConfig;
  savedTemplates: MappingTemplate[];
}

export interface ParsedAccountDraft {
  id: string;
  accountKey: string;
  accountNumberMasked: string;
  detectedType: string;
  currency: string;
  defaultQuickenName: string;
  defaultQuickenType: QuickenAccountType;
}

export interface ParseOutput {
  importKind: ImportKind;
  detectedFormat: string;
  parserTier: ParserTier;
  status: ImportStatus;
  accounts: ParsedAccountDraft[];
  transactions: TransactionRecord[];
  holdings: HoldingRecord[];
  skippedRows: SkippedRowRecord[];
  warnings: string[];
  summaryTable?: SummaryTableData;
}

export interface StatementParser {
  readonly id: string;
  readonly name: string;
  canParse(input: ParsedFileInput): number; // 0..1 confidence
  parse(input: ParsedFileInput, ctx: ParseContext): ParseOutput;
}
