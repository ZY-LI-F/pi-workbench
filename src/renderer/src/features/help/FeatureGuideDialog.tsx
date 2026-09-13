import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { DESKTOP_GUIDE } from "@shared/user-guide";
import { Modal } from "../../components/Modal";

export function FeatureGuideDialog({ onClose }: { readonly onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const topic = DESKTOP_GUIDE[selected]!;
  const select = (index: number) => {
    setSelected(index);
    contentRef.current?.scrollTo({ top: 0 });
  };
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "Home" ? 0 : event.key === "End" ? DESKTOP_GUIDE.length - 1
      : event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % DESKTOP_GUIDE.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index - 1 + DESKTOP_GUIDE.length) % DESKTOP_GUIDE.length : undefined;
    if (next === undefined) return;
    event.preventDefault();
    select(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };
  return <Modal title="功能介绍与操作说明" eyebrow="STELLA GUIDE" onClose={onClose} className="feature-guide-dialog">
    <p className="feature-guide-intro">选一个主题，三步上手。图文随安装包提供，离线也能查看。</p>
    <div className="feature-guide-layout">
      <nav className="feature-guide-nav" role="tablist" aria-label="操作说明主题" aria-orientation="vertical">
        {DESKTOP_GUIDE.map((item, index) => <button type="button" role="tab" id={`${id}-tab-${index}`} aria-selected={selected === index} aria-controls={`${id}-content`} tabIndex={selected === index ? 0 : -1} key={item.id} onClick={() => select(index)} onKeyDown={(event) => navigate(event, index)}><span>{String(index + 1).padStart(2, "0")}</span>{item.title}</button>)}
      </nav>
      <div className="feature-guide-content" role="tabpanel" id={`${id}-content`} aria-labelledby={`${id}-tab-${selected}`} tabIndex={0} ref={contentRef}>
        <h3>{topic.title}</h3><p className="feature-guide-summary">{topic.summary}</p>
        <figure><img src={topic.image} alt={topic.imageAlt} /><figcaption>操作示意</figcaption></figure>
        <ol>{topic.steps.map((step, index) => <li key={step}><span aria-hidden="true">{index + 1}</span><p>{step}</p></li>)}</ol>
        <p className="feature-guide-tip">{topic.tip}</p>
      </div>
    </div>
    <footer className="feature-guide-footer"><button type="button" className="button-secondary" onClick={onClose}><ArrowLeft size={14} />返回设置</button><span>{selected + 1} / {DESKTOP_GUIDE.length}</span><button type="button" className="button-primary" onClick={() => selected === DESKTOP_GUIDE.length - 1 ? onClose() : select(selected + 1)}>{selected === DESKTOP_GUIDE.length - 1 ? "阅读完成" : "下一主题"}<ArrowRight size={14} /></button></footer>
  </Modal>;
}
