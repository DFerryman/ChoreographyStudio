# 预览验证记录

## Version 19 · 精确源点、局部自动记录与长期交互标准（已上线验证，准确源码 CI 通过）

默认手动编辑无需 AI：选精确时间、在场景选部位，Timeline 自动展开／高亮／聚焦对应点，直接调整旋转、Root 或 IK，松手只记录实际变化及 IK／脚锁关联通道。一手势一条可撤销操作，空手势／选择不记历史，取消恢复手势前状态；移除完整姿态添加／更新快照按钮和 K 快捷键。Root、全部 25 个局部旋转、源点／计算点／作者 K／编辑前有效值可通过轨道查看。主场景与 Timeline 优先、次级入口按需折叠；用户要求将此流程作为未来功能标准，已写入 [EDITOR_INTERACTION_STANDARD.md](EDITOR_INTERACTION_STANDARD.md)、AGENTS 顶层及对应说明。

局部修改使用精确秒值，不把非整数帧源点吸附到 30 fps。首次有效修改冻结已保存的权威 Take；原采样时刻未改通道直接保持原值，稀疏 K 新支点使用规范求值，避免重烘焙／二次 NLERP 改掉无关数据。12 个历史快照含名称、时刻和轨道，并随本机保存、重开、完整包恢复。编码为 `compact-scene-1` 共享／差量，JSON 备份 `choreo-scene-backup-2`、完整头 `choreo-scene-bundle-2`；容器魔数仍 `CHOREO-BUNDLE-1`，兼容旧包，不重采样、不降精度、不丢音乐／历史。

**真实源数据范围。** 输入 26,710,050 B／原头 19,509,986 B。最新冻结权威数据回环：11 个精确非整数帧 Head 点、12 条历史后导出 **20,274,781 B／头 13,074,717 B**；重导项目、冻结原 Take、所有其它已有 Root／关节值及 7,200,044 B 原音频严格相等。独立 Chromium 私有作品单项 1／1（3.7 分钟）核对全部 5,040 原有效姿态、Delete 恢复、Undo 和完整包重导；该附件不进公开 repo，CI 因私有 fixture 不在 runner 跳过这一项，不能把跳过算通过。初 20,271,635 B Node 同引擎证明及其后真实 Chest 跨引擎失败是不同阶段，以下保留。

| 本轮实际证据 | 结果与范围 |
| --- | --- |
| 最终核心 | 81／81 与类型检查通过；严格旧值／新支点回归，原 validator 未放宽 |
| 本地完整基础阶段 | 542／542、27 文件、80.82 秒，bounded 2 workers；该批前端出现两处 Set 类型收窄错误，后仅加类型断言、前端类型／生产构建复核通过；最后新增新支点回归由准确 CI 的 543 项覆盖 |
| 本地当前浏览器 | 38 个独立场景都有实际通过证据，来自多批和 focused 补齐，不能称一次全量 38／38 |
| 精确点／真实作品 | portable 3 项通过＋私有真实作品 1 项通过 |
| Timeline 缩放 | clean 批 3 通过／1 新支点导出拒绝，修复后 focused edge 1／1（45.2 秒）；桌面／390／320、48px 帧距、精确末段、拖源键／碰撞、音频、锚定／平移、自动边滚、Undo／resize |
| 快捷键 | clean 8／9＋仅测试清除选择修正后 focused 1／1；Root 选择即使 selectedJoint 为空也有效，原动作／镜像／重复键断言保持 |
| Preview／场景 | 10／10、6.5 分钟；每项直接断言 pageerror／console-error 为空，成功 list attachments 未单独落 warning JSON，不声称 10 份零 warning 文件 |
| 完整备份 | 3／3、262.555013 秒；3 份实际 JSON 的 errors／warnings／API 全为空，原音乐／旧 JSON／坏包／quota／手机保护保持 |
| 音乐与默认人物 | music 7／7、1.4 分钟＋native 1 实际通过；音乐每项直接断言 errors／warnings／API 空，未落 7 份独立成功 JSON |
| Worker／构建 | Worker 类型、前端类型／生产构建及官方 Wrangler dry-run 通过；继承代理和既有大 chunk 提示保留，不作设备帧率结论 |

旧显式全姿态写 K／草稿／剪贴板 UI 测试原文保留为 `*.v18-legacy.ts`，按 [tests/README.md](../tests/README.md) 不参与当前发现；不能声称旧 86 个流程已通过。底层稀疏 K、作者优先、约束、IK、锁、步伐和蒙皮数学继续由基础测试覆盖。Root 亲审本轮新增 dense320、edge-autoscroll、backup-mobile 三张实际图接受；备份图有真实 toast，不宣称全部图无浮层。

**首次失败与修复保留。** 初 desktop fixture 的 quaternion 规范化差异、随后前臂 X＋25 为限位内空操作，均通过修正实际 fixture／负向弯曲测试解决；没有给空手势虚记历史。首五个并发浏览器出现真实 media readyState 0／1，保留严格 ≥2，并用普通原生标题点击激活同一暂停媒体，不伪造 readiness。首 full point 批终端原始四元数组件未规范化失败、mobile 在最后截图中断，修复终端实际输入后重验。后完整 point 批 3 通过／1 导入被未保存场景保护遮挡，测试先保存默认场景；私有 followup 在 Chest 样本 449／3.6432859048465986 秒严格比较发现约 1 ULP 漂移，冻结已保存权威 Take 后才通过全部原值检查。

原完整基础 528／530 的两项 timeout、backup focused 9／10 与 101／104 的 timeout、最初 Wrangler 默认日志目录失败保留；测试仅将必要容量用例时限设为 15／45 秒并限定两 worker，未弱化数值／资源断言。其后 542 基础与最终 543 CI 分别记录。两处 frontend Set 类型错误是已守卫对象的类型收窄问题，类型断言不改变运行 JS。

Timeline 首完整批 1 通过／3 失败（5.0 分钟）：旧 ruler selector 和手机平移；第二批 1 通过／3 失败（2.7 分钟）：原生事件 JSON 确认首 16px move 后 pointercancel，浏览器接管横向滚动；edge 又因合并中的 App conflict marker／Vite500 在业务前退出。整数 CDP origin 没有修复此问题，不能归成纯 1px 输入量化；恢复原 viewport pan-y 与 ruler／zoom-input none 后，390 原生事件为 269→173 六次 move＋pointerup、scroll 13034→13130，320 同样精确 96px，无 cancel，原严格断言不变。后 clean 3／4 的 edge 成功移 Root276→新299，却被备份 validator 正确拒绝二次 NLERP 的新支点姿态；仅让新增时点用 canonical derived pose、旧时点保 exact stored pose，focused edge 才通过导出／Undo／resize。原 log 引用 trace.zip 不能代替实际文件存在性证明；实际 mobile event JSON、上下文、截图及各轮日志保留。

music＋native 首批实际 native 1 通过／music 7 失败，原因是测试 JSON reader 忽略 compact envelope；仅解析新格式、保留原音乐／异步／选段断言后 music 7／7。该修正已在下述准确 dd0d132 source 内，没有另设假想 CI 或取消。

**准确源码和部署。** Runtime [dd0d132](https://github.com/DFerryman/ChoreographyStudio/commit/dd0d132785489ac3baedb19f53448ad6945adaf6)／tree `c6a09961f587d7a3b93b2260db5efc10e0d90295` 已 main 并 native 读回。准确 [CI37910066138](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37910066138)／job113752815025／attempt1／push 于 09:28:05Z completed success：**543／543 基础、27 文件＋类型／Vite 599ms＋Worker PASS；37 个浏览器实际 unique IDs 通过、8 文件、11.5 分钟，1 个私有 fixture 跳过**。Run created09:15:10Z，job09:15:12–09:28:05Z，updated09:28:06Z；原始日志 83,687 B／SHA256 `85ad50b82c2de382bc7410eed1251c1b534b17274db5035d3262e741309f9192`，未手动 rerun。

Cloudflare version `ed9c35b6-15b2-4af7-a895-7f74462b8d34`（native23／tag v19-point-edits）创建 09:23:55.434468Z，首 deployment `56eeba04-841b-45f2-b2ab-bc4d1df4c947`／09:23:55.872532Z／100%，native annotation 绑定 dd0d132；Wrangler EXIT0、Read29、3 新／20 复用。冻结 runtime74／dist26 与模型 README 保持。正常 TLS verify0 的有界 HTTP8／8 于09:27:35.326739–09:27:37.544456Z通过：根 HTML、JS／CSS、native GLB／rig JSON／model README 的 bytes／SHA exact，加 health／capabilities 两只读 GET。最初 /index.html 是307 canonical redirect，传输 exit0、审计 exit1；改用 / 的最终8项与该独立请求累计9请求，无重试，不把初审计失败写成成功。

| 冻结主要资产 | Bytes | SHA256 |
| --- | ---: | --- |
| index.html | 645 | 54f91039f937d5330ec8e93ff9dc0366712173a153a39f1e5583104e4d827185 |
| assets/index-DCKYDdaR.js | 1,161,641 | 279a0772403bd0507133d98d0b5fd53239a053478222aeb946383ecb85e909b3 |
| assets/index-B5ZA0MHA.css | 72,223 | b698624b8677a8fdad833d3ec57bd206c3870f927d16f387fa79342d9909bfb9 |
| models/neutral-quaternius-v1.glb | 480,376 | 6570b23a63a0a5b87ad3fa5f8d7a24536c8e7fc3ceb03d28893cb48966cc6527 |
| models/neutral-quaternius-v1.json | 79,998 | 882e122c2d497ea7c23ce073eefe3ddc3d09b6992f814a586b5b9ca658b7e68b |
| models/README.md | 21,099 | 14a040b502495cbd844209ec056681a9da82feeb7cde18035215d068b5dd5202 |

**公网首批实际 0／6。** 六个场景均在第一次 document goto 因 `ERR_CERT_AUTHORITY_INVALID` 退出，未进入应用，不能记为业务断言失败或应用通过。6 份实际 diagnostics 的 errors／warnings／API 都为0，同时有6个 failed document requests、documentResponse0；6 张 privacy 页图与6份实际 trace.zip 保留，verify 亲看其中3张隐私页，Root 尚未接受任何本轮公网 App 图。执行环境已有代理 CA 位于旧 HOME 的 `.pki/nssdb` 并以 C,, 信任；官方151 tag核查仍优先已存在旧目录，不能把XDG路径猜测当原因。旧NSS库挂载只读是RW初始化／fallback的有据待证原因，尚无直接NSS错误日志。修复实际为work内Chrome-created Default/ServerCertificate用户库配置已有CA DER和官方Trusted(3) metadata，离线原生cert manager复核，再wrapper复制至Playwright临时profile；不是成功UI文件导入。离线原生UI确认Trusted唯一openai.com、Intermediate／Distrusted为空、HTTP requests=[]，实际txt／png保留于work/v19/chrome-cert-manager/configured-trusted-ui；正常关闭profile后仅复制该用户库。Chrome args／HOME／正常TLS验证保持，不绕过证书。--list 确认 exactly6／2 wrapper 文件，与准确 CI 的8文件分别计；首批0／6不改写为通过。

**修复后唯一有界公网实际6／6。** 同一冻结dd0d132运行源、两wrapper文件覆盖三个points（真实场景部位／局部旋转、390 Root／compact完整重导、IK关联变化）与首播放、390／320布局。于2026-10-09T09:51:12.731Z开始，用时111,888.072ms，EXIT0；expected6、unexpected／skipped／flaky／report errors均0，每项actual result passed。六份独立JSON的pageErrors／consoleErrors／consoleWarnings／apiRequests／failedRequests都为空，累计10个mainResponses均200，httpsVerification=true；正常CA验证、HOME／原Chromium args不变。原始report1,517,966B／SHA256 `f723e3f4d7c514e0bd25c2daa1af61198047e1f915aaa5f216e4b8f55be5a8d1`。Root亲审该批public-point-desktop、public-point-mobile-root和public-preview-320三张实际App图接受舞台／精确点／紧凑Timeline及390／320布局；与本地三张图独立计，不是首失败的privacy页，也不据此保证所有取景全身无遮挡。没有追加测试批。

真实 Workers AI／付费推理／D1用户数据写入／新图片上传为0，私有附件不上传repo；固定默认人物数字资产、Worker业务源／绑定／限频不改。长期规范五页 Notion 已成功插入并读回，原全文／引用／四图保留，最终Markdown-only提交／同版部署注释及发布metadata同步按实际head读回。以下 v18 及以前全部原证据保留。

## Version 18 · 最终源码、部署与独立场景包验收

最新最后阶段用户要求：Timeline区域拉伸／扩张时同步放大或缩小每帧间距，逐帧K应清晰可见、可点击区分；极简界面要精致、便于操作；Timeline最后集中整理，功能明确、一眼可懂，以常见直觉拖拽为主，删除不使用的入口。本轮时间线已实现：全段显示→对数缩放滑杆→逐帧最大48px帧间距、统一滚动坐标与缩放锚点、空白区域点击定位／拖动平移、K和音乐边缘自动滚动；暗色中性浮层、不透明固定轨头、紧凑桌面约195px／手机约235px、手机K／音乐44px命中区，循环／速度／前后帧进入按需“更多”。16个显示轴几何用例实际通过；末尾不足1／30秒帧可伸展至48px，音频使用相同分段显示轴，真实时刻／核心动作逻辑不改。最终ac92保留上述操作与精致布局，仅三行≤360px工具padding-inline6修复四按钮右边界；保留完整12px标签／44px高／单行。新source公网缩放4＋原transfer3共7／7、诊断0／96runtime和26dist前后同，Root亲审公网3图及本地4图分别接受；准确完整CI结果独立记录。320倒立腿端仍可能被既有浮层／边缘遮，布局验收不保证任何取景下全身无遮挡。最终修复源码／CI／Cloudflare与实际交互和人物取景须独立核验，不借任何旧source通过。

最终运行[sourceac92f74](https://github.com/DFerryman/ChoreographyStudio/commit/ac92f743db9a144b9b6527ba1e465b82f87d2a9d)／tree `13e41442008ca4ec04b1d8627aa20e7bf2f27faf` 已push main并远端SHA精确读回。Cloudflare `e4784790-54c6-4716-a4a0-f8259567d381`（native22，产品迭代v18）于07:34:11.692073Z创建，100%初deployment `a04134ec-cca8-4fe8-ab25-9e889ef66244`／07:34:54.898518Z，upload／deploy EXIT0、native注释绑定ac92／tree13e。

最终ac92本地 `npm run check` 于07:31:54 UTC开始，480／480基础25文件、12.32秒，前端types＋Vite1944模块／1.11秒构建EXIT0；Worker输入未改，复用enabled原脚本actual类型PASS。仅一份CSS增加≤360px工具padding-inline6三行，保留12px完整标签／44px高／单行；原正式transfer3／3（111.439706秒）原width／Root／rotation／baseTake／revision／collision／undo／save／draft断言未改，诊断0；最终supplementary1／1（28.819567秒）与首incomplete1／1（28.499455秒）的桌面截图限制分别保留，126源快照前后SHA一致。Root亲审新local transferMore1440／390／320及stage四工具320四图接受。准确[CI37899685795](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37899685795)／job113719068029／attempt1／main push／headac92：于08:16:16Z实际SUCCESS：480／480基础（25条唯一文件行、sum480）＋104／104浏览器（25文件、IDs1..104各一次实际执行并通过），failed及failure／notpassed markers0，浏览器41.9分钟，未手动rerun；run于07:33:16Z创建、job07:33:19–08:16:16Z、runupdated08:16:17Z；有界HTTP5在正常TLS下200，index／JS／CSS字节和SHA精确、health／capabilities只读GET成功，AI／D1 0。最终同源公网：ac92／tree13e唯一首批公网实际7／7、2个精确文件（Timeline缩放4＋原transfer3），07:38:06.276Z开始、156.809599秒，unexpected／skipped／flaky0；7份逐case严格诊断errors／warnings／API全0，expectedHTTP按可选字段计（新4字段0、原3无字段），正常CA／ignoreHTTPSErrors=false／APIabort，真实AI／D1写入0；96runtime／26dist与冻结和commit前后逐字节／SHA完全一致。原始report1009168B／SHA256 `69e7deba009026e7f40c3c611a421e681508a75a1aead1492af967802539659a`；Root实际公网图：Root亲审该公网批dense320／transfer-mobile390／transfer-desktop1440三张实际图接受，与本地More1440／390／320＋four-tools320四图独立计；不声称公网图全部320px或所有身体部位无遮挡。

完整CI首轮91／100暴露两个真实运行缺陷：手机工具原40px不达既有44px触控门槛；新手势在限位投影归一化边界可返回表外浮点姿态。现分别修复至44px及稳健投影，保留原人体包络、作者原值与断言。其余失败修正真实按需弹层关闭／屏外相机取景／仅上传音频解码的测试屏障，未force点击或弱化动作精度。此前草稿条引发26px浮层／13px投影变化的拖动缺陷修复也保留。

最终运行96文件／dist26按冻结和commit逐字节／SHA封存。JS `index-B4aq9XS5.js`1147811B／SHA256 `51ca317a4a9e4185fb927c79aa4785df56f35451f58ebbf433159be24b419ab9` 与9a JS字节精确相同（文件名更新）；CSS `index-CcnCqTQI.css`75474B／`0441a7a6b847438d375cad8117b53984c3daa35ef8604bf1104313fa21421df1`；index645B／`fad20e70d989394deab160cd4893110d20a061d69f3ff8b0eb7c36c4f06a90bc`。Wrangler实际Read29 files、新／修改2文件（index与CSS）2／2上传、21 already uploaded，EXIT0；provider统计与96runtime／26dist库存分列，最终同版部署注释不再上传assets。 最后准确CI完整原始log 74941B／SHA256 `f279de4ad52956d11a2fd14a8a440250c77597947a7085f56d866d1297a23a3d`，native原始archiveSHA256 `5491d5f1876f783c78f8788e169148613a7489cc8205a5b2a76d4f812a251171`，时间 runcreated07:33:16Z，job07:33:19–08:16:16Z，runupdated08:16:17Z；raw首07:33:20.0846279Z／末08:16:15.0632608Z（UTC），实际逐例／失败／未执行数 480／480基础、25个唯一文件行与sum480一致；104／104浏览器、25文件、IDs1..104各一次执行且通过，failed／failure／notpassed markers0，fullyVerified=true、15核证项全true；不把计划数量、partial log或旧source成功当新CI通过。

初始b059上线／公网6通过仅证明该初始运行；cdc准确CI37880557802／job113659036357最终450基础＋91／100浏览器、9失败，原始log112816B／SHA256 `9345dae61b20b9437203a588d7e456c7657b2edd148463e5a4f850b5f3478206`。此前取消CI、TLS未加载应用0／6、两批3／6与严格0／2均保留；新source不借旧运行证据宣称最终通过。

用户最终撤回内置模板，已制作两个独立 `.choreo` 场景包：CMU85_12连续复杂街舞转身／倒置／地板技巧37.5秒；CMU61_08完整单人Salsa56.25秒。包内包含动作与原创128BPM参考节奏，可分别导入独立场景并二次修改；非原曲或某流行歌曲原版编舞。[复杂街舞37.5秒](https://choreo-scene-packs.danuberiverferryman.workers.dev/complex-street-dance.choreo)／[完整Salsa56.25秒](https://choreo-scene-packs.danuberiverferryman.workers.dev/salsa-dance.choreo)，附[导入编辑说明](https://choreo-scene-packs.danuberiverferryman.workers.dev/dance-package-guide.txt)与[来源许可／质量记录](https://choreo-scene-packs.danuberiverferryman.workers.dev/source-and-license.json)。 两包真实原生导入／播放／指定关节K／其它轨保持／撤销2／2通过（112.17秒），街舞最倒置第799帧另1／1通过（11.15秒），实际errors／warnings／API0；root亲审近取景及倒置人物接受。街舞681K、余3415（Spine／Chest／双Shoulder四作者轨）；Salsa1452K、余2644（双LowerLeg／RightForeArm／双Shoulder五作者轨）。Root／Hips及其余轨完整密集基底保留。

复杂包官方120Hz／4499真实帧，37.483333s→37.5s；Salsa官方60Hz／3421真实帧，57s→56.25s，公开BVH通用120Hz头不作采集率，不是120Hz下采样。转换者Tpose首帧跳过，其余完整段轻调速，不循环／拼接。固定25关节骨架保留RootXZ； wrist与2轴palm合并后，街舞2腿＋2掌短窗、Salsa1腕＋11掌短窗桥接与RootY支撑适配均公开。源映射、源异常修补、支撑适配、稀疏作者层、native编码、真实导入和皮肤观察分别计范围。

两包质量以校准、短窗源异常修补和RootY支撑适配后的基底为参照，9057／10173有限采样的最大作者旋转误差1.997188°／1.999203°；不是原演员骨架无损或连续时间全程证明。街舞手FK最大36.38mm／头19.53mm；Salsa脚底角点最大20.71mm、5个采样低于−3mm、最深−4.10mm。启发式支撑未保证水平滑步／身体碰撞消除，部分源姿态仍超保守编辑包络，作者数据保留。教学试跳、设备帧率与完整动力学仍未验收。

首次给一条密集基底轨写K会建立该整条作者轨插值，以基底首尾姿势补端点；完整姿态K同时写Root和全部19关节，可能改变其它原动捕细节。只修改一个部位时使用所选关节K。未写轨不是空动作，也不是全部已有拖动作者键。

4文件原始哈希：街舞26710050B／`e5f3d969c550fa6d401706b08cbe8beafb80a9346e1029e4d2c7a10a906afad5`；Salsa27041119B／`9d8022c073eb79210f8d6b1d9b661e2db05ee62541ca9fa1027551379100e34d`；guide3327B／`84da3c1f76eb5ea4d245f6433f33135631790f39ed6a35c1effd97ae2fef445f`；source/license105349B／`2432cab6f1c7f25fa683276804c95616024523ec4f49b64dae13da80f2fcad59`。实际下载回读：首轮HTTP4／4与Chrome原生下载2／2的文件名／字节／SHA精确，离线原6下载文件6／6及原严格nativecodec2／2成功工件复用通过；两次harness审计失败原状态保留，详见下方独立下载回执。

包与音频不进入公共代码repo；独立Cloudflare `choreo-scene-packs` 提供四文件下载，[GitHub Release v18-scene-packs](https://github.com/DFerryman/ChoreographyStudio/releases/tag/v18-scene-packs)于05:26:17Z正式发布，native id407489786／draftfalse／tag与target绑定95fb667，assets0、正文四外链exact。官方GitHub uploads两次401且native assets0、独立ASSETS首次upload JWT401及内置5retry／1of4仅暂存均保留，不能声称附件或暂存部署成功。首次运行token尝试KV返回401／Cloudflare10000，namespace0／PUT0；随后官方已安装Cloudflare connector确认同用户／账号，创建专用namespace `632828f74b8e48b0acb9bd3ac3aa2836` 一次，14个bulk请求／14key-success（两gzip包各6块＋guide／source2文本），native GET200核对14key和metadata逐SHA一致，无既有namespace修改／无expiry。独立下载Worker version `ce5ba5e2-87d2-4d42-a4ad-1f794bd9d3a2` 已上线；公开工件KV写入不等于编辑器D1或用户场景写入。实际下载服务版本／HTTP压缩还原／SHA／原生codec：05:23:18.637Z首轮curl4／4（HTTP200、TLSverify0、filename／bytes／SHA exact）与Chrome原生下载2／2（Content-Encoding gzip正常自动还原.choreo，无JS解压）字节／SHA实际通过；末尾请求审计误调用string字段url()抛TypeError，原脚本exit1保留，不记整轮exit0。05:26:46.922Z离线完成核对原6实下载文件6／6，复用原严格nativecodec2／2成功工件（音频SHA／时长／K／base exact），新增网络／浏览器／场景导入0；raw request events未保存，原先blockedRequests[]／errors[]／requests.length===2断言已实际先于TypeError通过；第一次离线completion在05:25:50.505Z误读空stdout为JSON，审计报Unexpected end of JSON input（exit1）也保留，实际codec成功工件已写出，最终改读该工件复用，未再执行codec／网络。最终combined receipt SHA256 `40cf4fe3b2070f086c2747c2bb468fb7200822e0b1fb4c53b62f5d7f8a2c9728`，原live失败receipt `6a3d865e466752ece9b041662f975b76aa86fe8bbad7eeb9d004264b867e4fda`，首离线审计失败receipt `9b76c12c74df6e00130f162c5eb2ff154ca4e2dcc7ba4ae1163149503073cf89`。

真实Workers AI／付费推理／D1写入／新图片上传0；v17人物数字资产和Worker业务源／绑定／限频配置保持。最终Markdown-only main与同版部署注释由独立回执和Notion记录，准确CI始终绑定所验runtime source，Markdown head不冒充CI head。 五Notion文本同步与native refs／四旧图保持读回见Root最终实际外部receipt，未新上传图片。

95阶段独立只读交接核验于05:31:20.408926Z实际通过：94／94运行文件与95fb667 Git blob逐字节／SHA相符、26／26dist库存／SHA完整相同、22个tracked public assets保持；没有新生成.choreo／BVH／AMC／音频加入trackedrepo，runtime／public／dist没有85_12／61_08包数据或引用，变更只为预计8Markdown。证据SHA256 `f4ad2e87649aaa7f46c536eef8ea1bbbdc8bb0f9e0564ef9ee541ff61d088161`；没有新增测试／浏览器／网络／API。

95阶段独立历史：运行95fb667／tree04cc31b已main，Cloudflare `8878bbd0-0f22-431d-80f9-8b1c61be69bf`（native19）／100%，deployment46cea86a；本地458／24与公网8／8、HTTP5实际通过，但准确[CI37885903336](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37885903336)／job113675734713／attempt1于05:34:37Z结束FAIL：458／458基础24文件、浏览器99通过／1失败（40.5分钟，100用例／24文件已执行）。唯一case59 tests/pose-guidance.spec.ts:103／line116要求可见草稿→K逐组件exact，新手势限位投影反复normalize造成2.22e−16／5.55e−17漂移；属于运行payload缺陷，原strict断言保持，不能把公网8／99例通过冒充完整CI成功。原始log78860B／SHA256 `86bdf975a70b9c67facdc1d871a33206a7a207b9920c2f9b63dd720a98d91dd6`，runupdated05:34:38Z，未手动rerun；后续修复只稳定新手势输出，既有KAPI／作者加载／bake／普通限幅不改。下载文件和发布tag95已验证事实独立保留。

EB中间阶段历史：运行eb96b29／tree944c6a77已main／Cloudflare number20（858edcb2）100%，local464／24、strict focused2首批59.442秒／诊断0通过；公开批次原计划9，但随后隔离worktree的同baseEB多轨6被suffix testMatch重复收集，实际15／15（5文件），05:55:57.330Z开始、239.329749秒、15个逐case strict诊断errors／warnings／API0，unexpected／skipped／flaky0。两份multitrack测试bytes／SHA完全相同，原断言保持；原postprocess assert9失败为统计审计问题，按真实15并列planned9＋duplicate6后完成收据，无另一次browser。94／26／HEAD／tree前后EB exact，HTTP5 TLS0／SHA通过。准确[CI37890466002](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37890466002)／job113690009837／attempt1／main push于06:30:51Z实际SUCCESS：464／464基础（24实际文件行／sum464）＋100／100浏览器（24文件、IDs1..100唯一、failed／notpassed0），05:51:07–06:30:48运行39.7分钟；原case59于06:13:15.1205182Z实际通过20.9秒。raw73665B／SHA256 `8b9f00a96a9a9666d76f1d9bf43731be43996ae52a98273349e0e99e202e26e0`，fullyVerifiedtrue，未手动rerun。成功只属于EB中间版，本段不能证明后续新版Timeline完成。新手势actualsource证明99,001 edits／185,367 calls／最多42相邻ULP、component4.44e−16／chord5.09e−14°、fixedpoint／limit0失败；work candidate-v2最多6ULP另列，不冒充实际source。

最后Timeline v1历史：6baa73c／tree10f482b0已pushmain但未部署Cloudflare，本地480与同源20例通过属于该首冻；随后真实complex native import1440→320使selectedChest行留在scrollbox外，严格toBeInViewport实际0／1，原断言不放宽。v2仅KeyframeEditor选中行effect加geometry.visibleWidth／labelWidth依赖，另9个正式source文件SHA原样，06:42:41.954274Z新冻、manifestSHA6aca4550ac456b31fb62424f6d12def7dbb4b5bfd55b73c659343f7cf60da8e2；最终新4＋nativecomplex1同源5／5不能冒称v1的20重跑。首触屏2／3、toast遮挡与capturelost修复历史另存，不隐去。

实际320px倒立取景限制：腿端可被既有stage工具／琥珀提示或画面边缘遮住；timeline/layout与选中行通过不证明所有身体部位无遮挡。另一次纯camera视图1／1（28.715345秒）保持project／K／selectedChest／time exact、诊断0／source10SHA同，也仍有上述遮挡；没有改包默认camera或扩改source，保留手动取景能力与限制。

Timeline v2／9a独立历史：运行9a023173c9a9848ab5c105cd1f981a778929d7c1／treea19e0215175cda2ca57a4fdba25a7bdd2c61a346、Cloudflare1ec19836-9be6-4ee5-9277-a04faa217071（native21）100%。准确[CI37895306305](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37895306305)／job113705194094／attempt1／main push于07:20:52Z实际FAIL：480／480基础25文件＋103／104浏览器25文件、104unique全部实际执行，33.2分钟。唯一case103 tests/transfer.spec.ts:258在320px打开“更多”的移动／复制弹层后页面scrollWidth340>320；后核原生截图与DOM，根因是stage右侧四工具left8／width331.672／right339.672，更多弹层自身right313且client=scroll304，没有弹层本身溢出；原≥44px按钮高度已通过，失败在实际转移后段前，不能称payload错误或103例等于完整成功。新Timeline4和strictpose已通过，仅保留对应source范围；Root授权最小CSS布局修复、新source push／新完整CI，原test／assert不改，不裁切或全局overflow-x掩盖，不手动rerun9a。原始raw78937B／SHA256 `d37f7465e03d01db0c12ee37ca5676c665d71b03cb493f2a324afd18bfec8643`；run created06:46:33Z，job06:46:35–07:20:52Z。watch在07:20:34Z出现HTTP401是CLI凭据过期，随后独立官方读取取得native FAIL，401不是CI失败原因。

此前9a运行[source9a02317](https://github.com/DFerryman/ChoreographyStudio/commit/9a023173c9a9848ab5c105cd1f981a778929d7c1)／tree `a19e0215175cda2ca57a4fdba25a7bdd2c61a346` 已push main、ls-remote读回；Cloudflare `1ec19836-9be6-4ee5-9277-a04faa217071`（native number21，产品迭代v18）于06:49:08.461855Z创建，初deployment `2418db53-a3de-49c8-9e25-73286cc243aa`／06:50:22.163473Z／100%，native注释绑定source9a／treea19。

9a阶段v2本地 `npm run check` 于06:44:11 UTC开始：480／480基础、25文件、15.95秒，前端类型与Vite1944模块／2.29秒构建EXIT0；Worker inputs完全未改，复用enabled原脚本类型PASS，首sandbox listen EPERM在tsc前的环境失败保留。v2同源新4＋native complex1实际5／5，06:43:26.890Z开始、112.879285秒，0skip／flaky／unexpected，5份errors／warnings／expectedHTTP／API诊断全0，正式10文件SHA前后同；v1同源20通过与native resize0／1不冒称v2批次。 准确[CI37895306305](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37895306305)／job113705194094／attempt1／main push／head9a02317：实际FAIL：480／480＋103／104，唯一case103窄屏stage四工具越右边界（打开转移弹层时被宽度断言发现）（完整失败记录见本历史段）。该9a版本有界HTTP与公网：有界HTTP5项在正常TLS下200，入口／JS／CSS字节与SHA精确，health／capabilities只读GET成功；同source9a／treea19公网首批实际13／13、5个精确文件（新Timeline4＋多轨6＋严格限位1＋控制入口1＋膝限位1），06:52:28.862Z开始、211.682553秒，unexpected／skipped／flaky0，13份逐例严格诊断errors／warnings／API及可选expectedHTTP全部0，正常CA／ignoreHTTPSErrors=false，真实AI／D1 0；96运行文件／26dist前后与冻结和commit逐字节／SHA相同；原始report1743709B／SHA256 `29cf5f318e98fd999f7be130b306cffd380ae4eec634f48c722055d9a12a7e95`；root实际看图：Root亲审该公网批实际dense1440／dense320／expandedjoint／strictknee四图，接受帧间距、逐关节轨、选中标记及限位姿态；与本地v2四图分别计数，未声称所有取景下全身无遮挡。

9a阶段source96文件／dist26文件按冻结和commit逐byte／SHA封存。JS `index-D7GFBHiA.js`1147811B／SHA256 `51ca317a4a9e4185fb927c79aa4785df56f35451f58ebbf433159be24b419ab9`；CSS `index-CwSlKOEP.css`75387B／`487b28537a9ad23e0fa95a09a6c1cd9020811de1bdbc3d53003a5c6c5231bf72`；index645B／`35824fc5f3fdfc2872cb6b10c45e9b2dd3301b9e166f9ba217b1528f35d45c13`。实际上传／native资产统计 Wrangler4.147.0实际Read29 files，3个新／修改文件（index.html、新JS、新CSS）3／3上传、20 already uploaded，EXIT0；provider上传统计与本地冻结96runtime／26dist库存分别计数，后续同版注释不再上传assets，版本／部署时间与100%由native读回。

9a失败附件历史：最初CLI官方artifact重定向403／0byte失败收据保留；同DFerryman官方GitHub connector合法下载原生preview-test-results ZIP，6200439B／SHA256 `e667e299e26fac870a67cef1ce59a14a8c044eb3f08ff818c46f93e40c835780` 与native metadata精确。Root随后授权离线解压，ZIP CRC全过，实际PNG／error-context.md／trace.zip共3成员，各bytes／SHA已封存；成功属于connector下载，不把CLI403写成成功，离线阶段新增网络／browser／图片上传0。该附件只属于9a CI103／104的真实失败，不能证明新CSS source通过。

窄屏修复的本地准备历史：两次setup因无可用本地server／默认网络sandbox导致EPERM，校正network-enabled本地Vite与Chromium后，原9a真实重现0／1（07:24:44.723Z、23.568244秒）核页面340px／四工具right339.671875／更多right313且scroll=client304。修复源只加≤360px工具padding-inline9→6三行；保留12px完整文案、44px高与单行，原正式transfer3／3（07:29:55.501Z、111.439706秒）全部原Root／rotation／baseTake／revision／collision／undo／save／draft及width断言保持。首补充visual1／1（28.499455秒）实际通过但desktop More被toast外点击关闭，该图不接受；修scratch截图顺序后另补充1／1（07:33:47.262Z、28.819567秒），1440／390／320页面宽等于视口、320四工具right315.671875／高度44px／中心可点击；126源快照前后SHA完全一致。两setup失败／原0／1／首不完整图均保留，补充图与原3例分别计；不得替代新完整CI或公网验收。

最终准确CI额外核证：原失败case103于08:15:23.7747710Z实际✓（27.5秒），包括width之后的全部原严格转移断言；旧9a与新ac92的transfer.spec.ts Git blob同为 `a380fd99412fc16fc1554ca9db198990bf93d9e6`，原fixture／assert未改。case59于07:57:26.9031682Z实际✓，新zoom92–95全部✓。CI check07:33:32–07:33:54、Worker types07:33:54–07:33:56、browser07:34:17–08:16:14（41.9分钟）。长寿命watch最后CLI exit1和首collector读取各出现一次凭据过期401，两个原始记录独立保留；fresh官方读取取得同一次native SUCCESS run／job、完整raw与archive，collector EXIT0、独立raw审计通过。两次401是CLI日志收集身份问题，均不是CI／应用失败或rerun，没有替换业务源码／断言。

## Version 18 · 极简舞台与分轨时间线（发布验收中） · 前期记录（历史）

主工作区移除常驻导航、重复数拍／版本信息与精细参数面板，舞台铺满视口，Timeline浮在底部并可收起；播放、时间定位和明确添加／更新完整姿态K保持可见。音乐、Root位移、身体、左右臂／腿分轨，身体组可展开到单关节。拖动已有K不要求播放头位于源帧，只移动该轨／组已有稀疏K，碰撞仍需明确确认；基底、作者优先、草稿、撤销／重做和精确末帧保持。音乐拖动只保存可选30fps偏移，不修改CountMap、原音乐或动作K；独立场景时钟支持前后静音，偏移随历史／保存／完整备份恢复。瞬时投影为浮层预留空间，不写入相机或动作数据，保留v17选定人物和所有模型字节。

最终本地 `npm run check` 于2026-10-09 02:47:38 UTC开始，实际 **450／450基础测试、24文件、11.05秒**，前端类型与生产构建通过。未改Worker源码／配置，Worker类型检查通过；官方Wrangler dry-run在任务目录日志／配置下通过，首次默认配置目录ENOENT保留。主JS `assets/index-DL-vZM0V.js` 为1138041B／SHA256 `f0d9cecb899bad68997fe9c9ab7d2ad5e999a6a4a05ede9a60cae00fddda9f73`，CSS `assets/index-kmxrmj-f.css` 为66297B／SHA256 `7d557823d890502d455c693246eabc41655e324601a7b24aa9566c85b0267e1a`；原有大chunk提示保留，不作为设备性能结论。

首批新增浏览器6项于02:41:12.164Z开始，187.586秒，实际3通过／3失败：桌面／手机舞台旧flex高度规则和运行中源码更新引起音频流程重载，随后修复布局并冷启动固定源码。第二批固定运行源码于02:48:07.669Z开始，214.924秒，仍3通过／3失败：测试投影尺寸与实际舞台存在小数差异、测试读取备份后菜单未收起遮挡手机工具、0.3秒可听窗口未被轮询捕获。随后仅修正测试操作、投影与可听观察窗口；已形成姿态写K逐组件精确保留要求不变。02:54:07.325Z聚焦3项53.268秒通过，其中Root指针目标用了临时较宽断言，因此该批只证明精确draft→K、手机流程和音频边界，不能冒充原高精度指针验收。后续高精度复核、相关回归、准确源码CI和上线结果另据实际回执补充，当前不宣称完成交付。

测试阻断真实API调用，真实Workers AI／付费推理为0。以下v17及之前证据完整保留。

**高精度复核暴露实际运行问题并修复。** 恢复原五位小数米断言后，02:55:30.981Z两项32.083秒均失败：桌面Root实际0.25013406164626417米、手机0.2501237872134692米。真实native事件probe确认：草稿提示使Timeline增高26px，手柄拖动过程中投影偏移从115.5→128.5px（桌面）／139.5→152.5px（手机），改变同一指针的射线；native浮点坐标误差仅约0.000018px。因此第二批Root失败不能归为单纯测试精度问题。最小Stage修复为正在拖动时冻结投影，释放后下一帧应用最新浮层高度，取消／显式取景立即同步；不补偿K数据或放宽断言。probe首默认sandbox在测试前启动失败、未进入UI，另网络授权运行实际提供上述证据，二者分别保留。

修复后本地完整检查于03:00:21 UTC重新实际通过 **450／450、24文件、9.44秒**，前端类型／构建通过；Worker源及配置未改，复用其类型检查。最终主JS `assets/index-JAM6kMSD.js` 1138058B／SHA256 `1297e24c678fb3c058747619ad087bacc8be8039a288caf0cececf88431be9df`，CSS不变。之前11.05秒和旧bundle保留为修复前历史。最终新流程和旧功能浏览器复核继续使用固定运行源码与原高精度要求。

最终固定运行源码新增浏览器 **6／6** 于03:02:25.040Z开始、96.267秒，失败／跳过／flaky0，6份实际errors／warnings／API诊断全部0。覆盖桌面1440px／手机390px场景占满视口、收起浮层不缩Canvas、显式添加／更新完整K、分轨／组／单关节拖动、碰撞取消／替换、Escape、撤销／重做、音频正负偏移／静音／CountMap选段／原音乐SHA、完整备份和本地重开。Root指针仍原五位小数米、K逐组件等于实际draft；实际pointerdown、六次move和up的投影偏移桌面恒115.5px、手机恒139.5px，释放后分别更新到128.5／152.5px。root亲审该轮实际桌面／手机两图，接受最大化舞台、浮层和全身可见；原失败与临时宽断言批不删，不能宣称首6全通过。旧功能相关回归和完整准确源码CI继续待实际结果。

旧编辑相关13项已由首批 **12／13（5.4分钟）** 加必要修正后的 **focused1／1（21.4秒）** 覆盖，不记首13全通过。唯一失败为测试用旧右上“空白”坐标清除选择时误点新浮层相机工具；共享helper改为先确认实际可见canvas命中，再真实点击空白候选点，未force、未写DOM选择或改运行源，原动作／5微米／历史／原音乐断言保持。覆盖320／390／768／1440布局、desktop／mobile稀疏K／SLERP插值、各轨删除与空操作、作用域导航、草稿写／放弃／取消、碰撞复制／移动、Undo／保存／重开。此前default网络隔离导致本地Vite不可见、0用例启动退出另据保留，未计业务失败；授权网络环境复用固定Vite成功。6项layout／timeline含内联error／warning／API0断言；其余旧回归未把所有warning落JSON，不能虚称13份零warning文件。root另亲审最终展开关节图，累计该新6轮3图接受。运行94文件／dist26文件前后SHA保持，真实AI0；完整准确源码CI与发布继续待实际回执。

运行源码 [b0599e2](https://github.com/DFerryman/ChoreographyStudio/commit/b0599e2d8b84b5ba872a832517f2013a69a55b4b)／tree `97bfc0d702c7b5e9f76494d9775cfe5b92730fdb` 已推送main并以remote读回核实。Wrangler实际部署03:17:51.255265–03:17:59.191705Z成功，4新／19复用静态资产，Cloudflare version18 `3709225d-3e2e-43b3-ab76-0513720c75bb` 于03:17:56.952002Z创建，首次deployment `11e8ff00-1f4a-45a1-a990-ebc9b007a999` 于03:17:57.556317Z创建、100%；native版本／部署读回绑定上述运行SHA／tree。Worker绑定、限频和无D1写入保持。标准curl有界HTTP25检查（23静态SHA／bytes＋health／capabilities两GET）于03:20:48–03:23:39.091803Z通过，根页既有probe复用，后续脚本只增加24请求；首urllib传输诊断因403退出，23静态请求已提交但单项结果未保存，业务API0，不能记成成功HTTP或运行资产失败。随后标准curl200和最终SHA核验结果分别保留，无重复公开轮询。

初始准确 [CI37878546326](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37878546326)／job113652628358／attempt1／main push被主动取消，最终03:19:55Z updated／job03:19:54Z结束，不能记完整100通过。其基础450／24文件和Worker类型实际通过，browser100已开始但仅2项accessibility实际通过；03:19:46.1907409Z已发生首AI用例失败，取消后没有完整browser汇总。原始唯一job日志55156B／SHA256 `c90e03089f11a982e5b305603be8acc858b3d3e184f28fb8532df8c9f202868d`保留。取消原因原先是本地中止32批发现音乐名定位遗漏；该批实际2通过／1音乐失败，第4项被中止，不算32全通过。音乐测试兼容无take时编排音乐卡片和手动时间线音频片段后，唯一focused1／1（7秒）通过，所有原CountMap／音乐字节断言保持，首次anchored grep收集0另存。

AI失败随后在本地mock首项真实0／1（61.574秒）复现：备份helper未收起新顶栏菜单，挡住候选预览按钮。仅修正测试读回备份后原生键盘关闭菜单，并统一独立helper同类副作用；未force、未改动作断言或运行源。最终mock AI **6／6** 于03:25:57.715Z开始、73.801秒通过，6份实际errors／warnings0，7次POST全部fixture fulfill、真实AI／付费0；429／502各一条是明确预期mockHTTP错误，不能称所有expectedHTTP0。将推送这些测试修正以启动对应源码的新CI，不手动rerun，不重复上传未变运行产物；公网新6与新CI结果另据实际记录。

最新发布核验：运行 main `b0599e2d8b84b5ba872a832517f2013a69a55b4b`／tree `97bfc0d702c7b5e9f76494d9775cfe5b92730fdb` 已部署 Cloudflare version18 `3709225d-3e2e-43b3-ab76-0513720c75bb`／100%，初始 deployment `11e8ff00-1f4a-45a1-a990-ebc9b007a999`。测试操作修正 main `cdc3723a53e65ce465d7a06ee748b347e7ceaf07`／tree `98a001fb1613f67ee7b9bff34f0a4e0a6e4a0243` 已远端读回，运行94文件／dist26与已部署版本逐项SHA相同。有界HTTP25已通过；公网初批6因执行环境CA信任失败、未进入应用，保留0／6。仅在任务临时profile配置现有CA的正常信任，TLS验证保持，未改HOME；单document GET返回200／TLS1.3／secure，随后唯一最终公网6于03:51:37.827Z开始、92.813秒全部通过，六份实际error／warning／API诊断0。root亲审该轮桌面1440／手机390／展开关节三图接受。准确CI37880557802／job113659036357／attempt1仍待完整100浏览器结束；此前取消CI、音乐／AI／相机浮层测试修正和所有失败保留，不提前宣称100通过。真实Workers AI／付费／D1写入0。

最新新增交付要求：用户撤回内置模板，要求直接可导入、稍复杂的成熟舞蹈场景包以观察效果上限，并支持Timeline／Track与二次修改。仅制作独立 `.choreo` 下载文件，不修改内置库或运行代码。使用合法CMU真人动捕：85_12复杂街舞转身与地板技巧37.5秒，61_08完整Salsa单人舞段56.25秒，附原创参考节拍；不声称是某流行歌曲原版或原曲同步。来源／实际帧率／短窗异常修补／固定骨架重定向／接地残差与4096作者K限制均需据实记录，完整高频基底优先保真，未经验证的包不记交付。包与音频等生成文件不进入公共代码仓库；待实际导入、播放、修改和真实人物视觉核验后提供下载附件。

## Version 17 · 用户选定 06 人物（已上线，准确源码CI通过）

选型证据为八候选各三实际GLB／glTF视图，共24个渲染视图及总览；05最终名“写实柔和”。用户明确选定06 Quaternius Superhero Male力量型。生产仅默认这一CC0标准免费包人体，不新增切换UI；原65骨／8483顶点／14318三角形／四权重、原几何／TRS／inverse bind保存。原25作者控制、K／Root／精确时刻／CountMap／历史／limits／IK／脚锁／步伐契约保持，显式异常作者K最高优先。

**方案与来源范围。** display-2固定21物理骨对齐canonical FK，runtime独立克隆inverse-bind数组／矩阵，躯干root／pelvis／三脊柱／双锁骨／neck／完整Head共享来源G（S1.0167145770612094，actor-localY−1.0403313802775447，Z+.06649314313096474），Head factor1；四肢和Foot／ball／leaf82毫米校准另行保留。源raw数据未写，显示有固定枢轴／肢长变化，不宣称完全原生FK或全形体不变。GLTFLoader会归一化权重，现从有界原GLB accessor恢复原Float32 bits后再克隆。六资产可复现bitexact，source5原生姿态全8483点0米是原生合并范围，不混称运行显示。publicREADME21099B／SHA `14a040b502495cbd844209ec056681a9da82feeb7cde18035215d068b5dd5202`已冻结，不回填部署结果。

**独立CPU实际验收。** 01:25:07.992–01:25:11.539Z／3.547秒，源码／来源hash前后相同；15×8483全点最大0.237187291微米，21独立canonical pivots最大8.9509e−16米，2微米原阈值保持。7双脚锁root移动的实际脚底最低6.042943毫米、相对皮肤漂移最大4.422363毫米；四向步各6步／122时刻、支撑误差最大3.086559毫米、最低真实脚底6.143789毫米，原5毫米／2°／−3毫米阈值未放宽。profile1.85米、头顶离舞台地面1.849999950714米、minY6.427074801毫米和实际mesh高度1.843572875913米区别记录；纯body3262点／纯head1802点相对来源G轮廓保持浮点误差，混合胸锁骨1025点宽−0.594783%、高+0.092224%。最大来源形体误差17.40094毫米出现在混合胸锁骨区域，不能称全身完全不变。CPU直接构造rawmesh，实际GLTFLoader加载另由浏览器核验。

**本地完整检查。** `npm run check`实际421／421基础、22文件、15.36秒，前端类型／Vite构建通过；原有大chunk提示保留。主JS index-CBtn1tpp.js1125855B／SHA `2d5eb17e74847f1bf0dc81199c2d3ac6e5a48533d3f36d8890b07027a4c714fd`。未改Worker源／配置，实际类型检查EXIT0复用；首默认日志位置ENOENT仍为真实诊断，第二scratch日志仅继承代理warning。旧420数学／构建通过是被拒首形体阶段，不能作最终验收。

**真实App相关15覆盖。** 完整15于01:27:19.181Z开始、276.838745秒，14通过／1失败；新增联动流程先因测试未切真实旋转工具且沿用前IK轴未清零而未完成，修正仅tests/quaternius-stage.spec.ts，focused1于01:34:50.985Z／27.816606秒通过；非首轮15全通过。最终77个选定文件hash前后exact，runtime／数字assets未改；实际加载原4权重SHA `d8fd81863a6c5e5926b450169febc992cace86ec98cd2cd0b36889444f2ef1a2` bitexact。浏览器oracle是15姿态×1563选点／21pivots、2微米，不冒充CPU全8483点；fixture1486599B／SHA `5548ffcf54261952f428d22fff5a955dcdfa1133ad214a2322a3f9bddee95ba6`。6份实际诊断errors／warnings／expectedHTTP／API均0。38张实际App图中root亲审13张，包含最终联动草稿／K两图及neutral、150°、环拖草稿、插值播放、neck/spine、手脚IK、desktop/mobile等，形体自然和皮肤连续性接受；候选3pilot图与此验收分开。

**失败保留。** 初始native偏移脚锚／pivot拒绝；display-1虽数学2微米通过，actual150°／170°胸肩水平平台／宽颈被root/browser拒绝；首完整15的14／15权重hash因GLTFLoader归一化失败，后恢复原bits；v2完整／focused的真实工具及IK轴测试纠正保留，不降低断言。source重现首跳过nativeRef步骤导致同内容JSON keyorder字节不同，正确四步重现后通过，未改生产；Worker首ENOENT和启动／connectivity退出均留档。MHR原source fixture／2微米／3%断言移入明确历史核验，未以新阈值删去旧证据。170°与异常膝压力K、悬空Root不是通常可做舞步／着地证明。

准确源码CI、运行main／Cloudflare与有界公网已真实核验；最后仅文档提交经同版注释关联，最终main／tree／deployment由独立回执与Notion实际metadata记录，不偷换准确CI的runtime源身份。真实Workers AI／付费生成0，后续七组功能暂停，M0–M3不关闭；Notion最终仅文本插入和读回，原文／引用／历史／原4图保持，不上传新图。以下v16及之前全文保留。

运行源码[ee376928](https://github.com/DFerryman/ChoreographyStudio/commit/ee376928f200e87e4eb48bbfec00fa60741fd12a)／tree `89c828c7b2770fd416a04c87dfe0fc04872dd7f2`已推送main；其准确[CI37871363910](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37871363910)／job113629975482／attempt1／main push于2026-10-09T02:10:06Z实际success：421／421基础（22文件）＋94／94浏览器（23文件），94逐例通过、失败／未通过0，未手动重跑。Cloudflare v17 `18dd4982-503a-4dfc-936c-6cffa7157b46`／100%，首次deployment `22f6f251-3b75-4495-800a-c8a3792e449a`；一次HTTP25和唯一公网8首轮通过，7份实际API／error／warning／expectedHTTP诊断0。root再亲审同轮23图中的6实际公网图，合本地13图接受形体／蒙皮。最后纯Markdown提交将通过同版部署注释关联最终main／tree与metadata，再同步五份Notion；不再上传运行资产或重测公网，真实Workers AI／付费／D1／新图片上传0。

实际Wrangler4.147.0唯一运行部署窗口01:46:35.365602–01:46:42.466173Z，version创建01:46:40.670588Z、首deployment创建01:46:41.132648Z，8新／15复用资产，bindings／settings不变。HTTP25（23静态SHA＋health／cap两GET）于01:48:03.064771–01:48:06.177276Z；首收据deployment参数手误由native读回更正，25检查原样保留、0补请求，不改成从未出错。公网8于01:49:39.159Z开始、110.911739秒，23实际App图、7实际诊断全0及第8严格late-bind；没有新增第8JSON或第二公网轮。

准确CI job从01:46:07至02:10:06Z共1439秒，browser终行02:10:05.0576071Z为94 passed（23.0m），runupdated02:10:07Z，首次观察02:10:42.411600Z。唯一完整原始log72182B／SHA256 `a0da8492b6c0573b5bdba0783bb3a8e53effbdf69624c1548272b77a1fcd5e2a`；准确CI收据SHA `99f24dc257ea8d8caa0c6618584ae02afc8d910499ebc2f8e9e60cb0210ea590`。准确CI仍绑定ee376928／tree89c828c7，之后纯Markdown head不冒充该CI head；冻结runtime、26dist文件和publicREADME继续复用。

## Version 16 · 平地自动迈步（已上线，准确源码CI通过）

范围是作者Root路径的平地左右／前后交替步，保留稀疏K、baseTake、脚锁、上半身、区间外和CountMap；作者K优先、三帧淡出、Root XZ准确与派生Y≤4厘米。修正后受限IK／适用性预检覆盖整数帧和所有原作者Take精确时刻，包括fade，不round或按frame去重丢原knot；仍不宣称交叉步、转脚、跳跃、主动平衡或完整连续力学。

较早本地`npm run check`于14:36:05Z实际通过：**406／406基础、21文件、8.76秒**，前端类型／Vite生产构建通过（1938模块、563毫秒）；Worker类型检查exit0且配置未改。旧主JS`index-ZB_SFpRR.js`1127474字节／SHA256 `24f71e47b02bc50ea65a357e59ccb1c33592ad382ae9f3b5305c644ec77f6cab`，CSS`index-e4GzrIK6.css`63251字节／`ba41e19f29da5255caa74edd5523fd67e98f12ef2038e7b1d5506da08463b375`。这是该时点历史构建，不是最终源码或目标设备帧率。

相关core15／15、既有K／脚锁／作者／键转移47／47、UI／备份65／65均实际通过。首13项仅8／13，5项失败来自插入knots后原Take插值重采样偏差；修正来源采样保护后13／13，补边界后15／15，失败保留。覆盖末样本、来源停顿／逆向、6001上限及异常中K仅跳过相邻段。浏览器首启动因crashpad setsockopt EPERM／SIGTRAP退出，未进入业务用例，不能记作业务失败或通过。

首次实际相关浏览器3／3于`2026-10-08T14:36:27.227Z`开始，51.668394秒，unexpected／skipped／flaky及报告errors0，3份实际API／errors／warnings诊断0；是在上述未进入用例的启动失败之后首次实际执行，不改记为首启动成功。首收据的事后sourcehash采集与UI修改有竞态，已明确校正关联，不能声称完整首轮源码捕获或用旧图关联新UI。根代理亲审旧左／右支撑、播放、390px及中间K共五张，实际MHR从头到脚、连续蒙皮无明显断裂，手机脚部完整。异常膝−100°中间K截图只证明作者优先／相关区间跳过，不标普通可执行舞步。

**独立审查发现并修复的非均匀时刻漏检：**原Take时刻`0,1,1.01,1.02,4`秒，Root X为`0,.125,2,.1275,.5`且没有Root K，旧整数预检报告6步可用，但1.01秒实际支撑残差`1.4986287506859723`米、朝向`.478624397`弧度；此真实runtime漏洞不以弱化门槛掩盖。原406／3浏览器通过保留为旧scope历史。最终预检纳入原精确时刻和fade；新增5用例覆盖原knot Root突刺／腿超限／Y跳跃及两端fade突刺，均跳过并保持原times／poses bits。核心20＋旧47于14:46:57Z实际67／67、5.08秒及tsc／diff通过，14:47:26Z冻结；receipt SHA256 `7839631a1665aec1e9a47fd6ea085555d41d0f040b6a37db8a034f9811530853`。独立原突刺复核于14:51:07.282Z得到0步／unreachable-steps、原Take时刻及姿态／序列准确保留。

最终本地完整`npm run check`于14:49:52Z开始：**411／411、21文件、10.89秒**，前端类型／Vite通过（1938模块、545毫秒）；Worker无源变化，复用上面实际类型通过，不重复。新主JS`index-jecJey3z.js`1127945字节／SHA256 `a3d82d25cf786cb65f19bb40feae17fd6e57287fd5f1fce97259a4f6421d99c6`，CSS仍63251字节／SHA `ba41e19f29da5255caa74edd5523fd67e98f12ef2038e7b1d5506da08463b375`；模型README14651字节／SHA `c6c2702dc16e8e047d8b7f36b08487554cca39cc588f5b0593f0eaea10dfa551`仅纠正文案，模型数字资产原字节不变。

最终UI将采用／关闭和预览合并同一模块；必要相关**3／3**于14:50:34.360Z开始，50.677040秒、unexpected／skipped／flaky及报告errors0，3份实际error／warning／API诊断0。最终收据窗口14:50:33.549181Z至14:51:25.067609Z，42个选定runtime／spec／manifest／GLB／gzip哈希全部相等；该42不含rigJSON，其与其它3数字资产由根代理独立4资产清单核对不变。报告SHA256 `5fafcdc5d7f17e51d4b41a79f5ada3b785c9beab26cfbf1cb611cfba37f9dbe3`，最终收据SHA256 `29dd9c66f0d257afde30f883b335f4e582762b834800842b19ff2913866e4cf7`，早先较松窗口不作最终依据。根代理又亲审本轮左支撑预览／右支撑采用／390px／异常中间K四张，MHR头脚全体和连续皮肤无明显破碎，采用／关闭在同模块；异常膝原值保留只作作者契约压力证据。左右支撑正常图可用于本轮Notion原生图库，尚未上传。相关流程覆盖明确采用与关闭、原K重算、取消／Undo／重开和完整备份、过快／锁冲突无可用候选；这些结果不替代完整准确源码CI。离散联合预检仍不是连续动力学证明。

### v16实际发布、首CI失败与测试限定修正

运行源码[fb7188ac](https://github.com/DFerryman/ChoreographyStudio/commit/fb7188ac99b272a9d583e4fefae54b4933904db2)／tree `e9465b73815ac8310c080a1e2de1f07d7dc8e28b`已main；普通官方CLI唯一运行上传于15:00:45.097471–15:00:56.866549Z成功，4新／13复用资产，rawPSD排除、gzip复用未重传。Cloudflare v16 `3be3c456-b824-4b67-9b21-bff8dd0271d0`／100%，首次deployment `5dd829ab-cf9d-4d61-85dc-a1cf820bfb1d`／15:00:54.629801Z。HTTP19／19（17静态＋health／cap2）于15:02:09.940367–15:02:12.570590Z完成；唯一公网7／7 FIRSTPASS于15:02:28.967Z开始，96.356428秒／15:04:05.356775Z结束，6实际JSON的errors／warnings／API0、第7迟到绑定严格断言0，不虚造第7份diagnostic。线上receipt SHA256 `97f07705e66a96ade50e4e15eed5cada2ab30fd9ac383e9980d068e729123bf6`。根代理亲审公网左支撑／390px／实际旋转环150°写K三图，后者保留肩部配合提醒，是作者／皮肤压力证据，不证明正常舞步全身可行。

准确fb7188初轮[CI37797090763](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37797090763)／job113379269228／attempt1失败：410／411，新增完整备份历史用例默认5000毫秒超时、实际5090毫秒，未运行Worker／browser阶段。完整日志34877字节／SHA256 `3fbdb1c85d62cee56f3fb852325e22e24bd9e0eaf34464fabf7ad3dcbff8b797`保留；只为该有界历史用例设置15秒timeout和注释，断言／fixture逐字未改，相关单项1／1实际2141.559毫秒通过。测试限定[e26813f3](https://github.com/DFerryman/ChoreographyStudio/commit/e26813f35fd9dd4e26ce15ffc3a32f5623726c4c)／tree `e680afd1463c86e18f49feb0de7e7295dcb36cf9`于15:09:19.048214Z native读回，除该test的全部git blobs／dist20相同，等价收据SHA256 `b2f6fa2cdfc1f01b7a93e92168d9ace9c2e8311f37890d81c8ac90464b6719f1`。复用已验fb运行版／HTTP19／公网7，无新上传／公开浏览器复跑。

准确[e268 CI37798386400](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37798386400)／job113383745739／attempt1／main push已实际completed／success：**411／411基础（21文件）＋92／92浏览器（21文件）**，92逐例通过，失败／未通过标记0。Job15:09:23–15:30:08Z共1245秒，首次读回15:30:26.531740Z；browser15:15:37.087–15:30:05.997Z、终行14.5m，原备份历史用例此次2466毫秒。完整日志67998字节／SHA256 `751104b1125e4ed9f3254b8c6cc9a57f717c976c4c360b79368266813b22b594`，准确CI收据SHA256 `42fe065e08d8f49052dcbcee8b0a091c33203736b88a5e4b17b532d7b4f418b6`；不是首CI全绿，未手动workflow rerun。

最终仅10MD main通过同一v16／100%部署注释关联，不重传运行版或重复公网；实际最终SHA／annotation metadata由发布收据及5份Notion正文读回核对，避免为写自身SHA再提交文档。v15的380＋89及14压力图不替代本轮证据。可选两张新步伐截图上传被自动审批拒绝，原因涉及图片外发授权／目标信任及凭据文件；进程尚未执行，实际POST0、凭据文件0、第二prepare0，无重试／绕换工具。新图只本地亲审，原4张Notion原生图保留，不声称6图；授权的正文同步继续完成。真实Workers AI／付费请求0，MHR本地修正实际计算，数字资产不变。

日期：2026-10-06 至 2026-10-08。对象为当前仓库的原创合成预览，不是原工程包 2.1.0、真实动作或教学发布验收。

## Version 15 · 全身蒙皮与人体提示（已上线，准确源码CI通过）

本轮已接入Meta官方MHR v1.0.1来源人体、127内部骨骼、原生绑定／权重及公开学习式姿态修正，草稿、写K、插值和播放共用显示链。老师仍操作原25作者关节，旋转／Root／时序／历史、FK／IK／脚锁和操作柄保持，不新增127关节表单或骨长编辑。私有helper保留来源驱动关系并使用中立相对轴向引导与半转平滑，修正外展误作twist和表示接缝；不声称任意上游compact Euler全链等价、现成JavaScript肌肉引擎或完整生物力学。

用户看合图后进一步要求核查人体做不到的动作。普通旋转／IK的人体活动包络已有，AI候选按actionId／幅度构建并对采样中的19关节应用限位；本轮补齐**全身19关节提示**，不再依赖选中某一关节或暂停，播放／观看同样显示。舞台用紧凑琥珀提示，现有“真实约束”折叠摘要显示数量，展开查看部位；上臂摆幅大于120°而同侧Shoulder参与小于5°作保守肩带协同提醒，只提示，不自动搬肩。明确作者K与既有SLERP仍按原值优先，超限提示不偷偷裁剪作品；两端表内合法也可能中间插值超范围，当前会在所看姿态提示，不宣称完整轨迹可行或自动修复。

14姿态合图是蒙皮／作者契约核验，不能当正常人体可完成的舞步集。四项明确越已有表：单上臂170°超过150°；前臂轴扭60°超过8°；蹲姿脚X−40°低于−20°；右踝Z20°超过15°。单上臂150°且锁骨0、双侧150°也未表达肩带联动；固定作者Root的蹲／双侧fixture有悬空脚，不能当着地演示。根代理亲审46张实际全身、390px、草稿K和播放图；压力场景证明显示连续性及作者原值保持，不证明舞者能做、安全或教师可执行。

真实加载强化后的wire正式5／5（72.024秒）已通过，禁止placeholder冒充人体；原14／14几何回顾仍对应未变的MHR数字链。最终150°肩部压缩1／72、170°0／72低于原3%门槛，源标定胸部逐点运动误差0.0241／0.0296微米和neutral0.0273微米低于2微米；高1.849999974米、脚底误差小于2毫米。首4／5、170°3／72拒绝、旧25毫米线经来源验证后修订，以及paint／DQS／53骨链／45–65–90度transfer与heat拒绝均保留；未标定来源约8微米向量差与标量p95分开记录。

姿态修正以可复现gzip文件传输（6244575字节）还原原9587356字节并验证原SHA，按前8字节区分gzip或浏览器已解码的MHRCORR1，保留上限、Abort、单fetch和无API fallback。`.assetsignore`只排除线上原未压缩bin，源数据／离线／CI参考保留。旧wire3／5前三项实为placeholder、第4／5加载失败和两次未进入test的harness退出都留档；真实原因是Vite Content-Encoding后重复解压，修正后才作本轮加载通过。

最新本地380／380基础（20文件、8.60秒）、前端类型／构建通过，bundle为`assets/index-CzQnbqF8.js`。新增人体提示3个相关流程经首2／3、腕部复核失败后最终实际覆盖全部3场景，保留失败与作者归一化末位差的fixture修正，不谎称首轮3／3。较早功能main `16e1fb90`的准确CI实际359＋86已通过，仅作初版历史。最新a9b753cd运行源码已进入main及Cloudflare v15，单轮HTTP19与公网10通过；其最新准确源码CI380＋89已实际通过，最终文档main由同版部署annotation关联并复用已验运行版；Workers AI与付费动作生成请求0，MHR学习式稀疏ReLU本地实际计算。

### 当前本地检查与压力用途

强化后的正式wire5项于`2026-10-08T12:09:38.399Z`开始，72.023662秒、5／5，skipped／unexpected／flaky和报告errors为0；只有实际MHR资产、蒙皮和可编辑加载成功才通过。原wire首轮于11:52:31.028Z开始，55.307324秒、报告3／5，但前三实际placeholder，根代理看图拒绝人体通过；第4实际编辑与第5CPU loader失败。之前cwd缺失exit254及网络未授权exit1均未进入任何test，不记作测试失败或成功。根因是Vite `.gz`的Content-Encoding被浏览器自动解码后再次DecompressionStream；表示嗅探修正并保持原SHA、资源限制与取消。

原正式5／5（11:15:07.309Z、65.290085秒）、14／14（11:07:31.857Z、111.76121秒）及46图亲审对应未变MHR数字链；原相关4／4（11:21:38.074Z、60.59469秒）保留。最终MHRRig SHA256 `29334e457af72f69bd271e904df9b428227a3eb53c0905cc8f80dfe1e0c55eb0`与视觉源码f484仅一行眼部null拾取归属元数据不同；update及轴向函数哈希一致。后续gzip表示和提示不改变作者求值或蒙皮数字链，不为这些变化重复完整14截图。

姿态提示首轮于12:08:32.326Z开始，40.840122秒、2／3；未选中作者K＋播放／390px、真实膝环170°→145°已通过。腕部fixture首复核15.799036秒仍失败，新K归一化的末位约2e−16与输入字面不等；最终用真实UI先复制b→Ka→粘贴b→Kb、捕获写K后权威值作严格不变对照，腕单项11.34648秒通过。runtime未因fixture修正改变，三场景按首通过／相关复核覆盖，不把首轮记作全绿。保存作者两端K及原SLERP方向／可见四元数的断言保留。

全身提示覆盖19可编辑关节，不依赖选择，暂停／播放／只读观看皆可见；腕端点表内合法但SLERP中间超限的确定性样本被提示而不改稿。肩部提醒阈值是上臂down-axis swing>120°且Shoulder swing<5°，仅保守审阅提示，不是临床范围、硬拒绝或自动肩胛模拟。AI协议actionId＋amp0.35–1不允许任意四元数，候选19关节采样应用共享限位；未验证整段SLERP可行性、主动平衡或完整肩带协同。

源标定逐点参考用官方FBX八slot、独立NPZ PSD和独立Python FK／固定标定：150°／170°胸部运动向量最大0.024125／0.029559微米、neutral0.027266微米。旧绝对25mm线在正常上游PSD本身失败（p95约25.535622mm），已公开修订原因，固定14顶点≤2微米加实际无大片翼状审阅；首4／5与原失败保留，原3%肩门槛不变。未标定来源约8微米差源于0.1049%上臂twist权重和段长标定；p95标量与逐点向量不能混称。

最新基础380／380、20文件、8.60秒及前端类型／构建真实通过，bundle1114517字节／SHA256 `5729096ee852f663af8d8f3558e058edd458d0cddb05ccd58193bdc2d37c09b6`。较早352、353、359、370各是其当时源码范围，不回改为380。Worker类型和dry-run按未变Worker范围复用；23.59KiB／gzip7.40KiB、现有绑定保留，不是设备benchmark。SDK两次重建8个模型／ignore文件逐字节相同；13项实际DecompressionStream检查保留。

原数据bin9587356字节／SHA256 `b09418f280a379c4f4a3fb72f4c8b909a6339a5fd1c7ed5513f3b8a17b947bde`；wire gzip6244575字节／`51b3557f469f9a22daec511302bb11a53ae778d1d8533d8d3b7ea3390df4d82b`，mtime0／OS255。8MiB wire上限、精确原字节数／SHA和Abort保护不增加第二fetch或API回退。GLB536452字节／`fe5a79bf9b39e2bb95aa632babc3d8068723ee3dfb5dd97fcb97a120748006ff`；descriptor135476字节／`4eebae7ca930f5ff01e5b419d61651c0c42825ad2e7fb2156fac35053aa83141`；旧CC0资产与完整Apache／MIT归属保留。

### 已发布的早期源码与当前远端边界

初版功能main `16e1fb90766fe5d7f89fe2075de167a0712caa87`／tree `22195254ec33ec8f2fd508ee1cea4b65c6d9ffac`于11:30:49.522761Z发布。[CI run37770541586](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37770541586)／job113288756691／attempt1于11:53:19Z实际completed/success：359／359、18基础文件＋86／86、19浏览器文件，browser21.3m、job1346秒；日志68966字节／SHA256 `06970c81f1f040e06971ef3597f0f2d92e1fafe1526a9920bc295e30c0d86dae`，无手动rerun。它是初版准确源码证据，不替代当前wire与提示修正源码。

首nativeCLI11:32:19–54 exit1，bucket3 sessionJWT broker401，6资产成功；合法single-file resume11:39:40–46 exit1，小许可／provenance成功、单个9587356字节PSD仍broker401，累计8资产但v15 runtime0；单次HTTP gzip传输实验11:42:38–43返回500/code−1，不证明该Content-Encoding方式支持。三条失败路径保留；首Wrangler请求含5次内置重试，后两个单次实验均无自动重试，不已证实尺寸根因，也不是approval拒绝。当时旧v14仍100%；该段是失败时点历史。后来a9成功运行上传／HTTP／线上核验另见下段，不能把失败改记成功。

### 当前准确运行版本与有界线上核验

实际运行源码[main a9b753cd](https://github.com/DFerryman/ChoreographyStudio/commit/a9b753cd11ad0ac303e81ae53e77b9e136e2ed27)／tree `fd54084a9f818ad910b7864307d0fa7d1fc1cf7c`已发布。Cloudflare version `ca7396ed-a8b1-4db6-a29d-149cbfdbcd59`／number15／100%，首次deployment `3157a661-7fb6-4339-b41f-ac89733774e8`于`2026-10-08T12:21:52.139463Z`；唯一成功运行上传12:21:37.907466–12:21:53.882121Z，5新资产／12复用，原三条失败路径作为独立历史保留。

唯一有界HTTP19／19于12:23:34.973722–12:23:38.206759Z完成；唯一公网相关10／10 FIRSTPASS于12:23:36.593Z开始，用时109.745579秒，unexpected／skipped／flaky及报告errors为0。9份实际诊断JSON的API／errors／warnings为0，另迟到绑定场景使用严格完整断言，不虚称第10份诊断。同轮产生24张图，根代理已亲审其中150°K、插值播放、170°390px、插值腕部四张；保留轻微腋部折痕，不宣称电影肌肉仿真。

压力图明确包含异常作者K、超限与固定Root场景，是蒙皮／数据契约验证，不等于默认受限摆姿或物理可行舞步。Workers AI与付费生成请求0；MHR公开学习式姿态修正本地实际执行。最新准确源码[CI run37775928775](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37775928775)／job113306622160／attempt1／main push已实际completed／success：**380／380基础（20文件）＋89／89浏览器（20文件）**，89逐例通过、失败／未通过0。Job于`2026-10-08T12:18:26Z`开始、`12:43:35Z`完成，共1509秒；browser终行`12:43:33.0391847Z`为89 passed（24.3m），run于12:43:36Z更新，首次读回12:43:43Z。完整原始日志70297字节／SHA256 `8f200441198d8d059b66e9e48e510cab17ef194a20e25cce9b8d149085cbe9c7`；没有手动workflow rerun。最终纯Markdown main通过同版Cloudflare部署annotation关联，复用以上已核对的运行版本、17资产和线上证据，不重复运行上传、公网测试或资产修改。


模型README的早期传输说明以本轮实际源码与读回为准：Fetch body可能已经按Content-Encoding解码，也可能仍是显式gzip，decoder按前8字节识别后核对原长度／SHA／上限／Abort。历史401／500没有证实尺寸根因或上传hard limit；最终6244575字节（约6.24MB）的确定性gzip后标准native上传成功，只记录这个实际结果与顺序。已发布静态模型README／来源／ignore与17资产不再修改。

## Version 14 · 舞台直接摆姿与统一自然人体（已上线，准确源码CI通过）

按用户最新截图和要求，完全移除右侧关节下拉与Euler/Root数值滑条表单，舞台与时间轴占满手动工作区。点击实际蒙皮选择身体部位，现有选择/旋转/整体移动与IK操作形成草稿，在时间轴显式写K；姿态复用集中到已有“更多编辑操作”，只读坐标/真实约束折叠。默认不显示全部25个蓝色节点，现有选中提示与Alt+上下选择保留键盘入口，没有增加常驻参数模块。

原模型肩部枢轴距中心0.287米而来源人体约0.204米，只有修权重不足以改善过宽肩与瘦臂/小头。首两种几何/权重候选的抬臂变形比旧资产更差，已拒绝；第三种局部修权重改善数值但实际浏览器仍显宽肩/腋下缺口，同样未作为自然度完成结论。最终统一neutral-rig-2/neutral-adult-v2，固定枢轴改为0.210米，表面肩宽约0.5174米（旧0.6549），头臂比例、连续肩腋几何与沿拓扑扩散的四影响蒙皮共同修正，不用独立错位的展示骨架。25关节名称/父子链/局部四元数通道、已有Take/Root/时间/历史不重写；派生手臂世界轨迹随新体型改变。下肢、脚底和世界脚锁锚点保持，70千克/1.85米/16段质量比例/重力/摩擦/有限驱动参数保持。

冻结当前GLB853172 bytes、11774顶点、23544三角形、25骨骼，SHA256 f7be9db402be188a2dd6f02d242eba83d6f84cd37ee2b3612447620580bb35cd；独立neutral-human-v2.glb与严格静止骨架/inverse bind校验防止误绑。原neutral-human.glb保留v13原字节供已打开旧页面加载。实际CPU八姿态均有限且无零面积三角形，下肢/脚部世界矩阵差<1e-12；肩部80/120°、肘100°/膝120°、站立/蹲姿与390px已在实际Stage比较并审阅。大块腋下拉伸改善，普通LBS高举臂仍有轻微压缩折痕，不宣称肌肉、完整生物力学或教师/具名真机验收。模型来源/CC0全文与适配记录见人物资产文档。

新增统一校准/旧姿态脚部兼容两项关联检查首轮4文件86项为85通过、1条fixture对0.09与0.09000000000000002使用严格字面等值失败；改为对派生几何采用1e-12距离容差，11项IK复核通过。输入JSON与非手臂世界位姿的独立旧骨架参照保持严格检查，明确证明手臂轨迹变化，不放宽作者K原值断言。冻结全套check于2026-10-08T08:52:36Z开始，15文件/321项全部通过（10.69秒），前端类型/生产构建通过。大包提示保留，首次主JS gzip305.30kB、按需Rapier gzip1669.96kB，不冒称性能/设备测试。Worker类型复核与原生wrangler dry-run通过，读取15目录文件、23.59KiB/gzip7.40KiB；AI/两级限频/ASSETS/RELEASE_STAGE保持。首次Worker命令因默认HOME日志目录不可写退出，不是测试断言失败；指定工作目录内XDG_CONFIG_HOME/WRANGLER_LOG_PATH后通过，原失败日志保留。浏览器、准确源码CI及线上收据完成后据实补充。

移除Root表单后的关联检查另暴露真实键盘缺口：镜像观看时快捷键早退，浏览器原生Ctrl+Z可恢复最后输入的帧120→0并聚焦时间输入。实际body/舞台DIV/canvas三种focus均复现，首trace与probe保留；修正为手动工作区识别快捷键后先阻止默认行为，再在镜像只读状态不执行编辑。输入框/按钮/模态/组合输入仍保留原生行为，未放宽帧/动画/历史断言；四项定向复核53.3秒全部通过，保留帧120、完整project/历史、Root5微米目标、输入原生行为和真实音频播放保护断言；首12项中11通过、唯一镜像失败及三焦点probe证据继续保留。

上述键盘修正后的最终前端类型/生产构建通过：主JS index-CDwxBzsl.js1097033字节/gzip305.31kB、SHA256434383f43ea99fbd130cc67c4322bda40c6f11b0feee89eeeb73668eeef4ed67。

删除旧表单后，浏览器测试改用真实皮肤选取/旋转环/整体移动与现有紧凑只读姿态反馈；正式K与实际草稿值严格相等，复制/保存的作者原值仍严格比较。常规鼠标目标允许微米级射线量化误差，0.04°/1.8000004米通过有效旧作品及实际复用流程保持精确，不能描述成已删除数值控件仍可输入。所有API fail closed，只有AI专属用例可mock fulfill；本轮真实AI调用始终0。旧81项/18文件覆盖保留，本地58个不同相关流程均有实际通过记录，逐项迁移及首失败/复核日志留存；不能用历史v13通过代替本轮。

### v14 · 实际发布与单轮线上收据

最终准确012c源码CI创建`2026-10-08T09:16:21Z`，job`2026-10-08T09:16:24Z`–`2026-10-08T09:38:34Z`（1330.0秒），run updated`2026-10-08T09:38:35Z`；15基础文件/18浏览器文件，321/321＋81/81，所有构建/Worker步骤成功。原始job日志66727bytes，SHA256`67c641db641c0d6af4fc0966eac7ce21dee9b3a75c0c1ea58b3f5fe9a7d921a5`，实际通过81个case，没有rerun。中间7f3f run37755125168也实际321＋81成功，job完成`2026-10-08T09:34:11Z`，原始日志63919bytes／SHA256`a266fc7289d8e498ef9e62e528753b70d6669dd8bfd3fd660141b57bf1acc422`；与首次失败和最终严格012c均单独记录。以上技术时间戳均为UTC原始回执。

功能源码[d435888f](https://github.com/DFerryman/ChoreographyStudio/commit/d435888f92a6a469f8de9cee0ee404ff5e54eecf)、树55cbc602a5984a0a651d43079d8a82403563d18d已push main，并与本地暂存/远端Git树核对。其后只修改tests/keyframes.spec.ts的实际手柄工作流fixture：切工具造成viewer未保存修改时，放弃草稿后仍明确处理第二场景保存保护；正式K以真实draft XYZ精确核对，正常请求目标允许5µm射线误差；390px大Root位移后正常全身取景再继续。第二head7f3f8a12与最终更严格目标012c1cd1均已push，最终源码树ad3901cd91f7bfd06d4c2d9e3dc9e4764e05a7f5，生产/模型/served README字节未再变化。首次相应本地旧fixture失败、0.051µm literal误差和离屏手柄trace保留；完整单case先22.9秒通过，再收紧最后1.9m目标后JSON复核23.722秒通过（总24.846），实际editableDuringSave=true、错误/警告0，未降低Take/历史/重开/音频哈希保护。首次功能head的[run37754117328](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37754117328)／job113234317872／attempt1已实际failure，基础321/321（15文件）、浏览器80/81（18文件），唯一失败为dirty-pose场景在放弃草稿后遗漏第二viewer未保存guard，题名仍在原场景；没有其他失败。job完成2026-10-08T09:25:42Z，原始日志69949bytes／SHA25627e0a329b6bbce221e6748731256a7f187263123ebe0dacf144011195ac98728。这是原fixture未走完新实际手柄流程，修正保留全部动画/历史/音频/保存断言，不移除产品保护。首次失败/trace和单case复核保持，不能记首次全绿。本轮功能源码[d435888f](https://github.com/DFerryman/ChoreographyStudio/commit/d435888f92a6a469f8de9cee0ee404ff5e54eecf)及更严格实际手柄测试[012c1cd1](https://github.com/DFerryman/ChoreographyStudio/commit/012c1cd1f3cadcf51bc8359e799c911c99291a19)已push main，最终源码树`ad3901cd91f7bfd06d4c2d9e3dc9e4764e05a7f5`与本地一致。[准确源码CI run37755495034](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37755495034)／job113238885766／attempt1于`2026-10-08T09:38:34Z` completed/success，实际**321基础＋完整81浏览器**；初始321＋80/81的旧保存guard fixture及独立7f3f完整通过记录保留，不手动rerun。Cloudflare v14 `b4a04064-9df8-479b-b817-0c6f7a1947e7`／100%，首次deployment `469d00f7-fe23-4e42-a88f-391eb8775be0`／`2026-10-08T09:10:51.003376Z`；单轮线上10/10和有界13 HTTP通过，实际8份JSON诊断及2模型断言错误／警告／API0，真实AI0。生产仍是d435，后续只改测试或Markdown，运行资产不重上传；最终文档main通过同版部署message关联。详见验证／部署记录。

Cloudflare实际version14 b4a04064-9df8-479b-b817-0c6f7a1947e7，首次deployment469d00f7-fe23-4e42-a88f-391eb8775be0，2026-10-08T09:10:51.003376Z／100%。版本创建2026-10-08T09:10:50.444189Z，tag v14-direct-stage-human、runtime annotation关联d435888f。原生wrangler读取15目录文件，上传index/JS/CSS/新GLB/served资产说明共5个新文件、复用6个，Worker23.59KiB/gzip7.40KiB、启动3ms为CLI测量。AI、两级限频、ASSETS及RELEASE_STAGE与SPA／/api/* worker-first设置均实际读回正确。

唯一相关线上10项首次全部通过，从2026-10-08T09:15:04.375Z起，128.661221秒：模型2（含版本v2延迟绑定）、作者优先2（中间K及细微精度）、320/1440布局2、IK／脚锁2、桌面／390稀疏三K时间轴2。expected10，unexpected/flaky/skipped/reporterrors0；实际8份JSON诊断errors/warnings/API/expectedHttpErrors全0，另外2模型流程断言完整report0；不假称10份JSON。11张同轮截图已检查肩部80°、手机模型和两尺寸时间轴，没有另开公网截图会话。部分捕获包含当时的备份下载toast，不视为常驻布局。公开套件开始head7f3f8a12与最终012c1cd1只在未选的dirty-save精度一行不同，选中全部spec/helpers前后sha完全相同。原始JSON2265081bytes／SHA2564f54df48d784bb4d765ef2208b907297107870abbeb4a1f33c75e5ff159e27bb，日志1830bytes／SHA256a004d05a8336343592f117379016a8a9a3d0c855a0646f6efd027519c5df28da。

有界HTTP从2026-10-08T09:15:54.458467+00:00至2026-10-08T09:15:55.479228+00:00，13/13通过：11个静态资源包括新GLB与v13旧GLB、页面／脚本／CSS／Rapier／来源许可逐字节、sha和安全headers匹配最终dist，health及capabilities200／no-store。没有POST、生成端点或限频burst。AI接线不变，保留前轮mock证据，真实AI推理0；没有重跑完整81项公网回归。最终纯Markdown记录完成后复用此已验证运行版本，部署message关联最终main／runtime／准确CI，不再上传资产或重复公网检查。

## 历史 Version 13 · 作者K最高权威，已上线并通过完整源码CI

用户进一步明确：自动插帧/迈步必须服从中间新增的手K，即使普通人体做不到也按老师关键姿态计算。此前已验证v12的脚锁仍可能修改作者时刻的Root Y/腿链，因此追加作者通道保护、近三帧平滑减弱辅助，以及草稿意图保护。现有数值输入允许有限各轴±180°创作姿态，滑条/舞台拖动/IK保留人体建议；粘贴与K不再次投影作者旋转。标准人体超限或脚锁冲突只提示，最终实际FK残差不通过改K消除。没有新增按钮或自动迈步规划。

为保护旧作品，序列新增可选`authorKeyPriority: author-key-priority-1`。新求值始终作者优先，旧Take打开不重烘焙；备份只接受整份动作严格匹配新求值，或无标记旧脚锁序列整份匹配旧确定性求值。新标记禁止旧fallback，未知版本/混合逐帧结果拒绝。9类真实键/锁/转移修改升级标记，空操作保留旧对象。独立AI/物理仍是明确生成与采用的整段替换，原稿留在历史，未接为后台补间。

核心关联首轮37项为36通过、1条旧fixture要求所有作者帧锁足<5mm而失败；按新作者Root优先规则同时检查作者原值与真实残差，37/37通过。新增作者优先/严格兼容10/10通过，类型与diff检查通过。备份54/54于07:26:39Z通过，包含旧完整包/JSON与历史保持、新标记禁止旧输出、未知版本和混合Take拒绝。最终`check-first.log`于07:28:27Z开始，15文件/**319 passed**、5.44秒，前端类型与生产构建通过；Worker类型通过。曾误用不存在的`typecheck:web`脚本，没有执行测试，随后使用仓库实际`check`/Worker类型命令通过。

首轮本地浏览器8/8于07:26:51.616Z开始，86.971秒通过：新作者3项、更新/新增旧约束3项、真实肘旋转环默认限位1和320/1440布局1。覆盖中间60帧创作K、后来90单轨编辑重求值、锁冲突、单轨剩余意图、390px超限数值与保存重开。expected8、unexpected/flaky0，实际诊断errors/warnings/API均0，全部API fail closed，真实AI0。旧关联5/5于07:32:51.307Z开始，74.459秒通过，包含部分K草稿、真实IK/脚锁和桌面/390px三姿态时间轴。

只读审查另发现原草稿判断使用未归一化dot与较松阈值，可能丢掉0.04°的小编辑，或在旧四元数合法norm容差下漏判变化。统一按归一化/q与−q等价的分量比较，Root意图与姿态差异使用同一精度；无剩余作者意图时不再把二次派生脚锁差异算作草稿。新增精度用例于07:35:42.667Z开始，11.345秒1/1通过：正式Root1.8/上臂0，输入0.04°与1.8000004米，单轨K后未写小角保留，后续显式K/备份/重开维持准确值。数值控件随后统一精度格式，常规1位°/3位米保持原样，需要额外精度时最多6位°/9位米、去末尾0；最后定向于07:38:08.219Z开始，11.662秒1/1通过，blur后、单轨K后和重开时0.04/1.8000004均清楚可见，原通过记录保留。现在14个不同关联用例均有本地通过记录，最终列表81例/18文件。最终冻结前端类型/生产构建通过；主JS gzip306.30kB，Rapier按需块gzip1669.96kB。保留Vite大块提示，不宣称性能/真机或教师验收。以下为准确最终功能源码的远端和运行证据。


### v13 GitHub / Cloudflare / 单轮线上实证

本轮作者优先源码 [e44a649b](https://github.com/DFerryman/ChoreographyStudio/commit/e44a649bb03583d847ea319dc27560643545a828) 已 push main，树 `ebc88873036023e6b00de28eb509a642a3ca97ae` 与本地一致；准确功能 head 的 [run37745471252](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37745471252)、job113205792740、attempt1 于 `2026-10-08T08:03:55Z` completed/success，实际 **319基础 + 完整81浏览器通过**，没有 workflow rerun。Cloudflare v13 `9dcbf7c0-24cb-41c7-a1a3-d36baa0893e4` 实际100%，首次 deployment `7e5a6ead-b240-4484-b83e-0a7f06f7716e` / `2026-10-08T07:46:28.924157Z`。单轮线上8/8与有界12 HTTP通过，实际诊断errors/warnings/API均0，真实AI推理0。最后仅Markdown回填复用该已验证runtime，并在同版100% deployment annotation关联最终main；实际ID与时间由Cloudflare记录核对。此前v12的306+76仅作为历史基线，详见验证/部署记录。

源码CI创建/开始 `2026-10-08T07:45:59Z`、job开始 `2026-10-08T07:46:02Z`，完整浏览器阶段和所有构建/类型步骤均成功。最终原始job日志 67138 bytes，SHA256 `8215291743c91061267e1d3e5e7ca91402bdcc7c5a552663fa6f168a9bb52cac`；319项来自15文件，81浏览器来自18文件。v12首次306+75/76与严格文本同步的修正306+76证据继续保留，不以旧通过结果代替v13。

有界HTTP从 `2026-10-08T07:47:07.974810+00:00` 至 `2026-10-08T07:47:09.226713+00:00`：10静态资产逐字节与最终dist相同，SHA256/安全headers正确，health和capabilities200/no-store，没有POST或限频burst。唯一相关线上8项从 `2026-10-08T07:48:09.324Z` 开始、81.407秒：作者优先4、统一时间轴桌面/390两项、IK/脚锁两项。expected8、unexpected/flaky/skipped0，8份实际诊断errors/warnings/API全部0。全部API fail closed，无真实AI；AI接线不变，沿用v12两项mock线上流程的证据，没有重复调用生成端点。实际审阅同一轮桌面/390截图，不另外启动公网截图会话。新主JS1100241 bytes SHA256 `2bab9d4f1817549b170d5209d30008983812f22863029a6cd346df1aa74c3a84`；中性人体与CSS/Rapier等8资产未变。

## 历史 Version 12 · 统一时间轴、人体与约束辅助，修正源码CI已通过

最新授权接入 Workers AI、手脚 IK、可保存脚锁、内置中性人体参数与 Rapier 重力候选，并将分段人偶换成 CC0 连续中性人体蒙皮。教师只选少量时刻摆姿/写 K，中间自动 Root 线性与四元数 SLERP；本轮进一步将播放、定位与写 K 合并到舞台正下方一个时间轴，侧栏只摆姿/复用。自动步法规划、键点拖动和曲线列为后续。原 25 关节、CountMap、显式写 K、历史及旧作品保留。

本轮真实 AI 推理测试为 **0**。API 单元测试使用 mock binding，客户端测试使用 stub fetch，浏览器对所有 API fail closed 并只为指定 AI 请求 route.fulfill。模拟 HTTP 错误属于预期错误，不能把 mock API 请求数记为零；没有调用线上生成端点、OpenAI 或 Workers AI 模型来验收质量或走量。

`check-first.log` 的首次全套 301 项基础检查、构建/前端类型及 Worker 类型通过。后续增加一项客户端错误隔离、一项三姿态稀疏 K 工作流和三项 GLB 实物检查；`check-model-first.log` 于 2026-10-08T05:42:40Z 实际 14 files / 306 passed，构建通过。这是该源码/模型快照的本地结果，不代替最终源码 CI 或 Cloudflare 发布。

新增浏览器首次 10 项为 5 通过、5 fixture 失败：错 CountMap 的安全错误文案不同、修改原稿直接清除候选，以及三个按需挂载的约束面板未先展开。保留原报告与 trace；五项 fixture 修正复核全部通过（46.105 秒）。实际单轨 K 的草稿所有权修正只保留未提交的用户意图，不把脚锁求解差异误当草稿；相关四项复核通过（62.611 秒），覆盖两项增强 IK/脚锁和两项旧草稿保护。新增十个不同流程均已有通过记录；不能记为首次一次全绿。

中性人体重新适配后，12 个相关浏览器流程（4 限位、4 取景、4 真实约束）实际通过。首轮截图暴露黑点；关闭自阴影仍存在，未减面的对照干净，最终定位为 UV 接缝重复顶点在减面时独立移动形成小缝隙。离线先焊接接缝再减面、校准后重算法线，实际桌面/390 px/80°肩部截图干净。模型新两项首轮 1 通过、1 错误按钮名 fixture 失败，修正后最终 2/2（2026-10-08T05:51:16.777Z，24.536 秒）；最终 GLB 实物三项复核通过。冻结文件 776136 bytes、10704 vertices、21404 triangles、25 bones、高度 1.85 m，SHA256 `4b5fa085d0a6e403abee4ce022cac8041e5bca8bce130d03f28f245a29fddc9a`，来源/完整许可保留。数学、代理物理和模型可用性检查不等于教师、真实设备或原 M0–M3 已通过。

### 统一时间轴 · 最终本地检查

`check-timeline-final.log` 于 2026-10-08T06:00:35Z 实际 14 files / **306 passed**，3.64 秒；冻结模型及新时间轴构建通过。随后仅清理姿态组件无用 props、明确高级单轨 K 只写选中关节、未选关节隐藏灰色旋转滑条，最终前端类型/生产构建通过。Worker 类型与 dry-run 通过，配置为 AI、20/60 API 限频、2/60 AI 限频、原生 ASSETS、RELEASE_STAGE；dry-run 不代表实际上线。主 JS gzip 305.33 kB，Rapier 按需块 gzip 1669.96 kB；保留 Vite 大块提示，不宣称完成性能或真机验收。

本轮统一时间轴验证 **26 个不同浏览器用例均有通过记录**：新增桌面1440/390 px 稀疏三姿态流程2，极简布局320/390/768/1440四项，既有约束4/取景4/轨道4/移动复制3，共15项，精选旧完整草稿、真实播放与输入/舞台键盘4项，部分K/复制缓冲1项。新增两项首跑因 Undo/Redo 既有行为回0帧、fixture 预期保存45帧而失败；明确重新选择45帧后2/2通过（2026-10-08T06:08:00Z，46.242 秒），原失败报告保留。15项关联首跑通过（06:05:49Z起，213.398 秒），精选4项（06:09:40Z，30.880秒）、最后部分K1项（13.5秒）通过。实际图检桌面与390 px就地K和320/1440布局，无页面横向溢出；桌面主K和轨道进首屏，手机为舞台→时间轴→姿态。`playwright --list` 实际76例/17文件，完整源码CI和线上发布已有下述实际回执。

### v12 GitHub / Cloudflare / 单轮线上

功能源码 [82b593d4](https://github.com/DFerryman/ChoreographyStudio/commit/82b593d483e875cb67d14975527bf5265eab3090) 已快进 push `main`，本地与远端树 `107fd10aa70606db90258b91ad55701c19d286f1` 一致。首次 [CI run37737956864](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37737956864)、job113181731273、attempt1、准确head已核对；06:30:14Z开始，06:46:52Z completed/failure：306 基础检查通过，浏览器 75/76。唯一失败为旧超限姿态/Root 单轨/粘贴后撤回流程在草稿消失后立即读取三轴数值文本，读到 `[0,-2.8,0]`。原日志、截图与 trace 保留；artifact 2716200 bytes，SHA256 `dbe3cb1621515f4fd79be065b6c3874d59ad4d592c9955880ce9a9b47eae65c2`。

原 trace 175130.870 ms 的正式三轴 range 值均恢复 0，175148–175177 ms 并发单次数值文本读取仍取到 Y=-2.8，175182.563 ms 下一 DOM snapshot 的 Y/Z 文本已变为 0.0；右膝、帧120和暂停状态均未变。一次本地复现也读到暂态 `[0,-2.8,-2.1]`，随后截图和 DOM 三轴均0.0。仅将 `tests/constraints.spec.ts:194` 改为 `expect.poll(() => angles(page)).toEqual([0,0,0])`，等待派生文本同步，严格期望与实现均未改。定向完整用例于06:52:29.689Z开始，11.617秒 **1/1通过**；正式项目与 `rootOnly` 完全相等、帧120以及后续显式全姿态K/历史/限位断言均实际执行通过。测试修正提交 [bd59b4bc](https://github.com/DFerryman/ChoreographyStudio/commit/bd59b4bc5cf189423fed29cf96349e81c7b79e6f) 已快进 push，树 `05cb650891c6e825ab71f630d457d1aae19f76c3`；准确head的 [run37740462981](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37740462981)、job113189737231、attempt1已核对，修正源码 [CI run37740462981](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37740462981)、job113189737231、attempt1，06:56:48Z创建/开始、job06:56:51Z开始、浏览器06:57:43Z开始，于 `2026-10-08T07:13:24Z` completed/success。原始job日志实际 **306基础 + 完整76浏览器通过**，17测试文件，所有安装/构建/类型步骤成功；仅测试修正触发新push运行，无 workflow rerun。运行代码与资产完全不变，复用同一轮线上证据。

Cloudflare原生Wrangler上传10静态资产，v12 `959cccfa-4deb-4e09-a064-ff840c881828` 实际100%，首部署 `08947d1b-4f7d-4743-961c-d580db9e25af` 于06:30:49.309957Z。实际AI、两个原生限频和ASSETS绑定及完整源码annotation读回一致。标准浏览器UA有界12 HTTP于06:31:46.171061Z–06:31:48.400927Z通过（10资产与dist逐字节一致，health/capabilities正常）。单轮线上9项于06:31:52.824Z开始，80.879秒通过；实际审阅desktop/390时间轴及连续蒙皮80°肩部。8份JSON诊断errors/warnings全空，两个AI mock流程有3个拦截POST，不能称API请求数0；真实推理0。源码/资产/绑定详单见 [DEPLOYMENT.md](DEPLOYMENT.md)。最后纯文档提交复用该已验证runtime，修正源码完整CI已按实际job日志核对，不再上传或重复公网测试。

## 历史 version 11 · 简洁手动编辑、实体人体与关节限位

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
