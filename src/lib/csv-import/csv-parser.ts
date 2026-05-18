/**
 * Minimal RFC 4180 CSV parser.
 *
 * Why a hand-rolled parser instead of papaparse / csv-parse?
 * ─────────────────────────────────────────────────────────
 * Adding an npm dep for a few hundred lines of well-specified state machine
 * is not worth the supply-chain surface. Exchange CSV exports are well-formed
 * (or fail loudly), and the spec we need is small:
 *
 *   • Comma-separated values, optional CRLF line endings
 *   • Fields may be wrapped in double quotes
 *   • Inside a quoted field, a doubled quote `""` is an escaped quote
 *   • Newlines inside quoted fields are part of the value
 *   • Trailing empty line is tolerated
 *   • Header detection is done by the caller, not the parser
 *
 * We also support tab-delimited input (some exchanges export `.tsv`). The
 * delimiter is inferred from the first non-quoted char on the first line
 * unless the caller forces it.
 *
 * The parser returns a plain string[][]; numeric/decimal conversion and
 * column-name binding is the caller's job. That separation keeps each
 * exchange-specific parser free to handle its own header quirks (Bybit
 * renames columns yearly; Coinbase ships two export formats; etc.).
 */

export interface ParseCsvOptions {
  /** Force a delimiter instead of auto-detecting. Useful for `.tsv` */
  delimiter?: ',' | '\t' | ';' | '|';
  /** If true (default), trim leading/trailing whitespace on unquoted fields. */
  trim?: boolean;
}

export interface ParsedRow {
  /** 1-based row number in the source file (header is row 1). */
  lineNumber: number;
  /** Field values in the order they appeared. */
  fields: string[];
}

/**
 * Split a CSV string into rows of fields. Empty input returns `[]`.
 *
 * Throws when input contains an unterminated quoted field at EOF — that's
 * almost always a corrupted export and silently truncating it produces
 * wrong P&L attribution downstream.
 */
export function parseCsv(input: string, opts: ParseCsvOptions = {}): ParsedRow[] {
  if (input.length === 0) return [];

  // Trim a UTF-8 BOM if the exporter wrote one (Excel-flavoured Coinbase
  // exports commonly do). Without this the first header is shifted by 3
  // bytes and column lookups silently fail.
  if (input.charCodeAt(0) === 0xfeff) {
    input = input.slice(1);
  }

  const delimiter = opts.delimiter ?? detectDelimiter(input);
  const trim = opts.trim ?? true;

  const rows: ParsedRow[] = [];
  let lineNumber = 1;
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let lastWasQuote = false; // last char was a `"` inside a quoted field

  const pushField = () => {
    if (!inQuotes && trim) {
      currentField = currentField.trim();
    }
    currentRow.push(currentField);
    currentField = '';
    lastWasQuote = false;
  };

  const pushRow = () => {
    // Tolerate trailing blank lines — empty single-field row of "" is dropped.
    const isEmpty = currentRow.length === 1 && currentRow[0] === '';
    if (!isEmpty) {
      rows.push({ lineNumber, fields: currentRow });
    }
    currentRow = [];
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (lastWasQuote) {
          // Doubled quote inside a quoted field == escaped literal `"`.
          currentField += '"';
          lastWasQuote = false;
        } else {
          lastWasQuote = true;
        }
      } else if (lastWasQuote) {
        // Previous char was a closing quote — exit quote mode and reprocess
        // the current char in unquoted state.
        inQuotes = false;
        lastWasQuote = false;
        continue;
      } else {
        currentField += ch;
      }
      i++;
      continue;
    }

    if (ch === '"' && currentField === '') {
      // Opening quote of a field. Mid-field `"` characters in unquoted mode
      // are treated as literals (some exchange exports use unescaped quotes
      // inside comment-style columns; throwing would be too strict).
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === delimiter) {
      pushField();
      i++;
      continue;
    }

    if (ch === '\n') {
      pushField();
      pushRow();
      lineNumber++;
      i++;
      continue;
    }

    if (ch === '\r') {
      // Handle CRLF as a single line terminator. A bare CR is also accepted
      // for legacy Mac exports.
      pushField();
      pushRow();
      lineNumber++;
      i++;
      if (i < input.length && input[i] === '\n') i++;
      continue;
    }

    currentField += ch;
    i++;
  }

  if (inQuotes && !lastWasQuote) {
    throw new Error(
      `CSV parse error: unterminated quoted field at end of input (line ${lineNumber})`,
    );
  }

  // Flush the trailing row if the file didn't end in a newline.
  if (currentField !== '' || currentRow.length > 0) {
    pushField();
    pushRow();
  }

  return rows;
}

/**
 * Look at the first line and pick the delimiter that produces the most
 * fields. Handles the common comma/tab/semicolon split.
 */
function detectDelimiter(input: string): ',' | '\t' | ';' | '|' {
  // Sample only the first line (or first 4KB, whichever is shorter) to keep
  // this O(1) on huge files.
  const sampleEnd = Math.min(input.length, 4096);
  let firstLineEnd = input.indexOf('\n', 0);
  if (firstLineEnd < 0 || firstLineEnd > sampleEnd) firstLineEnd = sampleEnd;
  const sample = input.slice(0, firstLineEnd);

  const candidates: Array<',' | '\t' | ';' | '|'> = [',', '\t', ';', '|'];
  let best: ',' | '\t' | ';' | '|' = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const count = countUnquoted(sample, d);
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

function countUnquoted(s: string, ch: string): number {
  let n = 0;
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ch) n++;
  }
  return n;
}

/**
 * Convenience: parse the file, treating the first non-empty row as the
 * header, and return a list of records keyed by header column. Header
 * values are lowercased and trimmed so callers can use case-insensitive
 * column lookup without doing it themselves.
 *
 * Returns:
 *   • headers — the original (un-lowercased) header strings, in order
 *   • headerIndex — lowercase header → column index (use for lookup)
 *   • rows — { lineNumber, values } for each data row
 *
 * Data rows shorter than the header are right-padded with `''`. Data rows
 * longer than the header have the excess columns dropped (Bybit sometimes
 * exports a phantom trailing column — silently tolerating it matches user
 * expectations).
 */
export interface CsvTable {
  headers: string[];
  headerIndex: Map<string, number>;
  rows: Array<{ lineNumber: number; values: string[] }>;
}

export function parseCsvTable(input: string, opts: ParseCsvOptions = {}): CsvTable {
  const rows = parseCsv(input, opts);
  if (rows.length === 0) {
    return { headers: [], headerIndex: new Map(), rows: [] };
  }
  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.fields;
  const headerIndex = new Map<string, number>();
  headers.forEach((h, i) => headerIndex.set(h.trim().toLowerCase(), i));

  const out: CsvTable['rows'] = dataRows.map(({ lineNumber, fields }) => {
    const values = new Array<string>(headers.length).fill('');
    for (let i = 0; i < Math.min(fields.length, headers.length); i++) {
      values[i] = fields[i];
    }
    return { lineNumber, values };
  });

  return { headers, headerIndex, rows: out };
}

/** Look up a column by case-insensitive header name. Returns '' if absent. */
export function getCell(
  row: { values: string[] },
  headerIndex: Map<string, number>,
  name: string,
): string {
  const idx = headerIndex.get(name.toLowerCase());
  if (idx === undefined) return '';
  return row.values[idx] ?? '';
}
