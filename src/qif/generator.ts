import type {
  AccountRecord,
  AppConfig,
  HoldingRecord,
  HoldingsExportMode,
  QifDateFormat,
  TransactionRecord,
} from '../types/models';

export function formatQifDate(isoDate: string, format: QifDateFormat): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [y, m, d] = parts;
  if (format === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
  if (format === 'DD/MM/YYYY') return `${d}/${m}/${y}`;
  if (format === "MM/DD'YY") return `${m}/${d}'${y.slice(2)}`;
  return `${y}-${m}-${d}`;
}

export function sanitizeQifText(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\^/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function generateTransactionsQif(
  accounts: AccountRecord[],
  transactions: TransactionRecord[],
  config: AppConfig
): string {
  const eol = config.lineEnding === 'CRLF' ? '\r\n' : '\n';
  const lines: string[] = [];
  const forceAccountHeader = config.includeAccountHeader || accounts.length > 1;

  for (const acc of accounts) {
    const accTxs = transactions.filter((t) => t.accountId === acc.id && t.isIncluded);
    if (accTxs.length === 0) continue;

    if (forceAccountHeader) {
      lines.push('!Account');
      lines.push(`N${sanitizeQifText(acc.quickenName)}`);
      lines.push(`T${acc.quickenType}`);
      lines.push('^');
    }

    lines.push(`!Type:${acc.quickenType}`);

    for (const tx of accTxs) {
      lines.push(`D${formatQifDate(tx.txDate, config.qifDateFormat)}`);
      lines.push(`T${tx.amount.toFixed(2)}`);
      const payee = sanitizeQifText(tx.payee || tx.memo || 'Transaction');
      if (payee) lines.push(`P${payee}`);
      const memo = sanitizeQifText(tx.memo);
      if (memo) lines.push(`M${memo}`);
      if (tx.chequeNumber) {
        const ref = sanitizeQifText(tx.chequeNumber);
        if (ref) lines.push(`N${ref}`);
      }
      if (tx.category) {
        const cat = sanitizeQifText(tx.category);
        if (cat) lines.push(`L${cat}`);
      }
      const cleared = tx.clearedStatus || config.defaultClearedStatus;
      if (cleared) lines.push(`C${cleared}`);
      lines.push('^');
    }
  }

  return lines.length > 0 ? lines.join(eol) + eol : '';
}

export function generateHoldingsQif(
  account: AccountRecord,
  holdings: HoldingRecord[],
  mode: HoldingsExportMode,
  config: AppConfig
): string {
  const eol = config.lineEnding === 'CRLF' ? '\r\n' : '\n';
  const included = holdings.filter((h) => h.isIncluded);
  if (included.length === 0) return '';

  const lines: string[] = [];

  // Always include !Type:Prices so Quicken updates latest market prices
  lines.push('!Type:Prices');
  for (const h of included) {
    const sym = sanitizeQifText(h.securityName).replace(/"/g, "'");
    const dt = formatQifDate(h.asOfDate, config.qifDateFormat);
    lines.push(`"${sym}",${h.unitPrice.toFixed(2)},"${dt}"`);
  }
  lines.push('^');

  if (mode === 'shrs_in_and_prices') {
    if (config.includeAccountHeader) {
      lines.push('!Account');
      lines.push(`N${sanitizeQifText(account.quickenName)}`);
      lines.push('TInvst');
      lines.push('^');
    }
    lines.push('!Type:Invst');
    for (const h of included) {
      const sym = sanitizeQifText(h.securityName);
      lines.push(`D${formatQifDate(h.asOfDate, config.qifDateFormat)}`);
      lines.push('NShrsIn');
      lines.push(`Y${sym}`);
      lines.push(`I${h.unitPrice.toFixed(2)}`);
      lines.push(`Q${h.quantity}`);
      lines.push(`T${h.marketValue.toFixed(2)}`);
      if (h.isin) lines.push(`MISIN: ${sanitizeQifText(h.isin)}`);
      lines.push('^');
    }
  }

  return lines.join(eol) + eol;
}
