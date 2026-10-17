/*
 * Workfront — DA library plugin.
 *
 * Uses the IMS token from the DA SDK first. If Workfront rejects it (401), falls
 * back to its own sign-in: an IMS popup (OAuth Web App, code flow) that redirects
 * to the App Builder action, which exchanges the code server-side and
 * postMessages the token back here. Data calls go to the same action with
 * Authorization: Bearer <IMS token>; the action forwards it to Workfront.
 */
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

const RUNTIME_URL = 'https://440115-958babybluelocust-stage.adobeioruntime.net/api/v1/web/daworkfront/workfront-planning';
const RUNTIME_ORIGIN = new URL(RUNTIME_URL).origin;
const CLIENT_ID = '46c1b579c7a84c289ecfc0e6c43be37d';
const IMS_AUTHORIZE = 'https://ims-na1.adobelogin.com/ims/authorize/v2';

// Re-login each session for now. Turning this on also needs WF_ENABLE_REFRESH=true on the action.
const ENABLE_REFRESH = false;

// Must match the scopes enabled on the Developer Console credential, or IMS returns invalid_scope.
const SCOPE = ['openid', 'AdobeID', 'profile', 'additional_info.projectedProductContext',
  ...(ENABLE_REFRESH ? ['offline_access'] : [])].join(',');

const SDK_TIMEOUT_MS = 3000;
const EXPIRY_SKEW_MS = 60 * 1000;
const STORE_KEY = 'wf_tokens';
const NONCE_KEY = 'wf_nonce';

const LINK_PATHS = {
  project: (id) => `project/${id}/overview`,
  tasks: (id) => `task/${id}/overview`,
  issues: (id) => `issue/${id}/overview`,
  documents: (id) => `document/${id}/details`,
};

let tokens = null;
// IMS token from the DA SDK. Preferred when Workfront accepts it; cleared on the
// first 401 so the plugin falls back to its own OAuth sign-in.
let daToken = null;
let daTokenRejected = false;
let pendingNonce = null;
let daActions = null;
let wfDomain = '';
let currentProject = null;
let currentResource = 'tasks';

function $(id) {
  return document.getElementById(id);
}

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`.trim();
}

// --- token storage -------------------------------------------------------

function storage() {
  try {
    sessionStorage.setItem('wf_probe', '1');
    sessionStorage.removeItem('wf_probe');
    return sessionStorage;
  } catch {
    return null;
  }
}

function loadTokens() {
  try {
    const raw = storage()?.getItem(STORE_KEY);
    tokens = raw ? JSON.parse(raw) : null;
  } catch {
    tokens = null;
  }
}

function saveTokens(data) {
  tokens = {
    accessToken: data.access_token,
    refreshToken: ENABLE_REFRESH ? data.refresh_token : undefined,
    expiresAt: Date.now() + Number(data.expires_in || 0) * 1000,
  };
  storage()?.setItem(STORE_KEY, JSON.stringify(tokens));
}

function clearTokens() {
  tokens = null;
  storage()?.removeItem(STORE_KEY);
}

async function refresh() {
  const res = await fetch(RUNTIME_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'refresh_token', refresh_token: tokens.refreshToken }),
  });
  if (!res.ok) throw new Error('reauth');
  saveTokens(await res.json());
}

async function ensureToken() {
  if (daToken) return daToken;
  if (!tokens?.accessToken) throw new Error('reauth');
  if (Date.now() < tokens.expiresAt - EXPIRY_SKEW_MS) return tokens.accessToken;
  if (ENABLE_REFRESH && tokens.refreshToken) {
    await refresh();
    return tokens.accessToken;
  }
  clearTokens();
  throw new Error('reauth');
}

// --- sign-in -------------------------------------------------------------

function base64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildAuthUrl() {
  pendingNonce = crypto.randomUUID();
  storage()?.setItem(NONCE_KEY, pendingNonce);
  const state = base64url(JSON.stringify({ n: pendingNonce, o: window.location.origin }));
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: RUNTIME_URL,
    state,
  });
  return `${IMS_AUTHORIZE}?${query}`;
}

function onAuthMessage(e) {
  if (e.origin !== RUNTIME_ORIGIN || e.data?.type !== 'wf_tokens') return;
  const expected = pendingNonce || storage()?.getItem(NONCE_KEY);
  if (!expected || e.data.nonce !== expected) return;
  pendingNonce = null;
  storage()?.removeItem(NONCE_KEY);

  if (e.data.error || !e.data.access_token) {
    setStatus(`Sign-in failed: ${e.data.error || 'no token returned'}`, 'error');
    return;
  }
  saveTokens(e.data);
  // eslint-disable-next-line no-use-before-define
  showBrowse();
}

async function connect() {
  // The plugin runs in a cross-site iframe inside da.live; ask for unpartitioned
  // storage while we still have the user gesture. Failure is fine: tokens then
  // live in partitioned storage or memory for this session only.
  if (document.requestStorageAccess) {
    try { await document.requestStorageAccess(); } catch { /* keep going */ }
  }
  const popup = window.open(buildAuthUrl(), 'wf_login', 'width=620,height=720');
  if (!popup) {
    setStatus('The sign-in popup was blocked. Allow popups for this page and try again.', 'error');
    return;
  }
  setStatus('Waiting for sign-in…');
}

// --- data ----------------------------------------------------------------

async function api(resource, params = {}) {
  const usingDaToken = Boolean(daToken);
  const token = await ensureToken();
  const res = await fetch(`${RUNTIME_URL}?${new URLSearchParams({ resource, ...params })}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    if (usingDaToken) {
      // Workfront rejected the DA token: stop using it and retry with our own OAuth token, if any.
      daToken = null;
      daTokenRejected = true;
      return api(resource, params);
    }
    clearTokens();
    throw new Error('reauth');
  }
  if (res.status === 403) throw new Error('Your account does not have Workfront access in this organization.');
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  if (body.domain) wfDomain = body.domain;
  return body.data || [];
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function wfUrl(kind, id) {
  return `https://${wfDomain}/${LINK_PATHS[kind](id)}`;
}

function insertLink(kind, item) {
  if (!daActions) {
    setStatus('Open this plugin from the DA editor to insert links.', 'warn');
    return;
  }
  daActions.sendHTML(`<a href="${escapeHtml(wfUrl(kind, item.ID))}">${escapeHtml(item.name)}</a>`);
  daActions.closeLibrary?.();
}

function meta(item) {
  const date = item.plannedCompletionDate?.slice(0, 10);
  return [item.status, item.assignedTo?.name || item.owner?.name, date].filter(Boolean).join(' · ');
}

function renderList(kind, items, onOpen) {
  const list = $('list');
  list.replaceChildren();
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing here.';
    list.append(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement('li');

    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement(onOpen ? 'button' : 'span');
    name.className = onOpen ? 'name link' : 'name';
    name.textContent = item.name;
    if (onOpen) {
      name.type = 'button';
      name.addEventListener('click', () => onOpen(item));
    }
    const sub = document.createElement('span');
    sub.className = 'meta';
    sub.textContent = meta(item);
    info.append(name, sub);

    const insert = document.createElement('button');
    insert.type = 'button';
    insert.className = 'insert';
    insert.textContent = 'Insert';
    insert.title = 'Insert a link into the document';
    insert.disabled = !daActions;
    insert.addEventListener('click', () => insertLink(kind, item));

    li.append(info, insert);
    list.append(li);
  });
}

function handleError(err) {
  if (err.message === 'reauth') {
    const message = daTokenRejected
      ? 'Your DA sign-in can\'t access Workfront. Connect to sign in to Workfront directly.'
      : 'Your Workfront session ended. Please sign in again.';
    // eslint-disable-next-line no-use-before-define
    showConnect(message);
    return;
  }
  setStatus(err.message, 'error');
}

async function loadProjects() {
  currentProject = null;
  $('back').hidden = true;
  $('tabs').hidden = true;
  $('project-filter').hidden = false;
  $('list-title').textContent = 'Projects';
  setStatus('Loading projects…');
  try {
    const items = await api('projects', { filter: $('project-filter').value });
    // eslint-disable-next-line no-use-before-define
    renderList('project', items, openProject);
    setStatus(`${items.length} project(s)`);
  } catch (err) {
    handleError(err);
  }
}

async function loadChildren() {
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.resource === currentResource));
  });
  setStatus(`Loading ${currentResource}…`);
  try {
    const items = await api(currentResource, { projectID: currentProject.ID });
    renderList(currentResource, items);
    setStatus(`${items.length} ${currentResource}`);
  } catch (err) {
    handleError(err);
  }
}

function openProject(project) {
  currentProject = project;
  $('back').hidden = false;
  $('tabs').hidden = false;
  $('project-filter').hidden = true;
  $('list-title').textContent = project.name;
  loadChildren();
}

// --- views ---------------------------------------------------------------

function showConnect(message = 'Not connected to Workfront.') {
  $('browse-view').hidden = true;
  $('connect-view').hidden = false;
  setStatus(message);
}

function showBrowse() {
  $('connect-view').hidden = true;
  $('browse-view').hidden = false;
  loadProjects();
}

function wire() {
  window.addEventListener('message', onAuthMessage);
  $('connect').addEventListener('click', connect);
  $('logout').addEventListener('click', () => {
    daToken = null;
    clearTokens();
    showConnect('Signed out.');
  });
  $('back').addEventListener('click', loadProjects);
  $('project-filter').addEventListener('change', loadProjects);
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.addEventListener('click', () => { currentResource = b.dataset.resource; loadChildren(); });
  });
}

async function init() {
  wire();
  loadTokens();
  setStatus('Connecting…');

  // DA_SDK only resolves inside the DA editor. Outside it (e.g. testing on
  // localhost) browsing still works with the OAuth sign-in; inserting needs DA.
  const timeout = new Promise((resolve) => { setTimeout(resolve, SDK_TIMEOUT_MS, null); });
  const sdk = await Promise.race([DA_SDK, timeout]);
  if (sdk?.actions) daActions = sdk.actions;
  if (sdk?.token) daToken = sdk.token;

  const hasOAuth = tokens?.accessToken && Date.now() < tokens.expiresAt - EXPIRY_SKEW_MS;
  if (daToken || hasOAuth) showBrowse();
  else showConnect();
}

init();
