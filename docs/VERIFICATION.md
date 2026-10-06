# S0 验证记录

日期：2026-10-06。对象为当前仓库的原创合成预览，不是原工程包 2.1.0、真实动作或教学发布验收。

## 已执行

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

## Cloudflare 在线检查

2026-10-06 在真实 [Cloudflare 预览](https://choreo-studio-preview.danuberiverferryman.workers.dev/) 运行相同的 7 项浏览器流程检查：全部通过，45.8 秒；零 console warning、console error 和 pageerror。报告记录开始时间 `2026-10-06T10:14:14.082Z`，无跳过、重试或不符合预期的用例。验证涵盖实际 3D/音频播放、八拍候选与撤销重做、候选失效、更简单动作提示、原创 WAV 本地保存恢复、数拍/范围校验，以及 320/390px 布局。

上述浏览器检查在 version 1 完成。随后由可复现生成器发布 version 2：`602fd037-46d4-4982-9691-14fffe497458`，deployment `f8ee52e1-ea1f-4b79-83a0-7b8315b3a93d`，100% 流量。4 个前端资产逐字节未变，原 API handler 保持原样；实际下载的 Worker 模块与 public 生成器输出逐字节一致，SHA-256 为 `ff196b960b592ed0963d0438cef620aac541c8de073a472c22288053a0675130`。

最终部署在 `2026-10-06T10:17:25.057Z` 完成 15 项 HTTP 复验，全部通过：4 个资产的内容与安全 headers、健康/能力读取、未实现 API 的 501、SPA 回退、缺失 JS 的 404、无 gzip 读取、条件请求 304、HEAD，以及保留 headers 配置不公开。没有声称 7 项浏览器检查在 version 2 发布后重跑。

可复现后备生成器的直接检查 39 项、workerd HTTP 检查 25 项、旧/新输出等价与动态 headers 检查 34 项通过。两个 infra 工具的 Node 语法检查通过。具体发布方式、实际 ID、资产 SHA-256 与再现命令见部署记录。

这些结果支持 S0 交互预览闭环。它们不验证真实设备输出延迟、蓝牙、渲染性能、真实动作质量或教学许可；不替代教师、MP4 或原 M0–M3 验收。线上部署的实际版本与检查记录见 [`DEPLOYMENT.md`](DEPLOYMENT.md)。
