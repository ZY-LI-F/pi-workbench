import Papa from "papaparse";
import { previewText } from "./artifact-preview";

export interface DelimitedData { readonly source: string; readonly rows: readonly (readonly string[])[]; readonly columns: number }
export function parseDelimited(bytes: Uint8Array, delimiter: "," | "\t", encoding = "auto"): DelimitedData {
  const source = previewText(bytes, encoding);
  if (!source) return { source, rows: [], columns: 0 };
  const result = Papa.parse<string[]>(source, { delimiter, header: false, dynamicTyping: false, skipEmptyLines: false });
  if (result.errors.length) throw new Error(result.errors.map((error) => `记录 ${(error.row ?? 0) + 1}：${error.message}`).join("；"));
  return { source, rows: result.data, columns: result.data.reduce((count, row) => Math.max(count, row.length), 0) };
}

function decimal(value: string): { readonly sign: number; readonly digits: string; readonly magnitude: bigint } | undefined {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!match) return undefined;
  const whole = match[2] ?? "";
  const raw = whole + (match[3] ?? match[4] ?? "");
  const leading = raw.match(/^0*/)?.[0].length ?? 0;
  const digits = raw.slice(leading).replace(/0+$/, "");
  return { sign: !digits ? 0 : match[1] === "-" ? -1 : 1, digits,
    magnitude: BigInt(whole.length - leading) + BigInt(match[5] ?? "0") };
}

/** Decimal ordering without coercing identifiers or losing >53-bit integers. */
export function compareNumericText(a: string, b: string, descending = false): number {
  const left = decimal(a); const right = decimal(b);
  if (!left || !right) return left ? -1 : right ? 1 : 0; // Non-numeric values stay last in either direction.
  let order = left.sign - right.sign;
  if (!order && left.sign) {
    const length = Math.max(left.digits.length, right.digits.length);
    const l = left.digits.padEnd(length, "0"); const r = right.digits.padEnd(length, "0");
    order = left.magnitude !== right.magnitude ? left.magnitude > right.magnitude ? 1 : -1 : l === r ? 0 : l > r ? 1 : -1;
    order *= left.sign;
  }
  return descending ? -order : order;
}

export interface TableQuery {
  readonly header: boolean; readonly search: string; readonly filterColumn: number; readonly filter: string;
  readonly sortColumn: number; readonly sort: "original" | "text-asc" | "text-desc" | "number-asc" | "number-desc";
}
export function tableRowIndices(rows: DelimitedData["rows"], query: TableQuery): readonly number[] {
  const search = query.search.toLowerCase(); const filter = query.filter.toLowerCase();
  const indices: number[] = [];
  for (let index = query.header ? 1 : 0; index < rows.length; index++) {
    const row = rows[index]!;
    if (search && !row.some((value) => value.toLowerCase().includes(search))) continue;
    if (filter && !(row[query.filterColumn] ?? "").toLowerCase().includes(filter)) continue;
    indices.push(index);
  }
  if (query.sort === "original") return indices;
  const descending = query.sort.endsWith("desc");
  const numeric = query.sort.startsWith("number");
  return indices.sort((left, right) => {
    const a = rows[left]?.[query.sortColumn] ?? ""; const b = rows[right]?.[query.sortColumn] ?? "";
    return (numeric ? compareNumericText(a, b, descending) : a.localeCompare(b) * (descending ? -1 : 1)) || left - right;
  });
}
