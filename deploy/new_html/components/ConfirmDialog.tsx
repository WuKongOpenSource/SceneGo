import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  detail?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  detail,
  confirmText = '确定',
  cancelText = '取消',
  variant = 'warning',
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const variantStyles = {
    danger: {
      icon: 'text-danger',
      confirmBtn: 'bg-danger hover:bg-red-500 text-white',
      detailBg: 'bg-r50 border-r75',
    },
    warning: {
      icon: 'text-warning',
      confirmBtn: 'bg-amber-600 hover:bg-amber-500 text-white',
      detailBg: 'bg-y50 border-y75',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      className="app-modal-backdrop fixed inset-0 z-[200] flex items-center justify-center bg-n900/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="app-modal-surface bg-n0 rounded-2xl border border-n40 shadow-bottom w-full max-w-md mx-4"
      >
        <div className="app-modal-header flex items-center gap-3 px-6 pt-6 pb-2">
          <div className={`p-2 rounded-md bg-n0 ${styles.icon}`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 id="confirm-dialog-title" className="text-lg font-semibold text-n800 flex-1">{title}</h3>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg hover:bg-n20 text-n100 hover:text-n700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="app-modal-body px-6 py-4">
          <p className="text-sm text-n700 leading-relaxed">{message}</p>
          {detail && (
            <div className={`mt-3 p-3 rounded-md border ${styles.detailBg}`}>
              {detail}
            </div>
          )}
        </div>

        <div className="app-modal-footer flex items-center justify-end gap-3 px-6 pb-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-md text-sm font-medium text-n700 bg-n0 hover:bg-n20 border border-n40 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${styles.confirmBtn}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
