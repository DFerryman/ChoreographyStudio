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
left unchanged. The preferred next step is reconnecting the Cloudflare app with
Workers creation/deployment permissions for the selected account, then retrying
deployment directly. The user only performs provider authorization.

- [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/)
- [Workers Static Assets direct upload](https://developers.cloudflare.com/workers/static-assets/direct-upload/)

## 重新授权入口

打开官方 [Cloudflare 插件页](https://chatgpt.com/plugins/cloudflare)，在账号连接设置中使用
**Reconnect / 重新连接**；如果界面要求重新连接流程，则按提示断开该账号后再连接。
授权应选目标 Cloudflare 账号，并包含创建和部署 Worker 所需的写权限。
ChatGPT 的“何时询问”设置与 Cloudflare 账号的 OAuth 权限是两回事；更改前者不会解决这个 403。

该链接是官方插件入口，并不是已经创建的 OAuth 会话。OAuth 授权页由连接流程生成；
当前可用工具无法直接生成新的授权会话链接。无需提供 token、填写代码或手工创建 Worker。
授权后重试实际创建、资源上传和部署，成功前继续将预览状态标为未上线。

官方说明：[OpenAI 账号连接与重新连接](https://help.openai.com/en/articles/20001494-connecting-and-managing-app-accounts-in-chatgpt)、
[Cloudflare MCP 授权模板与账号范围](https://developers.cloudflare.com/agent-setup/visual-studio-code/detailed-walkthrough/)。

## Deploy after identity setup

Reconnect the Cloudflare app as described above, then retry the connected
identity for the new `choreo-studio-preview` Worker. Confirm actual write access
by the deployment result. If a CLI identity is used instead, configure its
credentials securely through the environment or deployment platform; do not
commit token values.

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
