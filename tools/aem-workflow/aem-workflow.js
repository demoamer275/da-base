/*
 * AEM Workflow - DA library plugin.
 *
 * Calls the AEM DA workflow servlet with the DA SDK's IMS token as a bearer
 * token: list my work items, reply along a route, start da-approve on this page.
 */
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/extensions
import {
  createClient, previewUrl, describeItem, errorMessage,
} from './api.js';

const SDK_TIMEOUT_MS = 3000;

let client = null;

function $(id) {
  return document.getElementById(id);
}

function setStatus(text, kind = '') {
  const status = $('status');
  status.textContent = text;
  status.className = `status ${kind}`.trim();
}

function busy(on) {
  document.querySelectorAll('button').forEach((b) => { b.disabled = on; });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

let loadTasks;

async function act(fn, success) {
  busy(true);
  try {
    await fn();
    setStatus(success);
    await loadTasks(true);
  } catch (err) {
    setStatus(errorMessage(err), 'error');
    if (err.status === 403 || err.status === 404) await loadTasks(true);
  } finally {
    busy(false);
  }
}

function renderCard(item) {
  const d = describeItem(item);
  const li = el('li', 'card');
  li.append(el('strong', 'name', d.heading));
  if (d.step) li.append(el('span', 'step', d.step));
  if (d.payload) {
    const a = el('a', 'payload', d.payload);
    a.href = d.payload;
    a.target = '_blank';
    a.rel = 'noopener';
    li.append(a);
  }
  const meta = [d.initiator && `by ${d.initiator}`, d.created && new Date(d.created).toLocaleString()]
    .filter(Boolean).join(' · ');
  if (meta) li.append(el('span', 'meta', meta));

  const comment = el('textarea');
  comment.placeholder = 'Comment (optional)';
  comment.rows = 2;
  li.append(comment);

  const routes = el('div', 'routes');
  d.routes.forEach((route) => {
    const btn = el('button', route.backRoute ? 'secondary' : '', route.name);
    btn.type = 'button';
    btn.addEventListener('click', () => act(() => client.reply({
      workflowId: item.workflowId,
      workItemId: item.workItemId,
      routeId: route.routeId,
      routeName: route.name,
      comment: comment.value,
    }), `Moved to "${route.name}".`));
    routes.append(btn);
    if (route.branches.length) {
      routes.append(el('small', 'meta', `Runs in parallel: ${route.branches.join(', ')}`));
    }
  });
  if (!d.routes.length) routes.append(el('span', 'meta', 'No next steps available.'));
  li.append(routes);
  return li;
}

loadTasks = async (quiet = false) => {
  const list = $('list');
  if (!quiet) setStatus('Loading tasks.');
  try {
    const data = await client.list();
    const items = data?.workItems || [];
    list.replaceChildren(...items.map(renderCard));
    if (!items.length) list.append(el('li', 'empty', 'No tasks assigned to you.'));
    if (!quiet) setStatus(`${items.length} task${items.length === 1 ? '' : 's'} assigned to you.`);
  } catch (err) {
    list.replaceChildren();
    setStatus(errorMessage(err), 'error');
  }
};

async function init() {
  // DA_SDK only resolves inside the DA editor.
  const timeout = new Promise((resolve) => { setTimeout(resolve, SDK_TIMEOUT_MS, null); });
  const sdk = await Promise.race([DA_SDK, timeout]);
  if (!sdk?.token) {
    setStatus('Sign in to DA to use AEM Workflow.', 'warn');
    return;
  }
  const { context = {}, token } = sdk;
  client = createClient({ token });

  $('payload').value = previewUrl(context);
  $('title').value = (context.path || '').split('/').filter(Boolean).pop()?.replace(/\.html$/, '') || '';
  $('start-view').hidden = false;
  $('tasks-view').hidden = false;

  $('start').addEventListener('click', () => {
    const title = $('title').value.trim();
    if (!title) {
      setStatus('Enter a title.', 'warn');
      return;
    }
    act(() => client.start({ payload: $('payload').value, title }), 'Workflow started.');
  });
  $('refresh').addEventListener('click', () => loadTasks());

  await loadTasks();
}

init();
