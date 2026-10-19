# AEM Workflow Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A DA library panel that lists the user's AEM workflow tasks, lets them reply along a route, and starts `da-approve` on the open page.

**Architecture:** A pure `api.js` client (bearer token + CSRF, no DOM) unit-tested with a mocked fetch, and a thin UI module `aem-workflow.js` that gets `{ context, token }` from the DA SDK and renders with `textContent` only. Same layout as `tools/workfront`.

**Tech Stack:** Vanilla ES modules, DA App SDK (`https://da.live/nx/utils/sdk.js`), `node:test`, ESLint airbnb-base.

**Spec:** `docs/superpowers/specs/2026-10-19-aem-workflow-design.md`

## Global Constraints

- `AEM_HOST = 'https://author-p182083-e1919654.adobeaemcloud.com'`, `ENDPOINT = '/bin/ma10226/daworkflow'`, `DEFAULT_MODEL = 'da-approve'`. Defined once in `api.js`.
- All requests send `Authorization: Bearer <token>` and use `credentials: 'omit'`.
- Before each POST, GET `${host}/libs/granite/csrf/token.json` (with the bearer token) and send `CSRF-Token: <json.token>`.
- No build step and no new dependencies. Relative imports keep the `.js` extension.
- The UI uses `textContent` and DOM APIs only. Never assign `innerHTML` with server data.
- Tests run with `node --test tools/aem-workflow/`. Lint runs with `npx eslint tools/aem-workflow`.
- Error copy, exact:
  - 0: `Could not reach AEM (network or CORS configuration).`
  - 401: `AEM rejected your session. Reopen the panel or sign in again.`
  - 500+: `AEM workflow error. Try again later.`
  - 400/403/404: the server's `message`.

## Review Focus

1. **Non-JSON error bodies** (for example, an HTML 401 from the dispatcher). Expect an error with the correct `.status` and a status-text message, never a JSON parse crash. Test: Task 1 `non-JSON error body`.
2. **CSRF fetch fails.** The POST must not be sent, and the CSRF error propagates with its status. Test: Task 1 `csrf failure aborts post`.
3. **Null fields in work items** (`workflowTitle`, `payload`, `nextSteps`, `created`). Expect the card to render with fallbacks and no throw. Test: Task 1 `describeItem handles nulls`.
4. **Root and `index` paths in `previewUrl`.** `/index` → `/`, `/a/index` → `/a/`, `/a.html` → `/a`. Test: Task 1 `previewUrl`.
5. **Whitespace-only comment.** Treat it as empty and omit it from the reply body. Test: Task 1 `reply omits blank comment`.

---

### Task 1: API client

**Files:**
- Create: `tools/aem-workflow/api.js`
- Test: `tools/aem-workflow/api.test.js`

**Interfaces:**
- Produces:
  - `AEM_HOST`, `ENDPOINT`, `DEFAULT_MODEL` (strings).
  - `previewUrl({ org, repo, path }): string`.
  - `errorMessage(err: { status, message }): string`. Maps a status to the exact copy from Global Constraints.
  - `describeItem(item): { heading, step, payload, initiator, created, routes: [{ routeId, name, backRoute, branches: string[] }] }`. Fills nulls with `''`, `heading` falls back to `modelTitle` and then `'Workflow'`, `routes` is `[]` when `nextSteps` is null, and `branches` holds the titles from AND_SPLIT destinations.
  - `createClient({ host = AEM_HOST, token, fetchFn = globalThis.fetch })` returning:
    - `list(): Promise<{ user, count, workItems }>`
    - `start({ payload, title, modelId = DEFAULT_MODEL }): Promise<object>`
    - `reply({ workflowId, workItemId, routeId, routeName, comment }): Promise<object>`
  - Errors are instances of `Error` with `.status`. A network `TypeError` maps to `status 0`.

- [ ] **Step 1: Write the failing tests** in `api.test.js`. Use a `mockFetch(responses)` helper that records `[url, init]` calls and returns queued `{ status, body }` as `new Response(...)`.
  - `previewUrl`: `{org:'o',repo:'r',path:'/a/b'}` → `https://main--r--o.aem.page/a/b`. Also `/a.html` → `.../a`, `/index` → `.../`, `/a/index` → `.../a/`.
  - `list sends bearer`: one call to `AEM_HOST + ENDPOINT`. Headers include `Authorization: 'Bearer t'`, `credentials === 'omit'`, and the method is GET or undefined.
  - `start posts with csrf and default model`: call 1 is `.../libs/granite/csrf/token.json`, which returns `{token:'c'}`. Call 2 is a POST with `CSRF-Token: 'c'`, `Content-Type: application/json`, and a body deep-equal to `{action:'start',modelId:'da-approve',payload:'p',title:'t'}`.
  - `reply omits blank comment`: with `comment: '  '`, the body has no `comment` key. With `comment: 'ok'`, the body includes `comment:'ok'`, plus `workflowId`, `workItemId`, `routeId`, `routeName`.
  - `json error`: a 403 with `{status:'error',message:'gone'}` rejects with `{status:403, message:'gone'}`.
  - `non-JSON error body`: a 401 with body `'<html>'` rejects with `status 401` and a non-empty message.
  - `network failure`: when `fetchFn` throws a `TypeError`, the call rejects with `status 0`.
  - `csrf failure aborts post`: when the CSRF call returns 401, `start` rejects with 401 and only one fetch call was made.
  - `errorMessage`: statuses 0, 401, 500, and 403 (returns `'gone'`) each map to the exact copy.
  - `describeItem handles nulls`: `{workflowTitle:null, modelTitle:null, nextSteps:null, payload:null}` → `heading 'Workflow'`, `routes []`, `payload ''`. The AND_SPLIT sample from the API doc → `branches ['Legal review','Brand review']`.

- [ ] **Step 2: Run** `node --test tools/aem-workflow/`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `api.js`** to the interfaces above. Use one internal `request(path, init)` that adds the auth headers and `credentials:'omit'`. It reads the body as text, then tries `JSON.parse`. On `!ok`, it throws an `Error(json?.message || statusText || 'HTTP <status>')` with `.status`. The POST helper calls `request` for the CSRF token first.

- [ ] **Step 4: Run** `node --test tools/aem-workflow/` and then `npx eslint tools/aem-workflow`. Expected: all tests pass and there are no lint errors.

- [ ] **Step 5: Commit**: `git add tools/aem-workflow/api.js tools/aem-workflow/api.test.js` and `git commit -m "feat(aem-workflow): API client"`.

### Task 2: Panel UI

**Files:**
- Create: `tools/aem-workflow.html`, `tools/aem-workflow/aem-workflow.js`, `tools/aem-workflow/aem-workflow.css`

**Interfaces:**
- Consumes: everything Task 1 produces.

- [ ] **Step 1: Create `tools/aem-workflow.html`**, modelled on `tools/workfront.html`.
  - Header comment: describes the plugin, says auth is the DA SDK token, and gives the registration row (`library` sheet: title `AEM Workflow`, path `/tools/aem-workflow.html`).
  - Loads `sdk.js` and then `/tools/aem-workflow/aem-workflow.js` as modules, plus the CSS.
  - Body contains:
    - `#status`
    - `section#start-view`: read-only `#payload`, `#title` input, `#start` button with text `Start approval`, and a note `Model: da-approve`.
    - `section#tasks-view`: `h2` `My tasks`, `#refresh` button, and `ul#list`.

- [ ] **Step 2: Implement `aem-workflow.js`.**
  - `init()` races `DA_SDK` against a 3000 ms timeout, as in Workfront. If there is no token, set the status to `Sign in to DA to use AEM Workflow.` and stop.
  - `createClient({ token })`. Set `#payload` to `previewUrl(context)`. Default `#title` to the last path segment.
  - `loadTasks()` calls `list()` and renders one `li.card` per item using `describeItem`:
    - The heading, step, and payload (as `a[target=_blank]`, only when non-empty), plus `initiator` and `new Date(created).toLocaleString()` when present.
    - A `textarea` with placeholder `Comment (optional)`.
    - One button per route. Add the `secondary` class when `backRoute` is true. If there are branches, add a `small` that reads `Runs in parallel: a, b`.
    - With zero items, show `li.empty` with `No tasks assigned to you.`
  - `busy(true|false)` disables every button.
  - Clicking a route calls `reply({ workflowId, workItemId, routeId, routeName: name, comment })`.
    - On success, set the status to `Moved to "<name>".` and refresh.
    - On an error, set the status to `errorMessage(err)` with kind `error`. Refresh if the status is 403 or 404.
  - `#start` calls `start({ payload, title })`. If the title is empty, set the status to `Enter a title.` and don't call. On success, set the status to `Workflow started.` and refresh.

- [ ] **Step 3: Write `aem-workflow.css`.** Reuse the visual conventions from `tools/workfront/workfront.css`: status kinds, `.card`, button `.secondary`, and a full-width textarea.

- [ ] **Step 4: Run** `npx eslint tools/aem-workflow` and `node --test tools/aem-workflow/`. Expected: clean, and all tests pass.

- [ ] **Step 5: Manual check.**
  - Run `npx -y @adobe/aem-cli up`.
  - Add the library row in the DA config pointing at `/tools/aem-workflow.html`.
  - Open a page in da.live and open the AEM Workflow library panel.
  - Expected: the payload shows the page's `aem.page` URL. Start creates a task that appears after refresh. Clicking a route makes the task disappear (or advance). With the AEM CORS config missing, the status shows the network/CORS message.

- [ ] **Step 6: Commit**: `git add tools/aem-workflow.html tools/aem-workflow/aem-workflow.js tools/aem-workflow/aem-workflow.css` and `git commit -m "feat(aem-workflow): DA library panel"`.
