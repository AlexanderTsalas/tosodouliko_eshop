/**
 * Minimal CSV parser. Handles quoted fields with embedded commas and escaped
 * double-quotes (`""` → `"`). Does NOT handle multi-line quoted fields — rare
 * in supplier CSVs and not worth the parser complexity.
 *
 * Client-safe (no Node-only APIs). Used by the receipt workflow to read an
 * uploaded file in the browser before the admin reviews the diff.
 */
export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string): ParsedCsv {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = splitLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = (cells[i] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === ",") {
        out.push(cur);
        cur = "";
      } else if (c === '"' && cur === "") {
        inQuotes = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}
