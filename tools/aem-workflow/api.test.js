/* eslint-disable import/extensions */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AEM_HOST, ENDPOINT, previewUrl, errorMessage, describeItem, createClient, safeHref,
} from './api.js';

function mockFetch(responses) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push([url, init]);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    const body = typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {});
    return new Response(body, { status: next.status ?? 200 });
  };
  return { calls, fetchFn };
}

const CSRF_URL = `${AEM_HOST}/libs/granite/csrf/token.json`;

test('previewUrl', () => {
  const base = { org: 'o', repo: 'r' };
  assert.equal(previewUrl({ ...base, path: '/a/b' }), 'https://main--r--o.aem.page/a/b');
  assert.equal(previewUrl({ ...base, path: '/a.html' }), 'https://main--r--o.aem.page/a');
  assert.equal(previewUrl({ ...base, path: '/index' }), 'https://main--r--o.aem.page/');
  assert.equal(previewUrl({ ...base, path: '/a/index' }), 'https://main--r--o.aem.page/a/');
});

test('list sends bearer', async () => {
  const { calls, fetchFn } = mockFetch([{ body: { user: 'u', count: 0, workItems: [] } }]);
  const res = await createClient({ token: 't', fetchFn }).list();
  assert.equal(res.user, 'u');
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, AEM_HOST + ENDPOINT);
  assert.equal(init.headers.Authorization, 'Bearer t');
  assert.equal(init.credentials, 'omit');
  assert.ok(!init.method || init.method === 'GET');
});

test('start posts with csrf and default model', async () => {
  const { calls, fetchFn } = mockFetch([{ body: { token: 'c' } }, { body: { status: 'success' } }]);
  await createClient({ token: 't', fetchFn }).start({ payload: 'p', title: 't' });
  assert.equal(calls[0][0], CSRF_URL);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer t');
  const [url, init] = calls[1];
  assert.equal(url, AEM_HOST + ENDPOINT);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['CSRF-Token'], 'c');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.credentials, 'omit');
  assert.deepEqual(JSON.parse(init.body), {
    action: 'start', modelId: 'da-approve', payload: 'p', title: 't',
  });
});

test('reply omits blank comment', async () => {
  const args = {
    workflowId: 'w', workItemId: 'i', routeId: 'r', routeName: 'Approve',
  };
  let m = mockFetch([{ body: { token: 'c' } }, { body: {} }]);
  await createClient({ token: 't', fetchFn: m.fetchFn }).reply({ ...args, comment: '  ' });
  assert.deepEqual(JSON.parse(m.calls[1][1].body), { action: 'reply', ...args });

  m = mockFetch([{ body: { token: 'c' } }, { body: {} }]);
  await createClient({ token: 't', fetchFn: m.fetchFn }).reply({ ...args, comment: 'ok' });
  assert.deepEqual(JSON.parse(m.calls[1][1].body), { action: 'reply', ...args, comment: 'ok' });
});

test('json error', async () => {
  const { fetchFn } = mockFetch([{ status: 403, body: { status: 'error', message: 'gone' } }]);
  await assert.rejects(createClient({ token: 't', fetchFn }).list(), { status: 403, message: 'gone' });
});

test('non-JSON error body', async () => {
  const { fetchFn } = mockFetch([{ status: 401, body: '<html>' }]);
  await assert.rejects(createClient({ token: 't', fetchFn }).list(), (err) => {
    assert.equal(err.status, 401);
    assert.ok(err.message.length > 0);
    return true;
  });
});

test('network failure', async () => {
  const { fetchFn } = mockFetch([new TypeError('Failed to fetch')]);
  await assert.rejects(createClient({ token: 't', fetchFn }).list(), { status: 0 });
});

test('csrf failure aborts post', async () => {
  const { calls, fetchFn } = mockFetch([{ status: 401, body: '' }, { body: {} }]);
  await assert.rejects(createClient({ token: 't', fetchFn }).start({ payload: 'p', title: 't' }), { status: 401 });
  assert.equal(calls.length, 1);
});

test('missing csrf token aborts post', async () => {
  const { calls, fetchFn } = mockFetch([{ body: '<html>' }, { body: {} }]);
  await assert.rejects(createClient({ token: 't', fetchFn }).start({ payload: 'p', title: 't' }), { status: 403 });
  assert.equal(calls.length, 1);
});

test('safeHref', () => {
  assert.equal(safeHref('https://x.aem.page/a'), 'https://x.aem.page/a');
  assert.equal(safeHref('http://x/a'), 'http://x/a');
  assert.equal(safeHref('javascript:alert(1)'), ''); // eslint-disable-line no-script-url
  assert.equal(safeHref(' JaVaScRiPt:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('/content/a'), '');
  assert.equal(safeHref(null), '');
});

test('errorMessage', () => {
  assert.equal(errorMessage({ status: 0 }), 'Could not reach AEM (network or CORS configuration).');
  assert.equal(errorMessage({ status: 401 }), 'AEM rejected your session. Reopen the panel or sign in again.');
  assert.equal(errorMessage({ status: 500, message: 'x' }), 'AEM workflow error. Try again later.');
  assert.equal(errorMessage({ status: 403, message: 'gone' }), 'gone');
});

test('describeItem handles nulls', () => {
  const d = describeItem({
    workflowTitle: null, modelTitle: null, nextSteps: null, payload: null,
  });
  assert.equal(d.heading, 'Workflow');
  assert.deepEqual(d.routes, []);
  assert.equal(d.payload, '');

  const split = describeItem({
    workflowTitle: 'Spring campaign',
    nextSteps: [{
      routeId: 'node1_TO_node5',
      name: 'Send for parallel review',
      backRoute: false,
      destinations: [{
        nodeId: 'node5',
        title: 'AND_SPLIT',
        type: 'AND_SPLIT',
        branches: [
          { nodeId: 'node6', title: 'Legal review', type: 'PARTICIPANT' },
          { nodeId: 'node7', title: 'Brand review', type: 'PARTICIPANT' },
        ],
      }],
    }],
  });
  assert.equal(split.heading, 'Spring campaign');
  assert.deepEqual(split.routes[0].branches, ['Legal review', 'Brand review']);
  assert.equal(split.routes[0].routeId, 'node1_TO_node5');
});
