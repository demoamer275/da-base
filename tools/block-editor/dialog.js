/*
 * Pure dialog logic for the Block Editor plugin. No DOM access, so it can be
 * unit tested under Node. See docs/superpowers/specs/2026-10-14-block-editor-design.md.
 */

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&nbsp;': ' ',
};

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseBlockName(text) {
  const trimmed = text.trim().toLowerCase();
  const block = trimmed.split(/[\s(]/)[0];
  const match = trimmed.match(/\(([^)]*)\)/);
  const variant = match && match[1].trim() ? match[1].trim() : 'default';
  return { block, variant };
}

export function pickVariant(def, name) {
  const variants = Array.isArray(def?.variants) ? def.variants : [];
  const found = variants.find((v) => v.name === name)
    || variants.find((v) => v.name === 'default');
  if (!found) return { error: `Variant "${name}" is not defined.` };
  if (Array.isArray(found.rows) && found.rows.length) {
    return { variant: { name: found.name, mode: 'rows', cells: found.rows } };
  }
  if (found.row && Array.isArray(found.row.cells) && found.row.cells.length) {
    return {
      variant: {
        name: found.name, mode: 'row', label: found.row.label, cells: found.row.cells,
      },
    };
  }
  return { error: `Variant "${found.name}" defines no rows.` };
}

export function cellToValue(type, html = '') {
  if (type === 'richtext') return html.trim();
  if (type === 'image') {
    const match = html.match(/<img\b[^>]*\bsrc="([^"]*)"/i);
    return match ? match[1].replace(/&amp;/g, '&') : '';
  }
  return html
    .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|nbsp);/g, (m) => ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
}

// Image values are either the untouched original cell HTML (starts with '<',
// preserving <picture>, alt, etc.) or a new URL entered by the author.
export function valueToCell(type, value = '') {
  if (type === 'richtext') return value;
  if (type === 'image') {
    if (value.startsWith('<')) return value;
    return value ? `<img src="${escapeHtml(value)}">` : '';
  }
  return escapeHtml(value);
}

function initialValue(type, html = '') {
  return type === 'image' ? html.trim() : cellToValue(type, html);
}

export function readValues(variant, bodyRows) {
  if (variant.mode === 'rows') {
    return variant.cells.map((cell, i) => initialValue(cell.type, bodyRows[i]?.[0]));
  }
  const rows = bodyRows.length ? bodyRows : [[]];
  return rows.map((row) => variant.cells.map((cell, c) => initialValue(cell.type, row[c])));
}

export function buildTableHtml(headerHtml, variant, values) {
  const width = variant.mode === 'rows' ? 1 : variant.cells.length;
  const body = variant.mode === 'rows'
    ? variant.cells.map((cell, i) => `<tr><td>${valueToCell(cell.type, values[i])}</td></tr>`)
    : values.map((row) => `<tr>${variant.cells.map((cell, c) => `<td>${valueToCell(cell.type, row[c])}</td>`).join('')}</tr>`);
  return `<table><tr><td colspan="${width}">${headerHtml}</td></tr>${body.join('')}</table>`;
}
