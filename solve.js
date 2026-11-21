// solve.js — a faster drop-in for csv-reader 1.0.0. Same policy, same answers, single pass,
// slice-captured fields instead of per-character string building.
const COMMA = 44;
const QUOTE = 34;
const LF = 10;
const CR = 13;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  while (true) {
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) { pos += 1; line += 1; }
      else if (c === CR && text.charCodeAt(pos + 1) === LF) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let endedComma = true;
    let anyQuoted = false;

    while (endedComma) {
      if (text.charCodeAt(pos) === QUOTE) {
        anyQuoted = true;
        const open = pos;
        const openLine = line;
        let value = '';
        let chunkStart = ++pos;
        let closed = false;
        while (pos < n) {
          const c = text.charCodeAt(pos);
          if (c === QUOTE) {
            if (text.charCodeAt(pos + 1) === QUOTE) {
              value += text.slice(chunkStart, pos) + '"';
              pos += 2;
              chunkStart = pos;
              continue;
            }
            value += text.slice(chunkStart, pos);
            pos += 1;
            closed = true;
            break;
          }
          if (c === CR) {
            value += text.slice(chunkStart, pos) + '\n';
            line += 1;
            pos += text.charCodeAt(pos + 1) === LF ? 2 : 1;
            chunkStart = pos;
            continue;
          }
          if (c === LF) line += 1;
          pos += 1;
        }
        if (!closed) {
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          value = '"';
          endedComma = false;
          const r = readUnquoted(text, n, pos, line, value, errors, recordLine, recordRow);
          pos = r.pos; line = r.line; value = r.value; endedComma = r.endedComma;
          fields.push(value);
          continue;
        }
        if (pos >= n) { endedComma = false; fields.push(value); break; }
        const c = text.charCodeAt(pos);
        if (c === COMMA) { pos += 1; fields.push(value); continue; }
        if (c === LF) { pos += 1; line += 1; endedComma = false; fields.push(value); break; }
        if (c === CR && text.charCodeAt(pos + 1) === LF) { pos += 2; line += 1; endedComma = false; fields.push(value); break; }
        // junk after the closing quote, appended as it stands, up to the next comma or break
        const r = readUnquoted(text, n, pos, line, value, errors, recordLine, recordRow);
        pos = r.pos; line = r.line; value = r.value; endedComma = r.endedComma;
        if (r.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        fields.push(value);
        continue;
      }
      const r = readUnquoted(text, n, pos, line, '', errors, recordLine, recordRow);
      pos = r.pos; line = r.line; endedComma = r.endedComma;
      fields.push(r.value);
    }

    if (fields.length === 1 && fields[0] === '' && !anyQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}

// Unquoted characters up to a comma or a line break; a CR not followed by LF is dropped with stray_cr.
// Delimiters are found with indexOf, so the per-character work happens in V8 instead of here.
function readUnquoted(text, n, pos, line, prefix, errors, recordLine, recordRow) {
  let start = pos;
  let value = prefix;
  let added = 0;
  while (pos < n) {
    const comma = text.indexOf(',', pos);
    const lf = text.indexOf('\n', pos);
    const cr = text.indexOf('\r', pos);
    let next = n;
    if (comma >= 0 && comma < next) next = comma;
    if (lf >= 0 && lf < next) next = lf;
    if (cr >= 0 && cr < next) next = cr;
    if (next === n) { value += text.slice(start, n); added += n - start; pos = n; break; }
    const ch = text.charCodeAt(next);
    if (ch === COMMA) { value += text.slice(start, next); added += next - start; pos = next + 1; return { value, pos, line, endedComma: true, added }; }
    if (ch === LF) { value += text.slice(start, next); added += next - start; pos = next + 1; line += 1; return { value, pos, line, endedComma: false, added }; }
    value += text.slice(start, next);
    added += next - start;
    if (text.charCodeAt(next + 1) === LF) { pos = next + 2; line += 1; return { value, pos, line, endedComma: false, added }; }
    errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    pos = next + 1;
    start = pos;
  }
  return { value, pos, line, endedComma: false, added };
}
