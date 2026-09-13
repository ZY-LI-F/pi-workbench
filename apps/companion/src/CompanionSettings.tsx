import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef, useState } from "react";
import { version } from "../package.json";
import { ANDROID_GUIDE } from "../../../src/shared/user-guide";

export function CompanionSettings({ onClose }: { readonly onClose: () => void }) {
  const [reading, setReading] = useState(false);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string>();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const goBack = useRef<() => void>(() => undefined);
  goBack.current = () => reading ? setReading(false) : onClose();
  useEffect(() => {
    const dialog = dialogRef.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let active = true;
    let removeBackListener: (() => Promise<void>) | undefined;
    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener("backButton", () => goBack.current()).then((handle) => {
        if (active) removeBackListener = () => handle.remove();
        else void handle.remove();
      }).catch((cause: unknown) => { if (active) setError(`系统返回键不可用：${cause instanceof Error ? cause.message : String(cause)}`); });
    }
    return () => {
      active = false;
      void removeBackListener?.();
      document.body.style.overflow = previousOverflow;
      dialog.close();
      opener?.focus();
    };
  }, []);
  const topic = ANDROID_GUIDE[selected]!;
  const select = (index: number) => {
    setSelected(index);
    contentRef.current?.scrollTo({ top: 0 });
  };
  return <dialog className="companion-settings" ref={dialogRef} aria-labelledby="companion-settings-title" onCancel={(event) => { event.preventDefault(); goBack.current(); }}>
    <header className="companion-settings__header"><button type="button" aria-label={reading ? "返回设置" : "返回首页"} onClick={() => goBack.current()}>←</button><h2 id="companion-settings-title">{reading ? "功能介绍与操作说明" : "设置"}</h2><button type="button" aria-label="关闭设置" onClick={onClose}>×</button></header>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {reading ? <>
      <nav className="companion-guide__nav" aria-label="操作说明主题">{ANDROID_GUIDE.map((item, index) => <button type="button" aria-current={index === selected ? "page" : undefined} key={item.id} onClick={() => select(index)}>{item.title}</button>)}</nav>
      <article className="companion-guide__content" ref={contentRef} tabIndex={0} aria-label={topic.title}>
        <p className="companion-guide__count">{String(selected + 1).padStart(2, "0")} / {ANDROID_GUIDE.length} · 离线图文指南</p>
        <h3>{topic.title}</h3><p>{topic.summary}</p>
        <figure><img src={topic.image} alt={topic.imageAlt} /><figcaption>操作示意</figcaption></figure>
        <ol>{topic.steps.map((step, index) => <li key={step}><span aria-hidden="true">{index + 1}</span><p>{step}</p></li>)}</ol>
        <aside>{topic.tip}</aside>
        <button className="companion-guide__next" type="button" onClick={() => selected === ANDROID_GUIDE.length - 1 ? setReading(false) : select(selected + 1)}>{selected === ANDROID_GUIDE.length - 1 ? "阅读完成，返回设置" : "下一主题 →"}</button>
      </article>
    </> : <div className="companion-settings__body">
      <div className="companion-settings__about"><span className="brand-mark">S</span><div><strong>Stella Companion</strong><p>v{version} · 随时查看电脑上的工作</p></div></div>
      <button className="companion-settings__guide-entry" type="button" onClick={() => { setSelected(0); setReading(true); }}><span><strong>功能介绍与操作说明</strong><small>连接电脑、查看动态、回复与验收<br />每个主题三步，离线也能查看</small></span><b aria-hidden="true">→</b></button>
      <p className="companion-settings__note">添加和切换电脑在首页顶部。配对后可查看工作动态，并在 Task Room 处理当前事项。</p>
    </div>}
  </dialog>;
}
