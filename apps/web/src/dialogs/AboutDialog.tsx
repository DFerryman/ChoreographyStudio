import { ArrowUpRight } from 'lucide-react';
import { Dialog } from './Dialog';

const STAGES = [
  { title: '真人动作编排与候选检查', current: true, text: '音乐与镜头 Timeline、节拍选区、AI 编排真人动作、关节与碰撞检查、明确预览和采用、撤销与本机保存。' },
  { title: '扩展动作覆盖', text: '按实际质量与费用评估更多动作素材、专用动作模型及音乐理解。' },
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
    <div className="form-note">点击生成后，AI 根据描述、数拍与原动作上下文编排真人动捕片段；新轨迹经过关节、身体碰撞与接触检查，合格后才可预览和采用。当前素材以街舞和 Salsa 为主，未覆盖的动作会说明限制。选区两端和区间外保持，原场景动作与音乐不改，采用可撤销。检查使用简化身体模型，尚未验证完整人体力量与关节动力学；音乐字节不发送给模型。场景与音乐保存在本机，完整场景包保留原音乐，项目 JSON 不含音乐；当前不提供 MP4。</div>
    <a className="form-note" href="/motion-priors/NOTICE.txt" target="_blank" rel="noreferrer">真人动作来源与许可：CMU 动捕，可纳入商业产品，不可直接转售动作数据本身。</a>
    <a className="button primary full" href="https://github.com/DFerryman/ChoreographyStudio" target="_blank" rel="noreferrer">查看源码与阶段任务 <ArrowUpRight size={16} /></a>
  </Dialog>;
}
