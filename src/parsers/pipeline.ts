import type { ParsedFileInput } from '../types/models';
import { findMatchingTemplate, parseWithTemplate } from './templateParser';
import { depositSummaryParser } from './tier1/depositSummaryParser';
import { detailedStatementParser } from './tier1/detailedStatementParser';
import { holdingsPdfParser } from './tier1/holdingsPdfParser';
import { monthlyCsvParser } from './tier1/monthlyCsvParser';
import { heuristicParser } from './tier2/heuristicParser';
import type { ParseContext, ParseOutput, StatementParser } from './types';

const TIER1_PARSERS: StatementParser[] = [
  depositSummaryParser,
  holdingsPdfParser,
  monthlyCsvParser,
  detailedStatementParser,
];

export function runParsingPipeline(input: ParsedFileInput, ctx: ParseContext): ParseOutput {
  // Priority 1: User-Saved Mapping Templates
  const matchedTpl = findMatchingTemplate(input, ctx.savedTemplates);
  if (matchedTpl) {
    return parseWithTemplate(
      input,
      matchedTpl.template,
      ctx,
      matchedTpl.sheetIndex,
      matchedTpl.headerRowIndex
    );
  }

  // Priority 2: Tier 1 Built-in Plug-in Statement Parsers
  let bestTier1: { parser: StatementParser; score: number } | null = null;
  for (const parser of TIER1_PARSERS) {
    const score = parser.canParse(input);
    if (score >= 0.8 && (!bestTier1 || score > bestTier1.score)) {
      bestTier1 = { parser, score };
    }
  }
  if (bestTier1) {
    return bestTier1.parser.parse(input, ctx);
  }

  // Priority 3: Tier 2 Generic Heuristic Parser
  if (heuristicParser.canParse(input) >= 0.5) {
    const result = heuristicParser.parse(input, ctx);
    if (result.transactions.length > 0) {
      return result;
    }
  }

  // Priority 4: Tier 3 Interactive Column Mapper (for tabular files)
  if (input.sheets.length > 0 && input.sheets.some((s) => s.rows.length > 0)) {
    return {
      importKind: 'needs_mapping',
      detectedFormat: 'Unrecognized Format — Column Mapping Required',
      parserTier: 'tier3',
      status: 'needs_mapping',
      accounts: [],
      transactions: [],
      holdings: [],
      skippedRows: [],
      warnings: [
        'No built-in parser or heuristic matched this layout confidently. Use the Column Mapper to assign columns and optionally save a reusable template.',
      ],
    };
  }

  return {
    importKind: 'summary_only',
    detectedFormat: 'Unsupported or Empty Document',
    parserTier: 'tier3',
    status: 'no_transactions',
    accounts: [],
    transactions: [],
    holdings: [],
    skippedRows: [],
    warnings: ['No recognizable transactions or holdings tables were found in this file.'],
  };
}
