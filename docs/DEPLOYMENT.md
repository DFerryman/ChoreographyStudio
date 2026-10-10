# Cloudflare 预览部署

## v22 · 2026-10-10 · 四肢Timeline／末键保持／手动单模式（已发布；公网严格音频审计仍有未解释失败）

本轮实现可辨认的四肢源点／计算点／作者点、版本化末键保持和单一手动工作台。用户附件、音频、私有审计工件不进入公共仓库，现有模型资产和业务API配置保持。本地635项基础、52个不同浏览器流程、类型／构建、Worker、离线拟合及真实包严格审计已通过，分批结果和范围见[验证](VERIFICATION.md)。最终产物`index-B3UefweF.js`／`index-GhWOHzJk.css`已上传并在[工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/)生效。

此前直接推送GitHub main被自动审批拒绝，理由是请求未明确授权发布；用户随后明确要求提交、push到main并部署Cloudflare，本次推送和部署均实际完成。

| 本次发布项 | 实际收据 |
| --- | --- |
| GitHub main运行源码 | [05afa539](https://github.com/DFerryman/ChoreographyStudio/commit/05afa539d1627777f1319f36528c3f5ecaa7e2f7)，tree `49a78128a45cc1abb527fecf846d5079a576706e`；源码push EXIT0并原生读回相同，后续发布记录通过仅Markdown提交同步 |
| 准确源码CI | [38023885337](https://github.com/DFerryman/ChoreographyStudio/actions/runs/38023885337)／job114130496257／attempt1／success，04:23:22–04:41:37 UTC；635基础32文件、Python6项、fit、前端类型／构建和Worker通过；浏览器51实际pass／1私有附件skip（16.6m），非52pass |
| Cloudflare版本 | native26／`8e5e1648-0452-4263-b876-aa41099d17d7`／v22-manual-timeline，04:24:51.195601Z，upload EXIT0；仅新HTML／JS／CSS三资产上传 |
| 100%部署 | `4f51abfa-bcb4-43f9-912d-2e47867b87ff`／04:39:16.971692Z，deploy EXIT0，唯一新version100%；version／deployment原生message都含准确source／tree |
| 配置核对 | 与native25的bindings／script_runtime精确一致；AI、ASSETS、API20／60s、AI2／60s、原namespace、SPA／API worker-first及安全headers保持，无D1；observability enabled／sampling1、logpush false |
| 正常TLS HTTP | 04:39:50.028594–04:39:51.789106 UTC，5／5，verify0／retry0／redirect0；HTML／JS／CSS逐字节与dist相同；health／capabilities仅两次只读GET |
| 公网浏览器首批 | 04:47:35.474Z开始、259.826秒，实际EXIT1／5通过／1严格失败／0跳过或重试；真实包动作／音频断言全部完成，scratch审计仍保留1个未解释的本地blob媒体取消，不能将该批改为6／6 |
| 唯一聚焦诊断 | 05:00:22.726Z开始、191.187秒，实际EXIT1／0通过／1严格失败；仅补原生媒体事件观察，原判定不变，2个本地blob取消仍unexpected。原动作与音乐字节回环断言完成，不声称音频播放或完整线上审计通过 |

完整CI原log100443B／SHA `3cd61ec3e50da48bce031655745fc6ad02a5a213f3c31a20d31d8dff74d3497b`；首次logs下载exit1只是工具下载失败，官方gh run view有界fallback EXIT0，不是CI失败或重跑。上传／部署日志SHA分别`521937a83e6b0a50434a161d09b3ad0a831743568a85acf37fef9725ebd1887c`／`f0f3a6f9151929cc65b5b95bd11238399a712af76cbd316050f08f578487d3e3`；HTTPreceipt SHA `6601e5d619173a83a5eb9e5dc6a12ced0d464f2fb4ea98d6da2db907321b1578`。发布freeze156文件／SHA `0135a4e48b735f8771e02783872d6d01a3f4f9acd77f2f93c7494cc06e31f7c1`，130 Git blob精确，未修改已验收运行源码／dist／原spec。付费AI与D1写入0。

公网首次审批将native FileChooser本地读取视为私有附件上传，拒绝时0执行／0目标请求。随后核对File.arrayBuffer→本地decode／IndexedDB及blob音乐路径，并以冻结静态GET和严格重定向审计获准执行。首批77个实际HTTP请求均为无query／body的静态GET，11主文档及11模型响应均200且SHA正确，API／外发附件／AI／D1写入0；初始route不拦截重定向后的请求，因此仍逐项记录并严格拒绝未知后续请求，不声称它完整隔离网络。原report SHA `ca1012d129dee99a1d11c98434ad29f30041dbe900951538de8277d31e99365a`／receipt SHA `4e6cbe550e0e8e6190796da35b7e103561a2bb9b3fc4952c8200f4197c5eab19`保留。

唯一聚焦仍失败，report SHA `7c0ab8fcda495382935451cb566ccf0788f7c34f70d4d7c83d96bcbbc836019f`／receipt SHA `a21845ef2cf4ddfce6a12d8c410bbec9641fcf776fc545ac2289465c304a2c25`，85个媒体事件、4条媒体请求记录、7个静态GET精确响应，API／重定向／外发附件0。156发布文件、原18 scratch及归档18、观察6前后完全一致；库存SHA `38777e793e30355e0da35f803a0d749d818b09056171e7e5b9d71807bee6d93d`。未放宽判定或再复跑。最终Markdown发布记录不改运行资产，沿用上述准确源码CI及同版本部署，无二次上传。下方v21及旧本地发布段保留为历史。

## v21 · 摄像机轨道已发布，准确 CI 与分批公网验收完成

[打开工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/)。运行源码 [29d56d23](https://github.com/DFerryman/ChoreographyStudio/commit/29d56d23a22c5a55c6da8a263d01515e10fc6323)／tree `07def2ca48c8cc594a7e83dd21b8526b4dd2f983`，冻结inventory `d8ebf7910998524fd289d1ede533e6c774eb302303f83e3f0f1a198270d751da`。Camera独立精确秒轨道／历史／原场景回环已验证；未来bake只为需求。下方提交前和AF正文全部原字节保留。

| 实际发布项 | 同源原生收据 |
| --- | --- |
| Cloudflare version | 25／`d51b3db7-2757-4e64-b5db-9a97c7d82721`／v21-camera-track／2026-10-09T12:57:45.175978Z，upload EXIT0 |
| 100%部署 | `2e98bb48-df0e-4def-a06d-3fdf2e392de6`／12:58:57.455112Z，deploy EXIT0，单一新version100%；两边source／tree正确 |
| 配置实际审计 | AI、ASSETS、RELEASE_STAGE、AI_RATE_LIMITER、API_RATE_LIMITER；AI2／60s与API20／60s及原namespace；SPA fallback、/api/* worker-first、三安全headers符合冻结配置 |
| 本地与准确CI | 最终Camera4／4、旧3／3、619基础／32 files、前端及Worker通过；main push run37933375186／job113829312682／attempt1 success，6offline／fit检查、619实际文件行、build／Worker通过；browser10files、45实际pass＋private附件case22 skip1，12.5m |
| 有界HTTP | 已执行原5／5，13:00:09.204091–13:00:13.958433Z，normal TLS verify0／retry0；root/mainJS/CSS逐bytes／SHA与dist相同，health/capabilities只读GET；不新增请求 |
| 首批公网 | 原5／6通过，13:00:11.012Z／200113.757ms；第4camera例仅旧scratch将旧audio media取消记为failed，原report不改写 |
| 受影响focused | 第4camera例单独1／1、EXIT0，13:16:08.102Z／77635.108ms；生产与原断言不变；实际raw media cancel1、expected1、unknown0 |
| 合并验收口径 | 首批5个真正pass＋focused1 pass＝6个独立流程／2批／7尝试；不是单批6／6。正常TLS、模型SHA、应用诊断／API均核对；Root亲审首批6图＋focused1图accepted，审图不改变原failure |
| 发布后同源核对 | runtime81／dist26／tests69／offline16／delivery2，194文件完整freeze不变、168Git源码blob精确、added／removed／changed／invalidGit0 |

实际7次attempt共17document200／17模型读，合并6个通过流程14document／14模型读；所有GLB480376B／SHA `6570b23a63a0a5b87ad3fa5f8d7a24536c8e7fc3ceb03d28893cb48966cc6527`。首批report SHA `a01d22f2cbfa970d1a6598160d34b029ddbe7e984c2e26524d3a5998f7d329bd`，focused SHA `8bbdd27f60acb03b6671e8d12aad62100fa0781a84c48aa394d73e60ead87304`；CI原log SHA `152d77fcf0b1a4c9e00ed074a6f1d1eb366a11576374619aea13e09c7ccc0f96`。证据索引 `work/camera-release/public-final-evidence-index.json`，详细范围见 [VERIFICATION.md](VERIFICATION.md)。

scratch修正仅观察同文档／同audio元素先前旧src归属、精确同源GET/media/ERR_ABORTED及2s内不同src替换；本次detach -11ms／replacement +19ms，beforeunload分类0，raw失败完整保留，未知请求与console／API／TLS仍严格失败。它没有生产runtime修复，也不证明逐句cleanup调用或旧文档传输错误全汇总。首watch401仅工具认证失败，后fresh native poll和官方原日志成功，无workflow rerun。

真实公开动作5040 poses／原WAV7200044B由local／public回环证明；CI使用portable fixture，不宣称真实包CI回环。浏览器业务API0，HTTP两只读API另计；AI／付费推理／D1写入／新增图像上传0。音乐留在浏览器；桌面部分取景脚部可能被已有浮动timeline／下载notice遮挡，不作全取景无遮挡承诺。后续仅docs-only提交与既有UUID注释／100%更新，不新增upload、browser或CI运行。

## v21 · 精确秒摄像机轨道（本地检查完成，尚待发布）

本轮Camera轨道及历史／场景备份回环已完成本地验收。新main source／tree尚待Root提交／push；准确CI、新Cloudflare version／单一100% deployment、正常TLS有界HTTP与唯一公网批次均尚待实际回执。当前入口 [工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/) 的已发布证据仍对应下方AF v20源码，不能作为本轮Camera通过记录。

| 本轮已完成项 | 实际收据与范围 |
| --- | --- |
| Camera最终4 | batch9 4／4，EXIT0，12:41:05.467Z／171594.342ms；84 source bytecopy及before／after／当前均一致；4份应用diagnostics errors／warnings／HTTP errors／API为空 |
| 旧功能3 | 3／3，EXIT0，12:46:54.243Z／74228.848ms；89 source不变；两个points用例API／console／HTTP errors为空，scene camera仅console/errors/warnings记录为空 |
| foundation／build | 最终619／619、32／32 files，12:48:54开始，34.26s；TypeScript与Vite1952模块、580ms通过，既有大chunk警告保留 |
| Worker | 最终Wrangler types及Worker TypeScript EXIT0；代理环境与npm通知保留 |
| commit前源／dist封存 | runtime81／dist26／tests69／offline16／delivery2；inventory SHA `d8ebf7910998524fd289d1ede533e6c774eb302303f83e3f0f1a198270d751da`；正式Git blob字节比较待新commit |
| Root实际审图 | Camera桌面／390、数值inspector与原公开动作／WAV恢复四图accepted；桌面author取景脚部可能被已有timeline遮挡，不承诺所有姿态无遮挡 |

最终Camera report SHA `7d6c09ee943f26180e17136985c94d8beb75c240e8533f506d3bf78e6124f6fe`；旧3report SHA `85668d5c113aa3a5274e74ef788798aa0a963220d4ef6bee63055f48a9b7fd0b`；check log SHA `4e967e53f8689f2ba0dc2435903bf760c77f08428b9552c12e8250e71e4837bb`；Worker log SHA `cc927123b7329142ee2e78d036f6febc4298b10f78b7f5571bda7706c983a40e`。原始文件与离线汇总位于 `work/camera-browser/batch9-report.json`、`work/camera-legacy-final/`及`work/camera-release/`，本段未重跑检查。

所有开发失败／取消观察保留，精确范围见 [VERIFICATION.md](VERIFICATION.md)。batch6／8工具层exit130未终止Node／npm子进程，两份原最终report均3通过／1失败或超时，不能写为未执行或无断言。500ms wheel idle仅设计调整，已证实的wheel问题为原生OrbitControls reconnect/bubble顺序分类；原音频object URL生命周期已修复。本轮真实公开complex-street-dance fixture在浏览器本地回环5040 poses及原WAV7200044B，不是缺失私人附件，音乐不上传server。摄像机bake仅未来需求。

待本轮新main准确CI通过后，由Root读取官方Wrangler version／deployments原生JSON，核对同一source／tree、100%和既有绑定／限频／SPA／API-first／headers，再执行唯一有界正常TLS公共验收。公网前从最终main重拷测试，保留应用断言，native wrapper核对准确source和新100% version；不使用precommit prepared-copy，不把versions view单独当作100%证明。实际CI／HTTP／public数量、资源SHA、截图和写入计数待原始收据后再更新，没有本轮AI／付费／D1／公网行为的新增通过结论。

## v20 · 可复用人物碰撞体（AF 中间版已上线验证）

[打开工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/)。人物采用17个离线骨段凸包，新舞台旋转／Root／IK手势截停新增或加深的身体／地面接触；导入、播放和显式作者数值保持原值并提示接触。通用拟合器保留胶囊／盒／凸包选择，换模适配与拟合算法分离，生成源码及报告可复现。默认人物与原音乐／动作数据保持，具体边界见 [COLLISION_PROXIES.md](COLLISION_PROXIES.md)。

此发布准确绑定 [af1415d](https://github.com/DFerryman/ChoreographyStudio/commit/af1415d70613dc983640f840b13abfed29578045)／tree `57d9c2af6d0d473f11a649986c9666d580795dbb`，已 push main。后续相机轨道v21正在独立工作树实现，尚待新的最终源码／完整检查／准确CI／Cloudflare验收；以下AF发布证据仅对应碰撞版。

| AF 实际部署项 | 原生读回与同源结果 |
| --- | --- |
| Version／number／tag | `6140d4f5-507d-4c3c-bc48-35c2f9396f50`／24／v20-body-collision |
| Version创建UTC | 2026-10-09T11:18:57.571091Z |
| 首deployment／UTC | `e7162c7d-5be7-4746-af6e-c409b94cdad1`／2026-10-09T11:25:23.396828Z |
| 流量／source注释 | 100%；version和deployment均包含完整AF source／tree，官方Wrangler原生JSON读回相符 |
| 官方上传／部署 | 修正任务内配置目录后EXIT0；Read29资产，2新／修改文件上传、21复用；Worker startup3ms为CLI测量，不是设备帧率 |
| 保持的绑定／策略 | AI、ASSETS、RELEASE_STAGE；API20／60s namespace2026100601、AI2／60s namespace2026100801；SPA fallback、`/api/*` worker-first和安全headers原样 |
| 准确CI | [37922754770](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37922754770)／job113794375265／attempt1／main push，于11:31:49Z job success；Python3.12.15／锁定依赖／生成核对／offline6、581基础31文件、前端构建／Worker类型全部通过 |
| CI实际浏览器 | 41通过、私有fixture1项跳过；9文件／IDs1..42逐项核对，13.2分钟，新碰撞4项实际通过，未rerun |
| 发布后封存核对 | runtime79／dist26／tests67／offline16／delivery2与最终冻结bytes／SHA完全相同，源码与AF Git blobs逐字节一致 |
| 有界HTTP | 5／5，11:26:02.458920–11:26:06.858186Z；正常TLS verify0／retry0，根页／JS／CSS bytes／SHA精确及health／capabilities两只读GET成功 |
| 唯一相关公网 | 6／6，11:26:19.646Z开始、104,395.052ms；四碰撞＋原points桌面／390，0unexpected／skip／flaky／report errors；六实际TLS和应用诊断全零，15document200，API先abort |

主JS `index-Cj6ftVs3.js`1,284,585B／SHA256 `2a297baefe20d13a3263b4c808a5df3689c405b490960041b8812d9e87735884`；CSS `index-B5ZA0MHA.css`72,223B／`b698624b8677a8fdad833d3ec57bd206c3870f927d16f387fa79342d9909bfb9`。四碰撞用例共10次实际默认GLB读取200／glTF／480,376B，SHA `6570b23a63a0a5b87ad3fa5f8d7a24536c8e7fc3ceb03d28893cb48966cc6527`与冻结模型一致。公网报告1,361,575B／SHA `306f8c890832f30153fc584bf7c15e829fc8eabda61c8dcc78d1d92253d5e6c9`；准确CI日志99,943B／SHA `879f2efda52c0111d9295bef70cd3414e070ba2d979148f701405627b9190b2a`，完整失败历史和实际范围见 [验证记录](VERIFICATION.md)。

首upload因默认 `/home/agent/.config/.wrangler` 缺失退出，随后只将XDG配置目录置于任务work内，HOME与应用源码保持；成功上传／部署独立记录。公网使用离线原生复核的既有CA用户信任库，`ignoreHTTPSErrors=false`，原浏览器参数保持。Root亲审本批全部7张实际App图，接受桌面碰撞／作者原值／Root地面／points流程及清晰mobile points全身；loaded-skin390近取景有部分头部被顶部工具栏遮挡，明确记录取景局限，不宣称所有视图都无遮挡。审图与自动断言、本地图分别计数。真实Workers AI／付费推理／D1用户数据写入／新图片上传0；没有为本次离线核对再次运行公网。旧v19及更早发布记录全部保留。

## v19 · 精确数据点自动记录（已上线验证，准确源码 CI 通过）

[打开工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/)。当前默认手动流程不依赖 AI：选精确时刻、在场景选部位，Timeline 自动聚焦对应点，直接编辑并在松手时只记录局部／IK关联变化；一手势一撤销。Root 与全部25局部旋转可见可改，原数据及音乐无损往返；完整姿态快照按钮／K快捷键移除。用户要求将此布局和流程作为后续标准，见 [EDITOR_INTERACTION_STANDARD.md](EDITOR_INTERACTION_STANDARD.md)。

运行源码 [dd0d132](https://github.com/DFerryman/ChoreographyStudio/commit/dd0d132785489ac3baedb19f53448ad6945adaf6)／tree `c6a09961f587d7a3b93b2260db5efc10e0d90295` 已 main，native读回相符。准确 [CI37910066138](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37910066138)／job113752815025／attempt1／push 于09:28:05Z success：543／543基础27文件、前端类型／Vite599ms、Worker类型通过；37个浏览器实际通过、8文件、11.5分钟，私有fixture1项跳过。未手动rerun；日志83,687B／SHA `85ad50b82c2de382bc7410eed1251c1b534b17274db5035d3262e741309f9192`。本地38个独立场景由多个完整／focused批次覆盖，不能称一次全量38通过；跨引擎样本、原生触控、NLERP新支点、compact音乐reader的首失败和修复详见[验证记录](VERIFICATION.md)。

| 实际部署项 | 原生读回 |
| --- | --- |
| Version／number／tag | ed9c35b6-15b2-4af7-a895-7f74462b8d34／23／v19-point-edits |
| Version创建UTC | 2026-10-09T09:23:55.434468Z |
| 首deployment／UTC | 56eeba04-841b-45f2-b2ab-bc4d1df4c947／2026-10-09T09:23:55.872532Z |
| 流量／source annotation | 100%／Exact channel editing and permanent workflow standards; main dd0d132785489ac3baedb19f53448ad6945adaf6 |
| 官方Wrangler结果 | EXIT0，Read29资产文件，3新／20复用；启动3ms为CLI测量，非设备帧率 |
| 不变绑定 | AI、ASSETS、RELEASE_STAGE；API20／60s namespace2026100601，AI2／60s namespace2026100801 |
| 静态策略 | SPA fallback、/api/* worker-first、安全headers原样 |
| 冻结库存 | runtime74／dist26；modelREADME21,099B／SHA14a040b502495cbd844209ec056681a9da82feeb7cde18035215d068b5dd5202 |
| 有界HTTP | 8／8，09:27:35.326739–09:27:37.544456Z，正常TLS verify0；6静态bytes／SHA＋health／capabilities两GET |
| 公网浏览器 | 修复CA信任后唯一6／6，09:51:12.731Z开始／111,888.072ms；6实际零诊断、10document200、正常TLS；首0／6未进应用独立保留 |

最初单独 /index.html 返回307 canonical redirect，传输成功但expect200审计失败；改用 / 的8项与原请求累计9请求，无retry，初失败保留。HTTP精确核对的主JS `index-DCKYDdaR.js` 1,161,641B／SHA `279a0772403bd0507133d98d0b5fd53239a053478222aeb946383ecb85e909b3`，CSS `index-B5ZA0MHA.css` 72,223B／SHA `b698624b8677a8fdad833d3ec57bd206c3870f927d16f387fa79342d9909bfb9`；完整关键资产表见验证。

公网首唯一批的6次 `ERR_CERT_AUTHORITY_INVALID` 均在document首次导航，6份diagnostics虽然API／errors／warnings为0，实际failedRequests6、documentResponse0，不能当应用通过。6张privacy图与6份实际trace.zip保留，Root没有接受该批App图；官方151 tag仍优先已有旧NSS目录，XDG猜测不作原因；只读旧NSS初始化fallback仍待直接日志证明。实际配置work内Chrome-created Default/ServerCertificate用户库，已有CA DER＋官方Trusted(3) metadata经离线原生cert manager复核，再复制到任务临时profile；不是UI文件导入。args／HOME／正常TLS保持、不忽略证书。修复后有界批另计，首次0／6原样保留。

修复后唯一公网批覆盖三points、首播放与390／320布局，实际6／6，unexpected／skipped／flaky／report errors0；六份独立JSON的pageErrors／consoleErrors／consoleWarnings／apiRequests／failedRequests全空，10个mainResponses全200、httpsVerification=true。report1,517,966B／SHA256 `f723e3f4d7c514e0bd25c2daa1af61198047e1f915aaa5f216e4b8f55be5a8d1`，两wrapper文件与CI八source文件独立计。Root亲审该批desktop／390-Root／320三张实际App图接受，与本地dense320／edge／backup-mobile三图分计，未追加测试／网络批。

本轮只发布编辑器代码，已有独立CMU场景包／下载服务／Release tag及其SHA不改。私有源附件和音频不入公共repo，默认Quaternius人物数字资产及静态modelREADME冻结；真实Workers AI／付费推理／D1用户数据写入／新图片上传0。最后Markdown-only main通过同版deployment annotation关联，准确CI仍绑定dd0d132 runtime，不把文档head冒充CIhead。五页Notion保留最新v18全文／引用／四图和新增永久标准，最终Markdown-only提交与同版deployment注释后按实际head同步metadata；以下全部旧发布证据保留。

## v18 · 最终运行与独立场景包发布（已上线验证）

最新最后阶段用户要求：Timeline区域拉伸／扩张时同步放大或缩小每帧间距，逐帧K应清晰可见、可点击区分；极简界面要精致、便于操作；Timeline最后集中整理，功能明确、一眼可懂，以常见直觉拖拽为主，删除不使用的入口。本轮时间线已实现：全段显示→对数缩放滑杆→逐帧最大48px帧间距、统一滚动坐标与缩放锚点、空白区域点击定位／拖动平移、K和音乐边缘自动滚动；暗色中性浮层、不透明固定轨头、紧凑桌面约195px／手机约235px、手机K／音乐44px命中区，循环／速度／前后帧进入按需“更多”。16个显示轴几何用例实际通过；末尾不足1／30秒帧可伸展至48px，音频使用相同分段显示轴，真实时刻／核心动作逻辑不改。最终ac92保留上述操作与精致布局，仅三行≤360px工具padding-inline6修复四按钮右边界；保留完整12px标签／44px高／单行。新source公网缩放4＋原transfer3共7／7、诊断0／96runtime和26dist前后同，Root亲审公网3图及本地4图分别接受；准确完整CI结果独立记录。320倒立腿端仍可能被既有浮层／边缘遮，布局验收不保证任何取景下全身无遮挡。最终修复源码／CI／Cloudflare与实际交互和人物取景须独立核验，不借任何旧source通过。

最终运行[sourceac92f74](https://github.com/DFerryman/ChoreographyStudio/commit/ac92f743db9a144b9b6527ba1e465b82f87d2a9d)／tree `13e41442008ca4ec04b1d8627aa20e7bf2f27faf` 已push main并远端SHA精确读回。Cloudflare `e4784790-54c6-4716-a4a0-f8259567d381`（native22，产品迭代v18）于07:34:11.692073Z创建，100%初deployment `a04134ec-cca8-4fe8-ab25-9e889ef66244`／07:34:54.898518Z，upload／deploy EXIT0、native注释绑定ac92／tree13e。

最终运行96文件／dist26按冻结和commit逐字节／SHA封存。JS `index-B4aq9XS5.js`1147811B／SHA256 `51ca317a4a9e4185fb927c79aa4785df56f35451f58ebbf433159be24b419ab9` 与9a JS字节精确相同（文件名更新）；CSS `index-CcnCqTQI.css`75474B／`0441a7a6b847438d375cad8117b53984c3daa35ef8604bf1104313fa21421df1`；index645B／`fad20e70d989394deab160cd4893110d20a061d69f3ff8b0eb7c36c4f06a90bc`。Wrangler实际Read29 files、新／修改2文件（index与CSS）2／2上传、21 already uploaded，EXIT0；provider统计与96runtime／26dist库存分列，最终同版部署注释不再上传assets。

最终ac92本地 `npm run check` 于07:31:54 UTC开始，480／480基础25文件、12.32秒，前端types＋Vite1944模块／1.11秒构建EXIT0；Worker输入未改，复用enabled原脚本actual类型PASS。仅一份CSS增加≤360px工具padding-inline6三行，保留12px完整标签／44px高／单行；原正式transfer3／3（111.439706秒）原width／Root／rotation／baseTake／revision／collision／undo／save／draft断言未改，诊断0；最终supplementary1／1（28.819567秒）与首incomplete1／1（28.499455秒）的桌面截图限制分别保留，126源快照前后SHA一致。Root亲审新local transferMore1440／390／320及stage四工具320四图接受。准确[CI37899685795](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37899685795)／job113719068029／attempt1／main push／headac92：于08:16:16Z实际SUCCESS：480／480基础（25条唯一文件行、sum480）＋104／104浏览器（25文件、IDs1..104各一次实际执行并通过），failed及failure／notpassed markers0，浏览器41.9分钟，未手动rerun；run于07:33:16Z创建、job07:33:19–08:16:16Z、runupdated08:16:17Z；有界HTTP5在正常TLS下200，index／JS／CSS字节和SHA精确、health／capabilities只读GET成功，AI／D1 0。最终同源公网：ac92／tree13e唯一首批公网实际7／7、2个精确文件（Timeline缩放4＋原transfer3），07:38:06.276Z开始、156.809599秒，unexpected／skipped／flaky0；7份逐case严格诊断errors／warnings／API全0，expectedHTTP按可选字段计（新4字段0、原3无字段），正常CA／ignoreHTTPSErrors=false／APIabort，真实AI／D1写入0；96runtime／26dist与冻结和commit前后逐字节／SHA完全一致。原始report1009168B／SHA256 `69e7deba009026e7f40c3c611a421e681508a75a1aead1492af967802539659a`；Root实际公网图：Root亲审该公网批dense320／transfer-mobile390／transfer-desktop1440三张实际图接受，与本地More1440／390／320＋four-tools320四图独立计；不声称公网图全部320px或所有身体部位无遮挡。

初始b059上线／公网6通过仅证明该初始运行；cdc准确CI37880557802／job113659036357最终450基础＋91／100浏览器、9失败，原始log112816B／SHA256 `9345dae61b20b9437203a588d7e456c7657b2edd148463e5a4f850b5f3478206`。此前取消CI、TLS未加载应用0／6、两批3／6与严格0／2均保留；新source不借旧运行证据宣称最终通过。

用户最终撤回内置模板，已制作两个独立 `.choreo` 场景包：CMU85_12连续复杂街舞转身／倒置／地板技巧37.5秒；CMU61_08完整单人Salsa56.25秒。包内包含动作与原创128BPM参考节奏，可分别导入独立场景并二次修改；非原曲或某流行歌曲原版编舞。[复杂街舞37.5秒](https://choreo-scene-packs.danuberiverferryman.workers.dev/complex-street-dance.choreo)／[完整Salsa56.25秒](https://choreo-scene-packs.danuberiverferryman.workers.dev/salsa-dance.choreo)，附[导入编辑说明](https://choreo-scene-packs.danuberiverferryman.workers.dev/dance-package-guide.txt)与[来源许可／质量记录](https://choreo-scene-packs.danuberiverferryman.workers.dev/source-and-license.json)。 包与音频不进入公共代码repo；独立Cloudflare `choreo-scene-packs` 提供四文件下载，[GitHub Release v18-scene-packs](https://github.com/DFerryman/ChoreographyStudio/releases/tag/v18-scene-packs)于05:26:17Z正式发布，native id407489786／draftfalse／tag与target绑定95fb667，assets0、正文四外链exact。官方GitHub uploads两次401且native assets0、独立ASSETS首次upload JWT401及内置5retry／1of4仅暂存均保留，不能声称附件或暂存部署成功。首次运行token尝试KV返回401／Cloudflare10000，namespace0／PUT0；随后官方已安装Cloudflare connector确认同用户／账号，创建专用namespace `632828f74b8e48b0acb9bd3ac3aa2836` 一次，14个bulk请求／14key-success（两gzip包各6块＋guide／source2文本），native GET200核对14key和metadata逐SHA一致，无既有namespace修改／无expiry。独立下载Worker version `ce5ba5e2-87d2-4d42-a4ad-1f794bd9d3a2` 已上线；公开工件KV写入不等于编辑器D1或用户场景写入。实际下载服务版本／HTTP压缩还原／SHA／原生codec：05:23:18.637Z首轮curl4／4（HTTP200、TLSverify0、filename／bytes／SHA exact）与Chrome原生下载2／2（Content-Encoding gzip正常自动还原.choreo，无JS解压）字节／SHA实际通过；末尾请求审计误调用string字段url()抛TypeError，原脚本exit1保留，不记整轮exit0。05:26:46.922Z离线完成核对原6实下载文件6／6，复用原严格nativecodec2／2成功工件（音频SHA／时长／K／base exact），新增网络／浏览器／场景导入0；raw request events未保存，原先blockedRequests[]／errors[]／requests.length===2断言已实际先于TypeError通过；第一次离线completion在05:25:50.505Z误读空stdout为JSON，审计报Unexpected end of JSON input（exit1）也保留，实际codec成功工件已写出，最终改读该工件复用，未再执行codec／网络。最终combined receipt SHA256 `40cf4fe3b2070f086c2747c2bb468fb7200822e0b1fb4c53b62f5d7f8a2c9728`，原live失败receipt `6a3d865e466752ece9b041662f975b76aa86fe8bbad7eeb9d004264b867e4fda`，首离线审计失败receipt `9b76c12c74df6e00130f162c5eb2ff154ca4e2dcc7ba4ae1163149503073cf89`。

真实Workers AI／付费推理／D1写入／新图片上传0；v17人物数字资产和Worker业务源／绑定／限频配置保持。最终Markdown-only main与同版部署注释由独立回执和Notion记录，准确CI始终绑定所验runtime source，Markdown head不冒充CI head。 应用与下载服务分别记录，不把下载asset版本当编辑器运行版本；生成文件不入内置库。授权预览仍为 https://choreo-studio-preview.danuberiverferryman.workers.dev/ 。

95阶段独立历史：运行95fb667／tree04cc31b已main，Cloudflare `8878bbd0-0f22-431d-80f9-8b1c61be69bf`（native19）／100%，deployment46cea86a；本地458／24与公网8／8、HTTP5实际通过，但准确[CI37885903336](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37885903336)／job113675734713／attempt1于05:34:37Z结束FAIL：458／458基础24文件、浏览器99通过／1失败（40.5分钟，100用例／24文件已执行）。唯一case59 tests/pose-guidance.spec.ts:103／line116要求可见草稿→K逐组件exact，新手势限位投影反复normalize造成2.22e−16／5.55e−17漂移；属于运行payload缺陷，原strict断言保持，不能把公网8／99例通过冒充完整CI成功。原始log78860B／SHA256 `86bdf975a70b9c67facdc1d871a33206a7a207b9920c2f9b63dd720a98d91dd6`，runupdated05:34:38Z，未手动rerun；后续修复只稳定新手势输出，既有KAPI／作者加载／bake／普通限幅不改。下载文件和发布tag95已验证事实独立保留。

EB中间阶段历史：运行eb96b29／tree944c6a77已main／Cloudflare number20（858edcb2）100%，local464／24、strict focused2首批59.442秒／诊断0通过；公开批次原计划9，但随后隔离worktree的同baseEB多轨6被suffix testMatch重复收集，实际15／15（5文件），05:55:57.330Z开始、239.329749秒、15个逐case strict诊断errors／warnings／API0，unexpected／skipped／flaky0。两份multitrack测试bytes／SHA完全相同，原断言保持；原postprocess assert9失败为统计审计问题，按真实15并列planned9＋duplicate6后完成收据，无另一次browser。94／26／HEAD／tree前后EB exact，HTTP5 TLS0／SHA通过。准确[CI37890466002](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37890466002)／job113690009837／attempt1／main push于06:30:51Z实际SUCCESS：464／464基础（24实际文件行／sum464）＋100／100浏览器（24文件、IDs1..100唯一、failed／notpassed0），05:51:07–06:30:48运行39.7分钟；原case59于06:13:15.1205182Z实际通过20.9秒。raw73665B／SHA256 `8b9f00a96a9a9666d76f1d9bf43731be43996ae52a98273349e0e99e202e26e0`，fullyVerifiedtrue，未手动rerun。成功只属于EB中间版，本段不能证明后续新版Timeline完成。新手势actualsource证明99,001 edits／185,367 calls／最多42相邻ULP、component4.44e−16／chord5.09e−14°、fixedpoint／limit0失败；work candidate-v2最多6ULP另列，不冒充实际source。

最后Timeline v1历史：6baa73c／tree10f482b0已pushmain但未部署Cloudflare，本地480与同源20例通过属于该首冻；随后真实complex native import1440→320使selectedChest行留在scrollbox外，严格toBeInViewport实际0／1，原断言不放宽。v2仅KeyframeEditor选中行effect加geometry.visibleWidth／labelWidth依赖，另9个正式source文件SHA原样，06:42:41.954274Z新冻、manifestSHA6aca4550ac456b31fb62424f6d12def7dbb4b5bfd55b73c659343f7cf60da8e2；最终新4＋nativecomplex1同源5／5不能冒称v1的20重跑。首触屏2／3、toast遮挡与capturelost修复历史另存，不隐去。

Timeline v2／9a独立历史：运行9a023173c9a9848ab5c105cd1f981a778929d7c1／treea19e0215175cda2ca57a4fdba25a7bdd2c61a346、Cloudflare1ec19836-9be6-4ee5-9277-a04faa217071（native21）100%。准确[CI37895306305](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37895306305)／job113705194094／attempt1／main push于07:20:52Z实际FAIL：480／480基础25文件＋103／104浏览器25文件、104unique全部实际执行，33.2分钟。唯一case103 tests/transfer.spec.ts:258在320px打开“更多”的移动／复制弹层后页面scrollWidth340>320；后核原生截图与DOM，根因是stage右侧四工具left8／width331.672／right339.672，更多弹层自身right313且client=scroll304，没有弹层本身溢出；原≥44px按钮高度已通过，失败在实际转移后段前，不能称payload错误或103例等于完整成功。新Timeline4和strictpose已通过，仅保留对应source范围；Root授权最小CSS布局修复、新source push／新完整CI，原test／assert不改，不裁切或全局overflow-x掩盖，不手动rerun9a。原始raw78937B／SHA256 `d37f7465e03d01db0c12ee37ca5676c665d71b03cb493f2a324afd18bfec8643`；run created06:46:33Z，job06:46:35–07:20:52Z。watch在07:20:34Z出现HTTP401是CLI凭据过期，随后独立官方读取取得native FAIL，401不是CI失败原因。

此前9a运行[source9a02317](https://github.com/DFerryman/ChoreographyStudio/commit/9a023173c9a9848ab5c105cd1f981a778929d7c1)／tree `a19e0215175cda2ca57a4fdba25a7bdd2c61a346` 已push main、ls-remote读回；Cloudflare `1ec19836-9be6-4ee5-9277-a04faa217071`（native number21，产品迭代v18）于06:49:08.461855Z创建，初deployment `2418db53-a3de-49c8-9e25-73286cc243aa`／06:50:22.163473Z／100%，native注释绑定source9a／treea19。

9a阶段v2本地 `npm run check` 于06:44:11 UTC开始：480／480基础、25文件、15.95秒，前端类型与Vite1944模块／2.29秒构建EXIT0；Worker inputs完全未改，复用enabled原脚本类型PASS，首sandbox listen EPERM在tsc前的环境失败保留。v2同源新4＋native complex1实际5／5，06:43:26.890Z开始、112.879285秒，0skip／flaky／unexpected，5份errors／warnings／expectedHTTP／API诊断全0，正式10文件SHA前后同；v1同源20通过与native resize0／1不冒称v2批次。 准确[CI37895306305](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37895306305)／job113705194094／attempt1／main push／head9a02317：实际FAIL：480／480＋103／104，唯一case103窄屏stage四工具越右边界（打开转移弹层时被宽度断言发现）（完整失败记录见本历史段）。该9a版本有界HTTP与公网：有界HTTP5项在正常TLS下200，入口／JS／CSS字节与SHA精确，health／capabilities只读GET成功；同source9a／treea19公网首批实际13／13、5个精确文件（新Timeline4＋多轨6＋严格限位1＋控制入口1＋膝限位1），06:52:28.862Z开始、211.682553秒，unexpected／skipped／flaky0，13份逐例严格诊断errors／warnings／API及可选expectedHTTP全部0，正常CA／ignoreHTTPSErrors=false，真实AI／D1 0；96运行文件／26dist前后与冻结和commit逐字节／SHA相同；原始report1743709B／SHA256 `29cf5f318e98fd999f7be130b306cffd380ae4eec634f48c722055d9a12a7e95`；root实际看图：Root亲审该公网批实际dense1440／dense320／expandedjoint／strictknee四图，接受帧间距、逐关节轨、选中标记及限位姿态；与本地v2四图分别计数，未声称所有取景下全身无遮挡。

9a阶段source96文件／dist26文件按冻结和commit逐byte／SHA封存。JS `index-D7GFBHiA.js`1147811B／SHA256 `51ca317a4a9e4185fb927c79aa4785df56f35451f58ebbf433159be24b419ab9`；CSS `index-CwSlKOEP.css`75387B／`487b28537a9ad23e0fa95a09a6c1cd9020811de1bdbc3d53003a5c6c5231bf72`；index645B／`35824fc5f3fdfc2872cb6b10c45e9b2dd3301b9e166f9ba217b1528f35d45c13`。实际上传／native资产统计 Wrangler4.147.0实际Read29 files，3个新／修改文件（index.html、新JS、新CSS）3／3上传、20 already uploaded，EXIT0；provider上传统计与本地冻结96runtime／26dist库存分别计数，后续同版注释不再上传assets，版本／部署时间与100%由native读回。

## v18 · 极简舞台与分轨时间线（发布验收中） · 前期记录（历史）

本轮运行改动为铺满视口的舞台、底部浮层Timeline、音乐／Root／身体分轨拖动及音频偏移时钟；v17人物资产、Worker源、静态ASSETS、只读业务API、20／分钟API与2／分钟AI限频配置均未改。450／450本地基础、前端类型／构建和Worker类型检查通过，Wrangler dry-run通过；浏览器复核与main／准确源码CI／实际Cloudflare上传／有界公网核验仍待实际记录，不能把dry-run当上线。主JS `index-DL-vZM0V.js` 1138041B／SHA256 `f0d9cecb899bad68997fe9c9ab7d2ad5e999a6a4a05ede9a60cae00fddda9f73`，CSS `index-kmxrmj-f.css` 66297B／SHA256 `7d557823d890502d455c693246eabc41655e324601a7b24aa9566c85b0267e1a`。

授权目标仍为GitHub main及 [Cloudflare预览](https://choreo-studio-preview.danuberiverferryman.workers.dev/)。没有D1写入或真实Workers AI／付费推理，验证会阻断AI调用。以下v17及之前全文保留。

发布前实际指针probe发现草稿提示增高Timeline导致拖动中投影变化，已修复为手柄拖动期间冻结投影、释放后更新。03:00:21 UTC最终本地检查450／450（24文件、9.44秒）、类型／构建通过；最终JS `index-JAM6kMSD.js`1138058B／SHA256 `1297e24c678fb3c058747619ad087bacc8be8039a288caf0cececf88431be9df`，CSS不变。上述旧bundle为修复前历史，实际上传必须绑定这一最终运行产物。

固定运行源最终新增浏览器6／6（03:02:25.040Z、96.267秒）通过，6份实际API／errors／warnings0，原高精度与draft→K准确保持；root接受最终桌面／手机两图。旧功能相关回归正在验收，GitHub／Cloudflare／公网仍未发布结果。

旧功能相关13场景经首12通过／1失败和仅空白选择测试helper纠正后focused1通过完成覆盖；原精度／动作断言未放宽，运行源与dist冻结复用，不记首13全绿。root接受新增6轮的桌面／手机／展开关节3图。准备提交最终运行版本并推送main，再实际部署和有界公网核验。

实际运行[source b0599e2](https://github.com/DFerryman/ChoreographyStudio/commit/b0599e2d8b84b5ba872a832517f2013a69a55b4b)／tree `97bfc0d702c7b5e9f76494d9775cfe5b92730fdb` 已main，唯一运行上传03:17:51.255265–03:17:59.191705Z，4新／19复用，Cloudflare version18 `3709225d-3e2e-43b3-ab76-0513720c75bb`／100%，首次deployment `11e8ff00-1f4a-45a1-a990-ebc9b007a999`／03:17:57.556317Z。native读回运行SHA／tree、原Worker绑定和限频配置相符。有界标准curl HTTP25（23静态SHA＋两只读API）通过；首urllib403传输诊断和复用根页probe均另存，不隐去失败或把初始诊断算成功，细节见验证记录。

初始对应CI37878546326／job113652628358主动取消：450基础／Worker类型通过，100浏览器仅2实际通过、首AI已失败，没有全量汇总。音乐测试定位和备份后菜单关闭仅作测试修正，音乐focused1／mockAI6通过，将推送对应新source CI。运行94文件／dist26保持，后续测试／文档提交复用这一已发布版本，不作另一次运行上传；公网新6和最后完整CI继续待验。

最新发布核验：运行 main `b0599e2d8b84b5ba872a832517f2013a69a55b4b`／tree `97bfc0d702c7b5e9f76494d9775cfe5b92730fdb` 已部署 Cloudflare version18 `3709225d-3e2e-43b3-ab76-0513720c75bb`／100%，初始 deployment `11e8ff00-1f4a-45a1-a990-ebc9b007a999`。测试操作修正 main `cdc3723a53e65ce465d7a06ee748b347e7ceaf07`／tree `98a001fb1613f67ee7b9bff34f0a4e0a6e4a0243` 已远端读回，运行94文件／dist26与已部署版本逐项SHA相同。有界HTTP25已通过；公网初批6因执行环境CA信任失败、未进入应用，保留0／6。仅在任务临时profile配置现有CA的正常信任，TLS验证保持，未改HOME；单document GET返回200／TLS1.3／secure，随后唯一最终公网6于03:51:37.827Z开始、92.813秒全部通过，六份实际error／warning／API诊断0。root亲审该轮桌面1440／手机390／展开关节三图接受。准确CI37880557802／job113659036357／attempt1仍待完整100浏览器结束；此前取消CI、音乐／AI／相机浮层测试修正和所有失败保留，不提前宣称100通过。真实Workers AI／付费／D1写入0。

最新新增交付要求：用户撤回内置模板，要求直接可导入、稍复杂的成熟舞蹈场景包以观察效果上限，并支持Timeline／Track与二次修改。仅制作独立 `.choreo` 下载文件，不修改内置库或运行代码。使用合法CMU真人动捕：85_12复杂街舞转身与地板技巧37.5秒，61_08完整Salsa单人舞段56.25秒，附原创参考节拍；不声称是某流行歌曲原版或原曲同步。来源／实际帧率／短窗异常修补／固定骨架重定向／接地残差与4096作者K限制均需据实记录，完整高频基底优先保真，未经验证的包不记交付。包与音频等生成文件不进入公共代码仓库；待实际导入、播放、修改和真实人物视觉核验后提供下载附件。

## v17 · 用户所选 06 人物（已上线，准确源码CI通过）

Quaternius Superhero Male默认人物及display-2来源形体修正已完成本地验收；仅换默认人物，不加模型切换UI，不推进七组后续功能。421／421基础（22文件、15.36秒）、前端类型／Vite构建通过；Worker源及配置未变，实际类型检查EXIT0复用，首默认日志路径ENOENT与第二继承代理warning留档。主JS `index-CBtn1tpp.js`1125855B／SHA256 `2d5eb17e74847f1bf0dc81199c2d3ac6e5a48533d3f36d8890b07027a4c714fd`；CSS63251B／SHA `ba41e19f29da5255caa74edd5523fd67e98f12ef2038e7b1d5506da08463b375`。public模型README21099B／SHA `14a040b502495cbd844209ec056681a9da82feeb7cde18035215d068b5dd5202`及六新来源资产冻结，不随最后Markdown结果回填改变。

相关浏览器15场景按完整14＋纠正操作后focused1覆盖，运行资产不变、77文件hash前后稳定；根代理从38实际App图亲审13张接受蒙皮／形体。CPU15×8483全点及实际锁／步阈值通过；首数学通过但形体拒绝、14／15原权重失败和测试动作修正保留。

准确源码CI、运行main／Cloudflare与一次有界公网已核验。最终仅文档main提交将同版注释关联，再以真实metadata更新五份Notion正文，保留原引用／历史／四图片，不上传新图。真实Workers AI／付费请求0。下方v16及更早部署全文为历史。

运行源码[ee376928](https://github.com/DFerryman/ChoreographyStudio/commit/ee376928f200e87e4eb48bbfec00fa60741fd12a)／tree `89c828c7b2770fd416a04c87dfe0fc04872dd7f2`已推送main；其准确[CI37871363910](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37871363910)／job113629975482／attempt1／main push于2026-10-09T02:10:06Z实际success：421／421基础（22文件）＋94／94浏览器（23文件），94逐例通过、失败／未通过0，未手动重跑。Cloudflare v17 `18dd4982-503a-4dfc-936c-6cffa7157b46`／100%，首次deployment `22f6f251-3b75-4495-800a-c8a3792e449a`；一次HTTP25和唯一公网8首轮通过，7份实际API／error／warning／expectedHTTP诊断0。root再亲审同轮23图中的6实际公网图，合本地13图接受形体／蒙皮。最后纯Markdown提交将通过同版部署注释关联最终main／tree与metadata，再同步五份Notion；不再上传运行资产或重测公网，真实Workers AI／付费／D1／新图片上传0。

实际Wrangler4.147.0唯一运行部署窗口01:46:35.365602–01:46:42.466173Z，version创建01:46:40.670588Z、首deployment创建01:46:41.132648Z，8新／15复用资产，bindings／settings不变。HTTP25（23静态SHA＋health／cap两GET）于01:48:03.064771–01:48:06.177276Z；首收据deployment参数手误由native读回更正，25检查原样保留、0补请求，不改成从未出错。公网8于01:49:39.159Z开始、110.911739秒，23实际App图、7实际诊断全0及第8严格late-bind；没有新增第8JSON或第二公网轮。

准确CI job从01:46:07至02:10:06Z共1439秒，browser终行02:10:05.0576071Z为94 passed（23.0m），runupdated02:10:07Z，首次观察02:10:42.411600Z。唯一完整原始log72182B／SHA256 `a0da8492b6c0573b5bdba0783bb3a8e53effbdf69624c1548272b77a1fcd5e2a`；准确CI收据SHA `99f24dc257ea8d8caa0c6618584ae02afc8d910499ebc2f8e9e60cb0210ea590`。准确CI仍绑定ee376928／tree89c828c7，之后纯Markdown head不冒充该CI head；冻结runtime、26dist文件和publicREADME继续复用。

## v16 · 平地自动迈步（已上线，准确源码CI通过）

运行改动是平地步伐派生层、同模块折叠预览／采用／关闭和可选备份字段，预检原精确时刻／整数点／fade。MHR数字资产／绑定不改，模型README仅纠正实际传输和未证实upload尺寸因果，Worker／限频／只读API范围不扩大，真实Workers AI／付费请求0。最终本地411、类型／构建、相关3及准确CI411＋92已通过，42相关hash稳定，根代理亲审4最终本地图／3公网图。主JS`index-jecJey3z.js`1127945字节／SHA256 `a3d82d25cf786cb65f19bb40feae17fd6e57287fd5f1fce97259a4f6421d99c6`，CSS63251字节／`ba41e19f29da5255caa74edd5523fd67e98f12ef2038e7b1d5506da08463b375`，不当设备性能证明。

运行[source fb7188ac](https://github.com/DFerryman/ChoreographyStudio/commit/fb7188ac99b272a9d583e4fefae54b4933904db2)／tree `e9465b73815ac8310c080a1e2de1f07d7dc8e28b`已main；普通官方CLI于15:00:45.097471–15:00:56.866549Z唯一运行上传成功，4新／13复用，gzip未重传／rawPSD排除。当前Cloudflare v16 `3be3c456-b824-4b67-9b21-bff8dd0271d0`／100%，首次deployment `5dd829ab-cf9d-4d61-85dc-a1cf820bfb1d`于15:00:54.629801Z，HTTP19／19及单轮公网7／7通过；6份实际零诊断JSON＋一个迟到绑定严格断言，不虚增文件。具体时间／hash见[验证](VERIFICATION.md)。

首准确CI37797090763／job113379269228为410／411单项5000毫秒超时失败，未到Worker／browser；仅该有界测试15秒超时修正的[e26813f3](https://github.com/DFerryman/ChoreographyStudio/commit/e26813f35fd9dd4e26ce15ffc3a32f5623726c4c)／tree `e680afd1463c86e18f49feb0de7e7295dcb36cf9`于15:09:19.048214Z native读回，断言／fixture及其余git blobs／dist20逐字相同。其准确[CI37798386400](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37798386400)／job113383745739／attempt1／main push于15:30:08Z completed／success，实际411基础＋92浏览器（各21文件）、0失败／未通过；原始67998字节日志SHA256 `751104b1125e4ed9f3254b8c6cc9a57f717c976c4c360b79368266813b22b594`，无手动workflow rerun。

最终仅10MD main通过已验证v16／100%同版deployment注释关联；实际最终main及annotation metadata在发布收据／5Notion核对，不为填自身SHA循环提交。运行版／17资产／HTTP19／公网7复用，无新运行上传或公网复跑；原v15最终c1abd978／运行a9b753及完整旧回执以下为历史。

## v15 · 全身蒙皮与人体提示已上线（准确源码CI通过）

本轮已接入Meta官方MHR v1.0.1来源人体、127内部骨骼、原生绑定／权重及公开学习式姿态修正，草稿、写K、插值和播放共用显示链。老师仍操作原25作者关节，旋转／Root／时序／历史、FK／IK／脚锁和操作柄保持，不新增127关节表单或骨长编辑。私有helper保留来源驱动关系并使用中立相对轴向引导与半转平滑，修正外展误作twist和表示接缝；不声称任意上游compact Euler全链等价、现成JavaScript肌肉引擎或完整生物力学。

用户看合图后进一步要求核查人体做不到的动作。普通旋转／IK的人体活动包络已有，AI候选按actionId／幅度构建并对采样中的19关节应用限位；本轮补齐**全身19关节提示**，不再依赖选中某一关节或暂停，播放／观看同样显示。舞台用紧凑琥珀提示，现有“真实约束”折叠摘要显示数量，展开查看部位；上臂摆幅大于120°而同侧Shoulder参与小于5°作保守肩带协同提醒，只提示，不自动搬肩。明确作者K与既有SLERP仍按原值优先，超限提示不偷偷裁剪作品；两端表内合法也可能中间插值超范围，当前会在所看姿态提示，不宣称完整轨迹可行或自动修复。

14姿态合图是蒙皮／作者契约核验，不能当正常人体可完成的舞步集。四项明确越已有表：单上臂170°超过150°；前臂轴扭60°超过8°；蹲姿脚X−40°低于−20°；右踝Z20°超过15°。单上臂150°且锁骨0、双侧150°也未表达肩带联动；固定作者Root的蹲／双侧fixture有悬空脚，不能当着地演示。根代理亲审46张实际全身、390px、草稿K和播放图；压力场景证明显示连续性及作者原值保持，不证明舞者能做、安全或教师可执行。

真实加载强化后的wire正式5／5（72.024秒）已通过，禁止placeholder冒充人体；原14／14几何回顾仍对应未变的MHR数字链。最终150°肩部压缩1／72、170°0／72低于原3%门槛，源标定胸部逐点运动误差0.0241／0.0296微米和neutral0.0273微米低于2微米；高1.849999974米、脚底误差小于2毫米。首4／5、170°3／72拒绝、旧25毫米线经来源验证后修订，以及paint／DQS／53骨链／45–65–90度transfer与heat拒绝均保留；未标定来源约8微米向量差与标量p95分开记录。

姿态修正以可复现gzip文件传输（6244575字节）还原原9587356字节并验证原SHA，按前8字节区分gzip或浏览器已解码的MHRCORR1，保留上限、Abort、单fetch和无API fallback。`.assetsignore`只排除线上原未压缩bin，源数据／离线／CI参考保留。旧wire3／5前三项实为placeholder、第4／5加载失败和两次未进入test的harness退出都留档；真实原因是Vite Content-Encoding后重复解压，修正后才作本轮加载通过。

最新本地380／380基础（20文件、8.60秒）、前端类型／构建通过，bundle为`assets/index-CzQnbqF8.js`。新增人体提示3个相关流程经首2／3、腕部复核失败后最终实际覆盖全部3场景，保留失败与作者归一化末位差的fixture修正，不谎称首轮3／3。较早功能main `16e1fb90`的准确CI实际359＋86已通过，仅作初版历史。最新a9b753cd运行源码已进入main及Cloudflare v15，单轮HTTP19与公网10通过；其最新准确源码CI380＋89已实际通过，最终文档main由同版部署annotation关联并复用已验运行版；Workers AI与付费动作生成请求0，MHR学习式稀疏ReLU本地实际计算。

初版main16e1fb90准确CI359＋86已通过，当前wire／提示修正本地380＋正式5通过，部署、线上及准确源码CI380＋89均已按最终日志核对。三次nativeCLI／single-file resume／HTTP gzip experiment真实失败和8资产部分成功保留；失败时点没有v15运行版本、旧v14仍100%；当前已成功v15运行上传另据下段，不将部分资产上传当作当时服务上线。当前候选wire、decoder保护和新bundle见验证记录；后续只填实际main／version／deployment／流量／HTTP／线上回执。

### 当前准确运行版本与有界线上核验

实际运行源码[main a9b753cd](https://github.com/DFerryman/ChoreographyStudio/commit/a9b753cd11ad0ac303e81ae53e77b9e136e2ed27)／tree `fd54084a9f818ad910b7864307d0fa7d1fc1cf7c`已发布。Cloudflare version `ca7396ed-a8b1-4db6-a29d-149cbfdbcd59`／number15／100%，首次deployment `3157a661-7fb6-4339-b41f-ac89733774e8`于`2026-10-08T12:21:52.139463Z`；唯一成功运行上传12:21:37.907466–12:21:53.882121Z，5新资产／12复用，原三条失败路径作为独立历史保留。

唯一有界HTTP19／19于12:23:34.973722–12:23:38.206759Z完成；唯一公网相关10／10 FIRSTPASS于12:23:36.593Z开始，用时109.745579秒，unexpected／skipped／flaky及报告errors为0。9份实际诊断JSON的API／errors／warnings为0，另迟到绑定场景使用严格完整断言，不虚称第10份诊断。同轮产生24张图，根代理已亲审其中150°K、插值播放、170°390px、插值腕部四张；保留轻微腋部折痕，不宣称电影肌肉仿真。

压力图明确包含异常作者K、超限与固定Root场景，是蒙皮／数据契约验证，不等于默认受限摆姿或物理可行舞步。Workers AI与付费生成请求0；MHR公开学习式姿态修正本地实际执行。最新准确源码[CI run37775928775](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37775928775)／job113306622160／attempt1／main push已实际completed／success：**380／380基础（20文件）＋89／89浏览器（20文件）**，89逐例通过、失败／未通过0。Job于`2026-10-08T12:18:26Z`开始、`12:43:35Z`完成，共1509秒；browser终行`12:43:33.0391847Z`为89 passed（24.3m），run于12:43:36Z更新，首次读回12:43:43Z。完整原始日志70297字节／SHA256 `8f200441198d8d059b66e9e48e510cab17ef194a20e25cce9b8d149085cbe9c7`；没有手动workflow rerun。最终纯Markdown main通过同版Cloudflare部署annotation关联，复用以上已核对的运行版本、17资产和线上证据，不重复运行上传、公网测试或资产修改。


模型README的早期传输说明以本轮实际源码与读回为准：Fetch body可能已经按Content-Encoding解码，也可能仍是显式gzip，decoder按前8字节识别后核对原长度／SHA／上限／Abort。历史401／500没有证实尺寸根因或上传hard limit；最终6244575字节（约6.24MB）的确定性gzip后标准native上传成功，只记录这个实际结果与顺序。已发布静态模型README／来源／ignore与17资产不再修改。

### 当前v15已发布资产（17文件）

以下按本轮实际HTTP清单读回，每项字节数、SHA256与冻结dist一致。原未压缩`neutral-mhr-correctives-v1.bin`由assetsignore排除，仍在源码／离线／CI参考保留，不计作线上发布资产。

| v15资产 | Bytes | SHA256 |
| --- | ---: | --- |
| `index.html` | 645 | `9e71dd8c9d690495d327ec8c0fdb441af50d551f353e01c69e2f46cf39f342b8` |
| `assets/index-CzQnbqF8.js` | 1114517 | `5729096ee852f663af8d8f3558e058edd458d0cddb05ccd58193bdc2d37c09b6` |
| `assets/index-Dutow-49.css` | 62719 | `f06b18e3563f718322522c5c65e469f9dc5b57dfa9cac22b6d2efa0e8162b48d` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `models/CC0.txt` | 7048 | `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499` |
| `models/MHR-LICENSE.txt` | 11358 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| `models/MHR-PROVENANCE.json` | 245090 | `0d087bb46972b55f55a3ccf7cc4b595b4a8fd33404727556e93a31b417077b18` |
| `models/MOMENTUM-MIT.txt` | 1088 | `da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93` |
| `models/README.md` | 14125 | `e199470b53e1c53809ee1c302675703c1a501a2abc846305fee45ca43541ed0d` |
| `models/neutral-human-v2.glb` | 853172 | `f7be9db402be188a2dd6f02d242eba83d6f84cd37ee2b3612447620580bb35cd` |
| `models/neutral-human.glb` | 776136 | `4b5fa085d0a6e403abee4ce022cac8041e5bca8bce130d03f28f245a29fddc9a` |
| `models/neutral-mhr-correctives-v1.bin.gz` | 6244575 | `51b3557f469f9a22daec511302bb11a53ae778d1d8533d8d3b7ea3390df4d82b` |
| `models/neutral-mhr-v1.glb` | 536452 | `fe5a79bf9b39e2bb95aa632babc3d8068723ee3dfb5dd97fcb97a120748006ff` |
| `models/neutral-mhr-v1.json` | 135476 | `4eebae7ca930f5ff01e5b419d61651c0c42825ad2e7fb2156fac35053aa83141` |
| `third-party-licenses/rapier-apache-2.0.txt` | 11343 | `4c05555705e3efde601fb1252ae48f1d63992af8a8fb8947745b7fa834e8f519` |
| `third-party-licenses/three-mit.txt` | 1081 | `8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc` |
| `assets/rapier-BcnL-M2-.js` | 4335104 | `eba580e6ed6e22819a222beef8c8f10df2673fc258078aac38b328212612d6f5` |

## 历史 version14 · 当时已验证的部署

2026-10-08：**当前version14已上线并通过准确源码完整CI。** 已移除右侧精细参数模块，舞台直接摆姿＋统一时间轴，采用统一neutral-rig-2／neutral-adult-v2的自然人体与蒙皮；作者K优先，真实AI测试0。[打开工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/)。

本轮功能源码[d435888f](https://github.com/DFerryman/ChoreographyStudio/commit/d435888f92a6a469f8de9cee0ee404ff5e54eecf)及更严格实际手柄测试[012c1cd1](https://github.com/DFerryman/ChoreographyStudio/commit/012c1cd1f3cadcf51bc8359e799c911c99291a19)已push main，最终源码树`ad3901cd91f7bfd06d4c2d9e3dc9e4764e05a7f5`与本地一致。[准确源码CI run37755495034](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37755495034)／job113238885766／attempt1于`2026-10-08T09:38:34Z` completed/success，实际**321基础＋完整81浏览器**；初始321＋80/81的旧保存guard fixture及独立7f3f完整通过记录保留，不手动rerun。Cloudflare v14 `b4a04064-9df8-479b-b817-0c6f7a1947e7`／100%，首次deployment `469d00f7-fe23-4e42-a88f-391eb8775be0`／`2026-10-08T09:10:51.003376Z`；单轮线上10/10和有界13 HTTP通过，实际8份JSON诊断及2模型断言错误／警告／API0，真实AI0。生产仍是d435，后续只改测试或Markdown，运行资产不重上传；最终文档main通过同版部署message关联。详见验证／部署记录。

### 历史 version14 运行回执

| 项目 | 实际结果 |
| --- | --- |
| Runtime源 / 校验源码 | d435888f92a6a469f8de9cee0ee404ff5e54eecf / 012c1cd1f3cadcf51bc8359e799c911c99291a19，后续只改测试/Markdown |
| 准确CI / tree | [run37755495034](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37755495034)／job113238885766／attempt1；ad3901cd91f7bfd06d4c2d9e3dc9e4764e05a7f5，321+81成功 |
| Version ID / number / 流量 | b4a04064-9df8-479b-b817-0c6f7a1947e7 / 14 / 100% |
| 首次deployment / UTC | 469d00f7-fe23-4e42-a88f-391eb8775be0 / 2026-10-08T09:10:51.003376Z |
| Version创建 / tag | 2026-10-08T09:10:50.444189Z / v14-direct-stage-human |
| 原生上传 | 15目录文件，5新资产/6复用；Worker23.59KiB/gzip7.40KiB、启动3ms为CLI测量 |
| 实际绑定/路由 | AI、API20/60 namespace2026100601、AI2/60 namespace2026100801、ASSETS、RELEASE_STAGE；SPA、/api/*worker-first及安全headers正确 |
| 单轮线上 | 10/10，2026-10-08T09:15:04.375Z起、128.661221秒；8份JSON及模型2严格断言诊断0、AI0 |
| 有界HTTP | 13/13，2026-10-08T09:15:54.458467+00:00至2026-10-08T09:15:55.479228+00:00；11静态资产字节/hash/headers与2GET正确，无POST |

| v14资产 | Bytes | SHA256 |
| --- | ---: | --- |
| `index.html` | 645 | `6a8551ba63c0317acc55d49eac58b8d29ff90f3d6af6856357e613088b38885e` |
| `assets/index-CDwxBzsl.js` | 1097033 | `434383f43ea99fbd130cc67c4322bda40c6f11b0feee89eeeb73668eeef4ed67` |
| `assets/index-Dutow-49.css` | 62719 | `f06b18e3563f718322522c5c65e469f9dc5b57dfa9cac22b6d2efa0e8162b48d` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `models/neutral-human-v2.glb` | 853172 | `f7be9db402be188a2dd6f02d242eba83d6f84cd37ee2b3612447620580bb35cd` |
| `models/neutral-human.glb` | 776136 | `4b5fa085d0a6e403abee4ce022cac8041e5bca8bce130d03f28f245a29fddc9a` |
| `models/README.md` | 6428 | `7342710d028460e0eff1178bf3a2302c9cb5db28560ad2f5fdec43bafd92188b` |
| `models/CC0.txt` | 7048 | `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499` |
| `third-party-licenses/three-mit.txt` | 1081 | `8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc` |
| `third-party-licenses/rapier-apache-2.0.txt` | 11343 | `4c05555705e3efde601fb1252ae48f1d63992af8a8fb8947745b7fa834e8f519` |
| `assets/rapier-BcnL-M2-.js` | 4335104 | `eba580e6ed6e22819a222beef8c8f10df2673fc258078aac38b328212612d6f5` |

最终纯Markdown记录回填复用该已验证runtime，在同版100%部署message关联最终main、runtime和准确CI，不重新上传或重复公网检查。v13及更早原始记录保留为历史。



2026-10-08：**历史 version 13 已上线**：作者K和手动摆姿意图最高优先级，自动脚锁/插帧不得覆盖明确作者通道；延续统一时间轴、中性人体、IK、内置人体参数、Rapier候选和Workers AI接线。自动迈步仍未实现。打开 [八拍工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/)。

本轮作者优先源码 [e44a649b](https://github.com/DFerryman/ChoreographyStudio/commit/e44a649bb03583d847ea319dc27560643545a828) 已 push main，树 `ebc88873036023e6b00de28eb509a642a3ca97ae` 与本地一致；准确功能 head 的 [run37745471252](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37745471252)、job113205792740、attempt1 于 `2026-10-08T08:03:55Z` completed/success，实际 **319基础 + 完整81浏览器通过**，没有 workflow rerun。Cloudflare v13 `9dcbf7c0-24cb-41c7-a1a3-d36baa0893e4` 实际100%，首次 deployment `7e5a6ead-b240-4484-b83e-0a7f06f7716e` / `2026-10-08T07:46:28.924157Z`。单轮线上8/8与有界12 HTTP通过，实际诊断errors/warnings/API均0，真实AI推理0。最后仅Markdown回填复用该已验证runtime，并在同版100% deployment annotation关联最终main；实际ID与时间由Cloudflare记录核对。此前v12的306+76仅作为历史基线，详见验证/部署记录。

## 历史线上版本 · version 13

| 项目 | 实际结果 |
| --- | --- |
| Worker / Account | `choreo-studio-preview` / `84e421f26c708c0cf437e287eed11fa1` |
| 功能源码 main / tree | [e44a649b](https://github.com/DFerryman/ChoreographyStudio/commit/e44a649bb03583d847ea319dc27560643545a828) / `ebc88873036023e6b00de28eb509a642a3ca97ae` |
| Version ID / number / 流量 | `9dcbf7c0-24cb-41c7-a1a3-d36baa0893e4` / 13 / 100% |
| 首次 Deployment ID / UTC | `7e5a6ead-b240-4484-b83e-0a7f06f7716e` / `2026-10-08T07:46:28.924157Z` |
| Version创建 / source / tag | `2026-10-08T07:46:28.08916Z` / wrangler / `v13-author-key-priority` |
| 发布方式 | 原生wrangler读取14目录文件，实际上传2新资产，8复用；Worker23.45KiB/gzip7.32KiB，启动2ms为CLI测量 |
| 实际绑定与资产 | AI、API20/60 namespace2026100601、AI2/60 namespace2026100801、原生ASSETS、RELEASE_STAGE；无D1/KV/R2/DO；SPA及/api/* worker-first读回正确 |
| 源码CI | [run37745471252](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37745471252) / job113205792740 / attempt1，准确head；319+81通过，2026-10-08T08:03:55Z |
| 单轮线上 | 8/8，2026-10-08T07:48:09.324Z起/81.407秒；诊断errors/warnings/API0，AI0 |
| 有界HTTP | 12/12，2026-10-08T07:47:07.974810+00:00至2026-10-08T07:47:09.226713+00:00；全部静态字节/hash/安全headers、health/capabilities通过 |

| v13 资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `index.html` | 645 | `c56b03dbfdb1dfcc98518f0f8787af89a1007bcfd138796d4fb7e02aa2d7d997` |
| `assets/index-D3dqGsm5.js` | 1100241 | `2bab9d4f1817549b170d5209d30008983812f22863029a6cd346df1aa74c3a84` |
| `assets/index-CEndkUVE.css` | 67039 | `d9084eda0bd1f1e9c39ce4ef8c400c689961cfe52cb116e1e8e2e6b5bde74603` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `models/neutral-human.glb` | 776136 | `4b5fa085d0a6e403abee4ce022cac8041e5bca8bce130d03f28f245a29fddc9a` |
| `models/README.md` | 4339 | `543ca6bcce03be3a62543cb0a41932b6c6fa3cda8caad25d78b0e7850e5c3057` |
| `models/CC0.txt` | 7048 | `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499` |
| `third-party-licenses/three-mit.txt` | 1081 | `8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc` |
| `third-party-licenses/rapier-apache-2.0.txt` | 11343 | `4c05555705e3efde601fb1252ae48f1d63992af8a8fb8947745b7fa834e8f519` |
| `assets/rapier-BcnL-M2-.js` | 4335104 | `eba580e6ed6e22819a222beef8c8f10df2673fc258078aac38b328212612d6f5` |

最终仅Markdown记录回填后复用此版本100%部署，实际部署message关联最终main和功能source；不重新上传运行资产或重复公网检查。

## 历史 version 12 发布概述

2026-10-08：**历史 version 12 已上线**：舞台下方统一时间轴、CC0 连续中性人体、四肢 IK、可保存脚锁、内置人体参数、Rapier 重力候选及 Workers AI 编排接线。306项基础检查、本轮26个本地时间轴/关联浏览器流程、单轮线上9项与有界12 HTTP均通过。首次完整源码 CI 为306基础通过、75/76浏览器；一处旧测试提前读取数值文本，原trace确证正式姿态已恢复、文本稍后同步，仅补严格重试断言，定向1/1通过。修正提交 bd59b4bc 已推main，修正源码完整CI实际306基础+完整76浏览器通过（run37740462981，于2026-10-08T07:13:24Z），详见 [VERIFICATION.md](VERIFICATION.md)。打开 [八拍工作台](https://choreo-studio-preview.danuberiverferryman.workers.dev/)。

真实 AI 推理测试为0；所有生成响应由 mock提供。Workers AI 按用户主动生成请求排列现有六种原创模板，不是任意真实舞蹈合成。IK与脚锁改善几何和接触，Rapier为可选全身动态代理候选，不代表完整肢段受力/主动平衡。真实动作、自动迈步、教师及设备验证仍是后续。保存与编辑留在本机，没有 D1写入。

## 固定交付要求

用户要求每轮修改最终都提交并 push 到 `DFerryman/ChoreographyStudio`，同步部署到本 Cloudflare 预览。交付前核对远端提交、实际运行版本和预览结果，验证记录也提交；不能只留本地改动或把构建成功当作发布完成。此要求已写入根目录 `AGENTS.md`。

仅文档修改时复用已经验证的运行版本，同步部署在 `workers/message` 中记录本轮源码提交，核对实际部署与已有健康检查。运行代码和资产未变时复用既有检查，不重复完整公网回归，也不增加 D1 写入。旧表为v13，v12/v11留在历史章节；后续纯文档的同版同步在部署 message 中记录最终源码提交，实际 ID/时间由 Cloudflare 部署记录核对。旧记录保留在历史章节。

## 历史线上版本 · version 12

| 项目 | 实际结果 |
| --- | --- |
| Worker / Account | `choreo-studio-preview` / `84e421f26c708c0cf437e287eed11fa1` |
| 功能源码 main / tree | [82b593d4](https://github.com/DFerryman/ChoreographyStudio/commit/82b593d483e875cb67d14975527bf5265eab3090) / `107fd10aa70606db90258b91ad55701c19d286f1`，本地/远端树一致 |
| Version ID / number / 流量 | `959cccfa-4deb-4e09-a064-ff840c881828` / 12 / 100% |
| 首次 Deployment ID / UTC | `08947d1b-4f7d-4743-961c-d580db9e25af` / `2026-10-08T06:30:49.309957Z` |
| Version 创建 / source / tag | `2026-10-08T06:30:48.740977Z` / wrangler / `v12-timeline-realism` |
| 发布方式 | 原生 `wrangler deploy`，恰一次上传10静态文件；Worker 23.45 KiB / gzip7.32 KiB，启动1ms（CLI测量） |
| 实际绑定 | `AI`(type ai)、`API_RATE_LIMITER`20/60 namespace2026100601、`AI_RATE_LIMITER`2/60 namespace2026100801、真实原生`ASSETS`、`RELEASE_STAGE`；无D1/KV/R2/DO |
| 源码 annotation | 完整82b593d4 SHA及v12范围；版本/settings/100% deployment均实际读回 |
| 原生资产策略 | `/api/*` worker first、SPA fallback、统一nosniff/referrer/permissions headers，实际设置读回一致 |
| 本地基础 / 源码 CI | 306 passed；首次 [run37737956864](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37737956864)准确head/attempt1，306基础+75/76浏览器。仅测试等待文本同步的 [bd59b4bc](https://github.com/DFerryman/ChoreographyStudio/commit/bd59b4bc5cf189423fed29cf96349e81c7b79e6f)已推main，定向1/1通过，[run37740462981](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37740462981)准确bd59b4bc head/attempt1，于2026-10-08T07:13:24Z completed/success，306基础+完整76浏览器；runtime不变 |

### v12 有界线上核对

标准浏览器UA有界HTTP于 `2026-10-08T06:31:46.171061+00:00`–`2026-10-08T06:31:48.400927+00:00` **12/12通过**：10静态文件逐字节匹配最终dist、SHA256和安全headers正确，health200/statusok，capabilities200/AI和IK配置开启且no-store。没有POST生成、推理调用、限频burst或D1写入。

唯一相关线上浏览器从 `2026-10-08T06:31:52.824Z` 开始，**9/9通过**，80.879秒：两个AI mock流程、连续人体desktop/mobile与80°肩部、实际IK、脚锁/保存/完整包、Rapier候选/取消/采用撤销、390只读参数，以及桌面/390时间轴三稀疏K完整流程。8份实际JSON诊断errors/warnings为空；AI两例记录3个浏览器POST，但全被route.fulfill截获，真实网络推理为0，其他6份API请求为空。unexpected/flaky/skipped和reporterrors均0。实际审阅同一轮桌面、390时间轴和肩部截图，不另发公网截图会话。

| v12 资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `index.html` | 645 | `f84843fa6772a14a4888c639e29244829df7e4301acb6b1478b3ee134bfd2465` |
| `assets/index-DLZs441A.js` | 1097508 | `ac3affe8a76504eedb3782b4738bada559557d9e51c5e155961dff3efaaeef2f` |
| `assets/index-CEndkUVE.css` | 67039 | `d9084eda0bd1f1e9c39ce4ef8c400c689961cfe52cb116e1e8e2e6b5bde74603` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `models/neutral-human.glb` | 776136 | `4b5fa085d0a6e403abee4ce022cac8041e5bca8bce130d03f28f245a29fddc9a` |
| `models/README.md` | 4339 | `543ca6bcce03be3a62543cb0a41932b6c6fa3cda8caad25d78b0e7850e5c3057` |
| `models/CC0.txt` | 7048 | `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499` |
| `third-party-licenses/three-mit.txt` | 1081 | `8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc` |
| `third-party-licenses/rapier-apache-2.0.txt` | 11343 | `4c05555705e3efde601fb1252ae48f1d63992af8a8fb8947745b7fa834e8f519` |
| `assets/rapier-BcnL-M2-.js` | 4335104 | `eba580e6ed6e22819a222beef8c8f10df2673fc258078aac38b328212612d6f5` |

v12的最终验证记录和前端持续准则随v13功能提交e44a649b一同提交；新增作者优先规则改变运行逻辑，随后实际部署v13，没有另建v12同版文档deployment。上述v12检查是历史证据；v13使用自己的运行与完整源码CI回执。

## 历史线上版本 · version 11

| 项目 | 实际结果 |
| --- | --- |
| Worker / Account | `choreo-studio-preview` / `84e421f26c708c0cf437e287eed11fa1` |
| v11 功能首次发布 Deployment ID | `35663e67-deea-4c11-913d-5193c85a440b` |
| Version ID / number / 流量 | `f245eba5-7cda-4950-bda7-f0cae576368b` / 11 / 100% |
| 发布时间 | `2026-10-08T04:25:42.945845Z` |
| 功能运行源码 | [e02b76ba](https://github.com/DFerryman/ChoreographyStudio/commit/e02b76bab054120b31314622cf416d752e847b6f)（包含此前简洁界面 a3b0b20c） |
| 本地/远端功能树 | `f55ecb4ac9c4c0d1031da0048063500a08d9c75e` |
| 源码 CI | [run37727327279](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37727327279)、attempt1，于 `2026-10-08T04:37:58Z` completed/success；161 foundation + 完整 62 browser（12.8m） |
| 发布方式 | 恰一次 multipart 真实上传，Worker 内含 gzip 静态资产；`has_assets=false` |
| 实际 bindings | 原生 `API_RATE_LIMITER`（20/60，namespace 2026100601）与 `RELEASE_STAGE`；无 D1/KV/R2/DO/真实 ASSETS |
| 实际模块大小 / SHA-256 | 378822 bytes / `2d412af1988a21fc62359903228e4bad8ad877c53a60ca066f26f5d923a3487a` |
| 实际下载 / 版本 annotation | 模块内容与生成物一致；version message 关联完整 e02b76ba SHA，tag `v11-manual-human` |

## 历史 version 11 验证

最终本地 161 基础检查与构建、前端/Worker 类型和 dry-run 通过，新增约束 4/4 与既有相关 20 个流程均有通过证据。先前 58 项本地的 55+3 测试 fixture 修正、人体相关首轮 11+9 服务器断连恢复、新真实旋转环 fixture 的未跨界/错误拾取及精确 −145° 恢复全部保留在 [VERIFICATION.md](VERIFICATION.md)。首次简洁界面精确源码 a3b0b20c 的 CI run37724093326 已成功 107 + 58；最终精确人体源码 e02b76ba 的 run37727327279 于 `2026-10-08T04:37:58Z` completed/success，真实日志 161 + 完整 62 browser（12.8m），四项新增约束均成功；没有 rerun 或混用两份 CI。

标准浏览器 UA 的有界 5 HTTP 于 `2026-10-08T04:26:40.306412+00:00`–`04:26:40.916729+00:00` 全通过：四个资产逐字节/哈希/安全 headers 与最终 dist 一致，health 200/status ok/no-store。此前 Python 默认 UA 的首页请求及一次诊断返回 Cloudflare Browser Integrity 403/error1010，未进入业务验证；未调整安全设置，失败记录保留。没有额外 capabilities、POST、限频 burst 或 D1 写入。

唯一相关线上 8 项于 `2026-10-08T04:26:41.502Z` 开始，58.052 秒全通过；8 份实际 diagnostics 的浏览器 errors/warnings/API 请求及 unexpected/flaky/skipped/报告 errors 均为 0。覆盖限位数值/滑条与保存、真实肘部旋转环跨界、320/1440 极简手动布局、迟到音乐隔离、手机 0.5 选段恢复、K/Delete/历史与真实音频 Space。桌面、手机和受限肘部截图来自同一轮，未另开公网截图会话或完整 62 项回归。

| v11 资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `assets/index-CqvB3HBE.js` | 975306 | `949cc792440346f3a5fb8506b9492fc86bcfffe9e44ec7128a7a080b0718848e` |
| `assets/index-DqS_4Npc.css` | 59686 | `953cbdc84bf2df9ecbb79134a901bb3a2edfb1f70baeda7cea68f616527a9674` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `index.html` | 645 | `92be0d3fb1675451717d65fa32df92ef32ae3a1c9dc7f100578418526e232ae0` |

纯 Markdown 交付记录最终提交 push 后复用此运行版本，通过同版 deployment message 关联最终 main；不再次上传模块或重复公网检查。原生产/教学、教师试跳、具名设备、MP4 与 M0–M3 边界保留。

## 历史线上版本 · version 10

| 项目 | 实际结果 |
| --- | --- |
| Worker / Account | `choreo-studio-preview` / `84e421f26c708c0cf437e287eed11fa1` |
| v10 功能首次发布 Deployment ID | `aae5ec8b-a8f2-4f39-88d6-8c53d49b02b2` |
| Version ID / number / 流量 | `6df3fd31-141f-4834-b25c-e871f5a8bbf7` / 10 / 100% |
| 发布时间 | `2026-10-07T14:06:35.603261Z` |
| 功能运行源码 | [9fbc115f](https://github.com/DFerryman/ChoreographyStudio/commit/9fbc115f12d2580ff76b7cf5354fa581081579d8) |
| 测试坐标修正源码 / 实际 CI | [1719439d](https://github.com/DFerryman/ChoreographyStudio/commit/1719439d993cd893f19c771f90c2cf902ef46886) / [run37636175196](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37636175196) |
| 发布方式 | 恰一次 multipart 真实上传，Worker 内含 gzip 静态资产；`has_assets=false` |
| 实际 bindings | 原生 `API_RATE_LIMITER`（20/60，namespace 2026100601）与 `RELEASE_STAGE`；无 D1/KV/R2/DO/真实 ASSETS |
| 实际模块大小 / SHA-256 | 370986 bytes / `be024bed5d7b45667436e28099f2a57eed604cf77f0997b67049f6cf8ae71d87` |

## 历史 version 10 验证

107 项检查、最终构建、前端/Worker 类型与离线 dry-run 通过。8 个不同本地流程通过首轮 7 项和手机定向复核覆盖，新增缺音乐恢复只复核相关单项；10 份实际本地诊断零错误/警告/API。首次脚本/启动失败及对应恢复保留在 [VERIFICATION.md](VERIFICATION.md)。

单轮线上 8 项于 `2026-10-07T14:07:56.792Z` 开始，140.295 秒全部通过，8 份实际 errors/warnings/API 请求和 unexpected/flaky/skipped/报告 errors 为 0；320/390px 无横向溢出，新操作至少 44px，备份/音乐恢复保留精确动作、历史、原音乐和相机。截图来自同一轮，未另开公网截图会话。

唯一 5 HTTP 于 `2026-10-07T14:07:39.746323+00:00`–`2026-10-07T14:07:41.275334+00:00` 全通过，4 资产逐字节哈希/安全 headers 与 health 200/no-store 匹配。未重复 capabilities、POST、限频 burst 或完整公网回归，无 D1 写入。首次实际源码 CI run37633679536 在 2026-10-07T14:13:57Z completed/failure：107 检查、37/38 浏览器通过，唯一失败是旧手势测试在 footer 下载后复用过期坐标。trace 确认两触点在画布下方；仅测试重新定位并新增命中断言，相关本地复现/修正单项已完成。修正源码 1719439d 的 [新实际 CI run37636175196](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37636175196) 于 `2026-10-07T14:29:27Z` completed/success，实际日志 107 passed (107)、Running 38 tests / 38 passed (6.0m)；原双指项明确成功 13.2s。所有安装/构建/类型步骤成功，无 workflow rerun。运行代码/资产不变，复用既有实际线上证据。

| 当前资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `assets/index-CHg8RZiz.js` | 961578 | `8f325ec23d342397809b8889ab79b5ba0256821ddff83332e58b42e5e177b968` |
| `assets/index-gL39YgCa.css` | 53308 | `387f8f28f0730a9fe0141af8a22500e44a394af0c188c00618aafe8a969e844b` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `index.html` | 645 | `f0400eefb6718521ad5b0a3c5f3655a1980e376e718b1c39272cd90f83bcf710` |

初次部署调用因自动审批服务 capacity 未执行；沿同一审批路径、同 payload 的重试成功，只有一次实际 upload。最终 9 份 Markdown 验证文档也提交 push，复用这份完全相同的运行版本，以部署 message 关联最终源码 SHA；不再上传资产、重跑 CI 或公网浏览器。原生产契约/素材/教师/MP4 与 M0–M3 保留。

## 历史 version 9 线上版本

| 项目 | 实际结果 |
| --- | --- |
| Worker / Account | `choreo-studio-preview` / `84e421f26c708c0cf437e287eed11fa1` |
| v9 功能首次发布 Deployment ID | `fc8c7bcb-378b-4d15-9f68-639bb7179db4` |
| Version ID / number / 流量 | `4f83a485-6508-4f10-9e8e-6a3b0c8ec796` / 9 / 100% |
| 发布时间 | `2026-10-07T13:22:43.653545Z` |
| 功能源码 | [b4381724](https://github.com/DFerryman/ChoreographyStudio/commit/b43817249a9ade4e68bc9900ef273b3e47fdec0f) |
| 发布方式 | multipart 上传包含 gzip 静态资产的 Worker；`has_assets=false` |
| 实际 bindings | `API_RATE_LIMITER`（20/60）与 `RELEASE_STAGE`，无 D1/KV/R2/DO/真实 ASSETS |
| 实际模块大小 / SHA-256 | 355346 bytes / `d39e30c0e5c52f925a3a53bc2590bd151a7fa8b8e0fb0dbf5706d904ea3a8add` |

## 历史 version 9 验证

60 项检查、最终构建、Worker 类型与离线 dry-run 通过。本地 4 个新增范围由首轮 3 项和最终相关单项复核覆盖，保留数值格式断言及加强画布指针断言的记录。实际线上单轮 4 项于 `2026-10-07T13:24:30.561Z` 开始，53.841 秒全部通过，errors/warnings/API 请求和 unexpected/flaky/skipped 为 0；新增 320/390px 控件 >=44px，无横向溢出，相机/正式动作/原音频保存恢复一致。

唯一 5 HTTP 于 `2026-10-07T13:23:52.194430+00:00`–`2026-10-07T13:23:53.167641+00:00` 全通过，4 资产内容/安全 headers 与 health 200/no-store 匹配。没有未改 API 的重复探测、公网限频 burst 或 D1 写入。实际 [源码 CI run37627848531](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37627848531) completed/success，`2026-10-07T13:27:45Z` 更新，完整 60 检查与 30 浏览器流程成功；不触发重跑。

| 当前资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `assets/index-Ba2BRLq3.css` | 50274 | `6a31b7163e91973f5ae5b2eb30399637d9dac16090b8877f2a4cf0db1d756231` |
| `assets/index-Ctpwz7OU.js` | 927472 | `d64510d02c2e837925302410c14a47eda59bc8539fa0b9d601de3cabc917374b` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `index.html` | 645 | `dd7fd01c4bfc87d101a5c4ce33de79d7a60348bb9af0a56beaf44f5c3ed02dda` |

最终文档以纯 Markdown 提交 push，Cloudflare 复用同一 v9 version 的 deployment message 关联最终文档 SHA；无运行代码/资产变化，不再次上传或重跑公共验证。详细结果见 [VERIFICATION.md](VERIFICATION.md)。

## 历史 version 8 线上版本

| 项目 | 实际结果 |
| --- | --- |
| Worker / Account | `choreo-studio-preview` / `84e421f26c708c0cf437e287eed11fa1` |
| v8 功能首次发布 Deployment ID | `ebc26399-df3b-4b50-8de7-fb44b7f71821` |
| Version ID / number / 流量 | `bc806141-6418-44f7-b4c3-f6003ad48dcd` / 8 / 100% |
| 发布时间 | `2026-10-07T11:19:12.561597Z` |
| 功能源码 | [200f943b](https://github.com/DFerryman/ChoreographyStudio/commit/200f943b751b519ae6c19f31b744e4638fc3da18) |
| 发布方式 | multipart 上传含 gzip 静态资产的 Worker；`has_assets=false` |
| 实际 bindings | `API_RATE_LIMITER`（20/60、namespace 2026100601）与 `RELEASE_STAGE` |
| 实际模块大小 / SHA-256 | 353666 bytes / `1b182013eb22915c5cf94a8d0f2feca02231912e29d827696971071dfcff1d78` |

实际下载模块与可复现生成物逐字节一致，version message 关联完整功能 Git SHA；API bundle 与 v7 相同。无 D1/KV/R2/DO/真实 ASSETS 绑定，音乐、姿态复用、K/烘焙与 IndexedDB 保存均在浏览器。

## 历史 version 8 验证

唯一 5 HTTP 于 `2026-10-07T11:20:25.454604Z`–`11:20:27.111684Z` 全通过，4 资产 bytes/hash/安全 headers 与最终 dist 相同，health 200/no-store。API/infra 未改，复用既有 API 保护/501 证据，未另跑 capabilities、POST 或限频 burst。

| v8 历史资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `assets/index-Br0b-ptV.css` | 49517 | `a2255a09e7e9891ebd7e6556f3b9ef4ee2f1a45b38b9d880d2e523f4ebe40cdb` |
| `assets/index-CvrUMSNe.js` | 923879 | `d1ce8917038d3cfc54b724e4d942e433e9221985ca108eadeb2b61f0a9394f3c` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `index.html` | 645 | `7d4714485c9d665a2903512edc21a254b43e932b6c90d098792df4daffd4020a` |

本地单轮新增 4 项于 `11:12:23.918Z`、84.161 秒通过；实际新增线上单轮 4 项于 `2026-10-07T11:20:44.256Z`、74.446 秒全通过，两轮均无 unexpected/flaky/skipped/报告 errors，诊断 errors/warnings/API 请求均为 0。320/390px 新控件 >=44px/无横向溢出，原音频 hash 和正式动作/历史保存重开一致；截图来自同一轮，未重复公网会话。实际 [源码 CI run37613142651](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37613142651) completed/success、`2026-10-07T11:24:56Z` 更新，日志确认 52 检查和完整 26 项 e2e 通过。最终纯文档提交复用同一运行版本，以部署 message 同步最终 SHA，不再次上传资产或公网测试。详见 [VERIFICATION.md](VERIFICATION.md)。

## 历史 version 7 线上版本

| 项目 | 实际结果 |
| --- | --- |
| Worker | `choreo-studio-preview` |
| Account | `84e421f26c708c0cf437e287eed11fa1` |
| v7 功能首次发布 Deployment ID | `5e4bde38-3f4f-476f-8374-4fe410b36878` |
| Version ID | `2eb92bb1-7d34-448b-afae-3dfd4c0d28e4` |
| Version / 流量 | 7 / 100% |
| 发布时间 | `2026-10-07T06:55:05.960593Z` |
| 功能源码 | [b6dbd231](https://github.com/DFerryman/ChoreographyStudio/commit/b6dbd231a17d4da58ee5f78e122960542da4edb2) |
| 发布方式 | API multipart 上传包含 gzip 静态资产的 Worker；`has_assets=false` |
| 实际 bindings | `API_RATE_LIMITER`（20/60、namespace 2026100601）与 `RELEASE_STAGE` |
| 模块大小 | 352118 bytes |
| 实际下载模块 SHA-256 | `62663af9260aa723948941accc93afc7f276e8b115379fdec0491a4b377363a1` |

实际下载的 `index.js` 与最终可复现生成物逐字节一致；version message 关联同一功能 Git SHA。只保留原生限频与阶段变量，无 D1/KV/R2/DO/真实 ASSETS 绑定。音乐、编舞、轨道编辑、播放和 IndexedDB 场景保存留在本机。

## 历史 version 7 验证

必要单轮 5 HTTP 于 `2026-10-07T06:56:18.166541Z` 开始，`06:56:19.093700Z` 完成，全部通过：4 资产 200 且 bytes/SHA 与最终 dist 一致，安全 headers 保留；health 200 / no-store，stage、preview-1 和 synthetic-demo 正确。API/infra 没有改动，复用此前 API 保护/501 拒绝证据，没有再跑 capabilities/POST 或公网限频 burst。

| v7 历史资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `assets/index-C_Hml5-F.js` | 920967 | `8448fc352b75ae899ce0b7599d4d0c33b14c70db93c345ab15ba76b4d8b6bc89` |
| `assets/index-C2d_8p-4.css` | 48287 | `58d5ac45b78de57be7e8d204ae57b4e5a0dd69764f03c01d72962d8468b15f63` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `index.html` | 645 | `76e9bdaad093055e676ca78643a8161a92e350380bbe8dc9bd8f0a09b75c2ed2` |

本地 7 项与追加 Root 单项通过。首次在线浏览器导航因默认执行方式未使用受信代理证书而失败，尚未进入功能；恢复已验证启动配置后，一轮相关线上 4 项于 `2026-10-07T07:00:25.215Z` 开始，63.861 秒全部通过，零 unexpected/flaky/skipped、console errors/warnings 和 API 请求。桌面/手机截图来自此同一轮；保留追加脚本的首轮超时和代理证书失败及对应恢复，未另跑公网整套或截图会话。实际 [源码 CI run37584120545](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37584120545) completed/success、`2026-10-07T07:00:09Z` 更新，日志确认 52 检查与完整 22 项 e2e 通过，head 对应上述功能提交。详情见 [VERIFICATION.md](VERIFICATION.md)。

## 历史 version 6 线上版本

| 项目 | 实际结果 |
| --- | --- |
| Worker | `choreo-studio-preview` |
| Account | `84e421f26c708c0cf437e287eed11fa1` |
| v6 功能首次发布 Deployment ID | `3e4d1b20-04a7-477b-bf3d-9da12bb4b77e` |
| Version ID | `68f57f01-3e85-4811-a577-83a9e879d854` |
| Version / 流量 | 6 / 100% |
| 发布时间 | `2026-10-07T05:03:42.985483Z` |
| 发布方式 | API multipart 上传包含 gzip 静态资产的 Worker 模块 |
| Cloudflare assets 状态 | `has_assets=false`；本次没有 Cloudflare ASSETS 绑定 |
| 实际 bindings | `API_RATE_LIMITER`（ratelimit）与 `RELEASE_STAGE`（plain_text） |
| 模块大小 | 349962 bytes |
| 实际下载模块 SHA-256 | `7247fe5be3a50f606bf9ad6032e79264e1eaea8ff67829344ec0d9eff4e87dc2` |

实际从 Cloudflare 下载的 `index.js` 与仓库 `infra/prepare-inline-preview.mjs` 的稳定生成物逐字节一致。模块包含本次 Web 与带限频保护的 API 构建；生成器为同一 API handler 提供本地 fetch 兼容的资产接口。兼容日期、flags、vars、限频 binding 与 headers 来自版本控制中的 `wrangler.jsonc` 和构建的 `_headers`。两个发布准备工具通过 `infra/worker-metadata.mjs` 保留相同的限频配置。

此预览使用 `preview-1` 与原创 `synthetic-demo`。多个场景、编排历史、相机/播放状态和原音频只在浏览器/IndexedDB 保存；公开 API 只提供健康和能力读取。实际 Worker settings 未绑定 D1、KV、Durable Objects 或 R2；本项目没有数据库调用、服务器项目存储或真实 Motion Worker。

## 请求频率与成本边界

所有 `/api/*` 路由共用 `API_RATE_LIMITER`：namespace `2026100601`，每个 `CF-Connecting-IP` 配置 20 次 / 60 秒，实际 key 为 `choreo-preview:ip:<IP>`。超限返回 429、`Retry-After: 60`；保护缺失、失败或没有可信客户端 IP 时返回 503。静态资源和本机编辑不调用该限流器，不写 D1。

原生限频按 Cloudflare 节点生效且最终一致，共享出口 IP 共用额度；后续鉴权服务应改用账号身份。它不是账户全局费用硬上限，429 仍计 Worker 请求，当前 inline 静态交付也会执行 Worker。后续开放写入前还需业务幂等、写入合并和日写入预算门槛，当前没有宣称生产写入额度已完成。平台边界见 [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) 与 [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)。

## 历史 version 6 验证

`2026-10-07T05:04:47.316968Z` 至 `05:04:48.743614Z` 执行一次必要的 7 HTTP 检查，全部通过：4 个资产返回 200，SHA-256 与最终 `dist` 完全一致，安全 headers 生效；health/capabilities 返回 200，项目 POST 仍返回 501。实际下载 Worker 模块返回 200，与可复现生成物逐字节一致；settings 仍仅有上述两个 bindings。没有公网 burst、循环检查或服务器写入。

| 当前资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `index.html` | 645 | `5b1175ed187a8c58d1ff88eea7b0a056dde210a041b6a532931ba02a92dc444e` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `assets/index-CkuO6Doc.js` | 916330 | `9a3204e0d8404f95cf623035662d1cfcf8926740d33835005f4f5c801af8751c` |
| `assets/index-CXrg_P_F.css` | 45397 | `0bdca2f97bde79406cb45dbea93cf20d19e920ae69173279554a5963143c9371` |

唯一相关线上 4 项于 `2026-10-07T05:05:54.325Z` 开始，56.932 秒全部通过，unexpected/flaky/skipped 均为 0，4 个 console 附件零 errors/warnings。覆盖默认模式真实关节选择/旋转/写 K 与候选隔离、Root 世界箭头/写 K/撤销/保存恢复/旧场景兼容、320/390px 的 44px 操作入口与同帧工具保稿、真实取消与 CDP 多触点后的选点/相机恢复。桌面和手机截图从此单轮流程获取；未额外跑公网整套或截图会话。

功能源码为 [88ad1fdf4e0ac75ead076848d933660b62e98e07](https://github.com/DFerryman/ChoreographyStudio/commit/88ad1fdf4e0ac75ead076848d933660b62e98e07)，47 文件 tree `2ecc71a948dc7277a0c2c1b0a819a0f9e211f320` 与本地完全一致，保留原 MIT 和提交历史。[源码 CI run37574696859](https://github.com/DFerryman/ChoreographyStudio/actions/runs/37574696859) 已实际 completed/success，更新时间 `2026-10-07T05:11:10Z`；npm ci、check/构建、Worker 类型、Chromium 与完整 18 项 e2e 全部通过，失败产物上传按条件 skipped。本轮 [#7](https://github.com/DFerryman/ChoreographyStudio/issues/7) 的退出条件完成；旧 #5/#6 保持完成。此处为后续纯 Markdown 回填，不触发重复源码 CI。

操作仍先形成浏览器内 Pose 草稿，显式写 K 才修改权威动画；正式轨道、原音频和视口/工具设置按 Scene 保存，没有云保存或 D1 写入。详细本地首轮失败、相关复核和当前 CI 结论见 [VERIFICATION.md](VERIFICATION.md)。

## 历史 P1 version 5 验证

上一轮 version `2fac9fa5-5387-425c-9bbb-23a5379d162d`、deployment `1479fdaf-2aa0-44f1-a5dc-10e3f58b1624` 于 `2026-10-06T15:13:08.85059Z` 发布；模块 345890 bytes，SHA-256 `508ed426ae18b0c74e300c14068513ffa3611b80a97752bfff16d441569c92e8`。以下检查与资产均对应该历史版本。

version 5 于 `2026-10-06T15:14:55.350Z` 完成一次必要的 7 项 HTTP 检查，全部通过：

- HTML、favicon、JavaScript、CSS 返回 200，4 个资产的 SHA-256 与 `dist` 完全相同，安全 headers 生效。
- `/api/health`、`/api/capabilities` 返回 200；健康结果明确 `S0-interactive-preview`、`preview-1`、`synthetic-demo`。
- `POST /api/projects` 返回 501，没有开放项目上传或写入。
- 实际下载模块与生成物完全一致；settings 核验仅有上述两个 bindings。未进行公网 burst、循环压测或写入测试。

| 资产 | Bytes | SHA-256 |
| --- | ---: | --- |
| `index.html` | 645 | `6f8ef6d457648f6c9db7ee6d106524ddf9010d363ccdbbde4b7aed7059478ce0` |
| `favicon.svg` | 322 | `883028cbbedddb4251346f961e58174dfe92b20d8fdd7351d7373005f4c2b6ac` |
| `assets/index-cqLXFl6s.js` | 907440 | `729511114a8df0d398763d475e319332d96320cf0da7d859a50f03b0f5156b99` |
| `assets/index-Dh91RS4i.css` | 42602 | `39d3c950dd4d8d7a0e48df9a40116d68ebf211507b04a586141f0dcdc954c3a1` |

version5的唯一完整线上14项于 `2026-10-06T15:16:19.311Z` 开始，190.445秒全部通过，0 skipped/unexpected/flaky；14个console附件均无errors/warnings或pageerror。验证包括原10项和新增4项手K、旧场景/模板固化、保存失败/延迟保存与小屏流程；慢保存时可继续编辑。实际源码CI run37486474465已completed/success，详见验证记录。

保存的是正式轨道/基底与权威take，未写入Pose草稿不视为已保存动画；没有云保存或D1写入。实现规则与本地失败/脚本修正、CSS针对性复核记录见 [MANUAL_KEYFRAMES.md](MANUAL_KEYFRAMES.md) 和 [VERIFICATION.md](VERIFICATION.md)。

## 历史S0浏览器检查

version 4 的完整 10 项 Playwright 流程在 `2026-10-06T14:05:04.566Z` 开始，102.922 秒全部通过：原 7 项编舞流程，以及相机/骨骼/坐标、多场景独立保存与复制后刷新/删除、未保存改动保护及保存失败 3 项新增流程。10 个浏览器 console attachment 均无 errors/warnings，pageerror 为空，无跳过、重试不稳定或不符合预期的用例。公网只执行这一轮完整流程。

此前 version 3 的 7 项视觉流程在 `2026-10-06T13:25:18.181Z` 开始，38.752 秒全部通过；该结果发生在新 Scene 功能之前，作为历史记录保留，当前新增范围使用上述 version 4 的真实验证。

基础后备生成器曾通过39项直接、25项workerd HTTP和34项旧/新等价与动态headers检查。既有7项API mock与6项metadata断言验证429/503和两发布路径保留限频；本轮未改API/infra。当前52项core/手K/API/存储、构建/Worker类型及完整浏览器和CI结果见 [VERIFICATION.md](VERIFICATION.md)。

## 当前 v12/v13 原生发布构建

当前版本使用 `wrangler.jsonc` 的原生 Workers Static Assets 和 `AI` 绑定，实际 Wrangler 上传已经成功。先在本地运行基础/类型/全套 mock 浏览器验证，提交并 push GitHub main，再通过已认证 Wrangler 发布并核对实际版本、有限线上流程和准确源码 CI。AI 测试必须 mock，不能用真实推理验证部署。

```sh
npm ci
npm run check
npm run typecheck:worker
npm run test:e2e
npx wrangler deploy --dry-run --outdir /tmp/choreo-native-worker-build
npx wrangler deploy --tag v13-author-key-priority --message '<实际功能提交SHA与范围>'
```

仅 Markdown 回填时复用已验证原生版本，并以同版100% deployment message关联最终main，不再上传资产或重复公网流程。`_headers`/`_redirects`是配置元数据；AI请求始终限于用户主动生成，没有云项目保存。

## 历史 S0–v11 后备发布构建复现

以下只适用于对应历史提交及锁定构建输入，不用于当前v12/v13原生ASSETS发布。

生成器只准备文件，不执行网络请求或部署：

```sh
npm ci
npm run build
npx wrangler deploy --dry-run --outdir /tmp/choreo-worker-build
node infra/prepare-inline-preview.mjs dist /tmp/choreo-worker-build/index.js /tmp/choreo-inline-repro
```

输出为 `/tmp/choreo-inline-repro.mjs`、`-metadata.json`、`-multipart.txt` 和 `-summary.json`。对应历史锁定依赖与同一构建输入可重复生成当时的模块 SHA-256。当时通过已授权 Cloudflare API 上传 multipart，并启用目标 Worker 的 workers.dev 地址；发布后记录新 deployment/version IDs 并验证公网。

生成模块、multipart、临时上传 JWT、凭据及上传音乐不进入 public 仓库。后备生成器对未支持的非空 `_redirects` 明确报错，不默默忽略配置。

## 标准 Static Assets 路线与历史上传问题

`wrangler.jsonc` 使用 Workers Static Assets 标准配置，v12/v13已经通过原生Wrangler成功上传和部署，实际AI/ASSETS/限频绑定已读回。历史S0–v11后备方式内嵌资产，不能描述成ASSETS绑定部署。旧阶段完成Cloudflare重新授权后，正式Worker创建和发布已成功；当时官方资产manifest接口返回200，但上传JWT的小资产multipart请求返回`Unauthorized`，当轮采用上述可复现后备方式。这一历史失败不代表当前原生发布仍受阻。

当前在已认证的Wrangler环境可执行 `npm run deploy`；标准API准备工具 `infra/prepare-preview.mjs` 也将 `_headers`/`_redirects` 保留为配置元数据，不作为公开资产。GitHub自动CI已启用，Cloudflare发布由每轮明确部署步骤完成，尚未配置GitHub自动部署。

S0/P1上线代表原创演示和本机编辑闭环。真实动作、Avatar、许可、教师验证、生产服务和MP4尚未完成；原M0–M3仍未通过。
