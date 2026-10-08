# Cloudflare 预览部署

2026-10-08：当前 version 11 已上线简洁经典手动编辑器、舞台快捷键、音频异步取消/恢复，以及原创实体人体和新编辑姿态的关节限制。161 项本地基础检查、类型/生产构建与 dry-run、20 项人体相关既有流程的首轮及连接恢复覆盖、新增限位 4 项、单轮线上 8 项和有界 5 HTTP 通过。完整远端源码 CI 结果见 [VERIFICATION.md](VERIFICATION.md)。打开 [八拍工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/)。

API 与发布基础设施未改变，原生限频及无 D1 边界继续沿用。编辑、约束、音频、保存与备份均在浏览器完成；AI 未接入，IK、接触、质心/重力仍在分阶段评估，见 [REALISM_PLAN.md](REALISM_PLAN.md)。历史 v10 及 S0/v5–v9 记录保留。

## Version 12 发布准备

本轮已完成 Workers AI 接线（只 mock 验证，真实推理0）、四肢 IK、可保存脚锁、内置中性人体参数、Rapier 重力候选、CC0 连续中性人体与舞台下方统一时间轴。306项本地基础检查、前端/Worker类型、构建与dry-run通过，时间轴26个不同浏览器流程有通过记录。最终main提交、实际Cloudflare绑定/版本、完整源码CI与有界线上核对待发布后写入下节，不能以dry-run冒充部署。

## 固定交付要求

用户要求每轮修改最终都提交并 push 到 `DFerryman/ChoreographyStudio`，同步部署到本 Cloudflare 预览。交付前核对远端提交、实际运行版本和预览结果，验证记录也提交；不能只留本地改动或把构建成功当作发布完成。此要求已写入根目录 `AGENTS.md`。

仅文档修改时复用已经验证的运行版本，同步部署在 `workers/message` 中记录本轮源码提交，核对实际部署与已有健康检查。运行代码和资产未变时复用既有检查，不重复完整公网回归，也不增加 D1 写入。当前表保留 v11 功能版本首次发布记录；后续纯文档的同版同步在部署 message 中记录最终源码提交，实际 ID/时间由 Cloudflare 部署记录核对。旧记录保留在历史章节。

## 当前线上版本 · version 11

| 项目 | 实际结果 |
| --- | --- |
| Worker / Account | `choreo-studio-preview` / `84e421f26c708c0cf437e287eed11fa1` |
| v11 功能首次发布 Deployment ID | `35663e67-deea-4c11-913d-5193c85a440b` |
| Version ID / number / 流量 | `f245eba5-7cda-4950-bda7-f0cae576368b` / 11 / 100% |
| 发布时间 | `2026-10-08T04:25:42.945845Z` |
| 功能运行源码 | [e02b76ba](https://github.com/DFerryman/ChoreographyStudio/commit/e02b76bab054120b31314622cf416d752e847b6f)（包含此前简洁界面 a3b0b20c） |
| 本地/远端功能树 | `f55ecb4ac9c4c0d1031da0048063500a08d9c75e` |
| 源码 CI | [run37727327279](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37727327279)、attempt1，于 `2026-10-08T04:37:58Z` completed/success；161 foundation + 完整 62 browser（12.8m） |
| 发布方式 | 恰一次 multipart 真实上传，Worker 内含 gzip 静态资产；`has_assets=false` |
| 实际 bindings | 原生 `API_RATE_LIMITER`（20/60，namespace 2026100601）与 `RELEASE_STAGE`；无 D1/KV/R2/DO/真实 ASSETS |
| 实际模块大小 / SHA-256 | 378822 bytes / `2d412af1988a21fc62359903228e4bad8ad877c53a60ca066f26f5d923a3487a` |
| 实际下载 / 版本 annotation | 模块内容与生成物一致；version message 关联完整 e02b76ba SHA，tag `v11-manual-human` |

## 当前 version 11 验证

最终本地 161 基础检查与构建、前端/Worker 类型和 dry-run 通过，新增约束 4/4 与既有相关 20 个流程均有通过证据。先前 58 项本地的 55+3 测试 fixture 修正、人体相关首轮 11+9 服务器断连恢复、新真实旋转环 fixture 的未跨界/错误拾取及精确 −145° 恢复全部保留在 [VERIFICATION.md](VERIFICATION.md)。首次简洁界面精确源码 a3b0b20c 的 CI run37724093326 已成功 107 + 58；最终精确人体源码 e02b76ba 的 run37727327279 于 `2026-10-08T04:37:58Z` completed/success，真实日志 161 + 完整 62 browser（12.8m），四项新增约束均成功；没有 rerun 或混用两份 CI。

标准浏览器 UA 的有界 5 HTTP 于 `2026-10-08T04:26:40.306412+00:00`–`04:26:40.916729+00:00` 全通过：四个资产逐字节/哈希/安全 headers 与最终 dist 一致，health 200/status ok/no-store。此前 Python 默认 UA 的首页请求及一次诊断返回 Cloudflare Browser Integrity 403/error1010，未进入业务验证；未调整安全设置，失败记录保留。没有额外 capabilities、POST、限频 burst 或 D1 写入。

唯一相关线上 8 项于 `2026-10-08T04:26:41.502Z` 开始，58.052 秒全通过；8 份实际 diagnostics 的浏览器 errors/warnings/API 请求及 unexpected/flaky/skipped/报告 errors 均为 0。覆盖限位数值/滑条与保存、真实肘部旋转环跨界、320/1440 极简手动布局、迟到音乐隔离、手机 0.5 选段恢复、K/Delete/历史与真实音频 Space。桌面、手机和受限肘部截图来自同一轮，未另开公网截图会话或完整 62 项回归。

| v11 资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `assets/index-CqvB3HBE.js` | 975306 | `949cc792440346f3a5fb8506b9492fc86bcfffe9e44ec7128a7a080b0718848e` |
| `assets/index-DqS_4Npc.css` | 59686 | `953cbdc84bf2df9ecbb79134a901bb3a2edfb1f70baeda7cea68f616527a9674` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `index.html` | 645 | `92be0d3fb1675451717d65fa32df92ef32ae3a1c9dc7f100578418526e232ae0` |

纯 Markdown 交付记录最终提交 push 后复用此运行版本，通过同版 deployment message 关联最终 main；不再次上传模块或重复公网检查。原生产/教学、教师试跳、具名设备、MP4 与 M0–M3 边界保留。

## 历史线上版本 · version 10

| 项目 | 实际结果 |
| --- | --- |
| Worker / Account | `choreo-studio-preview` / `84e421f26c708c0cf437e287eed11fa1` |
| v10 功能首次发布 Deployment ID | `aae5ec8b-a8f2-4f39-88d6-8c53d49b02b2` |
| Version ID / number / 流量 | `6df3fd31-141f-4834-b25c-e871f5a8bbf7` / 10 / 100% |
| 发布时间 | `2026-10-07T14:06:35.603261Z` |
| 功能运行源码 | [9fbc115f](https://github.com/DFerryman/ChoreographyStudio/commit/9fbc115f12d2580ff76b7cf5354fa581081579d8) |
| 测试坐标修正源码 / 实际 CI | [1719439d](https://github.com/DFerryman/ChoreographyStudio/commit/1719439d993cd893f19c771f90c2cf902ef46886) / [run37636175196](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37636175196) |
| 发布方式 | 恰一次 multipart 真实上传，Worker 内含 gzip 静态资产；`has_assets=false` |
| 实际 bindings | 原生 `API_RATE_LIMITER`（20/60，namespace 2026100601）与 `RELEASE_STAGE`；无 D1/KV/R2/DO/真实 ASSETS |
| 实际模块大小 / SHA-256 | 370986 bytes / `be024bed5d7b45667436e28099f2a57eed604cf77f0997b67049f6cf8ae71d87` |

## 历史 version 10 验证

107 项检查、最终构建、前端/Worker 类型与离线 dry-run 通过。8 个不同本地流程通过首轮 7 项和手机定向复核覆盖，新增缺音乐恢复只复核相关单项；10 份实际本地诊断零错误/警告/API。首次脚本/启动失败及对应恢复保留在 [VERIFICATION.md](VERIFICATION.md)。

单轮线上 8 项于 `2026-10-07T14:07:56.792Z` 开始，140.295 秒全部通过，8 份实际 errors/warnings/API 请求和 unexpected/flaky/skipped/报告 errors 为 0；320/390px 无横向溢出，新操作至少 44px，备份/音乐恢复保留精确动作、历史、原音乐和相机。截图来自同一轮，未另开公网截图会话。

唯一 5 HTTP 于 `2026-10-07T14:07:39.746323+00:00`–`2026-10-07T14:07:41.275334+00:00` 全通过，4 资产逐字节哈希/安全 headers 与 health 200/no-store 匹配。未重复 capabilities、POST、限频 burst 或完整公网回归，无 D1 写入。首次实际源码 CI run37633679536 在 2026-10-07T14:13:57Z completed/failure：107 检查、37/38 浏览器通过，唯一失败是旧手势测试在 footer 下载后复用过期坐标。trace 确认两触点在画布下方；仅测试重新定位并新增命中断言，相关本地复现/修正单项已完成。修正源码 1719439d 的 [新实际 CI run37636175196](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37636175196) 于 `2026-10-07T14:29:27Z` completed/success，实际日志 107 passed (107)、Running 38 tests / 38 passed (6.0m)；原双指项明确成功 13.2s。所有安装/构建/类型步骤成功，无 workflow rerun。运行代码/资产不变，复用既有实际线上证据。

| 当前资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `assets/index-CHg8RZiz.js` | 961578 | `8f325ec23d342397809b8889ab79b5ba0256821ddff83332e58b42e5e177b968` |
| `assets/index-gL39YgCa.css` | 53308 | `387f8f28f0730a9fe0141af8a22500e44a394af0c188c00618aafe8a969e844b` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `index.html` | 645 | `f0400eefb6718521ad5b0a3c5f3655a1980e376e718b1c39272cd90f83bcf710` |

初次部署调用因自动审批服务 capacity 未执行；沿同一审批路径、同 payload 的重试成功，只有一次实际 upload。最终 9 份 Markdown 验证文档也提交 push，复用这份完全相同的运行版本，以部署 message 关联最终源码 SHA；不再上传资产、重跑 CI 或公网浏览器。原生产契约/素材/教师/MP4 与 M0–M3 保留。

## 历史 version 9 线上版本

| 项目 | 实际结果 |
| --- | --- |
| Worker / Account | `choreo-studio-preview` / `84e421f26c708c0cf437e287eed11fa1` |
| v9 功能首次发布 Deployment ID | `fc8c7bcb-378b-4d15-9f68-639bb7179db4` |
| Version ID / number / 流量 | `4f83a485-6508-4f10-9e8e-6a3b0c8ec796` / 9 / 100% |
| 发布时间 | `2026-10-07T13:22:43.653545Z` |
| 功能源码 | [b4381724](https://github.com/DFerryman/ChoreographyStudio/commit/b43817249a9ade4e68bc9900ef273b3e47fdec0f) |
| 发布方式 | multipart 上传包含 gzip 静态资产的 Worker；`has_assets=false` |
| 实际 bindings | `API_RATE_LIMITER`（20/60）与 `RELEASE_STAGE`，无 D1/KV/R2/DO/真实 ASSETS |
| 实际模块大小 / SHA-256 | 355346 bytes / `d39e30c0e5c52f925a3a53bc2590bd151a7fa8b8e0fb0dbf5706d904ea3a8add` |

## 历史 version 9 验证

60 项检查、最终构建、Worker 类型与离线 dry-run 通过。本地 4 个新增范围由首轮 3 项和最终相关单项复核覆盖，保留数值格式断言及加强画布指针断言的记录。实际线上单轮 4 项于 `2026-10-07T13:24:30.561Z` 开始，53.841 秒全部通过，errors/warnings/API 请求和 unexpected/flaky/skipped 为 0；新增 320/390px 控件 >=44px，无横向溢出，相机/正式动作/原音频保存恢复一致。

唯一 5 HTTP 于 `2026-10-07T13:23:52.194430+00:00`–`2026-10-07T13:23:53.167641+00:00` 全通过，4 资产内容/安全 headers 与 health 200/no-store 匹配。没有未改 API 的重复探测、公网限频 burst 或 D1 写入。实际 [源码 CI run37627848531](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37627848531) completed/success，`2026-10-07T13:27:45Z` 更新，完整 60 检查与 30 浏览器流程成功；不触发重跑。

| 当前资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `assets/index-Ba2BRLq3.css` | 50274 | `6a31b7163e91973f5ae5b2eb30399637d9dac16090b8877f2a4cf0db1d756231` |
| `assets/index-Ctpwz7OU.js` | 927472 | `d64510d02c2e837925302410c14a47eda59bc8539fa0b9d601de3cabc917374b` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `index.html` | 645 | `dd7fd01c4bfc87d101a5c4ce33de79d7a60348bb9af0a56beaf44f5c3ed02dda` |

最终文档以纯 Markdown 提交 push，Cloudflare 复用同一 v9 version 的 deployment message 关联最终文档 SHA；无运行代码/资产变化，不再次上传或重跑公共验证。详细结果见 [VERIFICATION.md](VERIFICATION.md)。

## 历史 version 8 线上版本

| 项目 | 实际结果 |
| --- | --- |
| Worker / Account | `choreo-studio-preview` / `84e421f26c708c0cf437e287eed11fa1` |
| v8 功能首次发布 Deployment ID | `ebc26399-df3b-4b50-8de7-fb44b7f71821` |
| Version ID / number / 流量 | `bc806141-6418-44f7-b4c3-f6003ad48dcd` / 8 / 100% |
| 发布时间 | `2026-10-07T11:19:12.561597Z` |
| 功能源码 | [200f943b](https://github.com/DFerryman/ChoreographyStudio/commit/200f943b751b519ae6c19f31b744e4638fc3da18) |
| 发布方式 | multipart 上传含 gzip 静态资产的 Worker；`has_assets=false` |
| 实际 bindings | `API_RATE_LIMITER`（20/60、namespace 2026100601）与 `RELEASE_STAGE` |
| 实际模块大小 / SHA-256 | 353666 bytes / `1b182013eb22915c5cf94a8d0f2feca02231912e29d827696971071dfcff1d78` |

实际下载模块与可复现生成物逐字节一致，version message 关联完整功能 Git SHA；API bundle 与 v7 相同。无 D1/KV/R2/DO/真实 ASSETS 绑定，音乐、姿态复用、K/烘焙与 IndexedDB 保存均在浏览器。

## 历史 version 8 验证

唯一 5 HTTP 于 `2026-10-07T11:20:25.454604Z`–`11:20:27.111684Z` 全通过，4 资产 bytes/hash/安全 headers 与最终 dist 相同，health 200/no-store。API/infra 未改，复用既有 API 保护/501 证据，未另跑 capabilities、POST 或限频 burst。

| v8 历史资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `assets/index-Br0b-ptV.css` | 49517 | `a2255a09e7e9891ebd7e6556f3b9ef4ee2f1a45b38b9d880d2e523f4ebe40cdb` |
| `assets/index-CvrUMSNe.js` | 923879 | `d1ce8917038d3cfc54b724e4d942e433e9221985ca108eadeb2b61f0a9394f3c` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `index.html` | 645 | `7d4714485c9d665a2903512edc21a254b43e932b6c90d098792df4daffd4020a` |

本地单轮新增 4 项于 `11:12:23.918Z`、84.161 秒通过；实际新增线上单轮 4 项于 `2026-10-07T11:20:44.256Z`、74.446 秒全通过，两轮均无 unexpected/flaky/skipped/报告 errors，诊断 errors/warnings/API 请求均为 0。320/390px 新控件 >=44px/无横向溢出，原音频 hash 和正式动作/历史保存重开一致；截图来自同一轮，未重复公网会话。实际 [源码 CI run37613142651](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37613142651) completed/success、`2026-10-07T11:24:56Z` 更新，日志确认 52 检查和完整 26 项 e2e 通过。最终纯文档提交复用同一运行版本，以部署 message 同步最终 SHA，不再次上传资产或公网测试。详见 [VERIFICATION.md](VERIFICATION.md)。

## 历史 version 7 线上版本

| 项目 | 实际结果 |
| --- | --- |
| Worker | `choreo-studio-preview` |
| Account | `84e421f26c708c0cf437e287eed11fa1` |
| v7 功能首次发布 Deployment ID | `5e4bde38-3f4f-476f-8374-4fe410b36878` |
| Version ID | `2eb92bb1-7d34-448b-afae-3dfd4c0d28e4` |
| Version / 流量 | 7 / 100% |
| 发布时间 | `2026-10-07T06:55:05.960593Z` |
| 功能源码 | [b6dbd231](https://github.com/DFerryman/ChoreographyStudio/commit/b6dbd231a17d4da58ee5f78e122960542da4edb2) |
| 发布方式 | API multipart 上传包含 gzip 静态资产的 Worker；`has_assets=false` |
| 实际 bindings | `API_RATE_LIMITER`（20/60、namespace 2026100601）与 `RELEASE_STAGE` |
| 模块大小 | 352118 bytes |
| 实际下载模块 SHA-256 | `62663af9260aa723948941accc93afc7f276e8b115379fdec0491a4b377363a1` |

实际下载的 `index.js` 与最终可复现生成物逐字节一致；version message 关联同一功能 Git SHA。只保留原生限频与阶段变量，无 D1/KV/R2/DO/真实 ASSETS 绑定。音乐、编舞、轨道编辑、播放和 IndexedDB 场景保存留在本机。

## 历史 version 7 验证

必要单轮 5 HTTP 于 `2026-10-07T06:56:18.166541Z` 开始，`06:56:19.093700Z` 完成，全部通过：4 资产 200 且 bytes/SHA 与最终 dist 一致，安全 headers 保留；health 200 / no-store，stage、preview-1 和 synthetic-demo 正确。API/infra 没有改动，复用此前 API 保护/501 拒绝证据，没有再跑 capabilities/POST 或公网限频 burst。

| v7 历史资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `assets/index-C_Hml5-F.js` | 920967 | `8448fc352b75ae899ce0b7599d4d0c33b14c70db93c345ab15ba76b4d8b6bc89` |
| `assets/index-C2d_8p-4.css` | 48287 | `58d5ac45b78de57be7e8d204ae57b4e5a0dd69764f03c01d72962d8468b15f63` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `index.html` | 645 | `76e9bdaad093055e676ca78643a8161a92e350380bbe8dc9bd8f0a09b75c2ed2` |

本地 7 项与追加 Root 单项通过。首次在线浏览器导航因默认执行方式未使用受信代理证书而失败，尚未进入功能；恢复已验证启动配置后，一轮相关线上 4 项于 `2026-10-07T07:00:25.215Z` 开始，63.861 秒全部通过，零 unexpected/flaky/skipped、console errors/warnings 和 API 请求。桌面/手机截图来自此同一轮；保留追加脚本的首轮超时和代理证书失败及对应恢复，未另跑公网整套或截图会话。实际 [源码 CI run37584120545](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37584120545) completed/success、`2026-10-07T07:00:09Z` 更新，日志确认 52 检查与完整 22 项 e2e 通过，head 对应上述功能提交。详情见 [VERIFICATION.md](VERIFICATION.md)。

## 历史 version 6 线上版本

| 项目 | 实际结果 |
| --- | --- |
| Worker | `choreo-studio-preview` |
| Account | `84e421f26c708c0cf437e287eed11fa1` |
| v6 功能首次发布 Deployment ID | `3e4d1b20-04a7-477b-bf3d-9da12bb4b77e` |
| Version ID | `68f57f01-3e85-4811-a577-83a9e879d854` |
| Version / 流量 | 6 / 100% |
| 发布时间 | `2026-10-07T05:03:42.985483Z` |
| 发布方式 | API multipart 上传包含 gzip 静态资产的 Worker 模块 |
| Cloudflare assets 状态 | `has_assets=false`；本次没有 Cloudflare ASSETS 绑定 |
| 实际 bindings | `API_RATE_LIMITER`（ratelimit）与 `RELEASE_STAGE`（plain_text） |
| 模块大小 | 349962 bytes |
| 实际下载模块 SHA-256 | `7247fe5be3a50f606bf9ad6032e79264e1eaea8ff67829344ec0d9eff4e87dc2` |

实际从 Cloudflare 下载的 `index.js` 与仓库 `infra/prepare-inline-preview.mjs` 的稳定生成物逐字节一致。模块包含本次 Web 与带限频保护的 API 构建；生成器为同一 API handler 提供本地 fetch 兼容的资产接口。兼容日期、flags、vars、限频 binding 与 headers 来自版本控制中的 `wrangler.jsonc` 和构建的 `_headers`。两个发布准备工具通过 `infra/worker-metadata.mjs` 保留相同的限频配置。

此预览使用 `preview-1` 与原创 `synthetic-demo`。多个场景、编排历史、相机/播放状态和原音频只在浏览器/IndexedDB 保存；公开 API 只提供健康和能力读取。实际 Worker settings 未绑定 D1、KV、Durable Objects 或 R2；本项目没有数据库调用、服务器项目存储或真实 Motion Worker。

## 请求频率与成本边界

所有 `/api/*` 路由共用 `API_RATE_LIMITER`：namespace `2026100601`，每个 `CF-Connecting-IP` 配置 20 次 / 60 秒，实际 key 为 `choreo-preview:ip:<IP>`。超限返回 429、`Retry-After: 60`；保护缺失、失败或没有可信客户端 IP 时返回 503。静态资源和本机编辑不调用该限流器，不写 D1。

原生限频按 Cloudflare 节点生效且最终一致，共享出口 IP 共用额度；后续鉴权服务应改用账号身份。它不是账户全局费用硬上限，429 仍计 Worker 请求，当前 inline 静态交付也会执行 Worker。后续开放写入前还需业务幂等、写入合并和日写入预算门槛，当前没有宣称生产写入额度已完成。平台边界见 [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) 与 [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)。

## 历史 version 6 验证

`2026-10-07T05:04:47.316968Z` 至 `05:04:48.743614Z` 执行一次必要的 7 HTTP 检查，全部通过：4 个资产返回 200，SHA-256 与最终 `dist` 完全一致，安全 headers 生效；health/capabilities 返回 200，项目 POST 仍返回 501。实际下载 Worker 模块返回 200，与可复现生成物逐字节一致；settings 仍仅有上述两个 bindings。没有公网 burst、循环检查或服务器写入。

| 当前资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `index.html` | 645 | `5b1175ed187a8c58d1ff88eea7b0a056dde210a041b6a532931ba02a92dc444e` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `assets/index-CkuO6Doc.js` | 916330 | `9a3204e0d8404f95cf623035662d1cfcf8926740d33835005f4f5c801af8751c` |
| `assets/index-CXrg_P_F.css` | 45397 | `0bdca2f97bde79406cb45dbea93cf20d19e920ae69173279554a5963143c9371` |

唯一相关线上 4 项于 `2026-10-07T05:05:54.325Z` 开始，56.932 秒全部通过，unexpected/flaky/skipped 均为 0，4 个 console 附件零 errors/warnings。覆盖默认模式真实关节选择/旋转/写 K 与候选隔离、Root 世界箭头/写 K/撤销/保存恢复/旧场景兼容、320/390px 的 44px 操作入口与同帧工具保稿、真实取消与 CDP 多触点后的选点/相机恢复。桌面和手机截图从此单轮流程获取；未额外跑公网整套或截图会话。

功能源码为 [88ad1fdf4e0ac75ead076848d933660b62e98e07](https://github.com/DFerryman/ChoreographyStudio/commit/88ad1fdf4e0ac75ead076848d933660b62e98e07)，47 文件 tree `2ecc71a948dc7277a0c2c1b0a819a0f9e211f320` 与本地完全一致，保留原 MIT 和提交历史。[源码 CI run37574696859](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37574696859) 已实际 completed/success，更新时间 `2026-10-07T05:11:10Z`；npm ci、check/构建、Worker 类型、Chromium 与完整 18 项 e2e 全部通过，失败产物上传按条件 skipped。本轮 [#7](https://github.com/DFerryman/ChoreographyStudio/issues/7) 的退出条件完成；旧 #5/#6 保持完成。此处为后续纯 Markdown 回填，不触发重复源码 CI。

操作仍先形成浏览器内 Pose 草稿，显式写 K 才修改权威动画；正式轨道、原音频和视口/工具设置按 Scene 保存，没有云保存或 D1 写入。详细本地首轮失败、相关复核和当前 CI 结论见 [VERIFICATION.md](VERIFICATION.md)。

## 历史 P1 version 5 验证

上一轮 version `2fac9fa5-5387-425c-9bbb-23a5379d162d`、deployment `1479fdaf-2aa0-44f1-a5dc-10e3f58b1624` 于 `2026-10-06T15:13:08.85059Z` 发布；模块 345890 bytes，SHA-256 `508ed426ae18b0c74e300c14068513ffa3611b80a97752bfff16d441569c92e8`。以下检查与资产均对应该历史版本。

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
