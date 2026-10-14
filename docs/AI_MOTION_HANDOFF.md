## 2026-10-14 · 用户要求真正创作素材；旧素材回退纠正与专用模型实测

修改记录保留：上一阶段main b89b0f28／native47及人体求解仍在。本轮用户明确不能剪辑街舞／Salsa冒充新素材，选择先实测专用动作模型；原先真人动捕选段、变速、转向、位移、接缝及IK不满足创作要求。默认入口已在本地改为创作，合格服务未接入时拒绝、没有旧素材回退；素材编排是需明确选择且如实标注来源的另一操作，模型摘要不能自称中国舞／新创作。

已完成两次真实官方Kimodo短生成（4秒120帧／6秒180帧、SOMA77、30fps、自写公开prompt、seed20261014），0新Workers AI／0用户场景音频上传。第二次产生侧移且左右手更不对称，但两份都没有完成所描述的云手与开臂收势，不能当合格中国舞发布。原始数据、参数、视频、数值与相似性回执已提交归档，见 [新素材评估](MOTION_CREATION_EVALUATION.md)。整体对本地两录制没有高相似旗标，仅是有限原型筛查；不担保全训练集原创或舞蹈质量。原矩阵／T姿态需要独立适配；密集曲线当前只接受真人动捕来源，不伪造生成器身份。

验证：当前源码定向101／3、前端构建、Worker类型通过。浏览器首次2／3的两个旧素材真实求解阳性通过，新增夹具因音频20秒／数拍32秒不一致失败；修正自有WAV36秒后的创作1／1通过，最新CSS／触控44px／390布局及时间线最后2／2通过。各轮单独保留，不是完整14／14。默认创作的API／POST／prior GET全部0，原project／take／manual／相机／CountMap／audiohash保持。原上传.choreo SHA仍e5f3d969…afad5。核心求解算法／阈值／固定边界／原文件未改。

本轮源代码尚未合并main／部署Cloudflare；线上仍native47。下一步只接入实测合格且服务方式明确的生成模型，再完成独立生成器来源、骨架重定向、整段曲线门禁与浏览器验收。官方共享演示不能冒充生产后端。保留本轮失败和所有下方历史，勿恢复静默剪辑回退或宣称只修改界面即已生成中国舞。

# AI 动作实现交接

## 2026-10-14 · 连续腿部修复已发布 native47，one-shot已使用完

最新运行source `ea886549f1027c8223fe14235002a7e46d2e9b30`／tree `2abb703515ef79de1edc9dbdf4b0f1ded13fd28a` 已main／native47，version `cd23036c-8157-42b6-8545-aecf1914eb15`，初始单100%deployment `e0e5eaa8-7d51-46ba-bf6c-84576e14e3d1`。准确源码PR13 CI38493625664/job115624307274 completed/success，updated01:17:35 UTC；同SHA main自动run尚未拿终态，不冒称PR结果是main重复运行成功。旧native46/main435 CI38490113946与旧0f PR38492677805另保留。

用户批准的一次owned32秒／4–9.5秒／普通“来段复杂街舞”真实请求已在native46执行：HTTP200、合法supported规划、cmu-85-12本地0–5.5秒，但7.96秒RightUpperLeg约373.52rad/s²超过250，产品拒绝、原稿保持。授权已使用完，不再请求模型。后续全部复用冻结请求／响应和公开素材，只重绑明确操作身份；旧REST401、remote-binding是否推理未知和审批拒绝仍为历史。

泛用UpperLeg SO3＋Knee50ms连续场只调理新候选，Salsa站姿／胫骨专属配置保持独立，Root算法、原3mm／250门槛、端点／切线／外部与来源文件不改。同一冻结计划的独立门禁accepted，783几何点、165span／330模板／660姿态、双coverage完整、违规0，maxacc238.728775、接地修正37.1499mm；纯不变量前移四完整夹具逐值与JSONSHA相同。完整人体力学、复杂地板／倒置、连续皮肤或普遍自然度仍不在完成范围。

最终本地949／48、210.68秒、专项12／12、26.76秒、build／Worker／dry-run0；同批13浏览器500.902702秒、全mock且13份错误／警告0、两个预期HTTP错误。原UpperLeg-only失败、full947／949两个旧超时、local12实际姿态匹配但source-diff守卫失败，以及首轮public因持久profile恢复四个localhost资产请求而FAILED均保留。

第二轮public使用clean profile，只复制已核验相同ServerCertificate DB，不带旧tabs／session／site data，正常TLS/proxy不变。01:23:15.650–01:23:48.719 UTC，provider0／一次冻结mock，status accepted；实际浏览器曲线独立correct:false0违规，12姿态以原1e−12比较max1.3877787807814457e−17，15公网响应9唯一路径与冻结SHA相同，原稿／音频hash、runtime diff和原provider ledger保持。Root亲审1440／390图：候选按钮可用、无溢出，toast下沿遮挡及旧五处编辑参考提示仍保留。

239非Markdown／41dist已冻结。详细证据分别在ignored `work/planner-release-20261014/`、`work/planner-frozen-review-20261014/` 与 `work/arm-hoist-review-20261014/`；私有原文件／音频／Notion全文不提交。原五页Notion原生更新全部succeeded，完整读回5／5确认原raw正文完整后缀、标题／自定义属性／icon／cover及原资产保留，新marker和全部最终证据出现；[原项目页](https://www.notion.so/3dfe5c88f85f8124be4ec66c263b1989)等原页面不替换，私有全文只在工具内存。正常TLS额外health GET200、推理0。最终纯Markdown提交复用已发布native47；原生deployment message记录最终main完整SHA及运行source ea886549f1027c8223fe14235002a7e46d2e9b30/tree2abb703515ef79de1edc9dbdf4b0f1ded13fd28a，保持同version100%，无代码／资产重上传或推理，完整关联以原生收据为准；下方旧pending／native46／native45及全部原交接正文保留为历史。

## 2026-10-14 · 用户已明确批准发布及一次真实验证

用户针对上一轮最终的main／Cloudflare发布和一次自建场景真实验证问题明确回答“允许”。旧自动审批拒绝仍保留为历史，这次对应授权已具备，不再把旧pending当作当前阻挡。批准范围是本草稿PR12修复、自建32秒／4–9.5秒／“来段复杂街舞”的一次实际规划，无用户场景或音频上传，无自动重试；后续结果以新的实际收据为准。

## 2026-10-13 · 普通街舞规划修复：本地完成，发布／真实验证待授权

最新用户反馈32秒新场景、4–9.5秒、“来段复杂街舞”总报无法使用规划。本地源码 `2d989dba04250d23639290985def589d28f55867`／tree `9cdad4e087e0ae6560baff29079f7d00783767ae` 已提交，修复逐clip本地秒Schema、非零选区提示、派生速率／过渡边界的binary64误拒绝，并以六个安全reasonCode显示具体原因。未捕获用户那次原始模型数据，不宣称已确定其某条精确原因；旧Schema可接受录制偏移24–29.5而短窗口仅8秒的独立反例已验证。原端点／来源界限、原稿及物理门槛保持。

本地948/48文件、最终专项59/3文件、同批12浏览器通过；新增用户相同选区的真实Street求解／partial限制展示／采用撤销保护与安全502分类通过，模型全部mock。最后Schema表达式修订保持41个前端文件字节不变；构建、Worker类型／dry-run通过。精确收据与首次监听权限失败见 [VERIFICATION.md](VERIFICATION.md)，不复写旧失败。

自动审批明确拒绝这次生产规划POST（必要元数据和付费调用未获明确授权）及直接push main（本次主分支发布缺明确授权）。一次真实验证已通过异步问题等待用户明确回答；主分支／Cloudflare发布也须批准，**不要换路径或用旧低频授权绕过这两次实际拒绝**。直接REST401和一次remote-binding失败均无有效模型结果；provider对新嵌套Schema兼容性、自由描述成功率尚未完成实测。未发布新Cloudflare，旧native45仍是上轮已发布版本，不能引用其指定Salsa成功证明新自由描述。

可审阅修复以本地提交／后续草稿PR为准，GitHub main仍需批准才更新；后续先查分支／PR和用户回答，按批准范围一次测试，不自行重试。原五页Notion只记录实现和pending事实，私有全文不落盘。新增证据在ignored `work/planner-invalid-20261013/`，不随Git迁移；下面native45发布及原baafe交接全文为历史。

## 2026-10-13 · 续接已完成并发布 native45

用户在新会话要求继续修改和发布。已确认上轮实现保存在 `baafe8891463fbe75c2e88a944606ddbfcefb076`，从旧工作区快进恢复，没有重新实现。下方13:30交接正文完整保留为历史；其中“停止／未发布／未同步／预检旧oracle”不再是当前状态。

本轮源码 [47ea623](https://github.com/DFerryman/ChoreographyStudio/commit/47ea623d8bc50d36c39a2e4d14b42f02b1dae6e5)／tree `e01a004f1540de6274dba5f70d6fada8917bb98b`：固定端点预检共享最终 native Foot 地面 oracle 与原3mm容差，新增真实脚尖−22.32mm回归，在不调用模型时拒绝不合法源端点。旧编辑器、原文件、区间端点／切线／外部、播放数学和物理门槛不变。

- 本地最终浏览器单批10/10，392.756秒，10次规划全部mock；单 worker 48文件922/922，242.64秒。首默认check912/922的10项超时保留，未改时限；前端构建、Worker类型／dry-run、人物拟合与6项Python回归通过。准确源码 [CI38409539714](https://github.com/DFerryman/ChoreographyStudio/actions/runs/38409539714) completed/success，含完整浏览器步骤；不编造CI逐例计数。
- native45/version `1f77133a-7b5d-4f3a-9130-d1347965eab9`，创建2026-10-13T14:19:10.232095Z；初始单100% deployment `1e84926e-96ba-4a99-b84c-b59b6e3b7c48`。原生source/tree精确，五项绑定／限流／runtime保持，18新资产上传／20复用。[线上工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/) health／capabilities正常TLS各一次GET200。
- 真实模型总计一次：HTTP200／合法 `ai-motion-plan-1`，supported，CMU61_08源0–16秒／yaw0／travel0，实际产品候选门禁accepted。首观察整批失败于浏览器和Node分别重新求解的组件差异1.545125138946446e−12，仅有2个观察；第二冻结回放新增真实调用0，8次观察／7通过，组件差异4.554184529492744e−10导致整批失败。两批失败不能改写或拼成完整通过。
- 最终独立观察2026-10-13T14:46:07.747Z–14:47:40.955Z通过，新增真实调用0／冻结结果mock一次。只读捕获实际浏览器冻结候选，核对来源身份／target／requestId，再以 `correct:false` 独立验收原曲线：2519几何样本＋480spans／960单侧stencils／1920额外姿态，两项coverage完整、0违规，最大角加速度199.7124rad/s²低于原250。12/12实际播放姿态按这份真实曲线以原1e−12比较，最大组件误差1.3877787807814457e−17；不是用另一引擎重新生成的轨迹作渲染标准。
- 最终批15静态响应／9唯一资源逐字节及SHA匹配冻结dist；诊断错误／警告／失败请求为空。原项目／Take／manual／CountMap／相机及音乐hash保持，无采用或保存。Root查看本批桌面1440／手机390截图，无横溢、手机时间线68.5px、操作按钮至少44px；旧编辑参考提示和截断标题仍可见。有限姿态与截图不证明整个连续蒙皮、自然度或设备帧率。

五个原Notion页面已更新实现与最终发布状态，原生任务及完整正文／属性／附件保护的最终读回收据见 [VERIFICATION.md](VERIFICATION.md)。源码238非Markdown文件与dist41文件冻结；最终文档提交复用同一native45，以deployment message关联最终main，不再上传、调用模型或重复公网观察。Markdown-only main不触发本仓库CI；准确运行代码CI是47ea623。

剩余范围：一般SO(3)跨π接续没有通用修复；旧Street／Salsa首帧若不满足当前profile，固定起点完整生成仍预检拒绝，不能迁移原文件。两来源十四片段、较大人体适配、末尾最多1.5秒稳定收势及可选AI修订未启用均保持。Root6cm预算是**各次调理调用内部**共享网格细化的预算，后续solver修正相对其输入计量，不能宣称整条多阶段管线对最初draft全局仅6cm。工程关节／Quaternius代理／native Foot／有限曲率与汇总接触检查不等于临床范围、完整关节动力学、MHR校准、音乐理解或连续皮肤无穿插。

新证据在ignored `work/resume-natural-20261013/`：`browser-report.json`、`check.log`、`check-single-worker.log`、`current-ci-final.json`、`deployment-receipt.json`、`public-real-once/receipt.json`、`public-frozen-replay/receipt.json`、`public-browser-curve-review/receipt.json`及真实浏览器曲线／截图。原先ignored scratch不随Git迁移，不冒称已恢复它们；持久结果在本文及验证／部署文档。下次先fetch并快进最新main，依最终交付收据确认部署；不要因历史pending段重复部署或模型调用。

交接时间：2026-10-13 13:30 UTC。用户最新要求：**提交并 push 到 main，然后交接给其他 agent。** 本轮是开发交接，不是发布验收完成；不要继续启动推理或部署。提交前基线为 `25fc4b09ba202b9ffede44023cf1a0cb496f5571`，本文件随实现一起提交。最终提交 SHA 以 Git main 和本次回复为准。

## 目标和不可改变的约束

用户认为直接文本模型输出的全身角度严重扭曲，要求新动作符合人体关节、碰撞及物理约束。已同意按实际收益分工：AI 理解意图和编排真人动作；确定性程序负责重定向、连续轨迹及独立验收。不要强行给每个环节调用 AI。

- 原场景文件、原 Take／manual、音乐、相机不修改；新动作是独立 AI 层，明确预览、采用，一次可撤销操作。
- 区间两端姿态与保存切线、区间外采样保持；当前完整生成也固定原始起点。旧文件不归一化迁移，不偷偷换成中立姿态。
- 播放读取冻结曲线，不恢复逐帧碰撞投影、夹关节或物理校正。
- AI-first UI，不恢复六动作模板；原角度／旧编排 API 只保留兼容，不是主界面回退。
- 原物理阈值不为参考通过而放宽。没有新 provider、账单、账号、存储；没有音频／完整场景上传、后台推理或自动重试。

## 当前实现

实际流程位于 `apps/web/src/App.tsx`：冻结原稿／选区 → 建立完整上下文 → 固定端点预检 → **一次** `/api/motion/plan` → 加载选中 SHA 固定素材 → 异步组合与人物适配 → Foot 连续调理 → 密集曲线 → 实际 Root 曲线支撑求解 → 独立几何和近端点角曲率门禁 → 容量检查 → 候选预览／明确采用。

| 部分 | 文件和关键行为 |
| --- | --- |
| 结构化规划 | `packages/core/src/aiMotionPlan.ts`、fixture/test；协议 `ai-motion-plan-1`，选择 source clip／区间／目标时间／yaw／travel／transition／contact；supported／partial／unsupported 诚实区分。最短0.1秒兼容仅一个二进制 ULP 时间差，覆盖仍严格 |
| Worker／客户端 | `apps/api/src/index.ts`、`motionPlan.test.ts`；`apps/web/src/aiMotionPlanClient.ts`／test。GPT-OSS120B、JSON Schema、单次调用、无回退；64KiB 请求／96KiB客户端响应，Worker90秒、整体120秒，AI2/min/IP＋API20/min/IP，不重试 |
| 必要上下文 | 现有 `aiMotionContext.ts`：原稿 hash／revision／CountMap／骨架／音频身份／区间前后各4姿态、两端姿态和切线。仅 advisory 音频名称截到64 Unicode字符以留出目录空间；原文件名／sourceHash／提示词／全部必要上下文保持 |
| 真人先验 | `motionPriors.ts`（core及web）、tests、`infra/build_motion_priors.py`、`apps/web/public/motion-priors/`。两条 CMU 来源＋十二子窗口，共14文件，约2.37MB；30Hz Float32姿态＋精确Float64时间。来源是公开授权包，不是用户上传文件；只加载选中同源文件，流读取上限、SHA、取消、不可变缓存 |
| 人物适配 | 连续 functional-axis 转移、Salsa站姿／胫骨／膝／Head／Spine／UpperLeg场、实际 Head／身体几何目标、最终 Arm75ms平滑。顺序必须身体处理→最终IK→Arm平滑，不能平滑后再逐帧IK恢复噪声 |
| Foot／Root | `packages/core/src/motionGrounding.ts`／test。Foot50ms、总15°有界C2场；Root按真实插值与接触求解，至多一次输出网格细化，共享原始6cm总预算，以Bézier控制点凸包保证整条Root修正预算，保留固定端点／切线 |
| 独立门禁 | `packages/core/src/motionFeasibility.ts`／test。工程功能关节、固定身长、Quaternius代理、真实Foot凸包地面／支撑、汇总接触受力／摩擦、速度／加速度、近似腾空和静态收势；`coverage.complete`＋`derivativeCoverage.complete`＋accepted＋0违规才采用 |
| 辅助角曲率 | 每个Hermite span两端分别单侧SO(3)差分，4个新姿态／span，独立于几何网格。解决 quarter采样平均两侧曲率而漏检的真实Head259峰；没有提高250rad/s²上限 |
| 原稿／容量 | `aiMotionTrack.ts`、`compactScene.ts`、`sceneBackup.ts`及tests。稠密patch最多1801样本；active7208knots／12patches，历史共享字典，精确JSON不降精度。`assertSceneBackupCapacity`在候选及采用前计算将提交的12历史及项目／音频包头，32MiB上限，不读取音乐字节 |
| UI | `AssistCandidatePanel.tsx`披露适配量、检查范围及完整生成末尾最多1.5秒稳定收势；详情折叠。`sceneModel.ts`仅新场景双臂±15°；`Stage.tsx`仅参考范围提示文案，播放数学不变。手机候选区最小高度340→420已修复时间线被压到5px的问题 |

音频理解仍为 false；只提供音频元数据、确认数拍，不发送音频内容。模型选动作和编排，不直接写全身Euler。可选 AI 修订未启用，没有数据证明额外调用有益。

## 已完成的验证（不要夸大）

- core feasibility **31/31**，包含真实完整16秒生产流程、原始Toe凸包−22.32mm漏检回归、真实Toe支持、near-knot假通过回归、接触／摩擦／腾空／取消／原稿保护。
- planner／Worker／client／Ground 共48功能检查：首轮47通过、一个非生产旧32秒IK原型因默认5秒超时；只把其测试预算改15秒后专项7.86秒通过。**不是同一轮48/48**，不是物理限值变化。
- prior／loader15项通过；sceneBackup161项＋5项容量专项通过。相关TypeScript检查通过，avatar fitter check与6个Python回归通过。最终整个源码的 `npm run check`／构建仍未完成；不要加总为完整本轮发布测试。
- 数值及独立复核：完整16／32秒Salsa、真实moving Root＋manual的4–12秒区间、Street0–3秒源→4–8秒区间，在最终真实Foot凸包和单侧曲率门禁内全部通过。完整Salsa max角加速度约199.7／236.7rad/s²，区间约201.0，阈值250保持。
- 独立小h全25关节复核通过，仍是有限审查，不是连续数学证明。
- 实际GLB蒙皮11姿态、8483顶点独立计算与真实产品一致到约1e−15m；119组非相邻区域无实际自交，最终足部最低点在−3mm容差内。只证明选择样本，不证明整个连续蒙皮。
- 60秒静态资源样本：7201几何点＋7200额外角曲率姿态，9.77秒Node/WASM；取消在定时事件后1.58ms返回。不是实际60秒捕捉质量或手机性能证明。
- 最终浏览器v10因用户要求交接而SIGINT停止：**4正例通过、1用例主动中断、4未运行，exit130**。已通过full16（含390布局）、full32、Salsa区间保存／重新打开／native备份音乐、Street；110个源码／资产／测试文件前后SHA相同。5份诊断errors0／warnings0，8次mock plan，真实推理0。
- 之前完整v9为 **8通过／1失败**，失败是390手机时间线viewport仅5px。CSS修复后的full16已通过；不要把两轮拼成同一次9/9。

## 精确证据和复验命令

`work/`由Git忽略，当前共享工作区保留；换机器不会随Git下载。不可把其中原场景／音频或私有Notion正文提交。持久说明在本文件、`MOTION_PRIORS.md`、`REALISM_PLAN.md`、`SCENE_BACKUPS.md`；没有生成新的公开发布收据。

- browser：`work/ai-natural-browser-20261013/final-native-foot-v10-handoff-receipt.json`、`final-native-foot-v10/`；冻结SHA `d0c60e26c50056131e5f57999a81676ff54bd7a60c7fa45babac6552fbcc4b85`。v9失败收据／截图／trace仍保留。
- 数值：`work/motion-grounding-20261013/`中的full16／full32 v7、`interval-12-grounded-v8.json`／`interval-12-gate-v8.json`。合法区间使用 **whole `cmu-61-08-c`、yaw−35°**，测量travel约 `[−.035699,−.640968]`，固定moving/manual原稿；不要读会被覆写的`latest-*`当成另一条轨迹证据。
- 独立：`work/motion-curve-review-20261013/`；`work/skin-proxy-audit-20261013/final-v7-floor-results.json`；最终browser读回曲线／姿态在v10目录。
- 视觉：`work/motion-final-visual-20261013/`。手势比来源更展开；部分全段最大手位移约55cm／100cm、脚部约35cm，含最后收势。UI／origin记录阶段代价，不能称原样复刻或最终全局误差。
- 资源：`work/motion-feasibility-20261013/performance-curvature-receipt.json`；`work/motion-priors-20261013/composer-performance.json`。

先完整跑全部9个真实资产／求解器浏览器用例：

```sh
CHOREO_SCREENSHOT_DIR=work/ai-natural-browser-20261013/resumed-review-shots npx playwright test tests/ai-motion.spec.ts --output work/ai-natural-browser-20261013/resumed-final9 --reporter=list
npm run check
XDG_CONFIG_HOME=/tmp/choreo-release40-config npm run typecheck:worker
npm run avatar:fit -- --check
npm run avatar:fit:test
```

这些命令应依序执行；不要为省时间把重型浏览器与全单测同时压CPU造成假超时。`XDG_CONFIG_HOME`用于可写CLI日志；不要改HOME。若源码变更，相关旧验证失效，按必要范围重验。当前9个browser业务API全部mock，不能触达真实推理。

## 必须明确保留的缺口

1. **最终整套验证与发布未完成。** 新main提交不等于Cloudflare上线，没有新真实模型或公开候选质量证据。
2. **一般SO(3)接缝跨π分支没有通用修复。** 对c窗口逐帧最短arc，balanced yaw约56.674°曾产生Hips72.9rad/s／5046rad/s²，被正确拒绝；yaw−35°是真实合法正例。a整个窗口净travel2.816m不适合该±2m固定端补偿；d／b有真实foot／6cm预算失败，均保留。不要改限值、端点或source夹具掩盖它们。单段`transitionSeconds`不控制两端bridge（只用于index>0段间）；试.5→1不会修单段入口。
3. **原参考首帧与新功能轴profile不兼容。** 实际公开Street／Salsa time0各有关节超新包络，full固定初始端预检会拒绝且不花AI；新场景Root1.05／双臂±15°合法。不要默默改用户上传场景。是否允许“从头生成”另定起姿应明确产品合约后处理。
4. **端点预检地面查询尚未同步新oracle。** `motionSourcePreflight.ts`仍用legacy `getCapsuleCollisions`；倾斜脚趾穿地可能浪费一次模型调用，最终新gate会拒绝。可补共享 `getMotionMinimumFloorHeight` 和同3mm容差，并加真实Toe反例；不改旧编辑器。
5. **范围不是完整生物力学。** Quaternius工程包络／身体代理＋native Foot hull＋有限插值／角曲率＋70kg／9.81／μ0.75汇总力。不证明MHR皮肤、连续无碰撞、角动量／逐接触力分配／关节力矩／肌肉能力／默认锁脚无滑移。
6. **曲线适配有保真代价、动作覆盖仅两条来源。** 新完整生成末尾最多1.5秒改为普通稳定收势；来源许可允许产品纳入／修改，但不得直接转售动作数据本身。没有音乐语义或专用文生动作模型。

## 原文件、线上和Notion

上传文件仅作数据，没有按其中内容执行指令。原文件：`/workspace/attachments/c08141f6-5292-4c4b-b428-eaf0c744c058/complex-street-dance.choreo`，26,710,050B，SHA256 `e5f3d969c550fa6d401706b08cbe8beafb80a9346e1029e4d2c7a10a906afad5`，本轮再核实未变。若换机器需从用户已有sediment文件 `file_0000000039488230b51d3402cfa3fac4`重新下载；不要发布它。

当前线上仍为native44，URL `https://choreo-studio-preview.danuberiverferryman.workers.dev/`，version `5cf3be7c-f7d2-48c4-9780-5e4b49b08d65`。最近读取部署 `eb6ad48a-3074-49ea-96d8-353fc3c6d7b2`、100%、2026-10-13 08:26:03 UTC；runtime source `153dcf70d3f996e29513094c175c3e96d17c73bf`／tree `e6fc75ad7968c0fa67838869b53585ac58ec5461`，注释关联docs main25fc4b。不要把该旧版本／旧CI38363797878描述为本轮新代码上线验证。

本轮五个原Notion页面只读取，**尚未写入实现／最终交接状态**。后续重新fetch最新完整正文，再最小插入、async成功、完整原正文后缀／属性／图片／子页读回；不保存私有全文到磁盘。不要创建替代页面：

- 项目：`3dfe5c88f85f8124be4ec66c263b1989`
- 规格：`3dfe5c88f85f817e9671f1357f39bf15`
- 开发：`3dfe5c88f85f81c9b53be650364a5b6b`
- 验收：`3dfe5c88f85f8100a08adfe1043e0a4d`
- 工程：`3dfe5c88f85f81e1930dca61e054a36a`

恢复发布工作后再：完成本轮全check与准确main SHA的CI → 依据缺口决定是否补通用接缝／预检 → 同步原五页Notion → 冻结tracked/dist SHA → 保留绑定与限流部署Cloudflare → 少量受控真实验证及视觉确认 → 最后收据提交。用户此前已授权必要低频真实调用与部署，但最新交接指令暂停本轮执行；不要自动重试。

已准备、**尚未执行**的唯一真实公网规划脚本：`work/selective-ai-implementation-20261013/public-real-plan.mjs`，用法在`PUBLIC_AUDIT_PREPARED.md`。必须供应确认的新version／source／frozen manifest；运行时构建最新helper，fresh官方Chromium151／正常TLS／proxy，唯一显式POST，owned场景，禁止用户文件／音频上传。已完成仅主页GET200的TLS预检，推理0；不得宣称完成模型验证。main push可能启动CI，交接时只据实读结果，不需要为了取结果延迟交接或部署未验源码。
