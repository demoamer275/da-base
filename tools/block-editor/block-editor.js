/*
 * Block Editor — DA library plugin. Loads the selected block table, builds a
 * form from /blocks/<block>/<block>.json and writes the edited table back.
 */
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  parseBlockName, pickVariant, readValues, buildTableHtml,
} from './dialog.js';
import createField from './fields.js';

const CONNECT_TIMEOUT_MS = 3000;
const SELECTION_TIMEOUT_MS = 3000;

let state = null;

function $(id) {
  return document.getElementById(id);
}

function setStatus(text, kind = 'info') {
  const status = $('status');
  status.textContent = text;
  status.className = `status status-${kind}`;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function fail(message) {
  state = null;
  $('form').replaceChildren();
  $('save').disabled = true;
  setStatus(message, 'error');
}

function renderFixed(variant, values) {
  const fields = variant.cells.map((cell, i) => createField(cell, values[i]));
  $('form').replaceChildren(...fields.map((f) => f.el));
  return () => fields.map((f) => f.getValue());
}

function renderRepeat(variant, values) {
  const sections = [];
  const list = document.createElement('div');
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'add';
  add.textContent = `Add ${variant.label}`;

  const renumber = () => {
    sections.forEach((s, i) => {
      s.heading.textContent = `${variant.label} ${i + 1}`;
      s.remove.disabled = sections.length === 1;
    });
  };

  const addSection = (rowValues) => {
    const el = document.createElement('fieldset');
    el.className = 'section';
    const legend = document.createElement('legend');
    const heading = document.createElement('span');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = 'Remove';
    legend.append(heading, remove);
    const fields = variant.cells.map((cell, c) => createField(cell, rowValues[c]));
    el.append(legend, ...fields.map((f) => f.el));
    const section = {
      el, heading, remove, fields,
    };
    remove.addEventListener('click', () => {
      if (sections.length === 1) return;
      sections.splice(sections.indexOf(section), 1);
      el.remove();
      renumber();
    });
    sections.push(section);
    list.append(el);
    renumber();
  };

  values.forEach(addSection);
  add.addEventListener('click', () => addSection([]));
  $('form').replaceChildren(list, add);
  return () => sections.map((s) => s.fields.map((f) => f.getValue()));
}

async function loadSelection(actions) {
  setStatus('Reading selection…');
  let html;
  try {
    html = String(await withTimeout(actions.getSelection(), SELECTION_TIMEOUT_MS));
  } catch {
    fail('Nothing selected. Select the whole block table in the document, then try again.');
    return;
  }

  // DOMParser builds an inert document: no scripts run, no images load.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) {
    fail('The selection does not contain a block table.');
    return;
  }
  const [headerRow, ...bodyRows] = [...table.rows];
  const headerCell = headerRow?.cells[0];
  const { block, variant: variantName } = parseBlockName(headerRow?.textContent || '');
  if (!block) {
    fail('The block table has no block name in its first row.');
    return;
  }

  let def;
  try {
    const resp = await fetch(`/blocks/${encodeURIComponent(block)}/${encodeURIComponent(block)}.json`);
    if (!resp.ok) throw new Error(resp.status);
    def = await resp.json();
  } catch {
    fail(`No dialog definition exists for the "${block}" block.`);
    return;
  }

  const { variant, error } = pickVariant(def, variantName);
  if (error) {
    fail(error);
    return;
  }

  const rows = bodyRows.map((row) => [...row.cells].map((cell) => cell.innerHTML));
  const values = readValues(variant, rows);
  const collect = variant.mode === 'rows' ? renderFixed(variant, values) : renderRepeat(variant, values);
  state = { variant, headerHtml: headerCell.innerHTML, collect };
  $('save').disabled = false;
  setStatus(`Editing ${block} (${variant.name})`);
}

function save(actions) {
  if (!state) return;
  const html = buildTableHtml(state.headerHtml, state.variant, state.collect());
  actions.sendHTML(html);
  setStatus('Saved to the document.', 'success');
}

async function init() {
  const timeout = new Promise((resolve) => {
    setTimeout(resolve, CONNECT_TIMEOUT_MS, null);
  });
  let sdk = await Promise.race([DA_SDK, timeout]);
  if (!sdk) {
    setStatus('Open this plugin from the DA editor library.', 'error');
    sdk = await DA_SDK;
  }
  const { actions } = sdk;
  $('load').disabled = false;
  $('load').addEventListener('click', () => loadSelection(actions));
  $('save').addEventListener('click', () => save(actions));
  setStatus('Select the whole block table, then click Load selection.');
}

init();
