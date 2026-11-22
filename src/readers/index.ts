import type { ParsedFileInput, SupportedFileType } from '../types/models';
import { readCsvBuffer } from './csvReader';
import { readExcelBuffer } from './excelReader';
import { readPdfBuffer } from './pdfReader';

export const MAX_RECOMMENDED_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

export function detectFileType(filename: string): SupportedFileType | null {
  const lower = filename.toLowerCase().trim();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xls')) return 'xls';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.pdf')) return 'pdf';
  return null;
}

export async function readStatementBuffer(
  filename: string,
  buffer: ArrayBuffer
): Promise<ParsedFileInput> {
  if (buffer.byteLength === 0) {
    throw new Error('The uploaded file is empty.');
  }

  const fileType = detectFileType(filename);
  if (!fileType) {
    throw new Error('Unsupported file format. Please upload a .csv, .xls, .xlsx, or .pdf file.');
  }

  if (fileType === 'csv') {
    return {
      filename,
      fileSize: buffer.byteLength,
      fileType,
      sheets: readCsvBuffer(buffer),
    };
  }

  if (fileType === 'xls' || fileType === 'xlsx') {
    return {
      filename,
      fileSize: buffer.byteLength,
      fileType,
      sheets: readExcelBuffer(buffer),
    };
  }

  const pdfPages = await readPdfBuffer(buffer);
  return {
    filename,
    fileSize: buffer.byteLength,
    fileType,
    sheets: [],
    pdfPages,
  };
}
