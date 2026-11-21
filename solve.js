// solve.js — a faster drop-in for csv-reader 1.0.0. Same policy, same answers: one left-to-right pass,
// fields captured as slices, delimiters located with indexOf, and the scanner state kept in module
// variables so no call allocates a result object.
const COMMA = 44;
const QUOTE = 34;
const LF = 10;
const CR = 13;

let T = '';
let N = 0;
let P = 0;
let L = 1;
let ADDED = 0;
let COMMA_END = false;
let CLOSED = false;
let ERRORS = null;
let SCAN_U = scanUnquoted;
let SCAN_Q = scanQuote;
let REC_LINE = 1;
let REC_ROW = 0;

export function run(input) {
  T = String(input.text);
  N = T.length;
  P = 0;
  L = 1;
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  ERRORS = errors;
  SCAN_U = scanUnquoted;
  SCAN_Q = scanQuote;
  if (T.charCodeAt(0) === 0xfeff) P = 1;

  while (true) {
    while (P < N) {
      const c = T.charCodeAt(P);
      if (c === LF) { P += 1; L += 1; }
      else if (c === CR && T.charCodeAt(P + 1) === LF) { P += 2; L += 1; }
      else break;
    }
    if (P >= N) break;

    const recordLine = L;
    const recordRow = header && columns === null ? null : rows.length;
    REC_LINE = recordLine;
    REC_ROW = recordRow;
    const fields = [];
    let nf = 0;
    let endedComma = true;
    let anyQuoted = false;

    while (endedComma) {
      if (T.charCodeAt(P) === QUOTE) {
        anyQuoted = true;
        const open = P;
        const openLine = L;
        CLOSED = false;
        let value = SCAN_Q();
        if (!CLOSED) {
          P = open + 1;
          L = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          ADDED = 0;
          value = '"' + SCAN_U();
          endedComma = COMMA_END;
          fields[nf++] = value;
          continue;
        }
        if (P >= N) { endedComma = false; fields[nf++] = value; break; }
        const c = T.charCodeAt(P);
        if (c === COMMA) { P += 1; fields[nf++] = value; continue; }
        if (c === LF) { P += 1; L += 1; endedComma = false; fields[nf++] = value; break; }
        if (c === CR && T.charCodeAt(P + 1) === LF) { P += 2; L += 1; endedComma = false; fields[nf++] = value; break; }
        // junk after the closing quote, appended as it stands, up to the next comma or break
        ADDED = 0;
        value += SCAN_U();
        endedComma = COMMA_END;
        if (ADDED > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        fields[nf++] = value;
        continue;
      }
      // an unquoted field, inline: one function call fewer per field
      let start = P;
      let value = '';
      let done = false;
      while (P < N) {
        const c = T.charCodeAt(P);
        if (c === COMMA) { value += T.slice(start, P); P += 1; endedComma = true; done = true; break; }
        if (c === LF) { value += T.slice(start, P); P += 1; L += 1; endedComma = false; done = true; break; }
        if (c === CR) {
          value += T.slice(start, P);
          if (T.charCodeAt(P + 1) === LF) { P += 2; L += 1; endedComma = false; done = true; break; }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          P += 1;
          start = P;
          continue;
        }
        P += 1;
      }
      if (!done) { value += T.slice(start, N); endedComma = false; }
      fields[nf++] = value;
    }
    fields.length = nf;

    if (nf === 1 && fields[0] === '' && !anyQuoted) continue;

    if (width < 0) width = nf;
    if (header && columns === null) { columns = fields; continue; }
    if (nf < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: nf });
      while (fields.length < width) fields.push('');
    } else if (nf > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}

// Unquoted characters up to a comma or a line break; a CR not followed by LF is dropped with stray_cr.
// A character loop, not indexOf: at these field lengths the call overhead of indexOf costs more than the
// compares, and a missing CR no longer makes every step rescan to the end of the document.
function scanUnquoted() {
  const start = P;
  while (P < N) {
    const c = T.charCodeAt(P);
    if (c === COMMA) { const v = T.slice(start, P); ADDED += P - start; P += 1; COMMA_END = true; return v; }
    if (c === LF) { const v = T.slice(start, P); ADDED += P - start; P += 1; L += 1; COMMA_END = false; return v; }
    if (c === CR) {
      const v = T.slice(start, P);
      ADDED += P - start;
      if (T.charCodeAt(P + 1) === LF) { P += 2; L += 1; COMMA_END = false; return v; }
      ERRORS.push({ code: 'stray_cr', line: REC_LINE, row: REC_ROW });
      P += 1;
      ADDED += 0;
      const rest = scanUnquoted();
      return v + rest;
    }
    P += 1;
  }
  const v = T.slice(start, N);
  ADDED += N - start;
  COMMA_END = false;
  return v;
}

// A quoted field, the opening quote already consumed: a CR or CRLF inside the field folds to one LF.
function scanQuote() {
  let value = '';
  let chunkStart = P + 1;
  P += 1;
  while (P < N) {
    const c = T.charCodeAt(P);
    if (c === QUOTE) {
      if (T.charCodeAt(P + 1) === QUOTE) {
        value += T.slice(chunkStart, P) + '"';
        P += 2;
        chunkStart = P;
        continue;
      }
      value += T.slice(chunkStart, P);
      P += 1;
      CLOSED = true;
      return value;
    }
    if (c === CR) {
      value += T.slice(chunkStart, P) + '\n';
      L += 1;
      P += T.charCodeAt(P + 1) === LF ? 2 : 1;
      chunkStart = P;
      continue;
    }
    if (c === LF) L += 1;
    P += 1;
  }
  value += T.slice(chunkStart, Math.min(P, N));
  return value;
}
