import type { ButtonHTMLAttributes, ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Inbox, LoaderCircle, X } from "lucide-react";

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
  if (!portal) return null;
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal modal-${width}`} role="dialog" aria-modal="true" aria-label={title}>
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
