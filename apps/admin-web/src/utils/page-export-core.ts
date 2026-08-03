import * as XLSX from 'xlsx';

export const PAGE_EXPORT_ROW_LIMIT = 10000;

export type PageExportSheet = {
  name: string;
  rows: unknown[][];
  moneyColumns?: number[];
  percentColumns?: number[];
};

export function exportTimestamp(date = new Date()): string {
  const p = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function makeExportFileName(pageName: string, scope: string, period: string, date = new Date()): string {
  return `${pageName}-${scope}-${period}-${exportTimestamp(date)}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
}

export function buildWorkbook(sheets: PageExportSheet[]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    for (let row = 1; row <= range.e.r; row += 1) {
      for (const column of sheet.moneyColumns || []) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell?.t === 'n') cell.z = '#,##0.00';
      }
      for (const column of sheet.percentColumns || []) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell?.t === 'n') cell.z = '0.00%';
      }
    }
    worksheet['!cols'] = sheet.rows[0]?.map((_, column) => ({
      wch: Math.min(32, Math.max(12, ...sheet.rows.map((row) => String(row[column] ?? '').length + 2))),
    })) || [];
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  return workbook;
}

export function writeWorkbook(fileName: string, sheets: PageExportSheet[]): void {
  XLSX.writeFile(buildWorkbook(sheets), fileName, { compression: true });
}
