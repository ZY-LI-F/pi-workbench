import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, Ellipsis } from "lucide-react";

export interface HeaderOverflowAction {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly onSelect: () => void;
}

interface HeaderOverflowMenuProps {
  readonly actions: readonly HeaderOverflowAction[];
  readonly ariaLabel: string;
  readonly className?: string;
  readonly status?: string;
}

export function HeaderOverflowMenu({ actions, ariaLabel, className = "", status }: HeaderOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  const run = (action: HeaderOverflowAction): void => {
    if (action.disabled) return;
    setOpen(false);
    action.onSelect();
  };

  return (
    <div ref={rootRef} className={`header-overflow ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="header-overflow__trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Ellipsis size={15} />
        <span>更多</span>
      </button>
      {open && (
        <div id={menuId} className="header-overflow__menu" role="menu" aria-label={ariaLabel}>
          {status && <div className="header-overflow__status" role="status"><i />{status}</div>}
          <div className="header-overflow__items">
            {actions.map((action) => (
              <button
                type="button"
                role={action.selected === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={action.selected}
                disabled={action.disabled}
                className="header-overflow__item"
                key={action.id}
                onClick={() => run(action)}
              >
                <span className="header-overflow__icon">{action.icon}</span>
                <span><strong>{action.label}</strong>{action.description && <small>{action.description}</small>}</span>
                {action.selected && <Check className="header-overflow__check" size={13} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
