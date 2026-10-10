# 可导入舞蹈场景包

## 当前导入与编辑说明 · 2026-10-10

上传的 `complex-street-dance.choreo` 未缺少手臂或腿部数据：4,499个基底源姿态和5,040个有效姿态全部包含Root与25关节旋转，主要四肢关节每个都有4,499个不同旋转值。稀疏作者K共681个（Spine441、Chest236、左右Shoulder各2）；双肩键只在0与37.5秒，中间窗口看不到这些菱形，腿部没有稀疏作者K。密集源点曾因过细而看似横线，现以源圆点／计算刻线／作者菱形区分，轨头显示数据点数量，可展开缩放查看。

应用只保留手动K帧工作台：场景导入后选时间、选部位、直接修改，完成变化时自动记录并可撤销。密集动作的局部点编辑继续保留邻近源点、其它通道和原时刻；新建手动作品及显式修改的稀疏作者轨使用末键保持，相邻作者键之间插值，不补基底结束姿态。旧包导入不自动重烘焙。下方显式按K／补首尾端点说明为历史，当前操作以本节和[关键帧规则](MANUAL_KEYFRAMES.md)为准。

旧包若已有编排记录但尚无动作Take，打开时临时使用中立姿态供手动编辑；首次实际编辑沿用已有编排绑定，原空动作历史保留，保存与完整包往返仍可验证。手机轨头保留清楚的左右臂／腿名称与点数量；下方轨道可在Timeline内纵向滚动查看。

当前及后续功能遵守[编辑交互长期标准](EDITOR_INTERACTION_STANDARD.md)：完整手动编辑无需 AI，精确选时间／场景部位后 Timeline 自动展开、高亮、聚焦，直接操作并局部自动记录，一手势一撤销，所有动作通道可见可改，未改数值与原音乐无损往返。

## 当前导入与局部微调（v19，已上线验证，准确源码 CI 通过）

1. 在[工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/)打开“场景 → 导入场景备份”，选择 `.choreo` 并“作为新场景导入”。既有场景继续保留，未保存修改沿用场景保存保护。
2. 暂停后在 Timeline 选择需要修改的精确时刻。Root 和全部 25 个局部旋转的源采样点均能查看和编辑；源点、计算点与已有作者 K 分开标识，非整数帧源点保留原始秒值。
3. 在场景点击人物部位，对应轨道和该时刻的点会自动展开、滚动聚焦并高亮。直接拖动旋转、Root 或 IK，松手自动记录实际变化；IK／脚锁实际改变的关联通道一起保存。
4. 调整错了可撤销／重做或打开紧凑操作记录；取消手势回退本次变化。普通编辑无需按 K 或点击添加／更新完整姿态，不会把所有部位拍成一次动作快照。
5. 保存可在本机重新打开；下载完整场景包可保留原音乐、局部修改及操作历史并继续编辑。未改原通道和原时刻数据保持，完整包使用无损共享／差量编码兼容旧包。

以上流程已在准确dd0d132／Cloudflare native23／100%实现；CI543基础＋37浏览器通过／1私有跳过，真实上传作品5,040原姿态／局部编辑／Undo／完整重导通过，修复CA信任后唯一公网6／6和桌面／390／320实际App图接受。本轮首失败、分批与完整回执见[验证](VERIFICATION.md)和[部署](DEPLOYMENT.md)。下面两包的来源、下载文件、v18 旧写 K 方式及当时发布证据完整保留为历史，不能用旧“按 K”说明替代新的局部自动记录流程。

## v18 包制作、下载与旧编辑流程（历史）

2026-10-09 用户最终要求独立场景包，撤回内置模板；舞蹈应稍复杂，以观察当前动作表现上限，Timeline／Track配套并支持二次修改。本次不修改应用、内置动作或默认场景。

两个完整单人动捕片段适配当前25关节骨架：CMU85_12的连续转身、倒置与地板技巧37.5秒；CMU61_08的完整Salsa舞段56.25秒。后者官方采集60Hz、3421真实帧、原长57秒，公开BVH头的通用120Hz不能用于时长；前者官方120Hz、4499真实帧。各自跳过转换者添加的首帧T姿势，并按完整段轻微调速，不靠拼接或循环延长。音轨为原创合成参考节拍，未使用原始表演音乐或外部样本，也不声称复刻某流行歌曲舞蹈或与原曲同步。

### v18 最终下载与当时编辑说明（两包当时已验收）

最新最后阶段用户要求：Timeline区域拉伸／扩张时同步放大或缩小每帧间距，逐帧K应清晰可见、可点击区分；极简界面要精致、便于操作；Timeline最后集中整理，功能明确、一眼可懂，以常见直觉拖拽为主，删除不使用的入口。本轮时间线已实现：全段显示→对数缩放滑杆→逐帧最大48px帧间距、统一滚动坐标与缩放锚点、空白区域点击定位／拖动平移、K和音乐边缘自动滚动；暗色中性浮层、不透明固定轨头、紧凑桌面约195px／手机约235px、手机K／音乐44px命中区，循环／速度／前后帧进入按需“更多”。16个显示轴几何用例实际通过；末尾不足1／30秒帧可伸展至48px，音频使用相同分段显示轴，真实时刻／核心动作逻辑不改。最终ac92保留上述操作与精致布局，仅三行≤360px工具padding-inline6修复四按钮右边界；保留完整12px标签／44px高／单行。新source公网缩放4＋原transfer3共7／7、诊断0／96runtime和26dist前后同，Root亲审公网3图及本地4图分别接受；准确完整CI结果独立记录。320倒立腿端仍可能被既有浮层／边缘遮，布局验收不保证任何取景下全身无遮挡。最终修复源码／CI／Cloudflare与实际交互和人物取景须独立核验，不借任何旧source通过。

用户最终撤回内置模板，已制作两个独立 `.choreo` 场景包：CMU85_12连续复杂街舞转身／倒置／地板技巧37.5秒；CMU61_08完整单人Salsa56.25秒。包内包含动作与原创128BPM参考节奏，可分别导入独立场景并二次修改；非原曲或某流行歌曲原版编舞。[复杂街舞37.5秒](https://choreo-scene-packs.danuberiverferryman.workers.dev/complex-street-dance.choreo)／[完整Salsa56.25秒](https://choreo-scene-packs.danuberiverferryman.workers.dev/salsa-dance.choreo)，附[导入编辑说明](https://choreo-scene-packs.danuberiverferryman.workers.dev/dance-package-guide.txt)与[来源许可／质量记录](https://choreo-scene-packs.danuberiverferryman.workers.dev/source-and-license.json)。

包与音频不进入公共代码repo；独立Cloudflare `choreo-scene-packs` 提供四文件下载，[GitHub Release v18-scene-packs](https://github.com/DFerryman/ChoreographyStudio/releases/tag/v18-scene-packs)于05:26:17Z正式发布，native id407489786／draftfalse／tag与target绑定95fb667，assets0、正文四外链exact。官方GitHub uploads两次401且native assets0、独立ASSETS首次upload JWT401及内置5retry／1of4仅暂存均保留，不能声称附件或暂存部署成功。首次运行token尝试KV返回401／Cloudflare10000，namespace0／PUT0；随后官方已安装Cloudflare connector确认同用户／账号，创建专用namespace `632828f74b8e48b0acb9bd3ac3aa2836` 一次，14个bulk请求／14key-success（两gzip包各6块＋guide／source2文本），native GET200核对14key和metadata逐SHA一致，无既有namespace修改／无expiry。独立下载Worker version `ce5ba5e2-87d2-4d42-a4ad-1f794bd9d3a2` 已上线；公开工件KV写入不等于编辑器D1或用户场景写入。实际下载服务版本／HTTP压缩还原／SHA／原生codec：05:23:18.637Z首轮curl4／4（HTTP200、TLSverify0、filename／bytes／SHA exact）与Chrome原生下载2／2（Content-Encoding gzip正常自动还原.choreo，无JS解压）字节／SHA实际通过；末尾请求审计误调用string字段url()抛TypeError，原脚本exit1保留，不记整轮exit0。05:26:46.922Z离线完成核对原6实下载文件6／6，复用原严格nativecodec2／2成功工件（音频SHA／时长／K／base exact），新增网络／浏览器／场景导入0；raw request events未保存，原先blockedRequests[]／errors[]／requests.length===2断言已实际先于TypeError通过；第一次离线completion在05:25:50.505Z误读空stdout为JSON，审计报Unexpected end of JSON input（exit1）也保留，实际codec成功工件已写出，最终改读该工件复用，未再执行codec／网络。最终combined receipt SHA256 `40cf4fe3b2070f086c2747c2bb468fb7200822e0b1fb4c53b62f5d7f8a2c9728`，原live失败receipt `6a3d865e466752ece9b041662f975b76aa86fe8bbad7eeb9d004264b867e4fda`，首离线审计失败receipt `9b76c12c74df6e00130f162c5eb2ff154ca4e2dcc7ba4ae1163149503073cf89`。

当前编辑器运行[sourceac92f74](https://github.com/DFerryman/ChoreographyStudio/commit/ac92f743db9a144b9b6527ba1e465b82f87d2a9d)／tree13e41442008ca4ec04b1d8627aa20e7bf2f27faf已main，Cloudflare `e4784790-54c6-4716-a4a0-f8259567d381`（native22）100%；其JS与前一9a原生复杂包导入通过版本逐字节相同，实际新验证结果见[验证](VERIFICATION.md)。 固定Release tag95是首次发布兼容锚，不随编辑器更新移动；两包内容和下载SHA保持，历史包验收与当前运行证据分别记录。

在[Cloudflare应用](https://choreo-studio-preview.danuberiverferryman.workers.dev/)点击“场景 → 导入场景备份”，选择文件后“作为新场景导入”。两包分别创建本机场景；桌面已按全片范围取景，窄屏可点现有全身取景按钮。暂停、选时间与具体关节，在场景摆姿后按K；音频与已有作者K可以独立拖动，支持撤销。

| 包 | 完整真人来源 | 作者轨 | 已有K／余量 |
| --- | --- | --- | --- |
| 复杂街舞37.5秒 | CMU85_12，官方120Hz，4499帧；原37.483333秒轻调速 | Spine、Chest、左右Shoulder | 681／3415 |
| Salsa56.25秒 | CMU61_08，官方60Hz，3421帧；原57秒轻调速，单舞者 | 双LowerLeg、RightForeArm、双Shoulder | 1452／2644 |

公开SalsaBVH通用120Hz头不代表官方采集率，不是120Hz下采样；两包跳过额外Tpose，其余完整捕捉不剪切、拼接或循环。Root、Hips与其它关节保留全部密集基底，作者层上限4096K不能无损放下所有60／120Hz通道。

首次给一条密集基底轨写K会建立该整条作者轨插值，以基底首尾姿势补端点；完整姿态K同时写Root和全部19关节，可能改变其它原动捕细节。只修改一个部位时使用所选关节K。未写轨不是空动作，也不是全部已有拖动作者键。

两包真实原生导入／播放／指定关节K／其它轨保持／撤销2／2通过（112.17秒），街舞最倒置第799帧另1／1通过（11.15秒），实际errors／warnings／API0；root亲审近取景及倒置人物接受。街舞681K、余3415（Spine／Chest／双Shoulder四作者轨）；Salsa1452K、余2644（双LowerLeg／RightForeArm／双Shoulder五作者轨）。Root／Hips及其余轨完整密集基底保留。

两包质量以校准、短窗源异常修补和RootY支撑适配后的基底为参照，9057／10173有限采样的最大作者旋转误差1.997188°／1.999203°；不是原演员骨架无损或连续时间全程证明。街舞手FK最大36.38mm／头19.53mm；Salsa脚底角点最大20.71mm、5个采样低于−3mm、最深−4.10mm。启发式支撑未保证水平滑步／身体碰撞消除，部分源姿态仍超保守编辑包络，作者数据保留。教学试跳、设备帧率与完整动力学仍未验收。

动作固定骨架重定向保留RootXZ，使用完整腕部＋掌部映射；显式桥接街舞2段腿＋2段掌、Salsa1帧腕＋11段掌源解算异常，RootY经启发式支撑适配，详见下载的source-and-license.json。协议`synthetic-demo`仅是preview-1的固定兼容字段，实际来源为CMU真人动捕。CMU允许复制／修改／再分发、允许纳入商业项目，但禁止直接转售动捕数据本身（包括转换形式）；BVH转换者无新增限制。音频为原创数字合成，无外部样本，非原始表演曲，不声称逐帧原曲踩点。

4下载原始文件：街舞26710050B／SHA256 `e5f3d969c550fa6d401706b08cbe8beafb80a9346e1029e4d2c7a10a906afad5`；Salsa27041119B／`9d8022c073eb79210f8d6b1d9b661e2db05ee62541ca9fa1027551379100e34d`；guide3327B／`84da3c1f76eb5ea4d245f6433f33135631790f39ed6a35c1effd97ae2fef445f`；source/license105349B／`2432cab6f1c7f25fa683276804c95616024523ec4f49b64dae13da80f2fcad59`。

生成包和音频不进入公共代码repo，也不内置应用。公开入口／下载回读与应用发布事实分别关联，见[验证](VERIFICATION.md)与[部署](DEPLOYMENT.md)。

95阶段独立只读交接核验于05:31:20.408926Z实际通过：94／94运行文件与95fb667 Git blob逐字节／SHA相符、26／26dist库存／SHA完整相同、22个tracked public assets保持；没有新生成.choreo／BVH／AMC／音频加入trackedrepo，runtime／public／dist没有85_12／61_08包数据或引用，变更只为预计8Markdown。证据SHA256 `f4ad2e87649aaa7f46c536eef8ea1bbbdc8bb0f9e0564ef9ee541ff61d088161`；没有新增测试／浏览器／网络／API。

95阶段独立历史：运行95fb667／tree04cc31b已main，Cloudflare `8878bbd0-0f22-431d-80f9-8b1c61be69bf`（native19）／100%，deployment46cea86a；本地458／24与公网8／8、HTTP5实际通过，但准确[CI37885903336](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37885903336)／job113675734713／attempt1于05:34:37Z结束FAIL：458／458基础24文件、浏览器99通过／1失败（40.5分钟，100用例／24文件已执行）。唯一case59 tests/pose-guidance.spec.ts:103／line116要求可见草稿→K逐组件exact，新手势限位投影反复normalize造成2.22e−16／5.55e−17漂移；属于运行payload缺陷，原strict断言保持，不能把公网8／99例通过冒充完整CI成功。原始log78860B／SHA256 `86bdf975a70b9c67facdc1d871a33206a7a207b9920c2f9b63dd720a98d91dd6`，runupdated05:34:38Z，未手动rerun；后续修复只稳定新手势输出，既有KAPI／作者加载／bake／普通限幅不改。下载文件和发布tag95已验证事实独立保留。

EB中间阶段历史：运行eb96b29／tree944c6a77已main／Cloudflare number20（858edcb2）100%，local464／24、strict focused2首批59.442秒／诊断0通过；公开批次原计划9，但随后隔离worktree的同baseEB多轨6被suffix testMatch重复收集，实际15／15（5文件），05:55:57.330Z开始、239.329749秒、15个逐case strict诊断errors／warnings／API0，unexpected／skipped／flaky0。两份multitrack测试bytes／SHA完全相同，原断言保持；原postprocess assert9失败为统计审计问题，按真实15并列planned9＋duplicate6后完成收据，无另一次browser。94／26／HEAD／tree前后EB exact，HTTP5 TLS0／SHA通过。准确[CI37890466002](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37890466002)／job113690009837／attempt1／main push于06:30:51Z实际SUCCESS：464／464基础（24实际文件行／sum464）＋100／100浏览器（24文件、IDs1..100唯一、failed／notpassed0），05:51:07–06:30:48运行39.7分钟；原case59于06:13:15.1205182Z实际通过20.9秒。raw73665B／SHA256 `8b9f00a96a9a9666d76f1d9bf43731be43996ae52a98273349e0e99e202e26e0`，fullyVerifiedtrue，未手动rerun。成功只属于EB中间版，本段不能证明后续新版Timeline完成。新手势actualsource证明99,001 edits／185,367 calls／最多42相邻ULP、component4.44e−16／chord5.09e−14°、fixedpoint／limit0失败；work candidate-v2最多6ULP另列，不冒充实际source。

最后Timeline v1历史：6baa73c／tree10f482b0已pushmain但未部署Cloudflare，本地480与同源20例通过属于该首冻；随后真实complex native import1440→320使selectedChest行留在scrollbox外，严格toBeInViewport实际0／1，原断言不放宽。v2仅KeyframeEditor选中行effect加geometry.visibleWidth／labelWidth依赖，另9个正式source文件SHA原样，06:42:41.954274Z新冻、manifestSHA6aca4550ac456b31fb62424f6d12def7dbb4b5bfd55b73c659343f7cf60da8e2；最终新4＋nativecomplex1同源5／5不能冒称v1的20重跑。首触屏2／3、toast遮挡与capturelost修复历史另存，不隐去。

实际320px倒立取景限制：腿端可被既有stage工具／琥珀提示或画面边缘遮住；timeline/layout与选中行通过不证明所有身体部位无遮挡。另一次纯camera视图1／1（28.715345秒）保持project／K／selectedChest／time exact、诊断0／source10SHA同，也仍有上述遮挡；没有改包默认camera或扩改source，保留手动取景能力与限制。

Timeline v2／9a独立历史：运行9a023173c9a9848ab5c105cd1f981a778929d7c1／treea19e0215175cda2ca57a4fdba25a7bdd2c61a346、Cloudflare1ec19836-9be6-4ee5-9277-a04faa217071（native21）100%。准确[CI37895306305](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37895306305)／job113705194094／attempt1／main push于07:20:52Z实际FAIL：480／480基础25文件＋103／104浏览器25文件、104unique全部实际执行，33.2分钟。唯一case103 tests/transfer.spec.ts:258在320px打开“更多”的移动／复制弹层后页面scrollWidth340>320；后核原生截图与DOM，根因是stage右侧四工具left8／width331.672／right339.672，更多弹层自身right313且client=scroll304，没有弹层本身溢出；原≥44px按钮高度已通过，失败在实际转移后段前，不能称payload错误或103例等于完整成功。新Timeline4和strictpose已通过，仅保留对应source范围；Root授权最小CSS布局修复、新source push／新完整CI，原test／assert不改，不裁切或全局overflow-x掩盖，不手动rerun9a。原始raw78937B／SHA256 `d37f7465e03d01db0c12ee37ca5676c665d71b03cb493f2a324afd18bfec8643`；run created06:46:33Z，job06:46:35–07:20:52Z。watch在07:20:34Z出现HTTP401是CLI凭据过期，随后独立官方读取取得native FAIL，401不是CI失败原因。

此前9a运行[source9a02317](https://github.com/DFerryman/ChoreographyStudio/commit/9a023173c9a9848ab5c105cd1f981a778929d7c1)／tree `a19e0215175cda2ca57a4fdba25a7bdd2c61a346` 已push main、ls-remote读回；Cloudflare `1ec19836-9be6-4ee5-9277-a04faa217071`（native number21，产品迭代v18）于06:49:08.461855Z创建，初deployment `2418db53-a3de-49c8-9e25-73286cc243aa`／06:50:22.163473Z／100%，native注释绑定source9a／treea19。

9a阶段v2本地 `npm run check` 于06:44:11 UTC开始：480／480基础、25文件、15.95秒，前端类型与Vite1944模块／2.29秒构建EXIT0；Worker inputs完全未改，复用enabled原脚本类型PASS，首sandbox listen EPERM在tsc前的环境失败保留。v2同源新4＋native complex1实际5／5，06:43:26.890Z开始、112.879285秒，0skip／flaky／unexpected，5份errors／warnings／expectedHTTP／API诊断全0，正式10文件SHA前后同；v1同源20通过与native resize0／1不冒称v2批次。 准确[CI37895306305](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37895306305)／job113705194094／attempt1／main push／head9a02317：实际FAIL：480／480＋103／104，唯一case103窄屏stage四工具越右边界（打开转移弹层时被宽度断言发现）（完整失败记录见本历史段）。该9a版本有界HTTP与公网：有界HTTP5项在正常TLS下200，入口／JS／CSS字节与SHA精确，health／capabilities只读GET成功；同source9a／treea19公网首批实际13／13、5个精确文件（新Timeline4＋多轨6＋严格限位1＋控制入口1＋膝限位1），06:52:28.862Z开始、211.682553秒，unexpected／skipped／flaky0，13份逐例严格诊断errors／warnings／API及可选expectedHTTP全部0，正常CA／ignoreHTTPSErrors=false，真实AI／D1 0；96运行文件／26dist前后与冻结和commit逐字节／SHA相同；原始report1743709B／SHA256 `29cf5f318e98fd999f7be130b306cffd380ae4eec634f48c722055d9a12a7e95`；root实际看图：Root亲审该公网批实际dense1440／dense320／expandedjoint／strictknee四图，接受帧间距、逐关节轨、选中标记及限位姿态；与本地v2四图分别计数，未声称所有取景下全身无遮挡。

## 导入与修改 · 前期记录（历史）

在[Cloudflare预览](https://choreo-studio-preview.danuberiverferryman.workers.dev/)中点击“场景 → 导入场景备份”，选择一个`.choreo`文件，再点击“作为新场景导入”。两个文件分别创建独立本机场景；完整包内含音频、动作与可编辑数据。

暂停、选择时间和关节后在场景内摆姿，按K写入该关节；已有作者关键帧可在分轨时间线上拖动，操作支持撤销。当前30fps作者层最多4096K，无法无损表达每条60／120Hz轨道；优先保存完整密集基底，给经实际误差检查合格的轨道添加稀疏K。未写K的轨道仍播放完整基底，也能手动开始写K；开始对一条基底轨写K后，该轨按作者键与隐式端点重新插值。完整姿态K会同时创建所有可编辑轨，可能重写此前基底轨的细节；只需修改某一关节时使用所选关节K。

当前真人数据重定向到固定肢长，包含源解算异常的显式短窗桥接和RootY支撑适配。完整原始数据、修补范围、实际误差、接地与滑移限制应在附件`source-and-license.json`记录；播放与皮肤观察不能证明完整动力学或教师试跳通过。旧协议中的`synthetic-demo`是严格兼容字段，不是本次动作来源说明。

## 来源与交付记录

CMU官方允许复制、修改与分发动作数据，主页允许商用但禁止直接转售数据。BVH转换者未加新限制。保留出处与许可记录：

- [CMU Motion Capture Database](http://mocap.cs.cmu.edu/)
- [官方FAQ](http://mocap.cs.cmu.edu/faqs.php)
- [subject85动作列表](http://mocap.cs.cmu.edu/search.php?subjectnumber=85)
- [subject61动作列表](http://mocap.cs.cmu.edu/search.php?subjectnumber=61)
- [BVH转换与说明](https://sites.google.com/a/cgspeed.com/cgspeed/motion-capture/cmu-bvh-conversion)

生成场景、音频和中间数据不进入公共代码仓库；最终经过实际原生导入、播放、所选关节K／撤销和真实人物图核验后，作为[独立下载附件](https://github.com/DFerryman/ChoreographyStudio/releases/tag/v18-scene-packs)交付。本段当前记录准备范围，最终包SHA、轨道、余量与实际验收结果待确认后填入。
