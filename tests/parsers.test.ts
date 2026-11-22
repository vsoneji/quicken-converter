import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type MappingTemplate } from '../src/types/models';
import { readStatementBuffer } from '../src/readers';
import { PdfValidationError } from '../src/readers/pdfReader';
import { runParsingPipeline } from '../src/parsers/pipeline';
import { parseWithTemplate } from '../src/parsers/templateParser';
import { decodeCsvBytes } from '../src/readers/csvReader';
import { parseDateToIso } from '../src/parsers/normalizers';

function loadSample(filename: string): ArrayBuffer {
  const buf = readFileSync(resolve(process.cwd(), 'samples', filename));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe('Multi-tier statement parsing pipeline', () => {
  it('parses noisy monthly CSV (Tier 1), strips boilerplate & B/F', async () => {
    const input = await readStatementBuffer(
      'monthly-statement-noisy-01.csv',
      loadSample('monthly-statement-noisy-01.csv')
    );
    const out = runParsingPipeline(input, {
      importId: 'imp-1',
      config: DEFAULT_CONFIG,
      savedTemplates: [],
    });

    expect(out.parserTier).toBe('tier1');
    expect(out.importKind).toBe('transactions');
    expect(out.accounts).toHaveLength(1);
    expect(out.transactions).toHaveLength(5);
    expect(out.transactions[0].txDate).toBe('2024-11-05');
    expect(out.transactions[0].amount).toBe(-1250.5);
    expect(out.transactions[4].amount).toBe(900);
    expect(out.skippedRows.some((s) => /b\/f/i.test(s.rawContent))).toBe(true);
  });

  it('parses detailed statement XLSX (Tier 1) and strips search criteria & legends', async () => {
    const input = await readStatementBuffer(
      'detailed-statement-01.xlsx',
      loadSample('detailed-statement-01.xlsx')
    );
    const out = runParsingPipeline(input, {
      importId: 'imp-2',
      config: DEFAULT_CONFIG,
      savedTemplates: [],
    });

    expect(out.parserTier).toBe('tier1');
    expect(out.importKind).toBe('transactions');
    expect(out.transactions).toHaveLength(5);
    expect(out.transactions[0].amount).toBe(-18000);
    expect(out.transactions[1].amount).toBe(45000);
    expect(out.transactions[4].chequeNumber).toBe('004120');
  });

  it('detects non-transaction deposit summary XLSX gracefully (Tier 1)', async () => {
    const input = await readStatementBuffer(
      'term-deposits-summary-01.xlsx',
      loadSample('term-deposits-summary-01.xlsx')
    );
    const out = runParsingPipeline(input, {
      importId: 'imp-3',
      config: DEFAULT_CONFIG,
      savedTemplates: [],
    });

    expect(out.parserTier).toBe('tier1');
    expect(out.importKind).toBe('summary_only');
    expect(out.status).toBe('no_transactions');
    expect(out.transactions).toHaveLength(0);
    expect(out.summaryTable?.rows).toHaveLength(3);
  });

  it('parses unencrypted bank statement PDF with X-aligned columns & wrapped remarks', async () => {
    const input = await readStatementBuffer(
      'bank-statement-01.pdf',
      loadSample('bank-statement-01.pdf')
    );
    const out = runParsingPipeline(input, {
      importId: 'imp-4',
      config: DEFAULT_CONFIG,
      savedTemplates: [],
    });

    expect(out.parserTier).toBe('tier1');
    expect(out.importKind).toBe('transactions');
    expect(out.transactions).toHaveLength(4);
    expect(out.transactions[0].txDate).toBe('2025-06-12');
    expect(out.transactions[0].amount).toBe(-615);
    expect(out.transactions[0].memo).toContain('VIN/ONLINE STORE');
    expect(out.transactions[1].amount).toBe(782);
    expect(out.transactions[2].amount).toBe(-354);
    expect(out.transactions[3].amount).toBe(677);
  });

  it('parses investment holdings snapshot PDF (Tier 1)', async () => {
    const input = await readStatementBuffer(
      'demat-holdings-01.pdf',
      loadSample('demat-holdings-01.pdf')
    );
    const out = runParsingPipeline(input, {
      importId: 'imp-5',
      config: DEFAULT_CONFIG,
      savedTemplates: [],
    });

    expect(out.parserTier).toBe('tier1');
    expect(out.importKind).toBe('holdings');
    expect(out.holdings).toHaveLength(4);
    expect(out.holdings[0].isin).toBe('INE000A01011');
    expect(out.holdings[0].quantity).toBe(100);
    expect(out.holdings[0].unitPrice).toBe(350.5);
    expect(out.holdings[0].marketValue).toBe(35050);
    expect(out.holdings[0].asOfDate).toBe('2026-03-31');
  });

  it('rejects encrypted PDFs cleanly', async () => {
    const fakeEncrypted = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Encrypt 2 0 R >> endobj\n%%EOF');
    await expect(
      readStatementBuffer('locked.pdf', fakeEncrypted.buffer)
    ).rejects.toThrow(PdfValidationError);
  });

  it('parses alternate savings CSV via Tier 2 heuristic', async () => {
    const input = await readStatementBuffer(
      'hdfc-savings-01.csv',
      loadSample('hdfc-savings-01.csv')
    );
    const out = runParsingPipeline(input, {
      importId: 'imp-6',
      config: DEFAULT_CONFIG,
      savedTemplates: [],
    });

    expect(out.parserTier).toBe('tier2');
    expect(out.transactions).toHaveLength(6);
    expect(out.transactions[0].amount).toBe(-645.5);
    expect(out.transactions[1].amount).toBe(85000);
  });

  it('parses multi-account CSV via Tier 2 heuristic and separates accounts', async () => {
    const input = await readStatementBuffer(
      'sbi-multi-account-01.csv',
      loadSample('sbi-multi-account-01.csv')
    );
    const out = runParsingPipeline(input, {
      importId: 'imp-7',
      config: DEFAULT_CONFIG,
      savedTemplates: [],
    });

    expect(out.parserTier).toBe('tier2');
    expect(out.accounts).toHaveLength(2);
    expect(out.transactions).toHaveLength(6);
    const acc1Count = out.transactions.filter((t) => t.accountId === out.accounts[0].id).length;
    const acc2Count = out.transactions.filter((t) => t.accountId === out.accounts[1].id).length;
    expect(acc1Count).toBe(3);
    expect(acc2Count).toBe(3);
  });

  it('handles format drift (single Amount + Dr/Cr column) via Tier 2 heuristic', async () => {
    const input = await readStatementBuffer(
      'icici-changed-format-2027.csv',
      loadSample('icici-changed-format-2027.csv')
    );
    const out = runParsingPipeline(input, {
      importId: 'imp-8',
      config: DEFAULT_CONFIG,
      savedTemplates: [],
    });

    expect(out.parserTier).toBe('tier2');
    expect(out.transactions).toHaveLength(4);
    expect(out.transactions[0].amount).toBe(-2450);
    expect(out.transactions[1].amount).toBe(50000);
    expect(out.transactions[2].amount).toBe(-1899);
    expect(out.transactions[3].amount).toBe(1625.5);
  });

  it('routes cryptic CSV to Tier 3 Column Mapper and auto-matches Saved Template on re-upload', async () => {
    const input = await readStatementBuffer(
      'unknown-bank-custom-01.csv',
      loadSample('unknown-bank-custom-01.csv')
    );

    const firstPass = runParsingPipeline(input, {
      importId: 'imp-9a',
      config: DEFAULT_CONFIG,
      savedTemplates: [],
    });
    expect(firstPass.status).toBe('needs_mapping');
    expect(firstPass.parserTier).toBe('tier3');

    const tpl: MappingTemplate = {
      id: 'tpl-coop',
      name: 'Regional Co-op CSV',
      headerSignature: 'col_a|col_b|col_c|col_d|col_e',
      headerRowIndex: 4,
      columnMap: { 0: 'date', 1: 'ref', 2: 'description', 3: 'amount', 4: 'balance' },
      amountMode: 'signed',
      invertSign: false,
      dateFormat: 'YYYY-MM-DD',
      skipPatterns: [],
      defaultAccountName: 'Co-op Checking',
      createdAt: '2026-11-22T00:00:00Z',
      updatedAt: '2026-11-22T00:00:00Z',
    };

    const mapped = parseWithTemplate(input, tpl, {
      importId: 'imp-9b',
      config: DEFAULT_CONFIG,
      savedTemplates: [tpl],
    });
    expect(mapped.transactions).toHaveLength(4);
    expect(mapped.transactions[0].amount).toBe(-1240);
    expect(mapped.transactions[1].amount).toBe(4500);

    // Priority 1 auto-match when template is saved
    const secondPass = runParsingPipeline(input, {
      importId: 'imp-9c',
      config: DEFAULT_CONFIG,
      savedTemplates: [tpl],
    });
    expect(secondPass.parserTier).toBe('template');
    expect(secondPass.transactions).toHaveLength(4);
  });

  it('strips UTF-8 BOM and disambiguates DMY vs MDY dates', () => {
    const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0x2c, 0x42]);
    expect(decodeCsvBytes(bomBytes.buffer)).toBe('A,B');

    expect(parseDateToIso('03/04/2025', 'DMY')).toBe('2025-04-03');
    expect(parseDateToIso('03/04/2025', 'MDY')).toBe('2025-03-04');
    expect(parseDateToIso('12.06.2025', 'DMY')).toBe('2025-06-12');
    expect(parseDateToIso('11,Apr,2025', 'DMY')).toBe('2025-04-11');
  });
});
