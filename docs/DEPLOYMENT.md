# Cloudflare 预览部署

2026-10-06：当前version5已上线P1本机手动关键帧，包含姿态/Root编辑、显式写K、稀疏轨插值、站姿起稿与历史/场景保存。本地52项、13+1浏览器/布局、单轮7HTTP、唯一完整线上14项与实际源码CI均通过。打开 [八拍工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/)。

API/原生限频及无D1边界继续沿用；下面的IDs/资产对应实际P1发布，既有S0浏览器证据另标为历史，不冒充P1线上验收。

## 当前线上版本

| 项目 | 实际结果 |
| --- | --- |
| Worker | `choreo-studio-preview` |
| Account | `84e421f26c708c0cf437e287eed11fa1` |
| Deployment ID | `1479fdaf-2aa0-44f1-a5dc-10e3f58b1624` |
| Version ID | `2fac9fa5-5387-425c-9bbb-23a5379d162d` |
| Version / 流量 | 5 / 100% |
| 发布时间 | `2026-10-06T15:13:08.85059Z` |
| 发布方式 | API multipart 上传包含 gzip 静态资产的 Worker 模块 |
| Cloudflare assets 状态 | `has_assets=false`；本次没有 Cloudflare ASSETS 绑定 |
| 实际 bindings | `API_RATE_LIMITER`（ratelimit）与 `RELEASE_STAGE`（plain_text） |
| 模块大小 | 345890 bytes |
| 实际下载模块 SHA-256 | `508ed426ae18b0c74e300c14068513ffa3611b80a97752bfff16d441569c92e8` |

实际从 Cloudflare 下载的 `index.js` 与仓库 `infra/prepare-inline-preview.mjs` 的稳定生成物逐字节一致。模块包含本次 Web 与带限频保护的 API 构建；生成器为同一 API handler 提供本地 fetch 兼容的资产接口。兼容日期、flags、vars、限频 binding 与 headers 来自版本控制中的 `wrangler.jsonc` 和构建的 `_headers`。两个发布准备工具通过 `infra/worker-metadata.mjs` 保留相同的限频配置。

此预览使用 `preview-1` 与原创 `synthetic-demo`。多个场景、编排历史、相机/播放状态和原音频只在浏览器/IndexedDB 保存；公开 API 只提供健康和能力读取。实际 Worker settings 未绑定 D1、KV、Durable Objects 或 R2；本项目没有数据库调用、服务器项目存储或真实 Motion Worker。

## 请求频率与成本边界

所有 `/api/*` 路由共用 `API_RATE_LIMITER`：namespace `2026100601`，每个 `CF-Connecting-IP` 配置 20 次 / 60 秒，实际 key 为 `choreo-preview:ip:<IP>`。超限返回 429、`Retry-After: 60`；保护缺失、失败或没有可信客户端 IP 时返回 503。静态资源和本机编辑不调用该限流器，不写 D1。

原生限频按 Cloudflare 节点生效且最终一致，共享出口 IP 共用额度；后续鉴权服务应改用账号身份。它不是账户全局费用硬上限，429 仍计 Worker 请求，当前 inline 静态交付也会执行 Worker。后续开放写入前还需业务幂等、写入合并和日写入预算门槛，当前没有宣称生产写入额度已完成。平台边界见 [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) 与 [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)。

## 验证记录

version 5 于 `2026-10-06T15:14:55.350Z` 完成一次必要的 7 项 HTTP 检查，全部通过：

- HTML、favicon、JavaScript、CSS 返回 200，4 个资产的 SHA-256 与 `dist` 完全相同，安全 headers 生效。
- `/api/health`、`/api/capabilities` 返回 200；健康结果明确 `S0-interactive-preview`、`preview-1`、`synthetic-demo`。
- `POST /api/projects` 返回 501，没有开放项目上传或写入。
- 实际下载模块与生成物完全一致；settings 核验仅有上述两个 bindings。未进行公网 burst、循环压测或写入测试。

| 资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `index.html` | 645 | `6f8ef6d457648f6c9db7ee6d106524ddf9010d363ccdbbde4b7aed7059478ce0` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `assets/index-cqLXFl6s.js` | 907440 | `729511114a8df0d398763d475e319332d96320cf0da7d859a50f03b0f5156b99` |
| `assets/index-Dh91RS4i.css` | 42602 | `39d3c950dd4d8d7a0e48df9a40116d68ebf211507b04a586141f0dcdc954c3a1` |

version5的唯一完整线上14项于 `2026-10-06T15:16:19.311Z` 开始，190.445秒全部通过，0 skipped/unexpected/flaky；14个console附件均无errors/warnings或pageerror。验证包括原10项和新增4项手K、旧场景/模板固化、保存失败/延迟保存与小屏流程；慢保存时可继续编辑。实际源码CI run37486474465已completed/success，详见验证记录。

保存的是正式轨道/基底与权威take，未写入Pose草稿不视为已保存动画；没有云保存或D1写入。实现规则与本地失败/脚本修正、CSS针对性复核记录见 [MANUAL_KEYFRAMES.md](MANUAL_KEYFRAMES.md) 和 [VERIFICATION.md](VERIFICATION.md)。

## 历史S0浏览器检查

version 4 的完整 10 项 Playwright 流程在 `2026-10-06T14:05:04.566Z` 开始，102.922 秒全部通过：原 7 项编舞流程，以及相机/骨骼/坐标、多场景独立保存与复制后刷新/删除、未保存改动保护及保存失败 3 项新增流程。10 个浏览器 console attachment 均无 errors/warnings，pageerror 为空，无跳过、重试不稳定或不符合预期的用例。公网只执行这一轮完整流程。

此前 version 3 的 7 项视觉流程在 `2026-10-06T13:25:18.181Z` 开始，38.752 秒全部通过；该结果发生在新 Scene 功能之前，作为历史记录保留，当前新增范围使用上述 version 4 的真实验证。

基础后备生成器曾通过39项直接、25项workerd HTTP和34项旧/新等价与动态headers检查。既有7项API mock与6项metadata断言验证429/503和两发布路径保留限频；本轮未改API/infra。当前52项core/手K/API/存储、构建/Worker类型及完整浏览器和CI结果见 [VERIFICATION.md](VERIFICATION.md)。

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

S0/P1上线代表原创演示和本机编辑闭环。真实动作、Avatar、许可、教师验证、生产服务和MP4尚未完成；原M0–M3仍未通过。
