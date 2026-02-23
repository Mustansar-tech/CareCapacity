import ExcelJS from 'exceljs';

interface CellValue {
  v: any;
}

export interface SheetCompat {
  '!ref'?: string;
  [cellRef: string]: any;
}

export interface WorkBookCompat {
  SheetNames: string[];
  Sheets: Record<string, SheetCompat>;
}

interface WriteOptions {
  type: string;
  bookType: string;
}

interface SheetToJsonOptions {
  header?: number | 1;
  raw?: boolean;
  blankrows?: boolean;
  defval?: any;
  range?: number;
}

function colToLetter(col: number): string {
  let letter = '';
  let c = col;
  while (c >= 0) {
    letter = String.fromCharCode((c % 26) + 65) + letter;
    c = Math.floor(c / 26) - 1;
  }
  return letter;
}

function encodeCell(coords: { r: number; c: number }): string {
  return colToLetter(coords.c) + (coords.r + 1);
}

function decodeRange(ref: string): { s: { r: number; c: number }; e: { r: number; c: number } } {
  const parts = ref.split(':');
  const start = decodeCellRef(parts[0]);
  const end = parts.length > 1 ? decodeCellRef(parts[1]) : start;
  return { s: start, e: end };
}

function decodeCellRef(ref: string): { r: number; c: number } {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return { r: 0, c: 0 };
  const letters = match[1];
  const row = parseInt(match[2], 10) - 1;
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  col -= 1;
  return { r: row, c: col };
}

function getCellValue(cell: ExcelJS.Cell): any {
  const val = cell.value;
  if (val === null || val === undefined) return val;
  if (typeof val === 'object') {
    if (val instanceof Date) return val;
    if ('result' in val && 'formula' in val) return (val as ExcelJS.CellFormulaValue).result;
    if ('richText' in val) return (val as ExcelJS.CellRichTextValue).richText.map((rt: any) => rt.text).join('');
    if ('text' in val && 'hyperlink' in val) return (val as ExcelJS.CellHyperlinkValue).text;
    if ('sharedFormula' in val) return (val as any).result;
    if ('error' in val) return (val as ExcelJS.CellErrorValue).error;
  }
  return val;
}

function worksheetToSheetCompat(ws: ExcelJS.Worksheet): SheetCompat {
  const sheet: SheetCompat = {};

  const dims = ws.dimensions;
  if (dims) {
    const topLeft = { r: (dims.top || 1) - 1, c: (dims.left || 1) - 1 };
    const bottomRight = { r: (dims.bottom || 1) - 1, c: (dims.right || 1) - 1 };
    sheet['!ref'] = `${encodeCell(topLeft)}:${encodeCell(bottomRight)}`;
  } else {
    sheet['!ref'] = 'A1:A1';
  }

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const ref = encodeCell({ r: rowNumber - 1, c: colNumber - 1 });
      sheet[ref] = { v: getCellValue(cell) };
    });
  });

  return sheet;
}

function sheetToJson<T = any>(sheet: SheetCompat, opts?: SheetToJsonOptions): T[] {
  const ref = sheet['!ref'] || 'A1:A1';
  const range = decodeRange(ref);

  const startRow = opts?.range !== undefined ? opts.range : range.s.r;
  const endRow = range.e.r;
  const startCol = range.s.c;
  const endCol = range.e.c;

  const allRows: any[][] = [];
  for (let r = startRow; r <= endRow; r++) {
    const row: any[] = [];
    let hasValue = false;
    for (let c = startCol; c <= endCol; c++) {
      const cellRef = encodeCell({ r, c });
      const cell = sheet[cellRef];
      const val = cell ? cell.v : (opts?.defval !== undefined ? opts.defval : undefined);
      row.push(val !== undefined && val !== null ? val : (opts?.defval !== undefined ? opts.defval : undefined));
      if (val !== undefined && val !== null && val !== '') hasValue = true;
    }
    if (!hasValue && opts?.blankrows === false) continue;
    allRows.push(row);
  }

  if (opts?.header === 1) {
    return allRows as unknown as T[];
  }

  if (allRows.length === 0) return [];

  const headerRow = allRows[0];
  const headers = headerRow.map((v: any) => String(v ?? '').trim());
  const result: T[] = [];

  for (let i = 1; i < allRows.length; i++) {
    const row = allRows[i];
    let hasValue = false;
    const obj: Record<string, any> = {};
    for (let j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      const val = row[j];
      obj[headers[j]] = val !== undefined && val !== null ? val : (opts?.defval !== undefined ? opts.defval : undefined);
      if (val !== undefined && val !== null && val !== '') hasValue = true;
    }
    if (!hasValue && opts?.blankrows === false) continue;
    result.push(obj as T);
  }

  return result;
}

interface WritableWorkbook {
  _sheets: { name: string; data: any[][] }[];
}

function bookNew(): WritableWorkbook {
  return { _sheets: [] };
}

function aoaToSheet(data: any[][]): { _aoa: any[][] } {
  return { _aoa: data };
}

function bookAppendSheet(wb: WritableWorkbook, sheet: { _aoa: any[][] }, name: string): void {
  wb._sheets.push({ name, data: sheet._aoa });
}

async function writeWorkbook(wb: WritableWorkbook, opts: WriteOptions): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  for (const sheet of wb._sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    for (let r = 0; r < sheet.data.length; r++) {
      const row = ws.getRow(r + 1);
      for (let c = 0; c < sheet.data[r].length; c++) {
        row.getCell(c + 1).value = sheet.data[r][c] ?? null;
      }
      row.commit();
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function read(buffer: Buffer, _opts?: { type?: string }): Promise<WorkBookCompat> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const SheetNames: string[] = [];
  const Sheets: Record<string, SheetCompat> = {};

  workbook.eachSheet((worksheet) => {
    SheetNames.push(worksheet.name);
    Sheets[worksheet.name] = worksheetToSheetCompat(worksheet);
  });

  return { SheetNames, Sheets };
}

export const utils = {
  sheet_to_json: sheetToJson,
  decode_range: decodeRange,
  encode_cell: encodeCell,
  book_new: bookNew,
  aoa_to_sheet: aoaToSheet,
  book_append_sheet: bookAppendSheet,
};

export const write = writeWorkbook;
