import { useEffect, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Table2 } from "lucide-react";
import type { LocalFilePreviewData } from "@shared/file-preview";
import type { Cell } from "@office-kit/xlsx/cell";
import type { Workbook } from "@office-kit/xlsx/workbook";
import type { Worksheet } from "@office-kit/xlsx/worksheet";

const ROWS_PER_PAGE = 100;
const COLUMNS_PER_PAGE = 40;

interface SpreadsheetRuntime {
  readonly workbook: Workbook;
  readonly getCell: (worksheet: Worksheet, row: number, column: number) => Cell | undefined;
  readonly getDataExtent: (worksheet: Worksheet) => {
    readonly minRow: number;
    readonly maxRow: number;
    readonly minCol: number;
    readonly maxCol: number;
  } | undefined;
  readonly cellStyle: (workbook: Workbook, cell: Cell) => Readonly<Record<string, string>>;
  readonly cellText: (cell: Cell) => string;
  readonly numberFormat: (workbook: Workbook, cell: Cell) => string;
  readonly columnLabel: (column: number) => string;
}

type RuntimeState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly runtime: SpreadsheetRuntime }
  | { readonly status: "error"; readonly message: string };

const SAFE_STYLE_PROPERTIES: Readonly<Record<string, keyof CSSProperties>> = Object.freeze({
  "background-color": "backgroundColor",
  "background-image": "backgroundImage",
  "border-bottom": "borderBottom",
  "border-left": "borderLeft",
  "border-right": "borderRight",
  "border-top": "borderTop",
  color: "color",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-style": "fontStyle",
  "font-weight": "fontWeight",
  "padding-left": "paddingLeft",
  "text-align": "textAlign",
  "text-decoration": "textDecoration",
  transform: "transform",
  "transform-origin": "transformOrigin",
  "vertical-align": "verticalAlign",
  "white-space": "whiteSpace",
  "writing-mode": "writingMode",
});

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function loadSpreadsheetRuntime(bytes: Uint8Array): Promise<SpreadsheetRuntime> {
  const [io, worksheet, cell, styles, utils] = await Promise.all([
    import("@office-kit/xlsx/io"),
    import("@office-kit/xlsx/worksheet"),
    import("@office-kit/xlsx/cell"),
    import("@office-kit/xlsx/styles"),
    import("@office-kit/xlsx/utils"),
  ]);
  const workbook = await io.loadWorkbook(io.fromArrayBuffer(bytes));
  return Object.freeze({
    workbook,
    getCell: worksheet.getCell,
    getDataExtent: worksheet.getDataExtent,
    cellStyle: styles.cellStyleToCss,
    cellText: (target: Cell) => cell.cellValueAsString(target.value, {
      dateFormat: (value) => value.toLocaleString("zh-CN"),
    }),
    numberFormat: styles.getCellNumberFormat,
    columnLabel: utils.columnLetterFromIndex,
  });
}

function numericCellText(cell: Cell, fallback: string, numberFormat: string): string {
  if (typeof cell.value !== "number" || !Number.isFinite(cell.value)) return fallback;
  const format = numberFormat.replace(/\\./g, "").replace(/"[^"]*"/g, "");
  const decimals = format.match(/0\.([0#]+)/)?.[1]?.length;
  if (format.includes("%")) {
    return `${(cell.value * 100).toLocaleString("zh-CN", {
      minimumFractionDigits: decimals ?? 0,
      maximumFractionDigits: decimals ?? 2,
    })}%`;
  }
  const currency = numberFormat.match(/[¥￥$€£]/)?.[0];
  const formatted = cell.value.toLocaleString("zh-CN", {
    useGrouping: format.includes(","),
    ...(decimals === undefined ? {} : {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }),
  });
  return currency ? `${currency}${formatted}` : formatted;
}

function safeCellStyle(style: Readonly<Record<string, string>>): CSSProperties {
  const safe: Record<string, string> = {};
  for (const [property, value] of Object.entries(style)) {
    const mapped = SAFE_STYLE_PROPERTIES[property];
    if (!mapped) continue;
    if (property === "background-image" && !/^((linear|radial)-gradient)\(/i.test(value)) continue;
    safe[mapped] = value;
  }
  return safe as CSSProperties;
}

function range(start: number, end: number): readonly number[] {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
}

function columnDimension(worksheet: Worksheet, column: number) {
  for (const dimension of worksheet.columnDimensions.values()) {
    if (column >= dimension.min && column <= dimension.max) return dimension;
  }
  return undefined;
}

function columnWidth(worksheet: Worksheet, column: number): number {
  const width = columnDimension(worksheet, column)?.width ?? worksheet.defaultColumnWidth ?? 8.43;
  return Math.max(36, Math.round(width * 7 + 5));
}

function rowHeight(worksheet: Worksheet, row: number): number {
  const points = worksheet.rowDimensions.get(row)?.height ?? worksheet.defaultRowHeight ?? 15;
  return Math.max(22, Math.round(points * 96 / 72));
}

function isColumnHidden(worksheet: Worksheet, column: number): boolean {
  return columnDimension(worksheet, column)?.hidden === true;
}

function mergedRangeAt(worksheet: Worksheet, row: number, column: number) {
  return worksheet.mergedCells.find((candidate) =>
    row >= candidate.minRow && row <= candidate.maxRow
    && column >= candidate.minCol && column <= candidate.maxCol);
}

function SpreadsheetGrid({
  runtime,
  worksheet,
  rowStart,
  columnStart,
}: {
  readonly runtime: SpreadsheetRuntime;
  readonly worksheet: Worksheet;
  readonly rowStart: number;
  readonly columnStart: number;
}) {
  const extent = runtime.getDataExtent(worksheet);
  if (!extent) {
    return <div className="file-preview__empty"><Table2 size={30} /><strong>这个工作表没有内容</strong></div>;
  }
  const rowEnd = Math.min(extent.maxRow, rowStart + ROWS_PER_PAGE - 1);
  const columnEnd = Math.min(extent.maxCol, columnStart + COLUMNS_PER_PAGE - 1);
  const rows = range(rowStart, rowEnd).filter((row) => worksheet.rowDimensions.get(row)?.hidden !== true);
  const columns = range(columnStart, columnEnd).filter((column) => !isColumnHidden(worksheet, column));

  return (
    <div className="spreadsheet-grid" role="region" aria-label={`工作表 ${worksheet.title}`} tabIndex={0}>
      <table>
        <colgroup>
          <col className="spreadsheet-grid__row-number-column" />
          {columns.map((column) => <col key={column} style={{ width: columnWidth(worksheet, column) }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="spreadsheet-grid__corner" />
            {columns.map((column) => <th key={column}>{runtime.columnLabel(column)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row} style={{ height: rowHeight(worksheet, row) }}>
              <th>{row}</th>
              {columns.flatMap((column) => {
                const merge = mergedRangeAt(worksheet, row, column);
                if (merge) {
                  const visibleRows = rows.filter((candidate) => candidate >= merge.minRow && candidate <= merge.maxRow);
                  const visibleColumns = columns.filter((candidate) => candidate >= merge.minCol && candidate <= merge.maxCol);
                  if (row !== visibleRows[0] || column !== visibleColumns[0]) return [];
                  const anchor = runtime.getCell(worksheet, merge.minRow, merge.minCol);
                  const text = anchor
                    ? numericCellText(anchor, runtime.cellText(anchor), runtime.numberFormat(runtime.workbook, anchor))
                    : "";
                  return [<td
                    key={`${row}:${column}`}
                    rowSpan={visibleRows.length}
                    colSpan={visibleColumns.length}
                    style={anchor ? safeCellStyle(runtime.cellStyle(runtime.workbook, anchor)) : undefined}
                    title={text}
                  >{text}</td>];
                }
                const target = runtime.getCell(worksheet, row, column);
                const text = target
                  ? numericCellText(target, runtime.cellText(target), runtime.numberFormat(runtime.workbook, target))
                  : "";
                return [<td
                  key={`${row}:${column}`}
                  style={target ? safeCellStyle(runtime.cellStyle(runtime.workbook, target)) : undefined}
                  title={text}
                >{text}</td>];
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SpreadsheetPreview({ data }: { readonly data: LocalFilePreviewData }) {
  const [state, setState] = useState<RuntimeState>({ status: "loading" });
  const [sheetIndex, setSheetIndex] = useState(0);
  const [rowPage, setRowPage] = useState(0);
  const [columnPage, setColumnPage] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    setSheetIndex(0);
    setRowPage(0);
    setColumnPage(0);
    void loadSpreadsheetRuntime(data.bytes).then(
      (runtime) => { if (active) setState({ status: "ready", runtime }); },
      (cause: unknown) => { if (active) setState({ status: "error", message: errorMessage(cause) }); },
    );
    return () => { active = false; };
  }, [data]);

  if (state.status === "loading") {
    return <div className="file-preview__loading" role="status"><LoaderCircle className="spin" /><strong>正在解析 Excel 工作簿</strong><small>读取单元格、合并区域和样式…</small></div>;
  }
  if (state.status === "error") {
    return <div className="file-preview__error" role="alert"><strong>Excel 预览失败</strong><p>{state.message}</p></div>;
  }

  const sheets = state.runtime.workbook.sheets.filter((sheet) => sheet.kind === "worksheet");
  const selected = sheets[sheetIndex] ?? sheets[0];
  if (!selected || selected.kind !== "worksheet") {
    return <div className="file-preview__empty"><Table2 size={30} /><strong>工作簿中没有可预览的工作表</strong></div>;
  }
  const extent = state.runtime.getDataExtent(selected.sheet);
  const rowStart = extent ? Math.min(extent.maxRow, extent.minRow + rowPage * ROWS_PER_PAGE) : 1;
  const columnStart = extent ? Math.min(extent.maxCol, extent.minCol + columnPage * COLUMNS_PER_PAGE) : 1;
  const rowEnd = extent ? Math.min(extent.maxRow, rowStart + ROWS_PER_PAGE - 1) : 0;
  const columnEnd = extent ? Math.min(extent.maxCol, columnStart + COLUMNS_PER_PAGE - 1) : 0;
  const canPreviousRows = rowPage > 0;
  const canNextRows = Boolean(extent && rowEnd < extent.maxRow);
  const canPreviousColumns = columnPage > 0;
  const canNextColumns = Boolean(extent && columnEnd < extent.maxCol);

  return (
    <div className="spreadsheet-preview">
      <div className="spreadsheet-preview__navigator">
        <div className="spreadsheet-preview__sheets" role="tablist" aria-label="工作表">
          {sheets.map((sheet, index) => <button
            type="button"
            role="tab"
            aria-selected={index === sheetIndex}
            className={index === sheetIndex ? "is-active" : ""}
            key={`${sheet.sheetId}:${sheet.sheet.title}`}
            onClick={() => {
              setSheetIndex(index);
              setRowPage(0);
              setColumnPage(0);
            }}
          >{sheet.sheet.title}</button>)}
        </div>
        <div className="spreadsheet-preview__range-controls">
          <span>行 {extent ? `${rowStart}–${rowEnd} / ${extent.maxRow}` : "0"}</span>
          <button type="button" aria-label="上一组行" disabled={!canPreviousRows} onClick={() => setRowPage((value) => value - 1)}><ChevronLeft size={14} /></button>
          <button type="button" aria-label="下一组行" disabled={!canNextRows} onClick={() => setRowPage((value) => value + 1)}><ChevronRight size={14} /></button>
          <span>列 {extent ? `${state.runtime.columnLabel(columnStart)}–${state.runtime.columnLabel(columnEnd)} / ${state.runtime.columnLabel(extent.maxCol)}` : "0"}</span>
          <button type="button" aria-label="上一组列" disabled={!canPreviousColumns} onClick={() => setColumnPage((value) => value - 1)}><ChevronLeft size={14} /></button>
          <button type="button" aria-label="下一组列" disabled={!canNextColumns} onClick={() => setColumnPage((value) => value + 1)}><ChevronRight size={14} /></button>
        </div>
      </div>
      <SpreadsheetGrid runtime={state.runtime} worksheet={selected.sheet} rowStart={rowStart} columnStart={columnStart} />
    </div>
  );
}
