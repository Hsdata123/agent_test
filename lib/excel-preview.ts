export type ExcelPreviewRow = string[];

export type ExcelPreviewSheet = {
  name: string;
  totalRows: number;
  previewRows: ExcelPreviewRow[];
  truncated: boolean;
};

export type ExcelPreview = {
  sheets: ExcelPreviewSheet[];
  totalSheets: number;
  totalRows: number;
};

const SHEET_HEADER_RE = /^===\s*Sheet:\s*(.+?)\s*===\s*$/;
const PREVIEW_ROW_LIMIT = 20;
const PREVIEW_CELL_LIMIT = 200;

export function parseExcelPreview(text: string | null | undefined): ExcelPreview | null {
  if (!text) return null;
  const sheets: ExcelPreviewSheet[] = [];
  let current: ExcelPreviewSheet | null = null;
  let totalRows = 0;

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/　/g, " ");
    const headerMatch = line.match(SHEET_HEADER_RE);
    if (headerMatch) {
      if (current) sheets.push(current);
      current = { name: headerMatch[1], totalRows: 0, previewRows: [], truncated: false };
      continue;
    }
    if (!current) continue;
    if (!line.trim()) continue;
    current.totalRows += 1;
    totalRows += 1;
    if (current.previewRows.length < PREVIEW_ROW_LIMIT) {
      current.previewRows.push(splitRow(line));
    } else {
      current.truncated = true;
    }
  }
  if (current) sheets.push(current);

  if (!sheets.length) return null;
  return { sheets, totalSheets: sheets.length, totalRows };
}

function splitRow(line: string): string[] {
  const cells = line.split(" | ");
  return cells.map((cell) => truncateCell(cell));
}

function truncateCell(value: string) {
  if (value.length <= PREVIEW_CELL_LIMIT) return value;
  return `${value.slice(0, PREVIEW_CELL_LIMIT)}…`;
}

export function isExcelAssetType(assetType: string | null | undefined) {
  return assetType === "excel";
}

export function isExcelFileName(originalName: string) {
  const lower = originalName.toLowerCase();
  return lower.endsWith(".xls") || lower.endsWith(".xlsx") || lower.endsWith(".xlsm");
}
