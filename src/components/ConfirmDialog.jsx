export default function ConfirmDialog({
  open,
  title,
  description,
  detail,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div className="dialog-overlay" role="presentation" onMouseDown={onCancel}>
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className={danger ? 'dialog-ribbon warning' : 'dialog-ribbon'}>{danger ? '需要确认' : '建议确认'}</div>
        <div className="dialog-body">
          <h2 id="confirm-title">{title}</h2>
          <p>{description}</p>
          {detail ? (
            <div className="dialog-detail">
              <span>当前记录</span>
              <strong>{detail}</strong>
            </div>
          ) : null}
        </div>
        <div className="dialog-actions">
          <button className="btn-ghost" onClick={onCancel}>{cancelText}</button>
          <button className="btn-dialog-primary" onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
