# 预览验证记录

日期：2026-10-06 至 2026-10-07。对象为当前仓库的原创合成预览，不是原工程包 2.1.0、真实动作或教学发布验收。

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
