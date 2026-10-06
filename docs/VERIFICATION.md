# 预览验证记录

日期：2026-10-06。对象为当前仓库的原创合成预览，不是原工程包 2.1.0、真实动作或教学发布验收。

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

## P1 手动关键帧 · 已部署，完整线上与CI验收中

用户已授权继续写帧与骨骼编辑，规则见 [MANUAL_KEYFRAMES.md](MANUAL_KEYFRAMES.md)。本轮检查需覆盖固定时长与精确末帧、局部四元数/Root 插值、稀疏轨和不可变基底、显式草稿提交与保护、版本/候选失效、撤销及 Scene 保存恢复、旧 take 不重烘焙，以及站姿和模板固化边界。

本轮 `npm run check` 已实际通过 52 项检查：22 项原 core、16 项手 K、7 项 API mock、7 项 IndexedDB；生产构建与 Worker 类型检查通过。手 K 的资源检查区分 4096 条轨键与输入/输出各 6001 个显式样本；编辑 UI 删除当前帧全部显式轨键，单轨删除只由 core API 提供。

14 项本地浏览器首轮执行发现测试 fixture 的统一 dialog dismiss 会在 reload 时拒绝 beforeunload，导致导航阻塞；该轮已中止，失败/中断报告保留。仅修正测试脚本为 beforeunload accept、其他 dialog dismiss，生产代码未改。

第二轮于 `2026-10-06T14:56:35.348Z` 开始，219.4 秒完成，13 项通过、1 项 unexpected，0 skipped/flaky；旧 10 项及新增 A/C/D 均通过，C 的延迟保存分支确认保存过程中仍可编辑。流程 B 的测试脚本使用 `poses[45]`，错误假设输出为完整 30 fps 均匀数组；实际契约保留基底非均匀 times 并加入显式键，8 样本 fixture 因此触发测试侧 TypeError，非页面运行错误。生产 bundle 未变，B 修正后的单项复核仍在执行。当前不将第二轮记为 14 项一次全绿，也不再跑整套抹去这次失败。

B 后续复核还发现测试选择的 4–8 秒区间只有边界、没有内部样本，原替换规则会明确拒绝。测试调整为先确认拒绝且权威动画不变，再选择包含内部样本的 0–4 秒区间检查固化、取消、范围外与撤销；生产核心和旧 source 均不修改或密化。

最终 B 单项于 `2026-10-06T15:05:19.710Z` 开始，测试用时 26.130 秒、报告总时长 28.122 秒，1/1 通过，无 skipped/unexpected/flaky，报告 errors 为空。由第二轮 13 项与最终 B 单项组成的本地 14 项范围均有通过证据；先前尝试、失败与脚本修正记录保留，不把它改写成一次 14 全绿。这些浏览器脚本修正未改生产逻辑。

随后 8 状态布局检查均无横向溢出或 console 错误。视觉审阅发现 390px 的提示略盖头，仅调整 `Stage.css` 的手机提示位置/内距并重新构建；最终 320/390px 对应截图已针对性复核，头部无遮挡，无横向溢出或 console 错误。最终 JavaScript SHA-256 与此前功能已测版相同，只有 CSS/HTML 改变，Worker/API 未变；没有为该小样式改动重跑整套。本地范围已放行，正式部署及其证据仍待记录。

本轮 version 5 已实际发布：version `2fac9fa5-5387-425c-9bbb-23a5379d162d`，deployment `1479fdaf-2aa0-44f1-a5dc-10e3f58b1624`，100% 流量，`2026-10-06T15:13:08.85059Z`。下载模块200、345890 bytes，SHA-256 `508ed426ae18b0c74e300c14068513ffa3611b80a97752bfff16d441569c92e8` 与生成器完全一致。`2026-10-06T15:14:55.350Z` 的必要单轮7HTTP全部通过：4资产内容/安全headers、health/capabilities 200与POST projects 501。

唯一完整线上14项与本轮GitHub功能源码/CI正在验收，尚不关闭 [#6](https://github.com/DFerryman/ChoreographyStudio/issues/6)。当前实际bindings仍仅API_RATE_LIMITER与RELEASE_STAGE，无D1/KV/DO/Cloudflare ASSETS；没有新增业务API、公网429 burst或高频验证。上述version4证据保留为历史，不代替P1验收。
