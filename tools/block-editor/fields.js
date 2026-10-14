/*
 * DOM builders for the Block Editor plugin. Each returns { el, getValue }.
 */

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
  const options = [...cell.options];
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

function imageField(cell, value) {
  const input = document.createElement('input');
  input.type = 'url';
  input.placeholder = 'https://…';
  input.value = value;
  const el = labelled(cell, input);
  const preview = document.createElement('img');
  preview.className = 'preview';
  preview.alt = '';
  const update = () => {
    preview.hidden = !input.value;
    if (input.value) preview.src = input.value;
  };
  input.addEventListener('change', update);
  update();
  el.append(preview);
  return { el, getValue: () => input.value.trim() };
}

const RT_BUTTONS = [
  { cmd: 'bold', text: 'B', title: 'Bold' },
  { cmd: 'italic', text: 'I', title: 'Italic' },
  { cmd: 'createLink', text: '🔗', title: 'Link' },
  { cmd: 'insertUnorderedList', text: '•', title: 'Bulleted list' },
];

function richtextField(cell, value) {
  const editor = document.createElement('div');
  editor.className = 'richtext';
  editor.contentEditable = 'true';
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-multiline', 'true');
  // Cell content is the author's own document content; it is rendered for editing.
  editor.innerHTML = value;
  const el = labelled(cell, editor);
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  RT_BUTTONS.forEach(({ cmd, text, title }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.title = title;
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () => {
      // eslint-disable-next-line no-alert
      const arg = cmd === 'createLink' ? window.prompt('Link URL') : null;
      if (cmd === 'createLink' && !arg) return;
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
