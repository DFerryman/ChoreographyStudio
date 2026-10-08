# 预览验证记录

日期：2026-10-06 至 2026-10-08。对象为当前仓库的原创合成预览，不是原工程包 2.1.0、真实动作或教学发布验收。

## 当前 version 11 · 简洁手动编辑、实体人体与关节限位

用户本轮明确暂停 AI 接入，优先经典手动编辑器、少量必要操作与清楚层级；要求更像人的模型和真实限制，并全面评估 IK、接触、体重与重力。首次使用/新场景默认手动，旧场景按原数据恢复；新增快捷键、音乐异步所有权保护、按需展开的次要操作、原创实体成人 mannequin 和新编辑姿态的统一关节包络。实现契约见 [MANUAL_EDITOR.md](MANUAL_EDITOR.md)、[MANUAL_KEYFRAMES.md](MANUAL_KEYFRAMES.md)，后续真实编舞方案见 [REALISM_PLAN.md](REALISM_PLAN.md)。

### 本地检查与保留的失败

简洁手动界面源码 [a3b0b20c](https://github.com/DFerryman/ChoreographyStudio/commit/a3b0b20ce8b7b0259970b290a206e0133919eb8d) 的 107 项 foundation、前端/Worker 类型、生产构建与离线 dry-run 已通过。首轮完整 58 项本地浏览器于 `2026-10-08T03:32:57.493Z` 开始，用时 544.581 秒，55 项通过、3 项失败；没有记作一次全绿。两项旧手势 fixture 在展开信息和下载后的画布坐标过期、相机 popup 未关闭，实际触点没有命中 canvas；测试关闭 popup、重取矩形并断言命中后，相关 2 项用时 24.956 秒通过。另一个组合按键测试在镜像控件折叠时错误尝试聚焦，明确展开后单项 6.3 秒通过；原隔离断言保留。独立 [CI run37724093326](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37724093326)、attempt1、精确 head a3b0b20c 于 `2026-10-08T03:55:30Z` completed/success，真实日志为 107 foundation 和完整 58 浏览器通过（10.9m），无 workflow rerun。

实体人体/统一限位功能源码为 [e02b76ba](https://github.com/DFerryman/ChoreographyStudio/commit/e02b76bab054120b31314622cf416d752e847b6f)，本地和远端树 `f55ecb4ac9c4c0d1031da0048063500a08d9c75e` 完全一致。`2026-10-08T03:55:24` 的最终 `npm run check` 为 8 文件、161/161 foundation（107 既有与 54 新约束检查），1.18 秒，并通过前端类型和生产构建；Worker 类型继承本轮已验证且未改变的 API，最终离线 dry-run 通过。构建保留 Three.js 大 chunk 提示，这不是具名设备性能验收。

人体变更的 framing、手 K、姿态复用、轨道范围共 20 个既有浏览器流程，首轮 11 通过、9 因旧代理 Vite 进程退出而连接拒绝；重启根代理持有的服务器后只复核这 9 项，9/9 通过（约 1.9m），没有改旧功能断言或把网络失败当成功。新增约束 4 项最终全部通过，41.5 秒：肘/膝数值与滑条、组合包络、新 K 保存恢复；旧超限姿态权威性及 Root-only、粘贴和取消；真实 X 旋转环跨界到精确 −145°、腕部渲染位置、显式 K、其他关节和相机保护；320/1440 实体表面像素与无溢出。四份实际 diagnostics 的 errors/warnings/API 请求均为 0。

真实拖拽 fixture 首次按屏幕弧长估算角度只到 −112.7°，未真正跨限；随后预设 −140° 时原拾取点被 Z 环遮挡，前两次恢复停在 X 轴选择断言。最终测试实际寻找可见 X 环，再短拖跨界，保留精确 −145° 和全部原数据/相机断言；单项 13.7 秒通过后才执行上述完整 4 项。没有放宽到“角度未越界即可通过”。早期并行视觉捕获遇到尚未合并 import 的 ReferenceError；补齐后类型/构建和最终截图均通过，该失败图不作为成功证据。

音乐异步旧结果覆盖新选择在修正前有实际失败复现；相关 7 项及快捷键 9 项最终由本地修正复核和 a3b CI 完整范围覆盖。所有首轮/中止/失败证据保留在忽略的 work 目录，未上传音乐、凭据、构建、截图或临时 payload。原 MIT 和提交历史保留。

### 实际 Cloudflare 验证

version 11 `f245eba5-7cda-4950-bda7-f0cae576368b`，首次 deployment `35663e67-deea-4c11-913d-5193c85a440b`，`2026-10-08T04:25:42.945845Z`，100% 流量。仅一次真实 multipart 运行模块上传，模块 378822 bytes、SHA-256 `2d412af1988a21fc62359903228e4bad8ad877c53a60ca066f26f5d923a3487a`；实际下载模块内容与生成物一致。settings/version 仍仅原生 API_RATE_LIMITER 20/60 与 RELEASE_STAGE，无 D1/KV/R2/DO/真实 ASSETS。运行代码与四个 gzip 资产由同一构建生成，详见 [DEPLOYMENT.md](DEPLOYMENT.md)。

首次 Python 默认 User-Agent 的首页请求返回 Cloudflare 403/error1010；一次诊断确认是 Browser Integrity 检查，未进入 Worker 资产验证。没有修改 Cloudflare 安全配置。标准浏览器 UA 的有界 5 HTTP 于 `2026-10-08T04:26:40.306412+00:00`–`04:26:40.916729+00:00` 全通过：四个最终 dist 资产逐字节/哈希/安全 headers 一致，health 为 200/status ok/no-store。没有请求 capabilities、POST、限频 burst 或 D1 写入；上述两次 403 首页尝试与成功的 5 项区分记录。

唯一相关线上 8 项于 `2026-10-08T04:26:41.502Z` 开始，58.052 秒全部通过，unexpected/flaky/skipped 与报告 errors 为 0；八份实际 browser diagnostics 的 errors/warnings/API 请求均为 0。覆盖肘/膝输入保存恢复、真实旋转环跨界、320/1440 手动布局和披露保稿、迟到音乐解码隔离、手机 0.5 选段恢复、K/Delete 与撤销重做、真实音频 Space 播放。三张人体/手动布局截图来自同轮，根代理目视审阅桌面和手机图，未另开公网截图或完整 62 项回归。

### 最终源码 CI 与边界

精确 head `e02b76bab054120b31314622cf416d752e847b6f` 的 [CI run37727327279](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37727327279)、attempt1、job113148372205 于 `2026-10-08T04:37:58Z` 实际 completed/success。交叉读取 run/job/steps/真实日志：8 test files、161 passed (161)、构建和 Worker 类型成功；完整 62 项浏览器全部通过（12.8m，browser 步骤 `04:25:10Z`–`04:37:56Z`）。四个新 constraints 流程明确成功，数值/滑条 12.9s、旧姿态与 Root-only/粘贴 11.9s、真实肘部操作环 15.4s、320/1440 实体人体 9.7s。Chromium 安装和 cleanup 成功，失败时才上传的 artifact 按条件 skipped；未 rerun，未将本地结果替代远端成功。

最终九份 Markdown 记录通过纯文档提交进入 main，Cloudflare 复用以上已验证的 version11，在同版 deployment message 中关联最终 main SHA；不再次上传运行模块、触发重复完整 CI 或公网验证。Notion 项目中心、规格、计划、验收和工程流程同步最终源码、CI 与部署凭证，并保留后续能力尚未实现的标记。

人体限位是保守编辑包络，不是完整生物力学证明。加载/播放/保存/撤销/删键/键转移不自动修复旧数据；Root-only 不修复其他关节。当前未实现 IK、脚锁、碰撞、质量/质心、重力或动力预览，新 K 角度合法也不证明整段插值轨迹合法；没有具名设备或教师试跳证据。AI 保持未接入，原生产契约、许可、教学 MP4 与 M0–M3 仍未通过。用户本轮要求与分层方案已同期写入 Notion 五份项目文档，后续新增要求同样同步。

## 首次 S0 执行记录

| 检查 | 实际结果 |
| --- | --- |
| `npm test` | 22 项通过；CountMap 参数/资源边界、数拍定位、SLERP、非均匀末采样、输入不变、局部替换外部等价及手臂方向 |
| `npm run build` | TypeScript 检查与 Vite 生产构建通过 |
| `npm run typecheck:worker` | Wrangler 生成 Env/运行时类型，Worker TypeScript 检查通过 |
| `wrangler deploy --dry-run` | Worker 与静态资源配置打包通过；这个结果不是已上线证明 |
| `npm run test:e2e` | 7 项浏览器流程检查通过，51.8 秒；零 console error 和 pageerror |

运行环境：Node.js 24.19.0，TypeScript/Vite/Vitest 等确切版本锁定在 `package-lock.json`。浏览器为 Chromium 151.0.7922.173，Playwright 1.63.0；本次使用 SwiftShader 软件图形环境。

浏览器检查内容：

- 3D canvas 包含实际画面，播放后姿态截图发生变化；音频与进度推进，暂停后稳定。
- 替换候选未采用时不改原时间线；采用只改选中八拍，撤销/重做可恢复；旧候选不可采用。
- 已是最简单的动作明确提示，不伪造“更简单”的成功。
- 上传原创 WAV、确认数拍、生成、IndexedDB 保存和刷新恢复；恢复的音频 SHA-256 一致，第一数拍 2 秒偏移也被保留。
- 时长越界、超过音频和非整数八拍出现明确错误，确认按钮禁用；改变 CountMap 后清空旧动作与旧历史，再生成新稿。
- 390px / 320px 主页面与音乐设置弹窗没有页面横向溢出。

## 边界

以上是功能与数学验证。没有测量真实设备的输出延迟、蓝牙、帧率或跨生产求值器误差；没有教师试跳或动作许可/接触质量证据。M0–M3 仍未通过，MP4 尚未实现。

## GitHub 发布与 CI

源码已发布到 public 仓库 `DFerryman/ChoreographyStudio` 的 `main`：[首次源码提交 `d05bf5ae1d502b3d32a75b246888ffeca993a56b`](https://github.com/DFerryman/ChoreographyStudio/commit/d05bf5ae1d502b3d32a75b246888ffeca993a56b)。这次首次源码提交的 34 个文件已核验与本地提交树一致，保留原初始提交与未修改的 MIT LICENSE；未发布私有文档、音乐、真实动作素材、凭据或构建/测试输出。

该提交的 [GitHub Actions `Check preview`](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37442000689) 已实际执行并以 `success` 完成。`npm ci`、`npm run check`（22 项 core 检查与生产构建）、Worker 类型检查、Chromium 安装和 7 项浏览器流程检查全部通过。这是独立的远端 CI 结果，不是把本机结果视作远端通过。

## 首次 Cloudflare 在线检查 · version 1/2

2026-10-06 在真实 [Cloudflare 预览](https://choreo-studio-preview.danuberiverferryman.workers.dev/) 运行相同的 7 项浏览器流程检查：全部通过，45.8 秒；零 console warning、console error 和 pageerror。报告记录开始时间 `2026-10-06T10:14:14.082Z`，无跳过、重试或不符合预期的用例。验证涵盖实际 3D/音频播放、八拍候选与撤销重做、候选失效、更简单动作提示、原创 WAV 本地保存恢复、数拍/范围校验，以及 320/390px 布局。

上述浏览器检查在 version 1 完成。随后由可复现生成器发布 version 2：`602fd037-46d4-4982-9691-14fffe497458`，deployment `f8ee52e1-ea1f-4b79-83a0-7b8315b3a93d`，100% 流量。4 个前端资产逐字节未变，原 API handler 保持原样；实际下载的 Worker 模块与 public 生成器输出逐字节一致，SHA-256 为 `ff196b960b592ed0963d0438cef620aac541c8de073a472c22288053a0675130`。

最终部署在 `2026-10-06T10:17:25.057Z` 完成 15 项 HTTP 复验，全部通过：4 个资产的内容与安全 headers、健康/能力读取、未实现 API 的 501、SPA 回退、缺失 JS 的 404、无 gzip 读取、条件请求 304、HEAD，以及保留 headers 配置不公开。没有声称 7 项浏览器检查在 version 2 发布后重跑。

可复现后备生成器的直接检查 39 项、workerd HTTP 检查 25 项、旧/新输出等价与动态 headers 检查 34 项通过。两个 infra 工具的 Node 语法检查通过。具体发布方式、实际 ID、资产 SHA-256 与再现命令见部署记录。

这些结果支持 S0 交互预览闭环。它们不验证真实设备输出延迟、蓝牙、渲染性能、真实动作质量或教学许可；不替代教师、MP4 或原 M0–M3 验收。线上部署的实际版本与检查记录见 [`DEPLOYMENT.md`](DEPLOYMENT.md)。

## S0 工作台与场景迭代 · 已上线验证

本轮重做工作台布局、文字与操作层次、模块间距，以及 3D 舞台。音乐与数拍、动作观看、选中八拍编辑和时间线使用独立模块；新增骨骼节点选择、自由相机、统一坐标，以及多个本机场景与旧数据迁移。保留原交互流程、`preview-1`/`synthetic-demo` 和本地数据边界。这次不接入 S1 的真实动作、原工程契约或生产服务，原 M0–M3 状态不变。

本轮已执行 `npm run check`：36 项检查（22 core、7 API mock、7 本地存储）和生产构建通过；Worker 类型检查通过，Env 包含 `API_RATE_LIMITER`。场景恢复修正后的生产资产为 `assets/index-Ddh52BJG.js`、`assets/index-7EKvYVHx.css`。存储检查覆盖独立音频/相机恢复、复制隔离、选择性改名/删除、一次性 v1 迁移、当前场景标记，以及读写事务中止时拒绝成功。

视觉阶段的本地浏览器 7 项流程在 `2026-10-06T13:20:23.546Z` 开始，68.028 秒全部通过；320/390/768/1440 的主界面、候选和音乐弹窗共 12 项布局复核没有横向或模块溢出，确认按钮均可达，零浏览器错误或警告。同一预览 URL 的 version 3 于 `2026-10-06T13:25:18.181Z` 开始线上 7 项流程，38.752 秒全部通过，零 console warning/error 和 pageerror。

前述视觉验证发生在新增视口/场景功能之前，不能作为新增范围的验收结论。本地新增范围的首轮 10 项检查在 `2026-10-06T13:54:08.426Z` 开始，9 项通过、1 项发现同相机状态跨场景恢复后保存会丢失相机反馈。修正恢复反馈后，实际在 `2026-10-06T13:59:53.218Z` 开始重跑 2 个相关流程，62.308 秒全部通过；本次也执行了后来补充的复制后刷新断言。没有把首轮失败或当时未执行的断言写成通过。

原生 API 限频已完成 Worker 类型检查、7 项纯 mock 检查和 6 项部署 metadata 断言；覆盖 429、保护缺失/失败的 503，以及静态路由不调用保护。线上 settings 实际只有 `API_RATE_LIMITER`（20 次 / 60 秒、namespace `2026100601`）与 `RELEASE_STAGE`；没有 D1/KV/DO，也没有用公网 burst 验证阈值。限频按节点生效且最终一致，不是账户全局费用硬上限。

最终 version 4 为 `03b0f070-6f73-4578-8b93-dafaaf23b90d`，deployment `ad2a639c-3868-4d3d-83fe-466beb702521`，100% 流量。实际下载的 325534-byte Worker 与仓库生成器输出逐字节一致，SHA-256 为 `b13d47093e3fc15f7fc848a58c7c8e3a99dd5c67716c032d90d00f0d4bf718af`。4 个资产、安全 headers、健康/能力读取与项目 POST 拒绝在 `2026-10-06T14:03:59.584Z` 单轮 7 项 HTTP 检查全部通过。

最终 version 4 的完整线上 10 项 Playwright 流程在 `2026-10-06T14:05:04.566Z` 开始，102.922 秒全部通过，无跳过、flaky 或 unexpected；10 个 console attachment 的 errors/warnings 均为空，pageerror 为空。覆盖原 7 项流程及新增相机/骨骼/坐标、多场景音频/相机独立保存与复制新 ID 后刷新/删除、未保存改动保护和模拟 quota 保存失败。只执行这一轮公网流程，没有循环测试或压测。

本轮功能源码已发布：[提交 `127d4cd3eef7349b44d31f8004edca81c9b7115b`](https://github.com/DFerryman/ChoreographyStudio/commit/127d4cd3eef7349b44d31f8004edca81c9b7115b)。远端 40 个文件的 Git tree `9a3104c2fcb5206d641c9aaa0e4b22bbf98e8ac8` 与本地暂存树完全一致，MIT LICENSE 保持原 blob `5a39dbe0352e210c31c6289236e2a9437930ccdb`，保留原提交历史；没有发布私有原文、用户音乐、凭据或生成/测试输出。

该源码提交的 [GitHub Actions `Check preview` · run 37476822139](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37476822139) 已实际完成并为 `success`，run 更新时间 `2026-10-06T14:13:58Z`。`npm ci`、`npm run check`、Worker 类型检查、Chromium 安装与 `npm run test:e2e` 步骤均为 success；失败产物上传按条件 skipped。本段为后续纯 Markdown 回填；main 的纯 Markdown 更新忽略整套 CI，PR 检查不变，不重复已通过的功能验收。

本轮 [#5](https://github.com/DFerryman/ChoreographyStudio/issues/5) 的 S0 范围已经完成线上和远端 CI 退出检查。该交付尚未包含手 K；S1 与原 M0–M3 仍未完成。

## P1 手动关键帧 · 已上线并完成本轮验收

用户已授权继续写帧与骨骼编辑，规则见 [MANUAL_KEYFRAMES.md](MANUAL_KEYFRAMES.md)。本轮检查需覆盖固定时长与精确末帧、局部四元数/Root 插值、稀疏轨和不可变基底、显式草稿提交与保护、版本/候选失效、撤销及 Scene 保存恢复、旧 take 不重烘焙，以及站姿和模板固化边界。

本轮 `npm run check` 已实际通过 52 项检查：22 项原 core、16 项手 K、7 项 API mock、7 项 IndexedDB；生产构建与 Worker 类型检查通过。手 K 的资源检查区分 4096 条轨键与输入/输出各 6001 个显式样本；编辑 UI 删除当前帧全部显式轨键，单轨删除只由 core API 提供。

14 项本地浏览器首轮执行发现测试 fixture 的统一 dialog dismiss 会在 reload 时拒绝 beforeunload，导致导航阻塞；该轮已中止，失败/中断报告保留。仅修正测试脚本为 beforeunload accept、其他 dialog dismiss，生产代码未改。

第二轮于 `2026-10-06T14:56:35.348Z` 开始，219.4 秒完成，13 项通过、1 项 unexpected，0 skipped/flaky；旧 10 项及新增 A/C/D 均通过，C 的延迟保存分支确认保存过程中仍可编辑。流程 B 的测试脚本使用 `poses[45]`，错误假设输出为完整 30 fps 均匀数组；实际契约保留基底非均匀 times 并加入显式键，8 样本 fixture 因此触发测试侧 TypeError，非页面运行错误。生产 bundle 未变，B 修正后的单项复核仍在执行。当前不将第二轮记为 14 项一次全绿，也不再跑整套抹去这次失败。

B 后续复核还发现测试选择的 4–8 秒区间只有边界、没有内部样本，原替换规则会明确拒绝。测试调整为先确认拒绝且权威动画不变，再选择包含内部样本的 0–4 秒区间检查固化、取消、范围外与撤销；生产核心和旧 source 均不修改或密化。

最终 B 单项于 `2026-10-06T15:05:19.710Z` 开始，测试用时 26.130 秒、报告总时长 28.122 秒，1/1 通过，无 skipped/unexpected/flaky，报告 errors 为空。由第二轮 13 项与最终 B 单项组成的本地 14 项范围均有通过证据；先前尝试、失败与脚本修正记录保留，不把它改写成一次 14 全绿。这些浏览器脚本修正未改生产逻辑。

随后8状态布局检查均无横向溢出或console错误。视觉审阅发现390px提示略盖头，仅调整Stage.css手机提示位置/内距并重新构建；最终320/390px截图已针对性复核，头部无遮挡，无横向溢出或console错误。最终JavaScript SHA-256与此前功能已测版相同，只有CSS/HTML改变，Worker/API未变；没有为小样式改动重跑整套。正式版本证据如下。

本轮 version 5 已实际发布：version `2fac9fa5-5387-425c-9bbb-23a5379d162d`，deployment `1479fdaf-2aa0-44f1-a5dc-10e3f58b1624`，100% 流量，`2026-10-06T15:13:08.85059Z`。下载模块200、345890 bytes，SHA-256 `508ed426ae18b0c74e300c14068513ffa3611b80a97752bfff16d441569c92e8` 与生成器完全一致。`2026-10-06T15:14:55.350Z` 的必要单轮7HTTP全部通过：4资产内容/安全headers、health/capabilities 200与POST projects 501。

version5唯一完整线上14项于 `2026-10-06T15:16:19.311Z` 开始，190.445秒全部通过，expected14、unexpected/flaky/skipped均为0；14个console附件errors/warnings（含pageerror）均为空。新增4流程覆盖显式姿态/Root写K与草稿保护、旧场景精确恢复和模板固化/取消/范围外/撤销、保存失败及延迟保存中继续编辑、小屏手K操作；延迟保存分支 `editableDuringSave:true`。没有为成功证据重跑第二轮公网流程。

功能源码为 [7a19fbdd9c6b6c8911fa294675de1dca6bcfa29a](https://github.com/DFerryman/ChoreographyStudio/commit/7a19fbdd9c6b6c8911fa294675de1dca6bcfa29a)。47文件Git tree `a9cbdbaa427e962c345d043fc1a282c39eff8842` 与本地暂存完全一致，原MIT blob `5a39dbe0352e210c31c6289236e2a9437930ccdb` 与提交历史保留；不包含私有文档、音乐、凭据或生成/测试输出。

该源码的 [GitHub Actions run37486474465](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37486474465) 已实际completed/success，run更新时间 `2026-10-06T15:22:04Z`；npm ci、check/生产构建、Worker类型、Chromium安装与e2e全部success，失败产物上传按条件skipped。本段及交付状态仅通过后续纯Markdown回填，main paths-ignore避免重复已通过的整套CI，PR检查不变。

[#6](https://github.com/DFerryman/ChoreographyStudio/issues/6) 的本轮P1退出证据已齐。实际bindings仍仅API_RATE_LIMITER与RELEASE_STAGE，无D1/KV/DO/Cloudflare ASSETS；没有新增业务API、公网429 burst或高频验证。version4证据保留为历史，不替代P1验收；S1及原M0–M3仍未完成。

## 2026-10-07 关节操作入口与 Root 箭头 · version 6 已上线并验收

本次修正默认编排模式选中关节后没有直接编辑入口：选中区域与舞台工具栏提供旋转/整体移动操作、Root 世界空间 XYZ 箭头及数值与写 K 跳转。关节继续父相对旋转，Root 只作整体位移；同帧切工具保留草稿，候选/镜像/教学的显式编辑入口返回原稿。core、API 和部署辅助工具未改，不新增 D1 或业务 API 调用。

`npm run check` 的 52 项既有检查与生产构建通过，Worker 类型检查通过。实际音频位置对齐的 App 改动随后落盘；视口取消/触点修正及手机样式全部落盘后，最终生产构建于 `2026-10-07 05:01:11 UTC` 通过。未改 core/API，不重复既有数学与 API 检查；前一次构建不视为最终资产。

本地唯一完整 17 项浏览器检查于 `2026-10-07T04:53:39.824Z` 开始，232.871 秒完成，16 项通过、1 项 unexpected，0 flaky/skipped。新增 Root 测试已经完成真实 X 箭头 hover/拖动和草稿检查，失败发生在骨长/位置断言的基准采样：列表 selectOption 已更新 React 选择，而舞台下一次 RAF 前公开坐标仍属于先前节点。trace 确认这是测试采样竞态，修正测试为等待 4 个不同节点的公开坐标完成反馈，再使用原有 0.002 米容差检查；不修改产品或放宽容差。

受影响的 Root 和手机两项于 `2026-10-07T04:57:50.336Z` 开始针对性复核，35.404 秒完成，2/2 通过，无 unexpected/flaky/skipped；手机同时检查新增 44px 操作按钮。Root 检查保留原有坐标容差，覆盖权威动画不变、相机与骨架保护、显式写 K、撤销、工具/旧场景兼容与原音频保存。

独立视口审阅随后发现实际拖动取消的 pointer bookkeeping 及第二触点隔离问题。产品修正取消时的拖动/触点清理，并隔离受到第二触点打断的手势组直到所有触点抬起；不让原生 TransformControls 的第二触点改写或结束第一触点操作。新增一项真实取消/多触点回归。

最终仅对新增手势和受影响的原相机流程做针对性复核，于 `2026-10-07T05:02:09.982Z` 开始，33.240 秒完成，2/2 通过，无 unexpected/flaky/skipped。检查使用真实 CDP touch 事件验证 Root 拖动被第二触点打断时姿态/相机保持、之后双指相机手势恢复；按住鼠标切换工具并在画布外松开后，实际选点、相机和新的 Root 拖动恢复。共 18 项本地范围由首轮 16 项和两次相关复核组成，21 个 console 附件均为零 errors/warnings；保留首轮失败与脚本修正，不改写成一次 18 项全绿。

本次 version 6 已实际发布：version `68f57f01-3e85-4811-a577-83a9e879d854`，deployment `3e4d1b20-04a7-477b-bf3d-9da12bb4b77e`，100% 流量，`2026-10-07T05:03:42.985483Z`。下载模块返回 200，349962 bytes，SHA-256 `7247fe5be3a50f606bf9ad6032e79264e1eaea8ff67829344ec0d9eff4e87dc2` 与生成物一致。`2026-10-07T05:04:47.316968Z` 的必要单轮 7 HTTP 全部通过：4 资产的内容/安全 headers、health/capabilities 200、项目 POST 501；无 D1/KV/DO/R2/真实 ASSETS 绑定或公开写入。

唯一相关线上 4 项于 `2026-10-07T05:05:54.325Z` 开始，56.932 秒全部通过，expected 4，unexpected/flaky/skipped 均为 0；4 个 console 附件均零 errors/warnings。覆盖真实选点后的直接旋转/K 与候选保护、Root 世界箭头/K/撤销/保存/旧场景、手机 320/390px 与 44px 按钮及同帧工具保稿、实际鼠标取消和 CDP 多触点隔离/恢复。新桌面和手机截图均从同一流程获取，不另开公网截图或重跑旧完整套件；未改范围沿用已有证据。

功能源码已发布：[88ad1fdf4e0ac75ead076848d933660b62e98e07](https://github.com/DFerryman/ChoreographyStudio/commit/88ad1fdf4e0ac75ead076848d933660b62e98e07)。47 文件远端 tree `2ecc71a948dc7277a0c2c1b0a819a0f9e211f320` 与本地暂存完全一致，保留原 MIT blob `5a39dbe0352e210c31c6289236e2a9437930ccdb` 和提交历史；不含私有文档、用户音乐、凭据或生成/测试产物。

[GitHub Actions run37574696859](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37574696859) 已实际 completed/success，head 与上述功能 SHA 一致，更新时间 `2026-10-07T05:11:10Z`。npm ci、check/构建、Worker 类型、Chromium 和 e2e 全部 success，失败产物上传按条件 skipped；job logs 明确为 `18 passed (3.8m)`，是一次完整源码 CI。此结论与本地 16/17 后相关复核的记录分别保留，未将本地失败抹去。

[#7](https://github.com/DFerryman/ChoreographyStudio/issues/7) 的本轮退出证据齐全，后续只提交实际验收的 Markdown 回填，main 的 paths-ignore 不重跑整套源码 CI。上一轮 v5 证据保留为历史，不代替本次验证；core/API/infra 不变，没有公网 429 burst、高频或 D1 写入测试。S1 及原 M0–M3 仍未通过。

## 2026-10-07 按轨查看、定位和删除 · version 7 已上线并验收

本轮补齐选中关节/Root 的显式键状态与单轨删除、全部/选中关节/Root 时间线筛选，以及严格上一/下一显式 K。筛选只改变视图，不写历史或扩展场景契约；待执行删除绑定原来的轨、关节和帧，缺键不提交。core、API、限频及基础设施未改，编辑和保存留在浏览器。阶段跟踪为 [#8](https://github.com/DFerryman/ChoreographyStudio/issues/8)。

`npm run check` 的 52 项既有检查与生产构建通过；最终 CSS 权重修正后再次生产构建通过，最终资产为 `assets/index-C_Hml5-F.js` / `assets/index-C2d_8p-4.css`。Worker 类型检查通过。首次 Wrangler dry-run 因默认日志/配置目录 `/home/agent/.config/.wrangler` 不存在而启动失败；将该离线打包的日志与配置目录指定到 `/tmp`、关闭 telemetry 后 dry-run 通过，没有发布请求或源码修改。保留首次失败，不将其写成一次成功。

本地单轮 7 项浏览器检查于 `2026-10-07T06:42:49.773Z` 开始，143.118 秒全部通过，unexpected/flaky/skipped 均为 0，7 个 console 附件零 errors/warnings。新增 4 项覆盖单关节删除保留同帧其它轨、Root 删除与空键/末端边界、过滤及跳 K 草稿保护、320/390px 触达/无横向溢出/音频及完整历史保存重开；另外复核 3 个既有流程：旧 v4 精确动作与音频、草稿/保存失败、小屏及真实旋转环/相机隔离。4 个新增流程均实际没有 API 请求。

补充 Root 删除的「写入完整姿态后继续」断言，针对性检查它先写完整姿态再只删 Root、保留 19 旋转与两次提交、撤销重做；该新增分支首轮于 `2026-10-07T06:46:07.204Z` 开始，183.551 秒后超时：脚本在撤销/重做按既有规则回到 0 帧后，未返回有键的 90 帧就点击已禁用的全帧删除。完整姿态写入与仅 Root 删除的前置断言已通过；测试增加明确跳回 90 帧，最终 Root 单项于 `2026-10-07T06:50:05.829Z` 开始，23.945 秒全部通过，零 unexpected/flaky/skipped，console 零 errors/warnings、无 API 请求。产品代码未因这次脚本错误改变，首次失败保留。线上与源码 CI 的实际结果如下，不用旧 v6 证据替代。

线上首次尝试于 `2026-10-07T06:56:30.813Z` 开始，10.823 秒内 4 个页面导航均遇到 `ERR_CERT_AUTHORITY_INVALID`，尚未进入编辑流程；这不是功能通过记录。执行环境的公开代理 CA 公钥 SHA-256 与已有在线 Chromium 包装器的受信 SPKI `n9jEr2dCP1tg9exQzr7xEpZ4TjG2QWO02LUFhmAzII4=` 核对一致；恢复此前已验证的在线浏览器启动配置，保留继承代理和限定证书信任，仅重试这 4 个相关流程，实际结果见下文。没有修改应用或再次上传部署，也未重跑未改范围。

最终 v7 为 `2eb92bb1-7d34-448b-afae-3dfd4c0d28e4`，首次功能 deployment `5e4bde38-3f4f-476f-8374-4fe410b36878`，100%，`2026-10-07T06:55:05.960593Z`。实际下载模块 352118 bytes，SHA-256 `62663af9260aa723948941accc93afc7f276e8b115379fdec0491a4b377363a1` 与生成物逐字节相同；单轮 5 HTTP 于 `06:56:18.166541Z`–`06:56:19.093700Z` 通过，4 资产哈希/安全 headers 一致、health 200。API/infra 未变，未重复 capabilities/POST 或限频 burst。

恢复受信在线浏览器后，实际进入功能流程的一轮相关 4 项于 `2026-10-07T07:00:25.215Z` 开始，63.861 秒全部通过，unexpected/flaky/skipped 均为 0，4 份 console 零 errors/warnings/pageerror，API 请求均为 0。完整覆盖本次单轨删除与基底恢复/其它轨保留、Root 草稿取消/放弃/写入完整姿态后仅删 Root、过滤及相邻 K/草稿保护、320/390px 44px 触达和正式轨/历史/原音频保存重开。桌面和手机截图从这同一轮获取，未另开公网截图会话或重跑未变的整套。浏览器为软件 Chromium/SwiftShader，不将其作为目标设备性能或教学质量证据。

[功能源码 b6dbd231](https://github.com/DFerryman/ChoreographyStudio/commit/b6dbd231a17d4da58ee5f78e122960542da4edb2) 已推送 main，48 文件 Git tree `aac22eb577548698d1bf77cc6e5c31254d5df7ea` 与本地一致，原 MIT blob `5a39dbe0352e210c31c6289236e2a9437930ccdb` 和历史保留；未提交私有文档、用户音频、凭据或生成/测试输出。[真实 GitHub Actions run37584120545](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37584120545) 已 completed/success，head 为本轮功能提交，更新时间 `2026-10-07T07:00:09Z`。npm ci、52 项检查/构建、Worker 类型、Chromium 及完整 e2e 步骤均成功；原始日志明确 `Running 22 tests` / `22 passed (5.0m)`，失败产物上传按条件 skipped，没有触发 CI 重跑。

本轮 [#8](https://github.com/DFerryman/ChoreographyStudio/issues/8) 范围验收完成。当前 binding 仍仅原生 API_RATE_LIMITER 和 RELEASE_STAGE，无 D1/KV/R2/DO；所有编舞、手 K 与 IndexedDB 保存仍在本机，本轮不新增 D1 写入。最终验证记录通过纯 Markdown 提交回填，不重复源码 CI；Cloudflare 同版部署 message 关联最终文档提交，复用以上未变的运行版本和有效检查。S1 真实内容/原契约、教师、MP4、云端场景及 M0–M3 按原门槛保留。

## 2026-10-07 场景内姿态复用 · version 8 已上线并验收

本轮只补充当前原稿/草稿的内存复制，以及关节旋转或旋转加 Root 粘贴。粘贴仍为草稿，显式 K 才提交；保留目标六个只读末端。复制缓冲不进入场景、历史或 JSON；应用场景、确认改音乐及刷新清空。core、Stage、API、基础设施和既有数据契约均未改。

`npm run check` 于 11:09:19 UTC 执行：52 项既有检查与 TypeScript/Vite 生产构建通过。实现最终状态另经 `npm run build` 通过；Worker 类型及使用临时日志/配置目录的 Wrangler 4.147.0 离线 dry-run 通过。构建保留既有超过 500 kB 的 chunk 提示，未把它当作性能达标或已上线证据。

本地单轮新增 4 项于 `2026-10-07T11:12:23.918Z` 开始，84.161 秒全部通过，unexpected/flaky/skipped 和报告 errors 均为 0；四份浏览器诊断的 errors/warnings/API 请求均为 0。覆盖来源草稿与独立复制缓冲、只粘旋转保留 Root、目标 6 个末端保留、部分/完整 K、相同粘贴无草稿/提交、已有草稿取消/放弃/写入后继续、旧 take 超界 Root 粘贴限制、撤销重做、保存重开原音频 SHA、缓存清空和 320/390px 新控件 >=44px/无页面横向溢出。

[功能源码 `200f943b`](https://github.com/DFerryman/ChoreographyStudio/commit/200f943b751b519ae6c19f31b744e4638fc3da18)已提交并 push；49 文件 tree `d0291d2c32ccb122f57fff7b93388d2cfef53176` 与本地完全一致，原 MIT 和历史保留，没有私有文档、用户音频、凭据或构建/测试输出。[实际源码 CI run37613142651](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37613142651) completed/success，`2026-10-07T11:24:56Z` 更新；npm ci、52 检查/构建、Worker 类型、Chromium 和完整 26 项 e2e 均通过，日志明确 Running 26 tests / 26 passed，未触发重跑。

v8 version `bc806141-6418-44f7-b4c3-f6003ad48dcd` / 100%，首次功能 deployment `ebc26399-df3b-4b50-8de7-fb44b7f71821`，`2026-10-07T11:19:12.561597Z`。实际下载模块 353666 bytes / SHA-256 `1b182013eb22915c5cf94a8d0f2feca02231912e29d827696971071dfcff1d78` 与最终生成物相同；4 资产逐字节对应最终 dist，版本 message 关联完整功能 SHA。唯一 5 HTTP 于 `11:20:25.454604Z`–`11:20:27.111684Z` 全通过，4 资产 bytes/hash/安全 headers 相同，health 200/no-store。

实际新增线上单轮 4 项于 `2026-10-07T11:20:44.256Z` 开始，74.446 秒全通过，unexpected/flaky/skipped/报告 errors 为 0；四份诊断 errors/warnings/API 请求均为 0。320/390px 新操作 >=44px、无横向溢出，正式键/历史及原音频 hash 保存重开一致。桌面/手机截图来自同一轮，未另开公网截图或完整回归会话。

API bundle 与 v7 逐字节相同，实际仍仅原生限频 20/60 和阶段变量，has_assets=false，无 D1/KV/R2/DO；未重复 capabilities/POST 或公网限频 burst。本轮编辑/存储留在浏览器，不新增 D1 写入。最终纯 Markdown 验证回填也提交 push，并以同一已验证 v8 runtime 的部署 message 同步最终提交；运行资产未变，复用有效检查。此范围不关闭真实内容、教师、云端场景、MP4、原工程契约或 M0–M3。

## 2026-10-07 相机全身取景与关节聚焦 · version 9 已上线并验收

本轮以当前可见骨架计算取景，包括草稿、镜像、候选和教学观看；保留相机方向，按实际视口宽高比留边。关节聚焦包含只读末端。只修改观看状态，沿用现有 camera 保存；没有动作提交、草稿清空、暂停播放或自动跟随。一次性请求不在跳帧、变姿态或调整视口后重放，切场景清空请求并恢复对应相机。取景前安全取消操作柄/相机手势，保留草稿和触点隔离。

最终源码的 `npm run check` 已通过 60 项检查（原 52 项加 8 项透视取景数学检查）及生产构建；Worker 类型与临时日志/配置目录下的离线 dry-run 通过。数学检查用前/背/侧/俯/斜视和窄/宽实际比例，正向投影全部边界角点并检查留边、方向、近裁面和导航距离；无效/退化输入有独立断言。保留既有 500 kB chunk 提示，软件图形检查不代表目标设备性能。

本地首轮新增 4 项于 `2026-10-07T13:12:49.315Z` 开始，90.223 秒完成，3 项通过、1 项为脚本格式断言失败：Root 数字 -5 显示为 -5.000，脚本原本比较字符串。取景、镜像/末端/教学、手机/候选/继续播放均通过；四份诊断 errors/warnings/API 请求均为 0。改为数字比较后，受影响的草稿/保存流程于 `13:14:57.231Z` 开始，29.689 秒通过。随后为确保按住指针的操作发生在真实可见画布上，补充脚本滚动回画布和选择保留断言，仅复核该受影响流程；最终受影响流程于 `2026-10-07T13:16:22.364Z` 开始，29.495 秒通过：真实可见画布上的持有指针在取景后继续移动不会误操作，关节选择保持，松开后新相机平移可用；草稿/缓存、显式 K、相机保存/刷新、切换场景和原音频 SHA 一致。4 个不同新增流程由首轮 3 项和最终相关复核覆盖，errors/warnings/API 为 0，保留各次报告而不称首轮全绿。源码与线上发布证据如下。

阶段 [#10](https://github.com/DFerryman/ChoreographyStudio/issues/10) 的本机相机范围已验收。core/API/infra 未变，取景与 IndexedDB 保存均留在本机，无 D1 写入。原契约、真实内容、教师、MP4 与 M0–M3 继续按原门槛。

[功能源码 `b4381724`](https://github.com/DFerryman/ChoreographyStudio/commit/b43817249a9ade4e68bc9900ef273b3e47fdec0f) 已 push main，52 文件 tree `8e28626bbfb875837f61a4529c5b857165ecea0c` 与冻结暂存树完全一致；保留 MIT 和历史，没有私有材料、用户音乐、凭据或生成产物。[源码 CI run37627848531](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37627848531) 实际 completed/success，`2026-10-07T13:27:45Z` 更新；npm ci、60 项检查/构建、Worker 类型、Chromium 与完整 30 项浏览器流程通过，原始日志为 Running 30 tests / 30 passed (5.4m)，没有重跑。

v9 version `4f83a485-6508-4f10-9e8e-6a3b0c8ec796` / 100%，首次功能 deployment `fc8c7bcb-378b-4d15-9f68-639bb7179db4`，`2026-10-07T13:22:43.653545Z`。实际模块 355346 bytes / SHA-256 `d39e30c0e5c52f925a3a53bc2590bd151a7fa8b8e0fb0dbf5706d904ea3a8add` 与生成物一致，资产对应最终 dist，版本 message 含完整功能 SHA。唯一 5 HTTP 于 `2026-10-07T13:23:52.194430+00:00`–`2026-10-07T13:23:53.167641+00:00` 全通过，四资产哈希/安全 headers 与 health 200/no-store 相符；没有重复未改 API 或限频 burst。

本轮实际相关线上单轮 4 项于 `2026-10-07T13:24:30.561Z` 开始，53.841 秒全部通过，unexpected/flaky/skipped/报告 errors 为 0；四份诊断 errors/warnings/API 请求均为 0。包括可见草稿/镜像/候选/教学与只读关节、方向和投影边界、持有指针打断/恢复、播放不暂停、相机保存/切场景与不重放、320/390px 无溢出和 44px 控件。桌面/手机截图来自这一轮，没有额外公网会话。

实际仍只绑定原生 API 限频 20/60 与阶段变量，无 D1/KV/R2/DO/真实 ASSETS。最终验证 Markdown 也提交 push，并以同一已验证 v9 的 deployment message 同步最终文档 SHA，复用未变运行资产和有效检查，不重跑公网或 CI。AI 前完整场景备份、K 时刻操作及模态完善另由 [#11](https://github.com/DFerryman/ChoreographyStudio/issues/11) 开发；原生产门槛继续保留。


## 2026-10-07 AI 接入前本机闭环 · version 10 已上线并验收

本輪由 [#11](https://github.com/DFerryman/ChoreographyStudio/issues/11) 跟踪，新增带原音频的 `.choreo` 完整场景备份/新 ID 事务恢复、旧 JSON 原曲关联和已有场景缺失音乐恢复、显式 K 的按范围移动/复制及冲突确认、顶层模态键盘焦点。备份保留精确 Take、manual/baseTake、CountMap、历史和相机，不从 plan 重新生成；草稿先明确处理，教师记录清空，原场景不覆盖。

107 项检查（7 文件）通过：原 52、v9 取景数学 8、完整包/旧备份解析与资源约束 38、键转移 9。严格 codec 接受合法旧的稀疏非均匀动作，不要求每个八拍边界存在采样；校验临时烘焙不替换原始动作。生产构建、前端/Worker 类型和离线 Wrangler dry-run 通过。`/tmp/choreo-preai-worker/index.js` 与 v9 API bundle 逐字节相同，未改变服务器业务接口/限频。

新增 8 个不同浏览器范围的首轮于 `2026-10-07T13:32:10.743Z` 开始，230.788 秒，7 通过/1 unexpected；失败是手机脚本期望响应式隐藏的状态节点可见，正式保存已成功。修正为可见保存按钮状态后，`2026-10-07T13:39:26.169Z` 开始的相关手机单项 10.678 秒通过。保留一次 `^mobile` grep 未匹配 0 测试的报告，不作功能通过证据。首轮 8 加手机复核 1 共 9 份浏览器 errors/warnings/API 请求诊断均零。

新增原音乐缺失恢复分支只复核既有旧备份流程：初次受本地 webServer 沙箱启动限制，`2026-10-07T13:52:24.660Z`、0 测试/0.931 秒，不作验收；授予本地监听所需网络权限后，`2026-10-07T13:54:21.108Z` 开始，39.066 秒相关单项通过，unexpected/flaky/skipped/报告 errors 和本轮 1 份 errors/warnings/API 诊断均零。实际覆盖音频空 src、停止播放与禁保存/完整包、拒绝仅覆盖选段的错误时长原曲、草稿显式写 K 后带最新历史/相机恢复到新 ID，以及旧保存场景仍为原项目且 audio=null。未扩大全部本地回归，也未调用业务服务。

本地截图取自上述既有流程，桌面和手机已视觉检查，无额外浏览器截图会话。离线生成模块 370986 bytes，SHA-256 `be024bed5d7b45667436e28099f2a57eed604cf77f0997b67049f6cf8ae71d87`。功能源码与 Cloudflare 已实际发布，相关公网流程通过；首次实际源码 CI 37/38 的测试坐标失败及修正保留；新精确源码 CI 已实际 completed/success，107 检查及完整 38 流程通过。原契约、真实内容/许可、教师、生产云场景、实际 MP4 与 M0–M3 仍保留。


功能源码 [9fbc115f](https://github.com/DFerryman/ChoreographyStudio/commit/9fbc115f12d2580ff76b7cf5354fa581081579d8) 已 push，62 文件 tree `1bf1f34a6f79c471eff580416fc79566f6e44e98` 完全对应冻结 22 路径修改，历史/MIT 保留。一个不可变 blob 首次 connector 响应未匹配预期 SHA，仅同对象重试后匹配；没有源修改或 CI 重跑。Cloudflare v10 `6df3fd31-141f-4834-b25c-e871f5a8bbf7` / 100%，功能首次 deployment `aae5ec8b-a8f2-4f39-88d6-8c53d49b02b2`、`2026-10-07T14:06:35.603261Z`，实际模块 370986 bytes / SHA-256 `be024bed5d7b45667436e28099f2a57eed604cf77f0997b67049f6cf8ae71d87` 与生成物相同。发布请求首次自动审批服务因 capacity 未执行；原审批路径同 payload 重试成功，恰一次真实 upload。实际 bindings 只有原生限频 20/60 与阶段变量，无 D1/KV/R2/DO/真实 ASSETS。

单轮 5 HTTP 于 `2026-10-07T14:07:39.746323+00:00`–`2026-10-07T14:07:41.275334+00:00` 完成，4 资产哈希/安全 headers 与 health 200/no-store 全通过。相关单轮线上 8 项于 `2026-10-07T14:07:56.792Z` 开始、140.295 秒全部通过，unexpected/flaky/skipped/报告 errors 为 0，8 份实际 errors/warnings/API 请求诊断均为 0。覆盖完整包精确原音乐/非均匀动作/手 K 历史和相机新 ID 往返、异常包无写入、旧 JSON 原曲关联及已保存场景音乐缺失恢复、手机草稿/容量失败重试、三种轨范围转移/碰撞/撤销/保存、草稿后固定源目标、顶层和嵌套键盘模态及持有指针隔离。320/390px 无横向溢出，新操作保持 44px；截图取自这一轮，桌面/手机已查看，不增加公网截图会话。未重复 capabilities、POST、限频 burst 或完整公网回归，不新增 D1 写入。


首次实际源码 CI [run37633679536](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37633679536) completed/failure，`2026-10-07T14:13:57Z` 完成，107/107 基础检查通过、38 浏览器为 37 通过/1 失败（8 个新增范围全部通过），日志为 `37 passed (8.4m)`。失败只在旧 native gesture recovery 测试的相机变化等待；实际失败 artifact/trace 保留，未重跑该 workflow。

trace 精确确认脚本在 `(123, 0, 956, 826.984375)` 读取画布矩形后点击 footer 下载备份，自动滚动使画布 top=-722、bottom=104.984375；旧双指坐标 `(811.32,132.3175)` 与 `(983.4,181.93656)` 都在当前画布下方，因此没有相机手势。主程序/Stage 未变。相关本地原脚本于 `2026-10-07T14:16:51.814Z` 开始、31.409 秒复现相同失败，保留报告。最小修正为最后一次下载后滚回画布、等两帧、重新获取矩形，并明确断言两个起点和移动终点 `elementFromPoint` 都命中真实 canvas；仍发送实际 CDP 双指，保留相机必须变化、原草稿必须不变、后续鼠标/关节/Root 手势恢复等全部原断言。

仅复核相关一项，`2026-10-07T14:18:45.108Z` 开始、39.091 秒通过，unexpected/flaky/skipped/报告 errors=0。该修正只改变测试与记录，不改运行代码或资产；单轮线上 8 项和 5 HTTP 的同模块有效证据继续复用，不新增公网测试/上传或 D1。修正源码 [1719439d](https://github.com/DFerryman/ChoreographyStudio/commit/1719439d993cd893f19c771f90c2cf902ef46886) 已 push，tree `366f97d28b120ea2429985a1fc0f0344bcc2874f`，仅测试与两份记录改变。新的 [实际源码 CI run37636175196](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37636175196) completed/success，job112842877630 于 `2026-10-07T14:29:27Z` 完成；完整日志 107 passed (107)、Running 38 tests / 38 passed (6.0m)，原 native gesture 项明确于 `2026-10-07T14:26:29.1382222Z` 成功（13.2s）。浏览器步骤从 `14:23:24.5684477Z` 到 `14:29:24.6050622Z`，没有 rerun，失败 artifact 步骤跳过。


本轮 AI 前本机编辑闭环全部通过实际功能/源码 CI 验收，完成 [#11](https://github.com/DFerryman/ChoreographyStudio/issues/11) 的本地范围。最终 9 份 Markdown 验证记录也提交 push，再以已验证 v10 的 deployment message 同步最终文档 SHA；运行资产、bindings 和业务代码完全不变，复用有效的实际公网 8 项/5 HTTP 与 corrected-source CI，不重复上传、测试或新增 D1 写入。清单见 [PRE_AI_CHECKLIST.md](PRE_AI_CHECKLIST.md)；原工程契约、真实素材/许可/教师、生产身份/云场景、动作处理和 MP4 与 M0–M3 不因本机闭环完成而通过。
