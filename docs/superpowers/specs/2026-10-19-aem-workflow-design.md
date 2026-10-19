# AEM Workflow – DA library plugin (design)

## Goal
A DA library panel that lets an author:
1. See the running AEM workflow work items assigned to them (directly or via groups).
2. Advance a work item by choosing one of its next steps, with an optional comment.
3. Start the `da-approve` workflow on the page currently open in DA.

Backend: `DaWorkflowServlet` at `/bin/ma10226/daworkflow`, documented in
`MA10226-p182083-uk37298/docs/daworkflow-api.md`.

## Constraints
- Auth uses the IMS token from the DA SDK (`DA_SDK` → `{ context, token }`), sent as
  `Authorization: Bearer <token>`. No cookies (`credentials: 'omit'`).
- POST requests need an AEM CSRF token. Fetch it from `/libs/granite/csrf/token.json`
  using the same bearer token, then send it in the `CSRF-Token` header.
- Host is hardcoded during development:
  `https://author-p182083-e1919654.adobeaemcloud.com`. It will later move to per-site
  config, so it lives in one constant.
- No build step. Plain ES modules. Follow the Workfront plugin's structure.

## Prerequisite (AEM repo, out of scope for this repo)
The AEM author currently sends no `Access-Control-Allow-Origin` header (preflight
checked 2026-10-19). Add an OSGi config
`com.adobe.granite.cors.impl.CORSPolicyImpl~daworkflow.cfg.json` with:
- `alloworigin`: none
- `alloworiginregexp`: `https://.*--da-base--demoamer275\.aem\.(page|live)`,
  `http://localhost:3000`
- `allowedpaths`: `/bin/ma10226/daworkflow`, `/libs/granite/csrf/token.json`
- `supportedmethods`: GET, POST, OPTIONS
- `supportedheaders`: Authorization, Content-Type, CSRF-Token
- `supportscredentials`: false

## Files
| File | Purpose |
|------|---------|
| `tools/aem-workflow.html` | Panel shell. Loads `sdk.js` then `aem-workflow.js`. |
| `tools/aem-workflow/api.js` | Pure API client. No DOM. |
| `tools/aem-workflow/api.test.js` | Unit tests for `api.js` with a mocked fetch. |
| `tools/aem-workflow/aem-workflow.js` | UI: SDK init, rendering, event wiring. |
| `tools/aem-workflow/aem-workflow.css` | Styles scoped to the panel. |

Registration (content, done once per site): add a row to the `library` sheet at
`https://da.live/config#/demoamer275/da-base/` with title `AEM Workflow` and path
`/tools/aem-workflow.html`.

## API module (`api.js`)
```js
export const AEM_HOST = 'https://author-p182083-e1919654.adobeaemcloud.com';
export const ENDPOINT = '/bin/ma10226/daworkflow';
export const DEFAULT_MODEL = 'da-approve';

export function previewUrl({ org, repo, path }) // https://main--{repo}--{org}.aem.page{path}
export function createClient({ host = AEM_HOST, token, fetchFn = fetch })
  // returns { list(), start({ payload, title, modelId = DEFAULT_MODEL }),
  //           reply({ workflowId, workItemId, routeId, routeName, comment }) }
```
- `list()`: GET the endpoint and return `{ user, count, workItems }`.
- `start` and `reply`: fetch the CSRF token, then POST JSON with `action`. Omit
  `comment` when it is empty.
- Error response: throw an `Error` with `.status` set to the HTTP status and
  `.message` set to `json.message` (or the status text if the body is not JSON).
- Network failure (a `TypeError` from fetch): throw an error with `.status = 0`.
- Paths in `previewUrl`: strip a trailing `.html`. `/index` maps to `/`.

## UI (`aem-workflow.js`)
1. Wait for `DA_SDK`. If there is no token, show "Sign in to DA to use AEM Workflow."
2. **Start section**
   - Read-only payload: `previewUrl(context)`.
   - Title input. Defaults to the last path segment.
   - "Start approval" button. The model shown is `da-approve`.
3. **My tasks section**
   - One card per work item: `workflowTitle` (falls back to `modelTitle`), step `title`,
     payload as a link, `initiator`, and `created` as a local date.
   - Each card has an optional comment textarea and one button per `nextSteps[]`
     entry, labelled with `name`. Back routes are styled as secondary buttons.
   - AND_SPLIT destinations list their branches as text under the button.
   - With no items, show "No tasks assigned to you."
   - Every value may be `null`. Render defensively and use `textContent` only.
4. Buttons are disabled while a request runs. After a start or reply, whether it
   succeeds or fails with 403/404, refresh the list.

## Error messages
| Status | Message |
|--------|---------|
| 0 | "Could not reach AEM (network or CORS configuration)." |
| 401 | "AEM rejected your session. Reopen the panel or sign in again." |
| 403/404 | Server `message`, then refresh the list. |
| 400 | Server `message`. |
| 500+ | "AEM workflow error. Try again later." |

## Testing
- `api.test.js` (Node test runner):
  - Bearer header and `credentials: 'omit'`.
  - CSRF fetched before POST.
  - Body shape for `start` and `reply`, including default model and empty comment.
  - Error mapping: JSON message, non-JSON body, network failure.
  - `previewUrl` cases.
- Manual: open the plugin in DA on a page. Start `da-approve`, confirm the task
  appears, and reply with a route.

## Out of scope
- Per-site host config (future).
- Model picker.
- Filtering tasks to the current page.
