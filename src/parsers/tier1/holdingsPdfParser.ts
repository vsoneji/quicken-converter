import type {
  HoldingRecord,
  ParsedFileInput,
  PdfPageData,
  PdfTextItem,
  SkippedRowRecord,
} from '../../types/models';
import { makeId, parseAmount, parseDateToIso } from '../normalizers';
import type { ParseContext, ParsedAccountDraft, ParseOutput, StatementParser } from '../types';

interface PdfLine {
  y: number;
  items: PdfTextItem[];
  text: string;
}

function groupLines(page: PdfPageData, yTolerance = 4): PdfLine[] {
  const sorted = [...page.items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfLine[] = [];
  for (const item of sorted) {
    const existing = lines.find((l) => Math.abs(l.y - item.y) <= yTolerance);
    if (existing) existing.items.push(item);
    else lines.push({ y: item.y, items: [item], text: '' });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((it) => it.str).join(' ');
  }
  return lines;
}

const ISIN_REGEX = /^IN[A-Z0-9]{10}$/;

function extractUnitPriceFromName(scripText: string): { cleanName: string; unitPrice: number | null } {
  const priceMatch = /\(\s*(?:Rs\.?|INR|₹)\s*([0-9,.]+)\s*\)/i.exec(scripText);
  const unitPrice = priceMatch ? parseAmount(priceMatch[1]) : null;
  const cleanName = scripText
    .replace(/\/-\s*Beneficiary Balance/i, '')
    .replace(/\(\s*(?:Rs\.?|INR|₹)\s*[0-9,.]+\s*\)/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { cleanName: cleanName || scripText.trim(), unitPrice };
}

export const holdingsPdfParser: StatementParser = {
  id: 'tier1-holdings-pdf',
  name: 'Investment / Demat Holdings Snapshot PDF',

  canParse(input: ParsedFileInput): number {
    if (input.fileType !== 'pdf' || !input.pdfPages || input.pdfPages.length === 0) return 0;
    const allText = input.pdfPages
      .map((p) => p.items.map((it) => it.str).join(' '))
      .join(' ');
    const hasIsin = /\bIN[A-Z0-9]{10}\b/.test(allText);
    const hasHoldingsMarker =
      /scrip name/i.test(allText) ||
      /balances for isins/i.test(allText) ||
      /beneficiary balance/i.test(allText);
    if (hasIsin && hasHoldingsMarker) return 0.96;
    return 0;
  },

  parse(input: ParsedFileInput, ctx: ParseContext): ParseOutput {
    const pages = input.pdfPages ?? [];
    const skippedRows: SkippedRowRecord[] = [];
    const holdingsMap = new Map<string, HoldingRecord>();
    const warnings: string[] = [];

    const firstPageText = pages[0]?.items.map((it) => it.str).join(' ') ?? '';

    // Extract account number
    let accountNum = 'Investment-Account';
    const acctMatch = /ACCOUNT\s*NO\.?\s*([A-Z0-9]+\s*-\s*\d+|\d{6,})/i.exec(firstPageText);
    if (acctMatch) accountNum = acctMatch[1].replace(/\s+/g, '');

    // Extract As-Of Date from statement period end or statement date
    let asOfDate = new Date().toISOString().slice(0, 10);
    const periodEnd = /to\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[./-][A-Za-z0-9]+[./-]\d{2,4})/i.exec(firstPageText);
    const stmtDate = /STATEMENT\s+DATE\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i.exec(firstPageText);
    const parsedPeriod = periodEnd ? parseDateToIso(periodEnd[1], ctx.config.defaultInputDateOrder) : null;
    const parsedStmt = stmtDate ? parseDateToIso(stmtDate[1], ctx.config.defaultInputDateOrder) : null;
    if (parsedPeriod) asOfDate = parsedPeriod;
    else if (parsedStmt) asOfDate = parsedStmt;

    const accountId = makeId('acc');
    const masked = accountNum.length > 4 ? `XXXX${accountNum.slice(-4)}` : accountNum;
    const accountDraft: ParsedAccountDraft = {
      id: accountId,
      accountKey: `INVST-${accountNum}`,
      accountNumberMasked: masked,
      detectedType: 'Investment / Demat Account',
      currency: ctx.config.currency,
      defaultQuickenName: `Investment Account (${accountNum.slice(-4)})`,
      defaultQuickenType: 'Invst',
    };

    // Track active security in Section 1 (Closing Balance) AND Section 2 (Balances for ISINs)
    let inCorporateBenefits = false;
    let currentSection1Isin: string | null = null;
    let currentSection1Name = '';
    let currentSection1UnitPrice: number | null = null;
    let rowIdx = 0;

    for (const page of pages) {
      const lines = groupLines(page, 4);
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        rowIdx++;
        const lower = line.text.toLowerCase();

        if (/corporate benefits|disclaimer clause|end of statement/i.test(lower)) {
          inCorporateBenefits = true;
          skippedRows.push({
            id: makeId('skip'),
            importId: ctx.importId,
            rowIndex: rowIdx,
            reason: 'Skipped non-holdings section (corporate benefits / disclaimer)',
            rawContent: line.text,
          });
          continue;
        }

        if (inCorporateBenefits) continue;

        const firstToken = line.items[0]?.str.trim() ?? '';

        // Direct holdings table row OR Section 1 security header: starts with ISIN
        if (ISIN_REGEX.test(firstToken)) {
          const isin = firstToken;
          const rest = line.items.slice(1);
          const trailingNums: number[] = [];
          const nameParts: string[] = [];

          // Trailing numeric tokens at the right end are Quantity and Value
          let idx = rest.length - 1;
          while (idx >= 0 && trailingNums.length < 2) {
            const val = parseAmount(rest[idx].str);
            if (val !== null && /^[0-9,]+(\.[0-9]+)?$/.test(rest[idx].str.trim())) {
              trailingNums.unshift(val);
              idx--;
            } else {
              break;
            }
          }
          for (let k = 0; k <= idx; k++) {
            nameParts.push(rest[k].str);
          }

          // Handle vertically-centered ISIN where wrapped 2-line scrip name sits ~5pt above & below
          const isNameContinuationLine = (candidate: PdfLine | undefined): boolean => {
            if (!candidate) return false;
            const txt = candidate.text.trim();
            if (!txt) return false;
            const cFirst = candidate.items[0]?.str.trim() ?? '';
            if (ISIN_REGEX.test(cFirst)) return false;
            if (/^\d{2}-[A-Za-z]{3}-\d{4}/.test(cFirst)) return false;
            if (/opening balance|closing balance|date\s+nsdl|isin\s+scrip/i.test(txt)) return false;
            return true;
          };

          if (nameParts.length === 0) {
            const prevLine = lines[li - 1];
            if (prevLine && Math.abs(prevLine.y - line.y) <= 9 && isNameContinuationLine(prevLine)) {
              nameParts.push(prevLine.text.trim());
            }
            const nextLine = lines[li + 1];
            if (nextLine && Math.abs(line.y - nextLine.y) <= 9 && isNameContinuationLine(nextLine)) {
              nameParts.push(nextLine.text.trim());
            }
          } else {
            // Also check for wrapped second line immediately below the ISIN line
            const nextLine = lines[li + 1];
            if (nextLine && Math.abs(line.y - nextLine.y) <= 10 && isNameContinuationLine(nextLine)) {
              nameParts.push(nextLine.text.trim());
            }
          }

          const rawName = nameParts.join(' ').trim();
          const { cleanName, unitPrice } = extractUnitPriceFromName(rawName);

          if (trailingNums.length === 2) {
            const [quantity, marketValue] = trailingNums;
            if (quantity > 0) {
              const computedPrice =
                unitPrice !== null && unitPrice > 0
                  ? unitPrice
                  : Math.round((marketValue / quantity) * 100) / 100;
              holdingsMap.set(isin, {
                id: makeId('hold'),
                importId: ctx.importId,
                accountId,
                isin,
                securityName: cleanName,
                quantity,
                unitPrice: computedPrice,
                marketValue: Math.round(marketValue * 100) / 100,
                asOfDate,
                isIncluded: true,
              });
            }
            currentSection1Isin = null;
          } else {
            // Section 1 security header (followed by Opening / Closing Balance rows)
            currentSection1Isin = isin;
            currentSection1Name = cleanName;
            currentSection1UnitPrice = unitPrice;
          }
          continue;
        }

        // Section 1 Closing Balance row for active ISIN
        if (currentSection1Isin && /closing balance/i.test(lower)) {
          const nums: number[] = [];
          for (let k = line.items.length - 1; k >= 0 && nums.length < 2; k--) {
            const s = line.items[k].str.trim();
            if (/^[0-9,]+(\.[0-9]+)?$/.test(s)) {
              const parsed = parseAmount(s);
              if (parsed !== null) nums.unshift(parsed);
            }
          }
          if (nums.length === 2 && nums[0] > 0) {
            const [quantity, marketValue] = nums;
            const computedPrice =
              currentSection1UnitPrice !== null && currentSection1UnitPrice > 0
                ? currentSection1UnitPrice
                : Math.round((marketValue / quantity) * 100) / 100;
            holdingsMap.set(currentSection1Isin, {
              id: makeId('hold'),
              importId: ctx.importId,
              accountId,
              isin: currentSection1Isin,
              securityName: currentSection1Name,
              quantity,
              unitPrice: computedPrice,
              marketValue: Math.round(marketValue * 100) / 100,
              asOfDate,
              isIncluded: true,
            });
          }
          currentSection1Isin = null;
        }
      }
    }

    const holdings = Array.from(holdingsMap.values());

    return {
      importKind: holdings.length > 0 ? 'holdings' : 'summary_only',
      detectedFormat: 'Investment Holdings Snapshot PDF',
      parserTier: 'tier1',
      status: holdings.length > 0 ? 'parsed' : 'no_transactions',
      accounts: holdings.length > 0 ? [accountDraft] : [],
      transactions: [],
      holdings,
      skippedRows,
      warnings,
    };
  },
};
