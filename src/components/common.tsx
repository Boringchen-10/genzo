import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Inbox, LoaderCircle, X } from "lucide-react";

const overlayStack: symbol[] = [];
const focusableSelector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function useOverlayFocus(ref: RefObject<HTMLElement | null>, onClose: () => void, keepNavLive = false) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const token = Symbol("overlay");
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    /* The settings drawer is a page-level surface: it leaves the left navigation
       clickable, so only the page content and the window bar go inert. Every
       other overlay inerts the whole app root. */
    const targets = (keepNavLive
      ? [document.querySelector<HTMLElement>(".main-content"), document.querySelector<HTMLElement>(".window-titlebar")]
      : [document.getElementById("root")]
    ).filter((element): element is HTMLElement => element !== null);
    overlayStack.push(token);
    targets.forEach((element) => { element.inert = true; });
    const frame = window.requestAnimationFrame(() => {
      const first = ref.current?.querySelector<HTMLElement>(focusableSelector);
      (first ?? ref.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (overlayStack.at(-1) !== token) return;
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(focusableSelector)).filter((item) => item.offsetParent !== null);
      if (!items.length) { event.preventDefault(); ref.current.focus(); return; }
      const first = items[0]!; const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      const index = overlayStack.indexOf(token);
      if (index >= 0) overlayStack.splice(index, 1);
      if (overlayStack.length === 0) {
        [
          document.getElementById("root"),
          document.querySelector<HTMLElement>(".main-content"),
          document.querySelector<HTMLElement>(".window-titlebar"),
        ].forEach((element) => { if (element) element.inert = false; });
      }
      window.requestAnimationFrame(() => previous?.focus());
    };
  }, [ref, keepNavLive]);
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function LoadingState({ label = "正在加载" }: { label?: string }) {
  return (
    <div className="state-block" role="status">
      <LoaderCircle className="spin" size={26} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="state-block error-state" role="alert">
      <AlertCircle size={28} />
      <strong>暂时无法加载</strong>
      <p>{message}</p>
      {retry ? (
        <button type="button" className="button secondary" onClick={retry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-block empty-state">
      <Inbox size={30} />
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function IconButton({ tooltip, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tooltip: string }) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={tooltip}
      data-tooltip={tooltip}
      {...props}
    />
  );
}

export function Modal({
  title,
  children,
  onClose,
  width = "medium",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: "small" | "medium" | "large";
}) {
  const portal = document.getElementById("portal-root");
  const dialogRef = useRef<HTMLElement>(null);
  useOverlayFocus(dialogRef, onClose);
  if (!portal) return null;
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} tabIndex={-1} className={`modal modal-${width}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <IconButton tooltip="关闭" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>,
    portal,
  );
}

export function Drawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const portal = document.getElementById("portal-root");
  const drawerRef = useRef<HTMLElement>(null);
  useOverlayFocus(drawerRef, onClose, true);
  if (!portal) return null;
  return createPortal(
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={drawerRef} tabIndex={-1} className="settings-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-header drawer-head"><h1>{title}</h1><IconButton tooltip="关闭设置" className="close" onClick={onClose}><X size={19}/></IconButton></header>
        <div className="drawer-body">{children}</div>
      </section>
    </div>,
    portal,
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "确认删除",
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={title} width="small" onClose={onCancel}>
      <p className="confirm-copy">{description}</p>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="button" className="button danger" onClick={onConfirm} disabled={busy}>
          {busy ? "处理中…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
