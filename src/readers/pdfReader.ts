import * as pdfjsLib from 'pdfjs-dist';
import type { PdfPageData, PdfTextItem } from '../types/models';

let workerConfigured = false;

function ensurePdfWorker(): void {
  if (workerConfigured) return;
  workerConfigured = true;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  }
}

export class PdfValidationError extends Error {
  readonly code: 'ENCRYPTED_PDF' | 'SCANNED_PDF' | 'INVALID_PDF';

  constructor(code: 'ENCRYPTED_PDF' | 'SCANNED_PDF' | 'INVALID_PDF', message: string) {
    super(message);
    this.name = 'PdfValidationError';
    this.code = code;
  }
}

function hasEncryptMarker(bytes: Uint8Array): boolean {
  // Fast check for /Encrypt dictionary in raw PDF trailer/objects
  const text = new TextDecoder('latin1').decode(bytes);
  return /\/Encrypt\b/.test(text);
}

export async function readPdfBuffer(buffer: ArrayBuffer): Promise<PdfPageData[]> {
  ensurePdfWorker();
  const bytes = new Uint8Array(buffer);

  if (hasEncryptMarker(bytes)) {
    throw new PdfValidationError(
      'ENCRYPTED_PDF',
      'Encrypted or password-protected PDFs are not supported. Please unlock/decrypt the PDF before importing.'
    );
  }

  let pdfDoc: pdfjsLib.PDFDocumentProxy;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: bytes.slice(),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    });
    pdfDoc = await loadingTask.promise;
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name || '';
    const msg = (err as { message?: string })?.message || '';
    if (name === 'PasswordException' || /password|encrypt/i.test(msg)) {
      throw new PdfValidationError(
        'ENCRYPTED_PDF',
        'Encrypted or password-protected PDFs are not supported. Please unlock/decrypt the PDF before importing.'
      );
    }
    throw new PdfValidationError('INVALID_PDF', `Unable to read PDF file: ${msg || 'corrupted or unsupported PDF'}`);
  }

  const pages: PdfPageData[] = [];
  let totalTextItems = 0;

  try {
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];

      for (const rawItem of content.items) {
        if (!('str' in rawItem)) continue;
        const str = rawItem.str.trim();
        if (!str) continue;
        const transform = rawItem.transform as number[];
        const x = Math.round((transform[4] ?? 0) * 10) / 10;
        const y = Math.round((transform[5] ?? 0) * 10) / 10;
        const width = Math.round((rawItem.width ?? 0) * 10) / 10;
        items.push({ str, x, y, width });
      }

      totalTextItems += items.length;
      pages.push({ pageNumber: p, items });
    }
  } finally {
    await pdfDoc.destroy();
  }

  if (totalTextItems === 0) {
    throw new PdfValidationError(
      'SCANNED_PDF',
      'This PDF appears to be a scanned image with no selectable text. Offline OCR is not supported.'
    );
  }

  return pages;
}
