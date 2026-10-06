# 八拍 · Choreo Studio

把音乐、八拍和动作放在一个简单的工作台里。按 v2.1 的单人入门编舞范围逐步开发，使用 React、TypeScript、Three.js 与 Cloudflare Workers。

**当前交付：S0 工作台与 P1 本机手动关键帧预览。** 程序化骨架、动作与节奏样例均为原创演示；模板与手 K 不调用生成模型。真实动作、人物素材、教师验收、生产服务和 MP4 尚未接入。当前 `preview-1` 契约不冒充原工程包 2.1.0 的生产契约。

version 5 已上线实际姿态编辑、显式写 K、插值播放和场景保存。52 项本地检查、本地浏览器范围（13 项加最终单项复核）及布局通过；部署单轮 7 HTTP 通过，线上完整 14 项与本次源码 CI 正在验收，具体证据见记录。

P1 删除按钮移除当前帧的全部显式轨键。规则见 [手动关键帧设计](docs/MANUAL_KEYFRAMES.md)，由 [#6](https://github.com/DFerryman/ChoreographyStudio/issues/6) 跟踪；源码 CI 与完整线上验收通过后关闭。

- 在线预览：[打开八拍工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/)
- [阶段计划](docs/ROADMAP.md)
- [实现状态与阻塞](docs/IMPLEMENTATION_STATUS.md)
- [部署与验收记录](docs/DEPLOYMENT.md)

## 这版可以操作什么

工作台将音乐与数拍、3D 舞台、选中八拍编辑、替换候选和时间线分为独立模块，按操作顺序显示主要按钮；桌面与手机使用相同流程。

1. 打开原创 120 BPM 示例，以细杆骨架和球形关节点播放 32 秒、8 个八拍的组合。
2. 点击八拍卡片，生成不同的替换预览；采用、放弃、撤销或重做。
3. 切换正背面、镜像观看、0.5×/0.75×慢放、八拍循环与节拍提示。
4. 读取本地音频，手动设置 BPM、数拍关系和第一数拍；确认完整选段后生成模板初稿。
5. 自由环绕、平移和缩放相机，切换侧面/俯视/正背面并复位；点击骨骼选择节点，查看未镜像的数据坐标。
6. 新建、打开、保存、复制、重命名和删除多个本机场景；分别保存原音频、编排历史、播放位置、相机与视图设置，刷新后恢复；旧版单项目自动迁移。
7. 下载不含音乐的 JSON 编排数据备份。

本地音乐不发送服务器。每个设备/浏览器独立保存；清理浏览器数据会删除本机项目。下载的 JSON 是数据备份，当前尚无导入 UI，请另行保留原音乐。

3D 场景使用右手系、Y 向上、+Z 为角色正面、米单位和 XZ 地面；镜像仅改变观看，节点选择和相机操作不修改动作。P1 不包含 IK、骨长编辑、云保存、真实动作或教学 MP4。

## P1 手 K 操作范围

确认音乐数拍并生成初稿后，切换「手动 K帧」；也可在同一场景点击「从站姿开始」。选定帧与关节，用局部旋转数值、滑条或未镜像暂停状态的旋转环摆姿，Root 使用米制位置。6 个末端节点只供选择/观察。

草稿先显示在舞台，点击写入当前关节、Root 或完整姿态后才改变动画。跳帧、播放、切换或保存前，未写草稿会要求写入、放弃或取消。删除处理该帧全部显式轨键；撤销/重做与编排共用场景历史，正式轨道、原音频和相机随场景保存恢复。

时长由已确认 CountMap 固定，键以 30 fps 定位并保留精确末帧。关节在相邻锚间 SLERP，Root 线性插值，影响整段相邻键区间。采用模板替换时会提示固化当前动画并清除可编辑轨，撤销可恢复；它不会将旧轨重新套到新基底。实际版本与检查见部署和验证记录。

## 本地运行

需要 Node.js 24 和 npm。

```sh
npm ci
npm run dev
npm run check
npm run typecheck:worker
npx playwright install chromium
npm run test:e2e
```

## 仓库

```text
apps/web/                 响应式工作台与 Three.js 人偶播放
apps/api/                 带原生限频的健康/能力 API；未开放接口明确拒绝
packages/core/            数拍、模板、合成 BakedTake、统一插值、局部替换
services/motion-worker/   真实 Python 动作处理的接入计划
infra/                   部署辅助工具
docs/                    阶段计划、实现状态、验证记录
```

## Cloudflare 部署

当前线上使用同一份 Web 构建与 API，通过可复现的 inline gzip 后备模块发布；Cloudflare 记录为 `has_assets=false`。生成工具为 `infra/prepare-inline-preview.mjs`，实际部署 ID、验证及再现步骤见部署记录。音乐仍只在浏览器本地处理。

`/api/*` 按客户端 IP 配置 20 次 / 60 秒原生限频；超限 429，保护缺失或失败 503。实际 Worker 没有 D1/KV/DO 绑定，本项目不写 D1。限频按节点生效且最终一致，共享 IP 会共用额度；429 与当前 inline 静态交付仍计 Worker 请求，因此它不是账户全局费用硬上限。本机编辑和保存不调用业务 API；后续服务写入还需幂等、合并写入和日预算门槛。

`wrangler.jsonc` 配置的 Workers Static Assets 是标准部署路径，后续恢复官方资产上传后使用。已认证的 Wrangler 环境运行：

```sh
npm run deploy
```

认证只在执行环境配置，不写入源码或配置文件。GitHub Actions 自动检查构建、契约与交互；main 的纯 Markdown 更新不重复运行整套检查，PR 检查保持启用。目前未配置含部署凭据的自动发布。可通过 Cloudflare Workers Builds 连接本仓库，设置构建命令 `npm run build`、部署命令 `npx wrangler deploy`，完成之后再记录启用状态。

Python 动作处理和 FFmpeg 不在普通 Worker 中运行。后续按真实负载选择独立执行环境，保留 PostgreSQL 与私有对象存储的方案。

## 来源与许可

本实现依据已读取的 v2.1 原生规格正文。当前连接未能下载 Notion 工程 ZIP，因此尚未读取原包 AGENTS、机器契约或复核原测试；S1 首先补齐这项接入。public 仓库不收录私有 Notion 原文、合同、历史 ZIP 或用户音乐。

沿用仓库原有 [MIT LICENSE](LICENSE)。代码许可不代表第三方动作、人物或音乐许可；当前仓库的演示人偶、姿态与节奏为原创程序生成。
