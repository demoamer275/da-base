# Block Editor — DA library plugin

## Goal
A DA library plugin that edits a selected block table through a form generated from a JSON dialog definition (`block-dialog.schema.json`, behaviour per `rules.md`).

## Decisions
- Definitions live at `/blocks/<block>/<block>.json`, fetched same-origin as the plugin.
- Richtext: `contenteditable` with Bold / Italic / Link / List buttons (`document.execCommand`), value is cell HTML.
- Image: URL input + thumbnail preview, written back as `<img src="…">`.
- No dependencies. Tests use Node's built-in `node:test` (no install).

## Files
- `tools/block-editor.html` — entry; registered in DA `library` sheet as `/tools/block-editor.html`.
- `tools/block-editor/dialog.js` — pure logic, no DOM:
  - `parseBlockName(text)` → `{ block, variant }` (name ends at first space or `(`; variant is paren text, else `default`).
  - `pickVariant(def, name)` → `{ variant }` or `{ error }` (exact match → `default` → "variant not defined"; neither `rows` nor `row` → "variant defines no rows"; `rows` wins over `row`).
  - `readValues(variant, bodyRows)` → values. `bodyRows` is `string[][]` of cell innerHTML for rows after the header. Fixed: `values[i]` = first cell of row i. Repeat: `values[r][c]`; missing cells → `''`; at least one section.
  - `buildTableHtml(headerHtml, variant, values)` → `<table>` HTML; header `<td colspan=N>` where N = widest row.
  - Cell value conversions: `cellToValue(type, html)` / `valueToCell(type, value)` (text/select: text; richtext: html; image: src of first img).
- `tools/block-editor/fields.js` — DOM builders for each field type; each returns `{ el, getValue() }`.
- `tools/block-editor/block-editor.js` — SDK connect, Load selection (getSelection with timeout, DOMParser, first `<table>`), fetch definition, render form (fixed fields or numbered repeat sections with Add/Remove, min 1, renumber), Save via `actions.sendHTML`.
- `tools/block-editor/block-editor.css`.
- `tools/block-editor/dialog.test.js` — `node --test`.
- Sample definitions: `blocks/hero/hero.json`, `blocks/cards/cards.json`.

## Errors (status line, no dialog built)
No selection/timeout · no table in selection · no dialog definition for `<block>` · variant not defined · variant defines no rows.

## Known limitation
`sendHTML` replaces the current selection; the user must select the whole table. The UI states this.
