# GPT-6.1 Sol 自有文本动作实验，2026-10-14

这是一次实际 **Codex 会话**内的文本模型创作与本地工程审计档案。实际来源为 `codex-session / gpt-6.1-sol`：一个 agent 作者任务产出三个稀疏全身动作 JSON，分别表达中国古典舞、Hip-hop、芭蕾的创作意图。它们不是 Cloudflare 推理结果，也不是三次已计量的 provider API 调用。没有外部 provider 调用、新服务购买费用、动作专用模型、动作目录或录制片段输入；没有 API token 用量、provider 时延或会话费用收据，不能据此声称会话计算成本为零。作者原始字节及其 SHA 保留不变。

原稿是本机自建的 32 秒静止夹具，25 关节、米制、Y 向上；120 BPM 数拍来源是本机设定，没有用户音乐或音频理解。只创作绝对时间 **4–9.5 秒，5.5 秒**的内部姿态，程序锁定区间两端及边界速度，外部沿用原稿。冻结请求保留实际骨架、人体约束和边界上下文。准备收据中的 GPT-OSS 模型字段描述当时既有接口配置，**不是**这次作者模型的执行证明。

## 保留的结果

| 样本 | 原始曲线门禁 | 最终独立门禁 | 原始曲线至最终曲线的修订 |
| --- | --- | --- | --- |
| 中国古典舞意图 | accepted | accepted，0 violations | 无修订 |
| Hip-hop 意图 | accepted | accepted，0 violations | 无修订 |
| 芭蕾意图 | rejected，180 条触地穿透，最大 19.628 mm | accepted，0 violations | 既有 Root conditioner；采样最大 Root 位移 25.669 mm，局部关节旋转及角速度分量不变 |

原始输出均未改写；芭蕾的原始拒绝和真实 Root 修订分别保留。最终门禁由原检测器 `correct:false` 执行，coverage 和 derivativeCoverage 均 complete。原稿、冻结请求、原始输出、区间两端及边界速度保持；六个外部／端点采样完全一致，采样器在区间外直接返回原稿。具体数值和有限覆盖范围见 `review/independent-text-audit.json`、每个 `audit/` 下的原始与最终报告。

**工程通过不证明舞种准确、自然度、任意舞种能力、完整人体动力学或连续皮肤碰撞。** 作者 summary 表达意图，不能用作风格评分。门禁包含有限人体代理几何、关节、触地、碰撞、速度／加速度及聚合支撑力检查；没有伪造 planted contact 计划，也不宣称完整脚锁／滑移验收。这里没有对全部训练数据的原创性担保；档案证明的生成上下文没有读取本项目现成动作素材。当前产品默认来源合同和正式生成能力不能由本次实验替代。

## 文件与身份

- `author/`：三个原始输出、实际作者 `create.py`、作者收据与诊断。脚本保留原貌，包含历史工作路径；不要直接执行它覆盖原始输出。
- `fixture/`：自有静止原稿、三个冻结请求、准备收据。
- `audit/<style>/`：精确原始／最终门禁、真实各阶段 patch、Root 条件化报告、原始质量记录、solver corrections 和审计收据。`locally-bound-result.json` 是可信操作人把独立输出绑定到冻结请求后的本地结果，**不是 provider 认证的 API 字典**。schema 验证不能证明模型执行，执行来源另见作者收据。
- `review/`、`checks/`：已有独立核查、五原Notion页保护读回摘要、核心60/60两文件、API83/83及原980/987七超时报告／失败三文件串行57/57、前端构建与创作入口浏览器1/1的已执行证据。60 条并非全部新增身份测试，归档时没有重跑。默认来源验收仍拒绝会话来源；只有显式独立传入可信模型／provider 配对才接纳，错误配对和伪造 human-prior 仍拒绝。
- `visuals/<style>/`：已经生成的真实 canonical25 FK **30 Hz，165 帧，5.5 秒** raw-vs-actual 对照视频与 contact sheet。数值诊断含 166 个端点采样；视频覆盖场景 4 秒起至 9.5 秒前。这些是骨架投影，没有原生蒙皮或连续力学含义。
- `browser/`：当前 App Stage 的四张指定原生蒙皮 PNG、先前 harness 失败、修正后收据、原生低帧率录屏分析、三份自有导入场景 JSON 的 gzip。修正后共 18 条观察：16 条正面姿态有逐组件直接核对，最大差值 0；另 2 条左侧观察。errors／warnings 均 0。attempt01 因 harness 按钮 selector 少逗号超时，未导入场景；不能删除这次失败。
- `methods/`：实际审计／准备／渲染脚本，保持原字节。browser helper 是有历史路径及浏览器依赖的执行记录，不是已验证的通用便携工具。

原生浏览器录屏只有 **17 帧／5.337 秒，约 3 FPS**，终止采样有调度延迟。本档案只保留其分析及原生静态截图，不把低帧率录屏标作 30 Hz／准确 5.5 秒动画、风格或平滑性证据。

两份浏览器收据原本含本机 Vite HMR WebSocket 查询 token。公开副本仅将 `network.webSockets[0]` 查询串替换为 `?[redacted-local-hmr-query]`；原始 SHA、脱敏路径和公开副本 SHA 见 manifest。原始完整收据仍在 ignored work。大型 compiled patch／门禁 JSON 和原始日志以 gzip 无损压缩保留，避免审阅时大量重复行；其它复制文件保留原字节。gzip 只压缩字节，解压 SHA 见 manifest，可用 Python gzip 或 gzip -dc 查看。未复制用户 scene／音频、合成静音 WAV、Notion、browser profile、cookie、凭据、完整 DOM／官方 HTML、mock provider envelopes 或可重建的大型 FK poseviews。

## 本地复算

依赖当前仓库及已安装的 Node／esbuild；可选渲染另需 Python、numpy、matplotlib、ffmpeg。`replay-analysis.mjs` 先校验归档字节和记录的检测器／身份源码 SHA，再把精确方法与冻结输入复制到 ignored `work/` 的同深度新目录。它运行本地审计，不调用模型、不联网、不覆盖本档案；`--render` 可重建省略的大型 FK poseviews 后渲染对照。原始工作路径保留为来源记录，不是便携运行时路径。

```sh
node docs/evidence/text-model-motion-20261014/replay-analysis.mjs
node docs/evidence/text-model-motion-20261014/replay-analysis.mjs --render
```

若源码 SHA 已变化，工具会停止；应在记录版本复算，不应静默使用新门槛。本次归档没有运行新的推理、审计或测试，也没有启用生产生成／部署。`manifest.json` 列出全部相对路径、文件字节数、SHA、来源与压缩／脱敏记录；不包含自己的递归 hash。

`cost/` 保留模型选择、官方单价的预算例和真实会话使用边界；没有跨模型舞蹈盲测，未把Sol证明成最佳或把会话账单写为0。当前实验没有启用新生产后端。
