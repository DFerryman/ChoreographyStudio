# 实现状态

## 最新要求／最高优先级 · 自由摆姿与统一碰撞预览（待实现）

2026-10-10 用户将第一阶段范围继续限定在本机手动 K 帧编辑，并调整碰撞时机：实时摆姿不受地面／身体碰撞阻挡；播放及向左／向右拖动 Timeline 预览需要考虑碰撞。最新要求取代下方旧版舞台手势增量碰撞阻挡策略；旧发布、测试与状态全文保留为历史。当前仅完成需求与优先级记录，新行为尚未实现或验收。

| 优先级 | 待实现工作 | 数据与能力边界 |
| --- | --- | --- |
| 1（最高） | 自由摆姿＋统一碰撞预览 | 作者原始 K、精确修改点和原 Take 保持权威；碰撞结果属于独立派生物理预览，不能自动回写作者值、历史或保存数据。播放、左右拖动和任意 seek 使用同一求值路径，同一版本／模型／精确时刻的结果不依赖先前显示姿态或拖动方向；不能把旧增量 guard 直接移入逐帧 draw。无法满足的冲突需如实反馈。 |
| 2 | 新旧 K／修改点的移动与复制整合 | 同时覆盖旧稀疏 K 和精确时间修改点，保持原秒值、操作边界、冲突处理及一次共享历史，避免既有入口只处理旧轨道。 |
| 3 | 自动迈步接入新 Root 修改 | 现有平地辅助需读取最新 Root 点编辑并随变更重算，保持作者通道和区间外原稿；仍采用预览／明确采用／取消，不声称完整步态或动力学。 |
| 4 | 已有足锁／steps 行为参数可见可改 | 已保存辅助行为参数应能查看、修改和移除，复用撤销／重做及保存／重开／备份；现有代理等只读诊断配置不因此变成行为编辑参数。 |

第 2–4 项为上轮发现的三个编辑缺口，现排在统一碰撞预览之后。现有 Rapier 整体刚体／人体包络没有证明独立肢体自碰撞求解、主动平衡或真实人体动力学已完成；已有 17 骨段凸包和通用拟合器也不代替新预览的确定性、连续性、失败路径及响应成本验证。后续先确定派生预览的时间求值／轨迹缓存与求解边界，再实现和记录实际验收结果。本节不记录新增测试或发布结果，也不改变第二阶段高精度烘焙仍未实现的状态。

## 当前迭代 · 2026-10-10 · 四肢数据可见与单一手动工作台

附件检查确认街舞有效Take有5,040个完整姿态、baseTake有4,499个完整源姿态，全部包含Root和25旋转；681个稀疏K集中于脊柱／胸部及双肩，四肢密集动作没有丢失。Timeline区分源圆点、计算刻线、作者菱形，并在折叠／关节轨显示数据点数量；不通过重采样解决可见性。

八拍编排模式及切换逻辑移除，新建／音乐重设直接使用站姿与手动Timeline，旧场景保留原动作音乐及历史。新手动创作单键之后保持、相邻作者键插值、末键保持；导入密集动作保留源局部编辑，旧稀疏轨显式修改时按轨启用版本化新语义。已标记轨道的末键持续保护作者通道，辅助脚锁／迈步不覆盖该姿态并报告真实残差；教学预览的本版试看标记保留在更多工具。

最终本地635项基础、类型／构建、Worker、离线拟合及真实包17组严格审计通过；52个不同浏览器流程分批完成，原失败和补验范围见[验证](VERIFICATION.md)。旧有编排记录但Take为空的首次编辑沿用原绑定；手机折叠轨名称与点数完整可读。用户在此前自动审批拒绝后明确授权发布，运行源码main05afa539准确CI38023885337通过（635基础、51浏览器pass／1私有附件skip）；Cloudflare native26／8e5e1648已100%上线，正常TLS HTTP5／5精确静态字节通过。公网原批实际5／6，唯一私有例聚焦诊断0／1：动作及音乐字节回环断言完成，但本地blob媒体取消仍未解释，未放宽规则或声明完整线上审计通过。Root分别亲审原8及聚焦1张图；最终发布记录仅Markdown提交沿用同运行版本。实际收据详见[部署](DEPLOYMENT.md)。下方为历史。

## Camera Track（已上线，准确源码CI通过）

本轮完成两阶段制作的第一阶段镜头编辑，继续优先快速编舞与操作效率。独立“镜头（Camera）”轨道保存位置、目标和可选缩放，以精确秒值选取、直接操作／数值编辑、自动记录、拖K时间、删除和一次撤销；不把相机写入Root、关节或manual.pointEdits，不重新烘焙舞蹈。

| 范围 | 实际实现／证据与边界 |
| --- | --- |
| 轨道与严格持久化 | 每快照可选camera-track-1，4096K／轨、最多12历史／49152总K，各历史按自己的时长检查finite、范围和严格递增时间；缺zoom保留原字段缺省，旧无轨道保持无字段。运行时up不入作者数据或viewer.camera，删除最后K移除轨道字段。 |
| 基础检查与构建 | 2026-10-09 12:48:54开始，32文件619／619、34.26秒；前端TypeScript、Vite1952模块／580ms构建与Worker类型EXIT0。Vite保留大chunk提示，不虚称构建零提示。 |
| 新镜头浏览器 | 独立final9批4／4，12:41:05.467Z开始、171.594342秒，EXIT0且skip／unexpected／flaky0；四份errors／warnings／expected HTTP／API均0，84源码及最终spec运行前后逐字节相同。 |
| 旧动作与观看回归 | 独立3／3，12:46:54.243Z开始、74.228848秒，EXIT0且skip／unexpected／flaky0；89源码SHA相同。两个point用例errors／warnings／expected HTTP／API均0，旧camera例只errors／warnings0。 |
| 真实作品与图审阅 | 26,710,050字节原包、5,040原姿态、7,200,044字节原音乐严格核对；相机编辑／保存重开／导出重导保留Take／baseTake／manual、原网格与音频。Root亲审4张实际桌面／390px和原音乐恢复图接受；不保证任意取景下全身均不被浮动Timeline遮住。 |
| 准确源码与发布 | main29d56d23／tree07def2ca，CI37933375186／job113829312682／attempt1实际success：619基础32文件、离线fitcheck＋6测试、类型构建／Worker，45浏览器通过10文件，私有case22跳过1。Cloudflare native25／100%及正常TLS HTTP5／5已核对。 |
| 高精度烘焙 | 仅需求与规划，未实现。编舞完成后按舞蹈／镜头Timeline计算更高精度碰撞、动作、骨骼和蒙皮，以无抖动为未来验收目标，输出可播放不可编辑视频并保留可编辑原项目。 |

最终基础日志SHA256：`4e967e53f8689f2ba0dc2435903bf760c77f08428b9552c12e8250e71e4837bb`；Worker日志：`cc927123b7329142ee2e78d036f6febc4298b10f78b7f5571bda7706c983a40e`。新4报告：`7d6c09ee943f26180e17136985c94d8beb75c240e8533f506d3bf78e6124f6fe`；旧3报告：`85668d5c113aa3a5274e74ef788798aa0a963220d4ef6bee63055f48a9b7fd0b`。此前各批失败／修复保留在[验证](VERIFICATION.md)，以上最终批不冒充首轮通过；[部署](DEPLOYMENT.md)按真实发布另行记录。

人物经常替换时继续使用v20保留的通用离线算法和独立模型适配配置，从新几何重算并校验模型／骨架／版本。当前17凸包仅保护实时编辑，不能代替完整蒙皮碰撞或第二阶段精度、稳定性的验收。下方所有历史正文与既有证据保留。

[运行源码29d56d23](https://github.com/DFerryman/ChoreographyStudio/commit/29d56d23a22c5a55c6da8a263d01515e10fc6323)／tree `07def2ca48c8cc594a7e83dd21b8526b4dd2f983`已进入main。准确[CI37933375186](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37933375186)／job113829312682／attempt1于2026-10-09 12:56:35–13:10:31 UTC实际success：619／619基础32文件、离线拟合--check及6个Python测试、前端类型／构建、Worker类型，以及45个实际浏览器通过（10文件）；私有case22跳过1不计通过。CI镜头4例使用可公开提交的便携fixture，真实5,040姿态包由本地与公网单独验证。 Cloudflare native25 `d51b3db7-2757-4e64-b5db-9a97c7d82721`于12:57:45.175978Z创建，`2e98bb48-df0e-4def-a06d-3fdf2e392de6`于12:58:57.455112Z部署100%，原生记录绑定上述准确源码／tree；正常TLS HTTP5／5，静态字节严格相同。

公网首批于13:00:11.012Z开始、200.113757秒，实际5／6，原report与失败保留。第4例功能和原动作／音频断言已完成，scratch网络审计把已归属旧owned媒体的正常源切换ERR_ABORTED列为失败；后续仅修改scratch审计，按已观察的同源blob／HTMLAudio元素、原URL、实际src离开或同URL主文档跳转及2秒内转换证据识别取消，保留原始事件，未知错误仍严格失败。仅对原第4例做一次focused补验：13:16:08.102Z开始、77.635108秒，实际EXIT0／1／1通过；原始failed request1保留并严格归属为expected owned媒体取消1，unexpected failed0，errors／warnings／pageerror／API／audioAuditErrors均0，3主文档200及3GLB正确。复用首批另外5个通过用例，最终6个独立流程跨两批、7次实际尝试覆盖；不能称首批6／6或第二次整6。 Root已亲审首批6张与focused1张共7张实际公网图并接受，但图接受不改变首批5／6结论；桌面部分取景脚部仍可能被既有Timeline遮挡。生产source／dist／原验收tests保持冻结，未新增整6公网批次。

## v20 · 人物混合碰撞体（实施、验证中）

本轮补明确碰撞体拟合和普通编辑防穿插：当前没有用户人物导入阶段，基于冻结 Quaternius 资产离线生成版本化混合代理，实时只做 FK 和碰撞查询。舞台旋转／Root／IK 增量路径受保护；作者源动作、已保存点、播放与数值输入保持原值并给出身体碰撞提示。原质量、惯量、82mm 脚底和 3mm 穿地阈值保持。五页 Notion 已记录新增要求与用户不限定胶囊形状的澄清；通过数、源码、CI 和部署按后续真实结果回填。

2026-10-09 用户新增长期要求已写入[编辑交互标准](EDITOR_INTERACTION_STANDARD.md)并由 AGENTS 顶层引用：当前简洁布局、精确时间／场景部位联动、局部自动记录、一手势一撤销及无损往返是后续开发依据。新功能必须复用此流程和操作栈，完整手动编辑无需 AI，全部存储动作数据可见可改，保持主场景／Timeline 空间，并通过桌面与 390px 手机和真实源场景验收。规范已记录与功能实际验收分别报告，当前发布证据见下文。

## v19 · 源动作可见与局部自动记录（已上线验证，准确源码 CI 通过）

已实现精确源点、计算点与稀疏作者K区分、Root／全部25旋转可见可改、场景选择自动展开聚焦对应点。舞台旋转／移动／IK松手只记录实际变化及IK／脚锁关联通道，一手势一历史，空手势不记、取消回退。19常规关节的新拖动保留建议限位，6末端可规范化编辑；选择不裁剪旧数据。快照式添加／更新按钮与K快捷键移除，场景／Timeline优先、次级与操作栈按需打开。

操作记录含名称／精确时刻／轨道，最多12快照，Undo／Redo、保存重开及完整包保持。无损Take共享／差量为 `compact-scene-1`，JSON `choreo-scene-backup-2`、完整头 `choreo-scene-bundle-2`，旧容器 `CHOREO-BUNDLE-1`兼容。首次有效点／稀疏K操作冻结已保存权威Take；旧时刻保exact存储值，新支点规范求值，严格validator不放宽。

最新实际源回环输入26,710,050字节／原头19,509,986字节，经11精确Head点／12历史后输出20,274,781字节／头13,074,717字节；重导项目、未改Root／其它关节和7,200,044字节原音乐严格保持。独立Chromium私有作品1／1核对5,040原姿态、Delete恢复／Undo和完整重导通过。首次20,271,635字节Node同引擎证明、Chest1ULP跨引擎与二次NLERP新支点失败分开保留，未以放宽精度处理。

准确main dd0d132／treec6a099已Cloudflare native23／version ed9c35b6-15b2-4af7-a895-7f74462b8d34／100%。CI37910066138／job113752815025／attempt1实际success：543基础27文件、前端类型／构建、Worker＋37浏览器8文件通过，私有fixture1项跳过。本地38独立流程由多批及focused补齐，正常TLS HTTP8／8静态bytes／SHA通过；公网首批0／6在首次goto证书信任错误、未进入应用独立保留；仅配置已有CA的官方151用户库并离线原生UI复核、保持HOME／args／正常TLS后，唯一修复批6／6实际通过111,888.072ms，六份诊断均0。Root亲审本轮实际桌面／390／320三张App图接受，与本地三图分计。五页Notion永久标准已成功读回，最终Markdown／同版注释及发布metadata按实际head回填。详细实际证据及所有初失败见[验证](VERIFICATION.md)与[部署](DEPLOYMENT.md)，以下旧版本全文保留。

## v18 · 极简场景与多轨编辑（已实现，发布验收中）

## v18 · 场景优先、多轨编辑与独立舞蹈包（已完成交付）

最新最后阶段用户要求：Timeline区域拉伸／扩张时同步放大或缩小每帧间距，逐帧K应清晰可见、可点击区分；极简界面要精致、便于操作；Timeline最后集中整理，功能明确、一眼可懂，以常见直觉拖拽为主，删除不使用的入口。本轮时间线已实现：全段显示→对数缩放滑杆→逐帧最大48px帧间距、统一滚动坐标与缩放锚点、空白区域点击定位／拖动平移、K和音乐边缘自动滚动；暗色中性浮层、不透明固定轨头、紧凑桌面约195px／手机约235px、手机K／音乐44px命中区，循环／速度／前后帧进入按需“更多”。16个显示轴几何用例实际通过；末尾不足1／30秒帧可伸展至48px，音频使用相同分段显示轴，真实时刻／核心动作逻辑不改。最终ac92保留上述操作与精致布局，仅三行≤360px工具padding-inline6修复四按钮右边界；保留完整12px标签／44px高／单行。新source公网缩放4＋原transfer3共7／7、诊断0／96runtime和26dist前后同，Root亲审公网3图及本地4图分别接受；准确完整CI结果独立记录。320倒立腿端仍可能被既有浮层／边缘遮，布局验收不保证任何取景下全身无遮挡。最终修复源码／CI／Cloudflare与实际交互和人物取景须独立核验，不借任何旧source通过。

已完成视口场景、可收起Timeline浮层、音乐波形／Root／身体组与逐关节分轨、拖K与独立音频偏移，常用摆姿／定位／明确K保持突出，重复模块移除。音频偏移不改变原音频、CountMap或作者键，沿用草稿、碰撞、观看与一次历史保护。

完整CI首轮91／100暴露两个真实运行缺陷：手机工具原40px不达既有44px触控门槛；新手势在限位投影归一化边界可返回表外浮点姿态。现分别修复至44px及稳健投影，保留原人体包络、作者原值与断言。其余失败修正真实按需弹层关闭／屏外相机取景／仅上传音频解码的测试屏障，未force点击或弱化动作精度。此前草稿条引发26px浮层／13px投影变化的拖动缺陷修复也保留。

最终运行[sourceac92f74](https://github.com/DFerryman/ChoreographyStudio/commit/ac92f743db9a144b9b6527ba1e465b82f87d2a9d)／tree `13e41442008ca4ec04b1d8627aa20e7bf2f27faf` 已push main并远端SHA精确读回。Cloudflare `e4784790-54c6-4716-a4a0-f8259567d381`（native22，产品迭代v18）于07:34:11.692073Z创建，100%初deployment `a04134ec-cca8-4fe8-ab25-9e889ef66244`／07:34:54.898518Z，upload／deploy EXIT0、native注释绑定ac92／tree13e。

最终ac92本地 `npm run check` 于07:31:54 UTC开始，480／480基础25文件、12.32秒，前端types＋Vite1944模块／1.11秒构建EXIT0；Worker输入未改，复用enabled原脚本actual类型PASS。仅一份CSS增加≤360px工具padding-inline6三行，保留12px完整标签／44px高／单行；原正式transfer3／3（111.439706秒）原width／Root／rotation／baseTake／revision／collision／undo／save／draft断言未改，诊断0；最终supplementary1／1（28.819567秒）与首incomplete1／1（28.499455秒）的桌面截图限制分别保留，126源快照前后SHA一致。Root亲审新local transferMore1440／390／320及stage四工具320四图接受。准确[CI37899685795](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37899685795)／job113719068029／attempt1／main push／headac92：于08:16:16Z实际SUCCESS：480／480基础（25条唯一文件行、sum480）＋104／104浏览器（25文件、IDs1..104各一次实际执行并通过），failed及failure／notpassed markers0，浏览器41.9分钟，未手动rerun；run于07:33:16Z创建、job07:33:19–08:16:16Z、runupdated08:16:17Z；有界HTTP5在正常TLS下200，index／JS／CSS字节和SHA精确、health／capabilities只读GET成功，AI／D1 0。最终同源公网：ac92／tree13e唯一首批公网实际7／7、2个精确文件（Timeline缩放4＋原transfer3），07:38:06.276Z开始、156.809599秒，unexpected／skipped／flaky0；7份逐case严格诊断errors／warnings／API全0，expectedHTTP按可选字段计（新4字段0、原3无字段），正常CA／ignoreHTTPSErrors=false／APIabort，真实AI／D1写入0；96runtime／26dist与冻结和commit前后逐字节／SHA完全一致。原始report1009168B／SHA256 `69e7deba009026e7f40c3c611a421e681508a75a1aead1492af967802539659a`；Root实际公网图：Root亲审该公网批dense320／transfer-mobile390／transfer-desktop1440三张实际图接受，与本地More1440／390／320＋four-tools320四图独立计；不声称公网图全部320px或所有身体部位无遮挡。

用户最终撤回内置模板，已制作两个独立 `.choreo` 场景包：CMU85_12连续复杂街舞转身／倒置／地板技巧37.5秒；CMU61_08完整单人Salsa56.25秒。包内包含动作与原创128BPM参考节奏，可分别导入独立场景并二次修改；非原曲或某流行歌曲原版编舞。[复杂街舞37.5秒](https://choreo-scene-packs.danuberiverferryman.workers.dev/complex-street-dance.choreo)／[完整Salsa56.25秒](https://choreo-scene-packs.danuberiverferryman.workers.dev/salsa-dance.choreo)，附[导入编辑说明](https://choreo-scene-packs.danuberiverferryman.workers.dev/dance-package-guide.txt)与[来源许可／质量记录](https://choreo-scene-packs.danuberiverferryman.workers.dev/source-and-license.json)。 两包真实原生导入／播放／指定关节K／其它轨保持／撤销2／2通过（112.17秒），街舞最倒置第799帧另1／1通过（11.15秒），实际errors／warnings／API0；root亲审近取景及倒置人物接受。街舞681K、余3415（Spine／Chest／双Shoulder四作者轨）；Salsa1452K、余2644（双LowerLeg／RightForeArm／双Shoulder五作者轨）。Root／Hips及其余轨完整密集基底保留。 首次给一条密集基底轨写K会建立该整条作者轨插值，以基底首尾姿势补端点；完整姿态K同时写Root和全部19关节，可能改变其它原动捕细节。只修改一个部位时使用所选关节K。未写轨不是空动作，也不是全部已有拖动作者键。

两包质量以校准、短窗源异常修补和RootY支撑适配后的基底为参照，9057／10173有限采样的最大作者旋转误差1.997188°／1.999203°；不是原演员骨架无损或连续时间全程证明。街舞手FK最大36.38mm／头19.53mm；Salsa脚底角点最大20.71mm、5个采样低于−3mm、最深−4.10mm。启发式支撑未保证水平滑步／身体碰撞消除，部分源姿态仍超保守编辑包络，作者数据保留。教学试跳、设备帧率与完整动力学仍未验收。 包与音频不进入公共代码repo；独立Cloudflare `choreo-scene-packs` 提供四文件下载，[GitHub Release v18-scene-packs](https://github.com/DFerryman/ChoreographyStudio/releases/tag/v18-scene-packs)于05:26:17Z正式发布，native id407489786／draftfalse／tag与target绑定95fb667，assets0、正文四外链exact。官方GitHub uploads两次401且native assets0、独立ASSETS首次upload JWT401及内置5retry／1of4仅暂存均保留，不能声称附件或暂存部署成功。首次运行token尝试KV返回401／Cloudflare10000，namespace0／PUT0；随后官方已安装Cloudflare connector确认同用户／账号，创建专用namespace `632828f74b8e48b0acb9bd3ac3aa2836` 一次，14个bulk请求／14key-success（两gzip包各6块＋guide／source2文本），native GET200核对14key和metadata逐SHA一致，无既有namespace修改／无expiry。独立下载Worker version `ce5ba5e2-87d2-4d42-a4ad-1f794bd9d3a2` 已上线；公开工件KV写入不等于编辑器D1或用户场景写入。实际下载服务版本／HTTP压缩还原／SHA／原生codec：05:23:18.637Z首轮curl4／4（HTTP200、TLSverify0、filename／bytes／SHA exact）与Chrome原生下载2／2（Content-Encoding gzip正常自动还原.choreo，无JS解压）字节／SHA实际通过；末尾请求审计误调用string字段url()抛TypeError，原脚本exit1保留，不记整轮exit0。05:26:46.922Z离线完成核对原6实下载文件6／6，复用原严格nativecodec2／2成功工件（音频SHA／时长／K／base exact），新增网络／浏览器／场景导入0；raw request events未保存，原先blockedRequests[]／errors[]／requests.length===2断言已实际先于TypeError通过；第一次离线completion在05:25:50.505Z误读空stdout为JSON，审计报Unexpected end of JSON input（exit1）也保留，实际codec成功工件已写出，最终改读该工件复用，未再执行codec／网络。最终combined receipt SHA256 `40cf4fe3b2070f086c2747c2bb468fb7200822e0b1fb4c53b62f5d7f8a2c9728`，原live失败receipt `6a3d865e466752ece9b041662f975b76aa86fe8bbad7eeb9d004264b867e4fda`，首离线审计失败receipt `9b76c12c74df6e00130f162c5eb2ff154ca4e2dcc7ba4ae1163149503073cf89`。

初始b059上线／公网6通过仅证明该初始运行；cdc准确CI37880557802／job113659036357最终450基础＋91／100浏览器、9失败，原始log112816B／SHA256 `9345dae61b20b9437203a588d7e456c7657b2edd148463e5a4f850b5f3478206`。此前取消CI、TLS未加载应用0／6、两批3／6与严格0／2均保留；新source不借旧运行证据宣称最终通过。

真实Workers AI／付费推理／D1写入／新图片上传0；v17人物数字资产和Worker业务源／绑定／限频配置保持。最终Markdown-only main与同版部署注释由独立回执和Notion记录，准确CI始终绑定所验runtime source，Markdown head不冒充CI head。 完成此轮并不关闭复杂接触／主动平衡／肩带协同／受限过渡、教师设备验证、教学MP4或账号云同步。

95阶段独立只读交接核验于05:31:20.408926Z实际通过：94／94运行文件与95fb667 Git blob逐字节／SHA相符、26／26dist库存／SHA完整相同、22个tracked public assets保持；没有新生成.choreo／BVH／AMC／音频加入trackedrepo，runtime／public／dist没有85_12／61_08包数据或引用，变更只为预计8Markdown。证据SHA256 `f4ad2e87649aaa7f46c536eef8ea1bbbdc8bb0f9e0564ef9ee541ff61d088161`；没有新增测试／浏览器／网络／API。

95阶段独立历史：运行95fb667／tree04cc31b已main，Cloudflare `8878bbd0-0f22-431d-80f9-8b1c61be69bf`（native19）／100%，deployment46cea86a；本地458／24与公网8／8、HTTP5实际通过，但准确[CI37885903336](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37885903336)／job113675734713／attempt1于05:34:37Z结束FAIL：458／458基础24文件、浏览器99通过／1失败（40.5分钟，100用例／24文件已执行）。唯一case59 tests/pose-guidance.spec.ts:103／line116要求可见草稿→K逐组件exact，新手势限位投影反复normalize造成2.22e−16／5.55e−17漂移；属于运行payload缺陷，原strict断言保持，不能把公网8／99例通过冒充完整CI成功。原始log78860B／SHA256 `86bdf975a70b9c67facdc1d871a33206a7a207b9920c2f9b63dd720a98d91dd6`，runupdated05:34:38Z，未手动rerun；后续修复只稳定新手势输出，既有KAPI／作者加载／bake／普通限幅不改。下载文件和发布tag95已验证事实独立保留。

EB中间阶段历史：运行eb96b29／tree944c6a77已main／Cloudflare number20（858edcb2）100%，local464／24、strict focused2首批59.442秒／诊断0通过；公开批次原计划9，但随后隔离worktree的同baseEB多轨6被suffix testMatch重复收集，实际15／15（5文件），05:55:57.330Z开始、239.329749秒、15个逐case strict诊断errors／warnings／API0，unexpected／skipped／flaky0。两份multitrack测试bytes／SHA完全相同，原断言保持；原postprocess assert9失败为统计审计问题，按真实15并列planned9＋duplicate6后完成收据，无另一次browser。94／26／HEAD／tree前后EB exact，HTTP5 TLS0／SHA通过。准确[CI37890466002](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37890466002)／job113690009837／attempt1／main push于06:30:51Z实际SUCCESS：464／464基础（24实际文件行／sum464）＋100／100浏览器（24文件、IDs1..100唯一、failed／notpassed0），05:51:07–06:30:48运行39.7分钟；原case59于06:13:15.1205182Z实际通过20.9秒。raw73665B／SHA256 `8b9f00a96a9a9666d76f1d9bf43731be43996ae52a98273349e0e99e202e26e0`，fullyVerifiedtrue，未手动rerun。成功只属于EB中间版，本段不能证明后续新版Timeline完成。新手势actualsource证明99,001 edits／185,367 calls／最多42相邻ULP、component4.44e−16／chord5.09e−14°、fixedpoint／limit0失败；work candidate-v2最多6ULP另列，不冒充实际source。

最后Timeline v1历史：6baa73c／tree10f482b0已pushmain但未部署Cloudflare，本地480与同源20例通过属于该首冻；随后真实complex native import1440→320使selectedChest行留在scrollbox外，严格toBeInViewport实际0／1，原断言不放宽。v2仅KeyframeEditor选中行effect加geometry.visibleWidth／labelWidth依赖，另9个正式source文件SHA原样，06:42:41.954274Z新冻、manifestSHA6aca4550ac456b31fb62424f6d12def7dbb4b5bfd55b73c659343f7cf60da8e2；最终新4＋nativecomplex1同源5／5不能冒称v1的20重跑。首触屏2／3、toast遮挡与capturelost修复历史另存，不隐去。

实际320px倒立取景限制：腿端可被既有stage工具／琥珀提示或画面边缘遮住；timeline/layout与选中行通过不证明所有身体部位无遮挡。另一次纯camera视图1／1（28.715345秒）保持project／K／selectedChest／time exact、诊断0／source10SHA同，也仍有上述遮挡；没有改包默认camera或扩改source，保留手动取景能力与限制。

Timeline v2／9a独立历史：运行9a023173c9a9848ab5c105cd1f981a778929d7c1／treea19e0215175cda2ca57a4fdba25a7bdd2c61a346、Cloudflare1ec19836-9be6-4ee5-9277-a04faa217071（native21）100%。准确[CI37895306305](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37895306305)／job113705194094／attempt1／main push于07:20:52Z实际FAIL：480／480基础25文件＋103／104浏览器25文件、104unique全部实际执行，33.2分钟。唯一case103 tests/transfer.spec.ts:258在320px打开“更多”的移动／复制弹层后页面scrollWidth340>320；后核原生截图与DOM，根因是stage右侧四工具left8／width331.672／right339.672，更多弹层自身right313且client=scroll304，没有弹层本身溢出；原≥44px按钮高度已通过，失败在实际转移后段前，不能称payload错误或103例等于完整成功。新Timeline4和strictpose已通过，仅保留对应source范围；Root授权最小CSS布局修复、新source push／新完整CI，原test／assert不改，不裁切或全局overflow-x掩盖，不手动rerun9a。原始raw78937B／SHA256 `d37f7465e03d01db0c12ee37ca5676c665d71b03cb493f2a324afd18bfec8643`；run created06:46:33Z，job06:46:35–07:20:52Z。watch在07:20:34Z出现HTTP401是CLI凭据过期，随后独立官方读取取得native FAIL，401不是CI失败原因。

此前9a运行[source9a02317](https://github.com/DFerryman/ChoreographyStudio/commit/9a023173c9a9848ab5c105cd1f981a778929d7c1)／tree `a19e0215175cda2ca57a4fdba25a7bdd2c61a346` 已push main、ls-remote读回；Cloudflare `1ec19836-9be6-4ee5-9277-a04faa217071`（native number21，产品迭代v18）于06:49:08.461855Z创建，初deployment `2418db53-a3de-49c8-9e25-73286cc243aa`／06:50:22.163473Z／100%，native注释绑定source9a／treea19。

9a阶段v2本地 `npm run check` 于06:44:11 UTC开始：480／480基础、25文件、15.95秒，前端类型与Vite1944模块／2.29秒构建EXIT0；Worker inputs完全未改，复用enabled原脚本类型PASS，首sandbox listen EPERM在tsc前的环境失败保留。v2同源新4＋native complex1实际5／5，06:43:26.890Z开始、112.879285秒，0skip／flaky／unexpected，5份errors／warnings／expectedHTTP／API诊断全0，正式10文件SHA前后同；v1同源20通过与native resize0／1不冒称v2批次。 准确[CI37895306305](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37895306305)／job113705194094／attempt1／main push／head9a02317：实际FAIL：480／480＋103／104，唯一case103窄屏stage四工具越右边界（打开转移弹层时被宽度断言发现）（完整失败记录见本历史段）。该9a版本有界HTTP与公网：有界HTTP5项在正常TLS下200，入口／JS／CSS字节与SHA精确，health／capabilities只读GET成功；同source9a／treea19公网首批实际13／13、5个精确文件（新Timeline4＋多轨6＋严格限位1＋控制入口1＋膝限位1），06:52:28.862Z开始、211.682553秒，unexpected／skipped／flaky0，13份逐例严格诊断errors／warnings／API及可选expectedHTTP全部0，正常CA／ignoreHTTPSErrors=false，真实AI／D1 0；96运行文件／26dist前后与冻结和commit逐字节／SHA相同；原始report1743709B／SHA256 `29cf5f318e98fd999f7be130b306cffd380ae4eec634f48c722055d9a12a7e95`；root实际看图：Root亲审该公网批实际dense1440／dense320／expandedjoint／strictknee四图，接受帧间距、逐关节轨、选中标记及限位姿态；与本地v2四图分别计数，未声称所有取景下全身无遮挡。

## v18 · 极简场景与多轨编辑（已实现，发布验收中） · 前期记录（历史）

2026-10-09 新增要求已记录：以尽可能大的场景为编辑主体，Timeline／Track 可作为场景浮层；常驻界面只突出人物直接操作、播放／定位和添加／更新关键帧，无用模块及重复信息移除。音乐与动作／Root／关节 K 分轨显示并支持拖动，采用视频剪辑器的轨道组织方式。

已实现视口大小场景、底部时间线浮层、收起／缩放／横向滚动和按需次要入口。音乐真实波形、Root、身体／左右臂／左右腿成轨，身体组可展开逐关节；组拖动只转移本组同帧作者键，取消／碰撞沿用既有保护。音频增加可选 audioOffsetSeconds，30 fps 吸附且保持已选源片段、CountMap 和动作时长；正负偏移外侧为静音，场景时钟独立运行。偏移保存在历史、本机场景和完整备份，旧数据缺省 0；v17 人物与作者动作／脚锁／步伐保持。

投影修复后最新本地 450／450 基础（24 文件）与前端类型／生产构建通过，基础用时 9.44 秒，记录于 2026-10-09 11:00:21（UTC+8）；未改 Worker 类型及先前 Wrangler dry run 已通过。此前 10:47:38／11.05 秒的 450 项只作修复前历史。最新 bundle 为 assets/index-JAM6kMSD.js，1138058 字节，SHA256 1297e24c678fb3c058747619ad087bacc8be8039a288caf0cececf88431be9df；CSS 未改。

新增浏览器首轮 3／6（187.586 秒）：场景高度 430／550px 不达要求、运行中 HMR 引发音频错误；运行修正后固定源第二轮仍 3／6（214.924 秒），分轨、组碰撞、偏移完整备份恢复通过，桌面 Root 出现 0.134mm 偏差、手机导出后更多弹层遮挡按钮、负偏移仅 0.3 秒可听窗口被轮询错过。第二轮六份诊断 errors／warnings／API 均为 0，但不能把断言失败写成全过。

最初把 Root 偏差归为测试投影的判断已被实际 probe 纠正。后续聚焦三例 3／3（53.268 秒、三份诊断 0），其中布局目标当时仅 5mm，不能证明原精度；恢复原五位小数断言后严格两例 0／2（32.083 秒、两份诊断 0），实际 Root 为 .250134／.250124。实测草稿条让时间线增加 26px，活动 transform 的投影偏移增加 13px；原生浮点指针误差仅 0.000018px，主因是运行代码在拖动中改变投影。已最小修复为活动 transform 冻结投影，松手下一帧更新，取消或明确取景即时同步；不放宽原精度门槛。

固定运行代码的最终新增六例实际 6／6，EXIT0；2026-10-09 11:02:25.040（UTC+8）开始，用时 96.267 秒，失败／跳过／flaky 为 0，六份 errors／warnings／API 诊断均为 0。桌面投影 down／六次 move／up 始终 115.5，释放后更新为 128.5；手机始终 139.5，释放后更新为 152.5。原 Root 五位精度与写 K 各分量 exact 均通过，包含手机拖 Root K／音频 1 秒、组／单关节拖动、碰撞／Esc、正负 4 秒真实音频边界、Undo／Redo、负 2 秒偏移保存刷新／完整包新 ID 恢复及原音频 SHA。根代理亲审最终桌面／390px 两图，接受舞台、浮层和全身可见性。首两轮 3／6、弱目标聚焦 3／3 与严格 0／2 均保留，最终 6／6 不写成首次通过。

相关旧流程、准确源码 CI、GitHub main 与 Cloudflare 发布仍待最终结果。结果记录在[验证](VERIFICATION.md)与[部署](DEPLOYMENT.md)，随后同步五份 Notion 和 main／Cloudflare；全部失败及原图保留，不预写发布成功。

最新发布核验：运行 main `b0599e2d8b84b5ba872a832517f2013a69a55b4b`／tree `97bfc0d702c7b5e9f76494d9775cfe5b92730fdb` 已部署 Cloudflare version18 `3709225d-3e2e-43b3-ab76-0513720c75bb`／100%，初始 deployment `11e8ff00-1f4a-45a1-a990-ebc9b007a999`。测试操作修正 main `cdc3723a53e65ce465d7a06ee748b347e7ceaf07`／tree `98a001fb1613f67ee7b9bff34f0a4e0a6e4a0243` 已远端读回，运行94文件／dist26与已部署版本逐项SHA相同。有界HTTP25已通过；公网初批6因执行环境CA信任失败、未进入应用，保留0／6。仅在任务临时profile配置现有CA的正常信任，TLS验证保持，未改HOME；单document GET返回200／TLS1.3／secure，随后唯一最终公网6于03:51:37.827Z开始、92.813秒全部通过，六份实际error／warning／API诊断0。root亲审该轮桌面1440／手机390／展开关节三图接受。准确CI37880557802／job113659036357／attempt1仍待完整100浏览器结束；此前取消CI、音乐／AI／相机浮层测试修正和所有失败保留，不提前宣称100通过。真实Workers AI／付费／D1写入0。

最新新增交付要求：用户撤回内置模板，要求直接可导入、稍复杂的成熟舞蹈场景包以观察效果上限，并支持Timeline／Track与二次修改。仅制作独立 `.choreo` 下载文件，不修改内置库或运行代码。使用合法CMU真人动捕：85_12复杂街舞转身与地板技巧37.5秒，61_08完整Salsa单人舞段56.25秒，附原创参考节拍；不声称是某流行歌曲原版或原曲同步。来源／实际帧率／短窗异常修补／固定骨架重定向／接地残差与4096作者K限制均需据实记录，完整高频基底优先保真，未经验证的包不记交付。包与音频等生成文件不进入公共代码仓库；待实际导入、播放、修改和真实人物视觉核验后提供下载附件。

## v17 · 06 默认人物（已上线，准确源码CI通过）

用户所选CC0 Quaternius Superhero Male默认人物已完成接入；原65骨／四权重和来源数据保留，继续25作者控制。display-2共同body G保持完整胸／颈／头；物理21映射框架仍匹配原canonical FK，肢段和82mm脚底固定校准。实际GLTFLoader归一化后从原GLB恢复四权重bits；raw源与运行绑定克隆明确分开，不称仅全局缩放或身材完全未变。

本地实际421／421基础、22文件，前端类型／构建与未变Worker类型通过。CPU15×8483全点最大0.237187微米；相关15浏览器场景经整体14与纠正工具／IK轴后focused1通过覆盖，77文件hash稳定、原权重真实加载bitexact。38实际App图中根代理亲审13张，实际旋转／K／插帧／播放及IK、桌面／手机形体与蒙皮接受。初版21frame数学过却胸肩平台／宽颈视觉拒绝、权重hash失败及测试纠正完整留档。

原K／Root／精确时刻／CountMap／历史／IK／脚锁／步伐契约和显式作者最高优先保持，无模型切换按钮。七组后续功能暂停、M0–M3未关闭。准确源码CI／运行main／Cloudflare／线上已验证，最后文档关联与Notion按最终metadata完成；真实Workers AI／付费0。下方v16及以前全文保留。

运行源码[ee376928](https://github.com/DFerryman/ChoreographyStudio/commit/ee376928f200e87e4eb48bbfec00fa60741fd12a)／tree `89c828c7b2770fd416a04c87dfe0fc04872dd7f2`已推送main；其准确[CI37871363910](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37871363910)／job113629975482／attempt1／main push于2026-10-09T02:10:06Z实际success：421／421基础（22文件）＋94／94浏览器（23文件），94逐例通过、失败／未通过0，未手动重跑。Cloudflare v17 `18dd4982-503a-4dfc-936c-6cffa7157b46`／100%，首次deployment `22f6f251-3b75-4495-800a-c8a3792e449a`；一次HTTP25和唯一公网8首轮通过，7份实际API／error／warning／expectedHTTP诊断0。root再亲审同轮23图中的6实际公网图，合本地13图接受形体／蒙皮。最后纯Markdown提交将通过同版部署注释关联最终main／tree与metadata，再同步五份Notion；不再上传运行资产或重测公网，真实Workers AI／付费／D1／新图片上传0。

## v16 · 平地自动迈步（已上线，准确源码CI通过）

新增确定性的平地左右／前后交替步派生层，沿作者Root水平路径安排支撑／摆动脚、抬脚和受限IK。“真实约束”中预览后明确采用，只保存`ground-steps-1`区间而不扩增稀疏K；保留baseTake、脚锁、上半身、CountMap和区间外原稿。作者K及草稿优先，近三帧淡出，非作者Root Y最多下降4厘米；新插入／更新／删除／移动K后重算。脚锁重叠、异常腿姿、悬空、转向、过快或不可达区间跳过并报告，零步不能采用。

修正后本地**411／411基础（21文件、10.89秒）**、类型／构建及Worker类型通过，相关3／3（50.677040秒）和42选定运行hash稳定。运行fb7188ac／Cloudflare v16 `3be3c456-b824-4b67-9b21-bff8dd0271d0`／100%，HTTP19／公网7通过，根代理亲审4最终本地图及3公网图。首8／13、旧406／3和1.4986米拒绝保留；首CI410／411单项5000毫秒超时失败，仅专用15秒timeout修正的e26813f3不改断言／fixture／runtime／dist。新准确CI37798386400／job113383745739／attempt1于15:30:08Z实际success：**411基础＋完整92浏览器**（各21文件），0失败／未通过。最终文档main以同版部署注释及Notion收据关联，不重复运行上传／公网；其它待办见[路线](ROADMAP.md)。

## v15 · 全身蒙皮与人体提示（已上线验证，准确源码CI通过）

本轮已接入Meta官方MHR v1.0.1来源人体、127内部骨骼、原生绑定／权重及公开学习式姿态修正，草稿、写K、插值和播放共用显示链。老师仍操作原25作者关节，旋转／Root／时序／历史、FK／IK／脚锁和操作柄保持，不新增127关节表单或骨长编辑。私有helper保留来源驱动关系并使用中立相对轴向引导与半转平滑，修正外展误作twist和表示接缝；不声称任意上游compact Euler全链等价、现成JavaScript肌肉引擎或完整生物力学。

用户看合图后进一步要求核查人体做不到的动作。普通旋转／IK的人体活动包络已有，AI候选按actionId／幅度构建并对采样中的19关节应用限位；本轮补齐**全身19关节提示**，不再依赖选中某一关节或暂停，播放／观看同样显示。舞台用紧凑琥珀提示，现有“真实约束”折叠摘要显示数量，展开查看部位；上臂摆幅大于120°而同侧Shoulder参与小于5°作保守肩带协同提醒，只提示，不自动搬肩。明确作者K与既有SLERP仍按原值优先，超限提示不偷偷裁剪作品；两端表内合法也可能中间插值超范围，当前会在所看姿态提示，不宣称完整轨迹可行或自动修复。

14姿态合图是蒙皮／作者契约核验，不能当正常人体可完成的舞步集。四项明确越已有表：单上臂170°超过150°；前臂轴扭60°超过8°；蹲姿脚X−40°低于−20°；右踝Z20°超过15°。单上臂150°且锁骨0、双侧150°也未表达肩带联动；固定作者Root的蹲／双侧fixture有悬空脚，不能当着地演示。根代理亲审46张实际全身、390px、草稿K和播放图；压力场景证明显示连续性及作者原值保持，不证明舞者能做、安全或教师可执行。

真实加载强化后的wire正式5／5（72.024秒）已通过，禁止placeholder冒充人体；原14／14几何回顾仍对应未变的MHR数字链。最终150°肩部压缩1／72、170°0／72低于原3%门槛，源标定胸部逐点运动误差0.0241／0.0296微米和neutral0.0273微米低于2微米；高1.849999974米、脚底误差小于2毫米。首4／5、170°3／72拒绝、旧25毫米线经来源验证后修订，以及paint／DQS／53骨链／45–65–90度transfer与heat拒绝均保留；未标定来源约8微米向量差与标量p95分开记录。

姿态修正以可复现gzip文件传输（6244575字节）还原原9587356字节并验证原SHA，按前8字节区分gzip或浏览器已解码的MHRCORR1，保留上限、Abort、单fetch和无API fallback。`.assetsignore`只排除线上原未压缩bin，源数据／离线／CI参考保留。旧wire3／5前三项实为placeholder、第4／5加载失败和两次未进入test的harness退出都留档；真实原因是Vite Content-Encoding后重复解压，修正后才作本轮加载通过。

最新本地380／380基础（20文件、8.60秒）、前端类型／构建通过，bundle为`assets/index-CzQnbqF8.js`。新增人体提示3个相关流程经首2／3、腕部复核失败后最终实际覆盖全部3场景，保留失败与作者归一化末位差的fixture修正，不谎称首轮3／3。较早功能main `16e1fb90`的准确CI实际359＋86已通过，仅作初版历史。最新a9b753cd运行源码已进入main及Cloudflare v15，单轮HTTP19与公网10通过；其最新准确源码CI380＋89已实际通过，最终文档main由同版部署annotation关联并复用已验运行版；Workers AI与付费动作生成请求0，MHR学习式稀疏ReLU本地实际计算。

### 当前准确运行版本与有界线上核验

实际运行源码[main a9b753cd](https://github.com/DFerryman/ChoreographyStudio/commit/a9b753cd11ad0ac303e81ae53e77b9e136e2ed27)／tree `fd54084a9f818ad910b7864307d0fa7d1fc1cf7c`已发布。Cloudflare version `ca7396ed-a8b1-4db6-a29d-149cbfdbcd59`／number15／100%，首次deployment `3157a661-7fb6-4339-b41f-ac89733774e8`于`2026-10-08T12:21:52.139463Z`；唯一成功运行上传12:21:37.907466–12:21:53.882121Z，5新资产／12复用，原三条失败路径作为独立历史保留。

唯一有界HTTP19／19于12:23:34.973722–12:23:38.206759Z完成；唯一公网相关10／10 FIRSTPASS于12:23:36.593Z开始，用时109.745579秒，unexpected／skipped／flaky及报告errors为0。9份实际诊断JSON的API／errors／warnings为0，另迟到绑定场景使用严格完整断言，不虚称第10份诊断。同轮产生24张图，根代理已亲审其中150°K、插值播放、170°390px、插值腕部四张；保留轻微腋部折痕，不宣称电影肌肉仿真。

压力图明确包含异常作者K、超限与固定Root场景，是蒙皮／数据契约验证，不等于默认受限摆姿或物理可行舞步。Workers AI与付费生成请求0；MHR公开学习式姿态修正本地实际执行。最新准确源码[CI run37775928775](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37775928775)／job113306622160／attempt1／main push已实际completed／success：**380／380基础（20文件）＋89／89浏览器（20文件）**，89逐例通过、失败／未通过0。Job于`2026-10-08T12:18:26Z`开始、`12:43:35Z`完成，共1509秒；browser终行`12:43:33.0391847Z`为89 passed（24.3m），run于12:43:36Z更新，首次读回12:43:43Z。完整原始日志70297字节／SHA256 `8f200441198d8d059b66e9e48e510cab17ef194a20e25cce9b8d149085cbe9c7`；没有手动workflow rerun。最终纯Markdown main通过同版Cloudflare部署annotation关联，复用以上已核对的运行版本、17资产和线上证据，不重复运行上传、公网测试或资产修改。

## v14 · 舞台直接摆姿与自然蒙皮（已上线验证）

用户明确移除右侧“选择关节”和“姿态调整”两块，不再要求编舞师使用逐轴角度/Root数值表单。主工作台采用全宽舞台与紧贴的时间轴；直接选取身体部位、旋转/整体移动/手脚IK形成草稿，显式K提交。姿态复用集中到时间轴既有“更多编辑操作”，只读坐标与真实约束按需展开；不把取消的参数模块搬到另一处继续堆表单。作者K最高优先、少量关键帧自动补间、草稿/历史/候选/本机保存和旧作品规则继续保留。

本轮采用统一 `neutral-rig-2` 与 `neutral-adult-v2`，共同校准肩部/上臂静止偏移，肱骨左右枢轴距中心由0.287米改为0.210米，模型肩部表面宽约0.517米。25关节名称/父子层级/局部旋转通道、Root/时间/CountMap和已保存历史保留；蒙皮、FK、IK、操作柄与物理代理用同一配置，无额外显示骨架。旧手臂派生空间轨迹随体型改变，不能声称旧手部世界位置不变；下肢/脚底/脚锁世界锚点与高度1.85米、质量70千克及其它内置参数保持。当前模型独立路径 `neutral-human-v2.glb`，旧文件保留供已打开v13页面加载。

用户截图所示肩腋变形已按统一骨架修正人体比例、连续几何与拓扑蒙皮权重。实际桌面站立、抬臂80°/120°、屈肘/屈膝和蹲姿、390px及八种CPU姿态已比较，肩宽与头臂比例更协调，腋下大块拉伸改善；高举臂仍有普通线性蒙皮的轻微压缩褶皱，不代表完整肌肉模拟。853172字节/11774顶点/23544三角形/25骨骼的新资产及完整CC0来源许可留档，绑定前校验骨骼层级、静止矩阵和inverse bind。冻结基础321项、前端/Worker类型和生产构建通过；本地58个相关流程、准确源码完整81项与单轮线上10项均已据实完成，main和Cloudflare已核对。真实AI测试保持0。

本轮功能源码[d435888f](https://github.com/DFerryman/ChoreographyStudio/commit/d435888f92a6a469f8de9cee0ee404ff5e54eecf)及更严格实际手柄测试[012c1cd1](https://github.com/DFerryman/ChoreographyStudio/commit/012c1cd1f3cadcf51bc8359e799c911c99291a19)已push main，最终源码树`ad3901cd91f7bfd06d4c2d9e3dc9e4764e05a7f5`与本地一致。[准确源码CI run37755495034](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37755495034)／job113238885766／attempt1于`2026-10-08T09:38:34Z` completed/success，实际**321基础＋完整81浏览器**；初始321＋80/81的旧保存guard fixture及独立7f3f完整通过记录保留，不手动rerun。Cloudflare v14 `b4a04064-9df8-479b-b817-0c6f7a1947e7`／100%，首次deployment `469d00f7-fe23-4e42-a88f-391eb8775be0`／`2026-10-08T09:10:51.003376Z`；单轮线上10/10和有界13 HTTP通过，实际8份JSON诊断及2模型断言错误／警告／API0，真实AI0。生产仍是d435，后续只改测试或Markdown，运行资产不重上传；最终文档main通过同版部署message关联。详见验证／部署记录。

## 历史 v13 · 作者关键帧最高权威（已上线验证）

用户明确自动插帧/迈步必须服从编舞师新增或更新的中间K，即使普通人体无法完成。明确作者轨道值与手动草稿意图优先于自动脚锁，完整姿态K保护Root与19个可编辑旋转，单轨K保护该通道；未写通道仍可辅助。作者K附近三帧平滑减弱自动修正，冲突展示最终实际残差，不靠改K消除提示。新增/更新/删除/移动K后重新计算相关过渡。

复用现有数值输入允许有限各轴±180°创作姿态，标准滑条/旋转环/IK保持人体建议；K与姿态粘贴不再次裁剪作者旋转，不新增按钮。独立AI/重力整段候选仍需主动请求、明确采用与替换说明，原稿可撤销；不是后台补间。自动迈步仍未实现，后续必须遵守作者优先。本轮作者优先源码 [e44a649b](https://github.com/DFerryman/ChoreographyStudio/commit/e44a649bb03583d847ea319dc27560643545a828) 已 push main，树 `ebc88873036023e6b00de28eb509a642a3ca97ae` 与本地一致；准确功能 head 的 [run37745471252](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37745471252)、job113205792740、attempt1 于 `2026-10-08T08:03:55Z` completed/success，实际 **319基础 + 完整81浏览器通过**，没有 workflow rerun。Cloudflare v13 `9dcbf7c0-24cb-41c7-a1a3-d36baa0893e4` 实际100%，首次 deployment `7e5a6ead-b240-4484-b83e-0a7f06f7716e` / `2026-10-08T07:46:28.924157Z`。单轮线上8/8与有界12 HTTP通过，实际诊断errors/warnings/API均0，真实AI推理0。最后仅Markdown回填复用该已验证runtime，并在同版100% deployment annotation关联最终main；实际ID与时间由Cloudflare记录核对。此前v12的306+76仅作为历史基线，详见验证/部署记录。

此前v12运行源码 [82b593d4](https://github.com/DFerryman/ChoreographyStudio/commit/82b593d483e875cb67d14975527bf5265eab3090) 与仅测试修正 [bd59b4bc](https://github.com/DFerryman/ChoreographyStudio/commit/bd59b4bc5cf189423fed29cf96349e81c7b79e6f) 已 push main；Cloudflare v12 `959cccfa-4deb-4e09-a064-ff840c881828` 实际100%。修正源码 [CI run37740462981](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37740462981)、job113189737231、attempt1，于 `2026-10-08T07:13:24Z` completed/success，实际306基础 + 完整76浏览器通过，无 workflow rerun。单轮线上9/9及有界12 HTTP通过，真实AI推理0；首轮CI75/76、异步文本trace、定向修正与运行版本对应证据保留在验证/部署记录。

此前已交付：**version 13，作者关键帧最高优先级，延续v12统一时间轴、连续中性人体与约束辅助。** 2026-10-08 用户在 v11 评估之后明确授权 AI、IK、脚锁与重力辅助，并要求优先采用可用开源库、内置标准中性人体参数且不要求用户手填。AI 确认使用 Cloudflare Workers AI，开发/验收禁止真实推理及走量；只用 mock/fixture。已实现四肢受限 IK、持久脚锁、默认分段质量/质心/惯量、代理诊断、Rapier 重力辅助核心及服务端 AI 编排接线；前端集成、本地/线上流程、准确源码CI与部署均已按本轮实际收据确认。

人物展示另选用有明确 CC0 许可的 MakeHuman/MPFB 衍生中性网格，已离线优化/重绑定至原 25 关节；来源 53 骨骼不改变权威 Take、父子链或 FK/IK。776,136 字节最终资产及独立本地校验/桌面手机视觉记录已冻结，本轮整体工作台、准确源码CI与部署已验证。来源与许可见 [人物资产](../apps/web/public/models/README.md) / [第三方声明](../THIRD_PARTY_NOTICES.md)；这只解决通用显示资产许可，不代替真实动作授权、生产 Avatar 校准或教师/设备门槛。

用户最新把进一步图形化/精简纳入同一轮：舞台下方统一时间轴集中播放、帧/秒定位、跳 K、筛选、主添加/更新完整姿态和撤回草稿，v12/v13历史侧栏仅姿态调整与复用；v14已移除两块参数面板并将复用并入时间轴。单轨 K、删除/站姿、移动复制和键明细折叠呈现，合并重复侧栏时间/K 与手动播放进度入口。实际改造与桌面/390 px三姿态流程已通过本地、单轮线上及完整源码CI；自动迈步仍是下一阶段，尚未实现。

此前已验证版本：**version 11 经典手动编辑器、原创实体人体与新编辑关节包络已上线。** 包含舞台快捷键、解码/试听/播放异步取消与旧结果隔离、原选段起点恢复、首次使用/新场景默认手动且旧模式保持，以及次要操作按需展开。原 25 关节层级上的实体成人 mannequin 替代细杆外观，统一四元数包络作用于新编辑/写 K；旧数据权威保持。具体范围和限位表见 [MANUAL_EDITOR.md](MANUAL_EDITOR.md)。

[功能源码](https://github.com/DFerryman/ChoreographyStudio/commit/e02b76bab054120b31314622cf416d752e847b6f)已 push 到 GitHub `main`，Cloudflare v11 `f245eba5-7cda-4950-bda7-f0cae576368b` 已 100% 部署。161 项本地基础检查、4 项新增约束交互和 20 项既有相关交互通过；CI、公网验收及实际资产对应关系统一以 [VERIFICATION.md](VERIFICATION.md) / [DEPLOYMENT.md](DEPLOYMENT.md) 的真实记录为准。version 10 的本机备份/恢复、缺失原音乐恢复、键时刻移动/复制和模态键盘继续保留为历史基线。原工程 ZIP 尚未取得，未执行 original 2.1.0 的验证；这只阻塞原契约集成，不阻塞当前已授权的手动编辑完善。

## 已验证基线与历史

相机取景：**version 9 已交付**。60 项本地检查、构建/Worker 类型与 dry run、4 项相关本地范围及复核、5 HTTP、单轮线上 4 项和实际源码 CI 完整 30 项通过；功能源码已 push 并同步 Cloudflare，v8 及以前证据保留为历史。

上轮交付：**version 10 已上线并验收**，由 [#11](https://github.com/DFerryman/ChoreographyStudio/issues/11) 跟踪。107 项基础检查、最终构建/Worker 类型与 dry run、8 个不同本地范围及缺音乐定向复核、5 HTTP 与单轮线上 8 项通过；[实际源码 CI](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37636175196)于 2026-10-07T14:29:27Z 成功完成 107 项检查和完整 38 项浏览器流程。[运行源码](https://github.com/DFerryman/ChoreographyStudio/commit/9fbc115f12d2580ff76b7cf5354fa581081579d8)已 push 并部署 Cloudflare v10 `6df3fd31-141f-4834-b25c-e871f5a8bbf7`。原 CI 37633679536 的 107 + 37/38 失败、过期画布坐标 trace/本地复现与[仅测试修正](https://github.com/DFerryman/ChoreographyStudio/commit/1719439d993cd893f19c771f90c2cf902ef46886)的定向通过保留；运行模块未变，沿用已通过的公网/部署证据。首次手机脚本和测试前启动问题也保留；不启用 AI、云保存或服务写入，最终验证文档提交与同版部署收据另列部署记录。

2026-10-07 的 v6 修正关节选择后的操作入口：默认编排模式显示旋转/整体移动动作，舞台提供旋转环和 Root 世界空间箭头；工具切换保留同帧草稿，显式写 K 规则不变。该版 18 项本地范围由首轮与相关复核通过，最终构建/Worker 类型、实际 v6 部署、7 HTTP、单轮相关线上 4 项及真实源码 CI 的完整 18 项全部通过。v5 的完整范围证据保留为历史。

v7 补充当前关节/Root 的显式键状态、各自独立删除、严格上一/下一 K 和全部/当前关节/Root 时间线筛选。单轨删除保留同帧其他轨；空删除不写历史；删除目标在草稿处理前固定。筛选只改变观看，不扩展保存契约；跳键保留草稿保护。v7 的 52 项检查/最终构建/Worker 类型、本地 7 项及追加 Root 单项、实际部署/5 HTTP/相关线上 4 项和源码 CI 完整 22 项均通过；首次脚本超时及证书失败保留在验证记录。

## 当前建设范围

| 项目 | 边界 |
| --- | --- |
| v11 手动编辑快捷键 | 已实现并上线：左右逐帧、Space、当前关节或整体移动 Root 的 K/Delete、撤销/重做；输入、顶层模态、草稿及单轨保护复用原规则 |
| v11 音频与模式恢复 | 已实现并上线：读取/解码、试听与播放启动可取消，旧结果隔离；重开恢复已确认选段起点；首次使用和新场景默认手动，旧场景按保存模式/工具及精确动作恢复 |
| v11 极简界面 | 已实现并上线：舞台/播放/时间/写 K 常用操作可见，姿态复用、删除/重置、键转移、相机高级、坐标、备份按需展开；只改入口层级，保留错误、数据和全部保护 |
| v12 图形化统一时间轴 | 已实现并上线：舞台正下方唯一手动时间轴合并播放、帧秒、跳 K、筛选、添加/更新完整姿态和撤回草稿；侧栏只摆姿/复用。单轨 K、删除/站姿、移动复制/键明细按需展开，删除重复控件；选时间/菱形不提交，保留快捷键工具语义与所有数据保护。桌面/390 px实际三姿态流程已通过，详细回执见验证记录 |
| 工作台 | 分区工作台、音乐/数拍确认、八拍卡片、候选预览/采用/放弃、撤销和教学播放已上线；version 4 的 10 项浏览器流程通过 |
| 3D 场景 | v11 历史是原创灰白实体成人 mannequin。v12 MakeHuman/MPFB 衍生 CC0 皮肤已优化重绑定并冻结，独立资产/视觉记录已有；本轮整体工作台/发布已验证。小节点/拾取代理及原 25 关节中心、父子链、骨长和动作保持。不是 UE 官方或已校准生产 Avatar。自由相机、旋转环、Root 箭头保持；右手系、Y↑、+Z 正面、米单位、XZ 地面 |
| v11 关节活动包络 | 已实现并上线：19 个可编辑旋转的 Euler 数值范围与四元数 swing/twist 共用约束，肘膝为近铰链；数值/滑条/操作环/新草稿及明确写 K 统一处理。旧 Take/基底/键/历史/导入不自动修复，Root 不改其他旧旋转；范围见 [手动编辑器](MANUAL_EDITOR.md#原创人体与关节活动限制) |
| v12 FK 与四肢 IK | 核心已实现，本轮集成/发布已验证。统一 25 关节 FK，复用 MIT Three.js CCDIKSolver，加人体弯曲方向初始化、pole 和逐轮复合限位；手/脚世界目标形成草稿，保持 Root、骨长和非链关节，不可达报告残差 |
| v12 持久脚锁 | 核心已实现，本轮集成/发布已验证。版本化世界脚踝锚点/脚部方向/起止帧，最多 32 个、同脚不重叠、平滑进出；显式支撑必要时只降低 Root Y。30 Hz 求解补样本而非数千条 K，保留源时刻/精确末帧及 4096/6001 上限；没有约束的旧动作不自动修复 |
| v14 标准中性人体 | 已内置 `neutral-adult-v2`：约 1.85 米/70 千克、16 对称肢段质量分布和局部质心，姿态相关惯量、重力/摩擦/恢复系数及有限辅助驱动；用户无需手填。工程代理近似，不声称个体测量或临床参数 |
| v12 接触/碰撞与支撑诊断 | 核心已实现，本轮集成/发布已验证。校准脚底代理，检测穿地、过滤自然相邻肢段的身体代理穿插，质量加权质心与准静态支撑多边形；动态/腾空不套用站姿判据硬拒绝，不构成教学或安全证明 |
| v12 重力辅助 | 已接入 Apache-2.0 Rapier 0.21.0 动态包络核心，按需加载/固定 1/120 秒步长/30 Hz 输出，保留原时间和末样本；重力、摩擦、地面接触、有限水平力/扶正力矩产生独立预览候选，明确采用才改稿。不是肢段独立刚体或完整主动平衡，本轮集成/发布已验证 |
| 手动关键帧 | v5/v6 已部署固定 CountMap、30fps 精确末帧、19 局部旋转+Root 米制位置、稀疏轨/不可变基底、显式草稿提交、历史/Scene 兼容与直接视口工具；v7 已部署轨道状态、单轨删除、严格跳 K 与时间线筛选，本地/必要线上/实际源码 CI 通过 |
| 姿态复用 | v8 已上线原稿/草稿复制与只粘关节或同时粘 Root，保留目标末端，显式 K 才提交；缓存只在当前页面内存，场景/音乐重置或刷新清空，不进入保存/备份，不调用系统剪贴板或 API。本轮新增本地/线上各 4 项及实际源码 CI 完整 26 项通过，无新增 D1 写入 |
| 相机取景 | v9 已上线：按当前可见骨架进行全身取景/选中关节聚焦，保留观察方向、依据真实宽高比适配；只读末端可聚焦。仅改变现有相机视图，保留草稿、播放、候选、权威动作和历史；60 项检查、4 项相关本地范围及复核、单轮线上 4 项及实际源码 CI 完整 30 项通过；无新增服务或 D1 |
| AI 接入前补齐 | v10 已上线并验收：完整场景备份/恢复、关键帧时刻移动/复制和模态键盘焦点。107 项检查、最终构建/Worker 类型/dry run、8 个不同本地范围及缺音乐定向复核、单轮线上 8 项、5 HTTP 和实际源码 CI 完整 38 项通过；运行源码及仅测试修正均已 push，Cloudflare 运行模块对应功能源码 |
| 缺失原音乐恢复 | v10 已上线，经定向本地复核、相关线上及完整源码 CI 通过：缺音频不配示例音乐，禁用播放/保存/完整包，保留项目 JSON；明确关联原曲并实际解码，草稿处理后的最新正式项目/视图保存为新 ID，旧场景保持原样，不清 K 或重烘焙 |
| 动作 | 原创 `synthetic-demo` 合成动作，仅展示运动与流程；未经独立舞蹈审核 |
| 数据协议 | `preview-1` 临时预览契约；不等同 original 2.1.0 机器契约 |
| v12 AI 编排 | 服务端 Workers AI / Qwen3-30B-A3B FP8 接线已实现，前端候选集成及原生AI绑定已验证部署，生成流程仅mock验收；按节拍排列现有六种原创模板、限制幅度，仍如实保留 `synthetic-demo`，不是任意真实舞蹈生成或生产 Motion Worker。没有本轮真实模型调用、生成质量或费用实测 |
| 音乐 | 浏览器本地读取与播放；当前没有上传音乐服务 |
| 保存 | IndexedDB 管理多个本机场景及各自原音频、编排历史、播放/相机/视图状态；新建、打开、复制、重命名、删除与旧单项目迁移已实现；没有账号、服务器持久化或跨设备同步 |
| API 保护 | v11 已真实绑定匿名 IP 原生限频 20 次 / 60 秒。v12 AI 再限 2 次 / 60 秒，新增AI与独立限频绑定已实际部署读回确认；同源 JSON ≤4 KiB、描述 ≤1000 字符、45 秒超时、取消与无重试。429/503 等仅 mock 验证，未做真实推理或公网 burst；无 D1/KV/DO，不是账户全局费用上限 |
| 导出 | 当前不提供经过验收的教学 MP4；项目数据导出不能替代教学视频 |
| 部署 | Cloudflare Web 预览；公开可访问性不代表教学发布验收通过 |

具体可运行功能以当前代码与本次检查结果为准。S0 不声称自动音乐理解、真实舞蹈生成、教学质量、许可通过、生产事务或固定 MP4 已完成。

## 原任务进度

| 任务 | 本仓库状态 |
| --- | --- |
| R01 协议与校验 | 仅预览契约与客户端边界；等待原 ZIP 导入、同源生成检查及真实服务接线 |
| R02 真实小包 | 通用CC0显示网格来源/实际接入已验证；仍待合法真实舞蹈动作、生产/教学 Avatar 校准、覆盖证明及独立教师/许可材料，不以显示皮肤关闭原任务 |
| R03 编排与烘焙 | 仅合成演示；待 Python Worker、真实过渡与接触检查、原 evaluator 对照 |
| R04 最小工作台 | S0工作台与P1本地手K已上线并验证；真实服务闭环尚未完成 |
| R05 教学输出 | 先实现显示交互；固定构图 MP4、设备音画和版本绑定教师确认待完成 |
| R06 试用与运行保护 | S0 匿名 API 限频已上线；教师试验、身份、租户、生产任务事务、服务端删除与回滚待完成 |

**M0–M3 均未通过。** 合成数据不满足真实内容门槛；工作台可访问或构建测试通过不等于里程碑通过。批次安排见 [ROADMAP.md](ROADMAP.md)。

[Cloudflare 在线预览](https://choreo-studio-preview.danuberiverferryman.workers.dev/) 已通过 S0 交互与部署检查；实际版本和可追溯结果见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 已交付阶段补充记录

v11 源码与 Cloudflare 已同步，新增人体外观及活动包络不改变原权威动作的加载/播放/保存规则。限位只覆盖新编辑与显式 K，不证明整个 SLERP 轨迹无穿插、足接触正确或动力学可行；后续 [真实编舞体验路线](REALISM_PLAN.md) 与原 M0–M3 仍独立验证。

2026-10-06 的 S0 v4 与 P1 v5 已由 [#5](https://github.com/DFerryman/ChoreographyStudio/issues/5)/[#6](https://github.com/DFerryman/ChoreographyStudio/issues/6) 完成。2026-10-07 的可发现编辑入口与 Root 3D 移动已发布 v6，本地、必要单轮相关线上、部署与真实源码 CI 全部通过，完成 [#7](https://github.com/DFerryman/ChoreographyStudio/issues/7) 的本轮退出条件；不新增服务或 D1 写入。下述原素材/契约与生产任务继续保留。

[#8](https://github.com/DFerryman/ChoreographyStudio/issues/8) 的 v7 轨道状态/单轨删除/跳 K 和筛选已完成相关本地、必要线上及实际源码 CI 验收，功能源码与交付文档已 push 并同步 Cloudflare。删除边界、空删除无历史、撤销/重做、严格相邻键、筛选空状态、草稿保护及小屏均有 v7 证据。该阶段未修改 core、API、基础设施或原协议，全部编辑在浏览器，未新增 D1 写入。

v8 按 [MANUAL_KEYFRAMES.md](MANUAL_KEYFRAMES.md) 实现场景内姿态复用。复制保持作品和保存状态不变；旋转粘贴保留目标 Root 和 6 个只读末端，第二种粘贴另复制受限 Root；两者都须显式 K。已有草稿确认固定请求内容与帧，部分提交继续保留未写变化。剪贴板独立且不持久化，场景应用/刷新/确认改音乐时清空；普通编辑、历史及同场景模板可保留。本轮 52 项既有检查、最终构建/Worker 类型、单轮新增本地 4 项与线上 4 项、5 HTTP，以及[实际源码 CI 完整 26 项](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37613142651)均通过，[功能源码](https://github.com/DFerryman/ChoreographyStudio/commit/200f943b751b519ae6c19f31b744e4638fc3da18)已 push 并部署 v8；最终验证文档也提交同步。不以 v7 证据代替本轮验证。

v9 按同一手 K 设计完成相机取景。明确点击全身取景或聚焦关节，针对当前可见草稿/镜像/候选/教学骨架计算，不隐式编辑动作或切换查看对象；保留相机方向，全身构图适配实际宽高比，只读末端可聚焦。取景不改当前帧、播放/音频、草稿、权威 take/revision/历史或教师确认；相机变化只通过现有本机场景视图保存。60 项本地检查、构建/Worker 类型与 dry run、4 项相关本地范围经首轮及数值显示断言修正后的复核、5 HTTP、单轮线上 4 项和[实际源码 CI 完整 30 项](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37627848531)通过；[功能源码](https://github.com/DFerryman/ChoreographyStudio/commit/b43817249a9ade4e68bc9900ef273b3e47fdec0f)已 push 并同步 Cloudflare，完成 [#10](https://github.com/DFerryman/ChoreographyStudio/issues/10) 的本机范围。首次脚本断言与复核保留，不以 v8 证据代替此轮检查。

用户扩大目标后，v10 已交付限定的 AI 接入前本机闭环。完整包包含原音乐，旧 JSON 重新关联原音乐；新 ID 事务导入保留精确动画、基底、轨道、CountMap、历史和相机，清空教师确认，不重确认音乐或重烘焙 plan。缺原音乐时明确恢复并保留草稿处理后的最新正式 K，旧场景不覆盖；保存/导入容量失败不谎报成功，清楚提示并允许重试。键转移范围固定、碰撞明确确认、空操作无历史，模态焦点和 Escape 只处理最上层。[SCENE_BACKUPS.md](SCENE_BACKUPS.md) 与 [PRE_AI_CHECKLIST.md](PRE_AI_CHECKLIST.md) 记录规则、实际验收与剩余门槛。本轮 107 项基础检查、最终构建/Worker 类型与 dry run、相关本地范围、单轮线上 8 项、5 HTTP 与实际源码 CI 完整 38 项均通过，源码已 push 并同步 Cloudflare；仍无模型、云保存或新增 D1，原素材和生产任务继续保留。

## 当前优先级与独立依赖

v12前端候选/草稿/脚锁/备份与统一时间轴已完成本地、相关线上和修正源码CI验证，源码已push main并同步Cloudflare；最终验证文档与同版部署关联见 [VERIFICATION.md](VERIFICATION.md) 和 [DEPLOYMENT.md](DEPLOYMENT.md)。后续优先整体移动的自动迈步辅助，本轮尚未实现。AI验证继续只用mock，禁止真实Workers AI推理测试或公网生成验收。

持续范围以经典手动编辑器为基础：编辑效率、可靠音频与本机作品保护优先，每个新增功能先确定常驻、上下文或折叠入口。用户后续授权已覆盖本轮 AI 编排、受限 IK、脚锁与物理辅助；标准中性人体配置内置。仍不增加骨长编辑、作品云保存/D1、无证素材教学使用或自由改变音乐/场景时长。原 M0–M3、素材/教师/设备与正式 MP4 门槛保持。

原生产/教学任务继续独立安排，不作为当前手动范围的开工阻塞：

1. 取得 original 2.1.0 工程包，读根 `AGENTS.md`，在私有工作区验证；按原生成器接入契约并明确 `preview-1` 迁移方案。
2. 落实一个真实合法的小包、一个 Avatar 与独立舞蹈审核；先满足完整组合和两个可替换中间槽位，再扩覆盖。
3. 实现 Python Worker 的同版 BakedTake 输出、真实接触/边界检查；网页和离线导出消费同一个产物。
4. 从首个真实组合开始教师观察，记录失败和返工；并行推进身份、版本事务、私有存储与生产 API。
5. 通过固定 MP4、目标设备音画、独立许可检查及正式教师验证，最后开放声明范围内的有限教学试用。

通用中性皮肤的CC0来源、接入/显示已有独立验证记录；源包下载、真实动作授权、生产/教学 Avatar 与教师安排、目标设备和重型执行环境仍没有以工程代码代替解决。后续每次交付记录实际运行检查和部署链接；只更新有证据的完成状态。
