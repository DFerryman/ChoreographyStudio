import { ArrowUpRight } from 'lucide-react';
import { Dialog } from './Dialog';

const STAGES = [
  { title: '交互与播放预览', current: true, text: '音乐与镜头两轨 Timeline、节拍选区、AI 生成人物动作候选、碰撞预览、操作记录、3D 播放与本机保存。' },
  { title: '接入真实动作与原工程契约', text: '取得合法素材、人物和过渡记录，运行 Python 动作处理与接触检查。' },
  { title: '接入生产服务', text: '账号、私有项目、版本事务、持久任务、取消与权限检查。' },
  { title: '高精度烘焙与教师验证', text: '编舞完成后，基于动作与相机 Timeline 计算高精度碰撞、骨骼与蒙皮，产出稳定无抖动的只读视频；此阶段尚未实现。' },
];

const SHORTCUTS: [string, string][] = [
  ['Space', '播放／暂停'], ['← →', '逐帧移动'], ['⇧ ← →', '逐拍移动'], ['Home End', '选区或整段起止'],
  ['I O', '设选区起点／终点'], ['Esc', '清除选区'], ['Delete', '删除选中镜头关键帧'],
  ['Ctrl/⌘ Z', '撤销'], ['Ctrl/⌘ ⇧ Z · Ctrl Y', '重做'], ['Ctrl/⌘ S', '保存到本机'],
];

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return <Dialog titleId="about-title" title="从可操作，到真正可教学" eyebrow="版本进展 / DEVELOPMENT" className="about-modal"
    closeLabel="关闭版本说明" onClose={onClose} dismissOnBackdrop
    intro="按 v2.1 范围逐步实现。当前是独立预览协议，不冒充原工程包已完成集成。">
    <div className="roadmap">{STAGES.map((stage, index) => <div key={stage.title} className={stage.current ? 'current' : ''}>
      <span>{String(index + 1).padStart(2, '0')}</span>
      <div><strong>{stage.title}{stage.current && <small>当前</small>}</strong><p>{stage.text}</p></div>
    </div>)}</div>
    <section className="shortcut-list" aria-label="键盘快捷键">
      <h3>键盘快捷键</h3>
      <dl>{SHORTCUTS.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>)}</dl>
    </section>
    <div className="form-note">人物动作只由 AI 生成：Workers AI 选择原创程序化动作与幅度，点击生成才调用模型，预览后再采用。按时间线选区只修改该段的 AI 生成是下一步功能。旧场景里的人物关键帧数据完整保留，只是不在时间线上显示或手动编辑。碰撞、IK 与物理计算仍在底层运行；仍需真实动作与教师验证。保存只在本机。完整场景包包含原音乐，可导入为新场景；项目 JSON 不含音乐。当前不提供 MP4 或真实动作库。</div>
    <a className="button primary full" href="https://github.com/DFerryman/ChoreographyStudio" target="_blank" rel="noreferrer">查看源码与阶段任务 <ArrowUpRight size={16} /></a>
  </Dialog>;
}
