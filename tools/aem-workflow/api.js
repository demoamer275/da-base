export const AEM_HOST = 'https://author-p182083-e1919654.adobeaemcloud.com';
export const ENDPOINT = '/bin/ma10226/daworkflow';
export const DEFAULT_MODEL = 'da-approve';

const CSRF_PATH = '/libs/granite/csrf/token.json';

export function previewUrl({ org, repo, path = '/' }) {
  const clean = path.replace(/\.html$/, '').replace(/(^|\/)index$/, '$1');
  return `https://main--${repo}--${org}.aem.page${clean || '/'}`;
}

export function safeHref(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

export function errorMessage(err) {
  const status = err?.status;
  if (status === 0) return 'Could not reach AEM (network or CORS configuration).';
  if (status === 401) return 'AEM rejected your session. Reopen the panel or sign in again.';
  if (!status || status >= 500) return 'AEM workflow error. Try again later.';
  return err.message;
}

export function describeItem(item) {
  const routes = (item?.nextSteps || []).map((step) => ({
    routeId: step.routeId,
    name: step.name || step.routeId || '',
    backRoute: !!step.backRoute,
    branches: (step.destinations || [])
      .filter((d) => d?.type === 'AND_SPLIT')
      .flatMap((d) => (d.branches || []).map((b) => b?.title || b?.nodeId || '')),
  }));
  return {
    heading: item?.workflowTitle || item?.modelTitle || 'Workflow',
    step: item?.title || '',
    payload: item?.payload || '',
    initiator: item?.initiator || '',
    created: item?.created || '',
    routes,
  };
}

export function createClient({ host = AEM_HOST, token, fetchFn = (...args) => fetch(...args) }) {
  async function request(path, { headers = {}, ...init } = {}) {
    let res;
    try {
      res = await fetchFn(`${host}${path}`, {
        ...init,
        credentials: 'omit',
        headers: { ...headers, Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      throw Object.assign(new Error(e?.message || 'Network error'), { status: 0 });
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const message = json?.message || res.statusText || `HTTP ${res.status}`;
      throw Object.assign(new Error(message), { status: res.status });
    }
    return json;
  }

  async function post(body) {
    const csrf = await request(CSRF_PATH);
    if (!csrf?.token) {
      throw Object.assign(new Error('AEM did not return a CSRF token.'), { status: 403 });
    }
    return request(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrf.token },
      body: JSON.stringify(body),
    });
  }

  return {
    list: () => request(ENDPOINT),
    start: ({ payload, title, modelId = DEFAULT_MODEL }) => post({
      action: 'start', modelId, payload, title,
    }),
    reply: ({
      workflowId, workItemId, routeId, routeName, comment,
    }) => {
      const body = {
        action: 'reply', workflowId, workItemId, routeId, routeName,
      };
      if (comment && comment.trim()) body.comment = comment.trim();
      return post(body);
    },
  };
}
