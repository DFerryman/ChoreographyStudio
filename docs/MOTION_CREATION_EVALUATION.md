# 新动作素材创作 · 2026-10-14

用户要求 AI 创造新动作素材，可以参考网络样本，但不能截取现有录制片段充数；转向、移位、变速、姿态调理、接缝与 IK 均不改变这个判断。用户选择先实测专用动作模型的中国舞风格与自然度，再决定接入。

## 产品纠正

当前线上 native47 的主体路径是 Workers AI 选择 CMU 85_12 Street／61_08 Salsa，两条完整录制及其十四个窗口，再由程序适配与求解。程序没有从用户打开的场景文件偷读片段，但这些内置来源和旧演示场景是同一批真人动捕，确实不满足“创造新素材”。旧物理检查通过，只能说明对应已编排候选通过其声明范围，不能证明中国舞风格或新创作。

本轮源码把“创作新动作”设为默认操作。当前没有合格且已接入生产的新素材提供方，创作按钮明确不可用，操作入口也在清候选、暂停、哈希、调用 AI 或加载来源之前拒绝；没有自动改用素材编排。已有来源须明确选择“编排已有素材”，界面及候选摘要披露选取、组合和适配现有 Street／Salsa，不能接受模型自行把摘要写成“中国舞”或“新创作”。音频与原场景保留，原有显式采用、边界、撤销与求解门槛继续使用。

`GET /api/capabilities` 单独声明 `newMotionCreation.available=false`、`existingClipFallback=false`；旧 `modelGeneration` 仅保留历史文本模型接口的兼容语义，不能据此宣称专用模型可用。规划能力明确 `operation=arrange-existing`、`createsNewMaterial=false`、两条录制覆盖。`POST /api/motion/create` 经过共享 API 限流、Origin 与 JSON 类型检查后返回 `503 CREATION_UNAVAILABLE`，不读取旧素材、不访问 AI 绑定或 AI 配额、不解析/储存场景数据。

## 两次真实专用模型实验

使用 [NVIDIA 官方 Kimodo Space](https://huggingface.co/spaces/nvidia/Kimodo)，而不是播放 gallery／Load Example。每次新会话只按一次 Generate，单样本、seed 20261014、100 步、CFG `[2,2]`、关闭后处理，采用自行写的公开英语动作描述，没有用户场景、音频、凭据或私人描述上传；本轮 Workers AI 调用为零。第一次 4 秒，第二次根据失败细化左右交替动作，改为 6 秒。提示词和时长都改变，因此两次不是单变量对照，也没有测试稳定成功率。

Space 观测为 RUNNING／L40S，发布仓 SHA `032e9f86e8ab21aca62e72564aac6dbbb20cfe5b`；其 requirements 未固定 Kimodo 代码 SHA。界面显示 `Kimodo-SOMA-RP-v1`，输出实际都是 77 个关节；界面版本名和发布仓 SHA 不能证明进程代码或加载权重 SHA。当前公开 v1 权重仓 SHA `defbe1f34f5fd031eb0ccfe19f3f92a9880c287b` 仅是只读查证的仓身份，实际进程权重 SHA 未独立验证。原始 NPZ 不内嵌提示词、seed、fps 或模型信息，故必须与另存的实验回执一起解释。

模型机制是从噪声合成运动，见 [官方 Kimodo 实现](https://github.com/nv-tlabs/kimodo)。SOMA 权重的 [NVIDIA Open Model License](https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1/blob/main/LICENSE) 明确允许商业使用并不主张输出所有权；代码 Apache-2.0 与权重许可是不同事项。77 关节中的扩展手指采用放松姿态，不能宣称模型生成了兰花指等独立手指编舞。原样本仅供本轮评估，不进入内置动作库，也不作为“中国舞生成成功”展示。

| 实验 | 实际输出 | 原始文件 SHA256 | 当前结论 |
|---|---|---|---|
| 01：古典舞、交替云手、躯干螺旋、柔和侧步、开臂收势 | 120 帧 × 77 关节；UI 4 秒，30 fps，末样本 119/30 秒 | `254e4c22eb7d176e4def9c6a75a27eb76a49ce3f021fdbeeb6346fb952f04e59` | 双手主要同步抬落、脚基本站定；不能判为满足描述 |
| 02：明确左臂圆周／右手腰侧，交换左右，躯干随动、侧步、开臂收势 | 180 帧 × 77 关节；UI 6 秒，30 fps，末样本 179/30 秒 | `84c4b29492e51dde15a1896ef454f7d1941ec0e5ed859efabef1735ad749507c` | 手臂更不对称且发生侧移，末尾仍落手，未达到描述／中国舞风格验收 |

每个文件都含 `posed_joints`、全局／局部旋转矩阵、Root 和六个预测接触标签，均为有限值；这并不自动证明正确人体动力学、足底碰撞、曲线接缝或风格。

## 原始数据与相似性检查范围

第一份样本的全局矩阵与官方休止骨架位置一致，最大位置误差约 0.000201 mm；原始矩阵并非精确 SO(3)，直接连乘局部矩阵会产生最大 6.92 mm 位置误差。仅诊断性将全局矩阵投影到 SO(3) 后重算局部，可把误差降至约 0.999 mm，未修改原始文件，也没有将投影姿态作为已验收候选。左右手高度相关系数 0.9608；左脚接触时最大水平位移约 22.7 mm、累计小幅移动约 120 mm。接触标签是预测，不是受力测量；这些数据没有经过本项目的重定向、实际足底、插值曲线与固定边界验收。

第二份样本出现约 32.5 cm 水平净位移，左右手高度相关降至约 0.502，但末尾两腕仍约 0.823／0.832 m 高，未形成开臂收势。局部矩阵递推位置误差最大约 9.17 mm，诊断性投影并重算后约 1.367 mm。预测接触期间双脚最大移动约 56.9／70.1 mm；局部手腕有限差分角加速度存在尖峰。原始指标不能代替本项目重定向和实际曲线门槛，不能宣称已通过或已证实整个人体不可行。

本地相似性原型对齐共同身体关节方向，允许整体转向、Root 平移、速度变化和镜像，检查至少两秒的连续来源区间。第一版先用 36 个原录制阳性对照校准，随后才读取第一份新样本。追加 8 个实际旧流程重定向、接触调理、接缝、求解与收势后的复制对照时已看过新样本，修订版不是盲评；旧版回执保留。44 个阳性来源全部检出，阈值按原规则修订至 0.43256753。第一份新样本最接近的两秒窗口距离 0.48786985，只比阈值高约 12.8%；不能夸大区分强度。

这个检查只涉及两条本地录制，最多支持“此原型未发现对这两条来源的高度相似连续截取”。它不检查完整训练集，也不能保证著作权意义上的原创性。相似性、按描述生成、风格、自然度及人体可行性须分别判断，不允许一个检查通过抵消另一个失败。

第二份按同一最终阈值检查，全段最接近 Street 原始 0–3 秒，方向 RMS 距离约 0.56972165；九个两秒窗最小约 0.50656712，只有约 17.1% 阈值余量。没有高度相似旗标，同样不构成完整原创性保证。保存的路径距离独立重算，最大误差 2.22e−16。

原始结果、提示词／参数、数值审计、正面／侧面视频及校准记录已归档在 [evidence/motion-creation-20261014](evidence/motion-creation-20261014/manifest.json)。两份 raw SHA 保持原值；没有用户原场景或音频进入归档。

本地复算：

```sh
python infra/analyze_generated_motion.py --input docs/evidence/motion-creation-20261014/trial-02/raw.npz --skeleton-json docs/evidence/motion-creation-20261014/soma-skeleton-metadata.json --fps 30 --trial-json docs/evidence/motion-creation-20261014/trial-02/trial.json --output-dir work/recheck-native --skip-video
```

此脚本要求本地 numpy、scipy、matplotlib；视频另需 ffmpeg。它不会运行模型，也不会修改原始样本。相似性脚本 `infra/audit_motion_similarity.py` 消费已归档的来源世界关节和固定校准文件，不调用模型。复算最终第二份：

```sh
OPENBLAS_NUM_THREADS=1 python infra/audit_motion_similarity.py --raw docs/evidence/motion-creation-20261014/trial-02/raw.npz --expected-raw-sha256 84c4b29492e51dde15a1896ef454f7d1941ec0e5ed859efabef1735ad749507c --priors-world-joints docs/evidence/motion-creation-20261014/similarity/priors-world-joints.json.gz --soma-metadata docs/evidence/motion-creation-20261014/soma-skeleton-metadata.json --calibration docs/evidence/motion-creation-20261014/similarity/calibration-adapted-v2.json --output-dir work/recheck-similarity
```

以已归档输入实际复算第二份，距离和保存路径成本与原记录一致；回执时间与文件路径会按新运行更新。

## 后续接入条件

1. 候选实测能表达要求的舞种和动作，不靠模型自写 summary 宣告成功；保留失败样本与原始输出。
2. 建立生成器原生坐标、单位、休止姿态和本项目 25 关节的重定向；明确手指限制及 SO(3) 修正量，不能直接复制 T 形休止骨架的局部旋转。
3. 为真正生成的轨迹新增严格、真实的生成器来源记录。现有密集曲线要求真人动捕来源，不能伪造 CMU 或 Workers AI 的来源给 Kimodo 输出通过。
4. 用整段轨迹门禁检查新候选；固定区间两端／速度／外部、原文件、3 mm 地面与 250 rad/s² 门槛保持。
5. 官方演示的五分钟共享 GPU 会话只用于实验，不能冒充生产推理服务或未经允许架设代理。生产需要实际可用、许可合适、费用和访问方式明确的模型服务；当前没有部署这个后端。

本轮尚未将新素材模型接入生产，也尚未发布本轮源码。定向单元101／3、前端构建、Worker类型与分轮浏览器检查通过，完整本轮验证见 [VERIFICATION.md](VERIFICATION.md)。不是完整14／14浏览器或新源码全量949。所有旧发布／失败记录保留。
