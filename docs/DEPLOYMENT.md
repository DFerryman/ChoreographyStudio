# Cloudflare 预览部署

2026-10-06：S0 交互预览已上线并完成验收。打开 [八拍工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/)。

## 当前线上版本

| 项目 | 实际结果 |
| --- | --- |
| Worker | `choreo-studio-preview` |
| Account | `84e421f26c708c0cf437e287eed11fa1` |
| Deployment ID | `f8ee52e1-ea1f-4b79-83a0-7b8315b3a93d` |
| Version ID | `602fd037-46d4-4982-9691-14fffe497458` |
| Version / 流量 | 2 / 100% |
| 发布时间 | `2026-10-06T10:16:47.661373Z` |
| 发布方式 | API multipart 上传包含 gzip 静态资产的 Worker 模块 |
| Cloudflare assets 状态 | `has_assets=false`；本次没有 Cloudflare ASSETS 绑定 |
| 模块大小 | 307885 bytes |
| 实际下载模块 SHA-256 | `ff196b960b592ed0963d0438cef620aac541c8de073a472c22288053a0675130` |

实际从 Cloudflare 下载的 `index.js` 与仓库 `infra/prepare-inline-preview.mjs` 的稳定生成物逐字节一致。Web 构建与 API 源码没有因后备发布方式改变；生成器为原 API handler 提供本地 fetch 兼容的资产接口。兼容日期、flags、vars 与 headers 来自版本控制中的 `wrangler.jsonc` 和构建的 `_headers`。

此预览使用 `preview-1` 与原创 `synthetic-demo`。音乐、项目和原音频只在浏览器/IndexedDB 处理；公开 API 只提供健康和能力读取。没有配置 D1、R2、AI keys、服务器项目存储或真实 Motion Worker。

## 验证记录

最终版本于 `2026-10-06T10:17:25.057Z` 完成 15 项 HTTP 复验，全部通过：

- HTML、favicon、JavaScript、CSS 返回 200，4 个资产的 SHA-256 与 `dist` 完全相同，安全 headers 生效。
- `/api/health`、`/api/capabilities` 返回 200；健康结果明确 `S0-interactive-preview`、`preview-1`、`synthetic-demo`。
- 未实现 API 的 GET，以及 `POST /api/health`、`POST /api/projects` 返回 501。
- 页面路径使用 SPA 回退；缺失 JavaScript 返回 404；关闭 gzip 时仍返回正确资产。
- 条件请求返回 304，HEAD 返回 200；`/_headers` 不公开配置原文。

| 资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `index.html` | 645 | `bd731a644df135eced1157a43017778b481db3ff0cb59780081c78be94d4e946` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `assets/index-DCty2fBJ.js` | 810600 | `0e327d0d9460802256fb22201a87e7bac4741169c6ad8f079671428d6fc21e2b` |
| `assets/index-BfyEEScG.css` | 28931 | `49c4b16a5939844920377f694d16b963b3f39a773edc9dce2ab34f0b1dc73fda` |

同一公网 URL 的 7 项 Playwright 交互检查在 `2026-10-06T10:14:14.082Z` 开始，45.8 秒全部通过，零 console warning/error 和 pageerror；当时是 version 1。随后 version 2 使用可复现生成物重发，4 个前端资产完全未变，原 API handler 保持原样；完成了最后的 15 项 HTTP 检查。没有声称 7 项浏览器检查在 version 2 发布后重跑。

后备生成器另外通过 39 项直接检查、25 项 workerd HTTP 检查，以及 34 项旧/新输出等价和动态 headers 检查。构建、22 项 core 检查、Worker 类型检查与 GitHub CI 结果见 [VERIFICATION.md](VERIFICATION.md)。

## 复现当前发布构建

生成器只准备文件，不执行网络请求或部署：

```sh
npm ci
npm run build
npx wrangler deploy --dry-run --outdir /tmp/choreo-worker-build
node infra/prepare-inline-preview.mjs dist /tmp/choreo-worker-build/index.js /tmp/choreo-inline-repro
```

输出为 `/tmp/choreo-inline-repro.mjs`、`-metadata.json`、`-multipart.txt` 和 `-summary.json`。当前锁定依赖与同一构建输入可重复生成上述模块 SHA-256。通过已授权 Cloudflare API 上传 multipart，并启用目标 Worker 的 workers.dev 地址；发布后记录新 deployment/version IDs 并验证公网。

生成模块、multipart、临时上传 JWT、凭据及上传音乐不进入 public 仓库。后备生成器对未支持的非空 `_redirects` 明确报错，不默默忽略配置。

## 标准 Static Assets 路线

`wrangler.jsonc` 保留 Workers Static Assets 标准配置。当前没有把后备方式描述成 ASSETS 绑定部署。用户完成 Cloudflare 重新授权后，正式 Worker 创建和发布已成功；无需手工创建 Worker。官方资产 manifest 接口返回 200，但使用上传 JWT 的小资产 multipart 请求返回 `Unauthorized`，原因仍未定位，因此本次采用上述可复现后备方式。

恢复官方资产上传后，在已认证的 Wrangler 环境可执行 `npm run deploy`。标准 API 准备工具 `infra/prepare-preview.mjs` 已将 `_headers`/`_redirects` 保留为配置元数据，不作为公开资产。GitHub 自动 CI 已启用，自动 Cloudflare 发布尚未配置。

S0 上线只代表原创演示的交互闭环。真实动作、Avatar、许可、教师验证、生产服务和 MP4 尚未完成；原 M0–M3 仍未通过。
