import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  readonly title: string;
  readonly eyebrow?: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly className?: string;
  readonly hideClose?: boolean;
}
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");
const MODAL_STACK: string[] = [];

export function Modal({ title, eyebrow, children, onClose, className = "", hideClose = false }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const modalId = useId();
  const titleId = `${modalId}-title`;
  closeRef.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById("root");
    const rootWasInert = appRoot?.inert ?? false;
    if (appRoot) appRoot.inert = true;
    MODAL_STACK.push(modalId);
    const focusable = panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (panel?.querySelector<HTMLElement>("[autofocus]") ?? focusable?.[0] ?? panel)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (MODAL_STACK.at(-1) !== modalId) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const elements = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      const index = MODAL_STACK.lastIndexOf(modalId);
      if (index >= 0) MODAL_STACK.splice(index, 1);
      if (appRoot) appRoot.inert = rootWasInert;
      opener?.focus();
    };
  }, [modalId]);

  return createPortal(
    <div className="modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && MODAL_STACK.at(-1) === modalId) onClose();
    }}>
      <div className={`modal-panel ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef} tabIndex={-1}>
        <div className="modal-panel__header">
          <div>{eyebrow && <small>{eyebrow}</small>}<h2 id={titleId}>{title}</h2></div>
          {!hideClose && <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={17} /></button>}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
