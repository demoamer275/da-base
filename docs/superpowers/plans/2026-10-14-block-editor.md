# Block Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DA library plugin that edits a selected block table via a form generated from `/blocks/<block>/<block>.json`.

**Architecture:** Pure string/array logic in `dialog.js` (Node-testable), DOM field builders in `fields.js`, SDK + flow in `block-editor.js`. Read via `actions.getSelection()` + `DOMParser`; write via `actions.sendHTML(tableHtml)`.

**Tech Stack:** Vanilla ES modules, DA SDK `https://da.live/nx/utils/sdk.js`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-14-block-editor-design.md` (rules: `C:\git2026\rules.md`)

## Global Constraints
- No new dependencies; no build step. Code passes `npm run lint:js`.
- Never inject selection HTML with `innerHTML` into the plugin document except richtext editor content (author's own content); parse via `DOMParser`.
- Follow `tools/sdk-demo` patterns (connect timeout 3000 ms, selection timeout 3000 ms).
- `dialog.js` must not touch `document`/`window` (runs under Node).

## Review Focus
- Header text with extra whitespace/case, e.g. `Hero (Center)` → block `hero`, variant `center` (lowercase, trimmed). Test in Task 1.
- Table rows with fewer cells than `cells` → empty fields, not crash. Test in Task 1.
- Repeat block with zero body rows → one empty section. Test in Task 1.
- Escaping: text/select values containing `<`/`&` written as text, not markup. Test in Task 1.
- Header cell HTML (e.g. existing `colspan`) replaced with correct colspan only. Test in Task 1.

---

### Task 1: dialog.js pure logic

**Files:** Create `tools/block-editor/dialog.js`, `tools/block-editor/dialog.test.js`

**Interfaces (Produces):**
- `parseBlockName(text: string) → { block: string, variant: string }`
- `pickVariant(def: object, name: string) → { variant } | { error: string }`; returned variant normalized as `{ name, mode: 'rows'|'row', cells: Cell[], label?: string }`.
- `cellToValue(type, html) → string`, `valueToCell(type, value) → string`
- `readValues(variant, bodyRows: string[][]) → string[] (rows mode) | string[][] (row mode)`
- `buildTableHtml(headerHtml: string, variant, values) → string`

- [ ] Step 1: tests — `parseBlockName('hero (center)')` → `{hero, center}`; `'cards'` → variant `default`; `' Hero (Center) '` → `{hero, center}`. `pickVariant` falls back to default; errors `Variant "x" is not defined.` and `Variant "x" defines no rows.`; prefers rows. `readValues` fills missing cells with `''`; row mode with `[]` → `[['','']]`. `valueToCell('text','a<b')` → `a&lt;b`; image → `<img src="u">`, empty → `''`. `buildTableHtml` header `colspan="2"` for 2-cell repeat, `colspan="1"` for fixed.
- [ ] Step 2: `node --test tools/block-editor/` → FAIL.
- [ ] Step 3: implement. `cellToValue` for text/select strips tags (regex) and decodes basic entities; image extracts first `src="…"`.
- [ ] Step 4: tests PASS; `npx eslint tools/block-editor`.
- [ ] Step 5: commit.

### Task 2: fields, UI, samples

**Files:** Create `tools/block-editor.html`, `tools/block-editor/fields.js`, `tools/block-editor/block-editor.js`, `tools/block-editor/block-editor.css`, `blocks/hero/hero.json`, `blocks/cards/cards.json`

**Interfaces:** `createField(cell, value) → { el, getValue(): string }` in fields.js.

- [ ] Step 1: fields.js — text `<input>`, select `<select>` from options, image URL + `<img>` preview, richtext toolbar (bold/italic/link/list via `execCommand`) + `contenteditable` div.
- [ ] Step 2: block-editor.js — connect; Load button → getSelection (timeout) → DOMParser → first `table` → header text → fetch `/blocks/${block}/${block}.json` → pickVariant → readValues → render; repeat mode sections labelled `${label} ${n}`, Remove (disabled when 1), Add `Add ${label}`; Save → buildTableHtml → `actions.sendHTML`.
- [ ] Step 3: samples from rules.md examples (hero fixed, cards repeat).
- [ ] Step 4: `npm run lint`; manual check in DA with `?ref=local` and `npx -y @adobe/aem-cli up`.
- [ ] Step 5: commit.
