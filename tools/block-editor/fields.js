/*
 * DOM builders for the Block Editor plugin. Each returns { el, getValue }.
 */
import { cellToValue } from './dialog.js';

const SAFE_URL = /^(https?:|mailto:|\/|#)/i;
const BLOCKED_TAGS = 'script,style,iframe,object,embed,link,meta,base,form,input,button,textarea,select';

// Parse document HTML inertly and strip anything that could execute before it
// is placed in the live editor.
function sanitize(html) {
  const { body } = new DOMParser().parseFromString(html, 'text/html');
  body.querySelectorAll(BLOCKED_TAGS).forEach((node) => node.remove());
  body.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach(({ name, value }) => {
      const isUrl = ['href', 'src', 'srcset', 'action', 'formaction', 'xlink:href'].includes(name);
      if (name.startsWith('on') || name === 'style' || (isUrl && !SAFE_URL.test(value.trim()))) {
        node.removeAttribute(name);
      }
    });
  });
  return [...body.childNodes];
}

let fieldCount = 0;

function labelled(cell, input) {
  fieldCount += 1;
  const id = `field-${fieldCount}`;
  input.id = id;
  input.name = cell.name;
  const wrap = document.createElement('div');
  wrap.className = `field field-${cell.type}`;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = cell.label || cell.name;
  wrap.append(label, input);
  return wrap;
}

function textField(cell, value) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  return { el: labelled(cell, input), getValue: () => input.value };
}

function selectField(cell, value) {
  const select = document.createElement('select');
  const options = [...(cell.options || [])];
  // Keep an unknown existing value rather than silently replacing it.
  if (value && !options.some((o) => o.value === value)) options.unshift({ title: value, value });
  options.forEach(({ title, value: v }) => {
    const option = document.createElement('option');
    option.value = v;
    option.textContent = title;
    select.append(option);
  });
  if (value) select.value = value;
  return { el: labelled(cell, select), getValue: () => select.value };
}

function imageField(cell, original) {
  const originalSrc = cellToValue('image', original);
  const input = document.createElement('input');
  input.type = 'url';
  input.placeholder = 'https://…';
  input.value = originalSrc;
  const el = labelled(cell, input);
  const preview = document.createElement('img');
  preview.className = 'preview';
  preview.alt = '';
  const update = () => {
    const src = input.value.trim();
    preview.hidden = !SAFE_URL.test(src);
    if (!preview.hidden) preview.src = src;
  };
  input.addEventListener('change', update);
  update();
  el.append(preview);
  // Unchanged URL: keep the original cell HTML (<picture>, alt, link).
  const getValue = () => {
    const src = input.value.trim();
    return src === originalSrc && original ? original : src;
  };
  return { el, getValue };
}

const RT_BUTTONS = [
  { cmd: 'bold', text: 'B', title: 'Bold' },
  { cmd: 'italic', text: 'I', title: 'Italic' },
  { cmd: 'createLink', text: '🔗', title: 'Link' },
  { cmd: 'insertUnorderedList', text: '•', title: 'Bulleted list' },
];

const BLOCK_FORMATS = [
  { value: 'p', title: 'Paragraph' },
  { value: 'h1', title: 'Heading 1' },
  { value: 'h2', title: 'Heading 2' },
  { value: 'h3', title: 'Heading 3' },
  { value: 'h4', title: 'Heading 4' },
  { value: 'h5', title: 'Heading 5' },
  { value: 'h6', title: 'Heading 6' },
];

// A <select> takes focus and drops the editor's selection, so remember the
// last range inside the editor and restore it before applying a format.
function formatSelect(editor) {
  const select = document.createElement('select');
  select.className = 'format';
  select.title = 'Text style';
  select.setAttribute('aria-label', 'Text style');
  BLOCK_FORMATS.forEach(({ value, title }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = title;
    select.append(option);
  });

  let range = null;
  const sync = () => {
    const sel = document.getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return;
    range = sel.getRangeAt(0).cloneRange();
    const current = String(document.queryCommandValue('formatBlock')).toLowerCase();
    select.value = BLOCK_FORMATS.some((f) => f.value === current) ? current : 'p';
  };
  document.addEventListener('selectionchange', sync);

  select.addEventListener('change', () => {
    editor.focus();
    if (range) {
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand('formatBlock', false, `<${select.value}>`);
  });
  return select;
}

function richtextField(cell, value) {
  const editor = document.createElement('div');
  editor.className = 'richtext';
  editor.contentEditable = 'true';
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-multiline', 'true');
  // Sanitized: the cell HTML comes from a shared document.
  editor.replaceChildren(...sanitize(value));
  const el = labelled(cell, editor);
  // New lines become <p>, not <div>, to match document content.
  document.execCommand('defaultParagraphSeparator', false, 'p');
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.append(formatSelect(editor));
  RT_BUTTONS.forEach(({ cmd, text, title }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.title = title;
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () => {
      // eslint-disable-next-line no-alert
      const arg = cmd === 'createLink' ? window.prompt('Link URL') : null;
      if (cmd === 'createLink' && !(arg && SAFE_URL.test(arg.trim()))) return;
      editor.focus();
      document.execCommand(cmd, false, arg);
    });
    toolbar.append(button);
  });
  editor.before(toolbar);
  return { el, getValue: () => editor.innerHTML.trim() };
}

const BUILDERS = {
  text: textField, select: selectField, image: imageField, richtext: richtextField,
};

export default function createField(cell, value = '') {
  const build = BUILDERS[cell.type] || textField;
  return build(cell, value);
}
