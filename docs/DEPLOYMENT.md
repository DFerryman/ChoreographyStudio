# Cloudflare preview deployment

Status on 2026-10-06: **build verified; deployment blocked by Cloudflare authorization**.

No preview Worker or deployment was created. The URL below is the intended address,
not a live deployment:

`https://choreo-studio-preview.danuberiverferryman.workers.dev`

## Target configuration

- Worker: `choreo-studio-preview`.
- Account: `84e421f26c708c0cf437e287eed11fa1`.
- Release stage: `S0-interactive-preview`.
- Runtime compatibility date: `2026-10-06`; flag: `nodejs_compat`.
- Frontend: Vite `dist`, served by Workers Static Assets with `ASSETS` binding.
- SPA fallback: `single-page-application`; `/api/*` runs the Worker first.
- Public API: read-only health and capabilities; other APIs return `501`.
- Music is handled locally by the browser; the preview API accepts no music uploads.
- No D1, R2, AI keys, or server project storage are provisioned for this stage.
- Deployment ID: none.

The version-controlled source of truth is [`wrangler.jsonc`](../wrangler.jsonc).

## Verification completed before deployment

- TypeScript and Vite production build passed.
- Core tests passed: 22.
- Playwright browser checks passed: 7.
- Mobile layouts at 320 and 390 pixels had no horizontal overflow.
- Browser checks reported no runtime errors.
- Worker binding type generation, TypeScript check, and Wrangler dry run passed.

## Observed deployment blocker

The connected Cloudflare identity can list the account and existing Workers, and
can read the account's `danuberiverferryman` workers.dev subdomain. It cannot create
the new preview Worker using either currently supported API route:

| Operation | Result |
| --- | --- |
| Register new Worker's static asset manifest | HTTP 403: `No access to the specified resource.` |
| Create Worker with the newer Workers API | Cloudflare error `10000`: `Authentication error` |
| Upload new Worker through the established multipart script API | HTTP 403: `No access to the specified resource.` |

The HTTP 403 response was also confirmed directly for the multipart upload. This
occurred before asset upload or a Worker deployment. Existing Workers were not
modified. A follow-up list confirmed the preview Worker was absent.

Wrangler 4.147.0 is available, but `wrangler whoami` reports that this execution
environment is not authenticated. Its managed credential status reports no
Cloudflare secret or outbound identity. No interactive login was started and no
credentials were copied from unrelated projects.

Cloudflare's current authorization documentation distinguishes `Editor` (deploy
existing Workers) from Workers-product `Admin` (create new Workers). The exact
scope of the connected OAuth identity was not exposed. Updating an existing
Worker has not been attempted: unrelated existing Workers were intentionally
left unchanged. Creating an empty target Worker in the dashboard is the next
minimal setup step; it avoids granting broader account administration access.

- [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/)
- [Workers Static Assets direct upload](https://developers.cloudflare.com/workers/static-assets/direct-upload/)

## 最少操作：先创建空 Worker

1. 打开目标账号的 [Workers & Pages](https://dash.cloudflare.com/84e421f26c708c0cf437e287eed11fa1/workers-and-pages)。
2. 点击 **Create application**（创建应用）→ **Create Worker**。如果出现模板选择，选 **Start with Hello World!** → **Get started**。
3. 名称填写 **`choreo-studio-preview`**，保留默认示例代码，点击 **Deploy**。
4. 告知已创建；接着重试连接身份对这个目标 Worker 的更新和静态资产上传。

无需填写代码、上传音乐、创建数据库或提供 token。空 Worker 只作为目标容器；
创建完成不代表编舞应用已上线。现有 Worker 的编辑权限仍需实际重试确认。
如果对这个新 Worker 的更新仍被拒绝，再单独检查此 Worker 的 Editor 授权。

官方创建流程来源：[Create your first Worker](https://developers.cloudflare.com/learning-paths/workers/get-started/first-worker/)、[D1 dashboard setup](https://developers.cloudflare.com/d1/get-started/)（确认 Hello World 选项与命名步骤）。

## Deploy after identity setup

Prefer creating the empty `choreo-studio-preview` Worker as described above and
retrying the connected identity for this existing target. If needed, authorize
the deployment identity as Editor for this Worker. An identity authorized to
create Workers in the account is another route, but is not required for the
preferred setup. Configure any CLI credentials securely through the environment
or deployment platform; do not commit token values.

With an authenticated Wrangler identity:

```sh
npm ci
npm run check
npm run deploy
```

If deployment is performed through the connected Cloudflare API, first prepare
the verified build without credentials or network operations:

```sh
npx wrangler deploy --dry-run --outdir /tmp/choreo-worker-build
node infra/prepare-preview.mjs dist /tmp/choreo-worker-build/index.js /tmp/choreo-preview.json
```

Use the official manifest → asset upload → multipart Worker upload flow, retaining
the Worker bindings and routing in `wrangler.jsonc`. Enable the new Worker's
workers.dev address after the upload succeeds. Asset-upload JWTs and prepared
payloads remain temporary and must not be committed.

After deployment, record the actual deployment ID and validate the root HTML,
referenced CSS/JavaScript, `/api/health`, `/api/capabilities`, unknown API `501`,
and non-GET API rejection. Repeat the application browser flow against the live
URL before reporting it as available.
