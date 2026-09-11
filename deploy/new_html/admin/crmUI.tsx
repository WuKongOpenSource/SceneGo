

















import React, { useEffect, useState, useRef } from 'react';
import { CheckCircle2, XCircle, Info, AlertTriangle, X, Search } from 'lucide-react';



type MsgType = 'success' | 'error' | 'info' | 'warning';
interface MsgItem { id: number; text: string; type: MsgType }
interface DialogState {
  kind: 'confirm' | 'prompt';
  title: string;
  message?: string;
  type?: 'danger' | 'warning' | 'info';
  confirmText?: string;
  cancelText?: string;

  label?: string;
  placeholder?: string;
  inputType?: string;
  defaultValue?: string;
  required?: boolean;
  resolve: (v: any) => void;
}

let _msgs: MsgItem[] = [];
let _dialog: DialogState | null = null;
const _msgSubs = new Set<() => void>();
const _dlgSubs = new Set<() => void>();
let _mid = 0;
const emitMsg = () => _msgSubs.forEach(f => f());
const emitDlg = () => _dlgSubs.forEach(f => f());

function removeMsg(id: number) { _msgs = _msgs.filter(m => m.id !== id); emitMsg(); }

function pushMsg(text: string, type: MsgType, duration = 3000) {
  const id = ++_mid;
  _msgs = [..._msgs, { id, text, type }];
  emitMsg();
  setTimeout(() => removeMsg(id), duration);
}

export const crmMessage = {

  success: (t: string) => pushMsg(t, 'success'),
  error: (t: string) => pushMsg(t, 'error', 8000),
  info: (t: string) => pushMsg(t, 'info'),
  warning: (t: string) => pushMsg(t, 'warning', 7000),
};

export function crmConfirm(opts: {
  title?: string; message?: string; type?: 'danger' | 'warning' | 'info';
  confirmText?: string; cancelText?: string;
}): Promise<boolean> {
  return new Promise(resolve => {
    _dialog = { kind: 'confirm', title: opts.title ?? '提示', message: opts.message,
      type: opts.type ?? 'warning', confirmText: opts.confirmText, cancelText: opts.cancelText, resolve };
    emitDlg();
  });
}

export function crmPrompt(opts: {
  title?: string; label?: string; placeholder?: string; inputType?: string;
  defaultValue?: string; required?: boolean; confirmText?: string; cancelText?: string;
}): Promise<string | null> {
  return new Promise(resolve => {
    _dialog = { kind: 'prompt', title: opts.title ?? '请输入', label: opts.label,
      placeholder: opts.placeholder, inputType: opts.inputType ?? 'text', defaultValue: opts.defaultValue ?? '',
      required: opts.required, confirmText: opts.confirmText, cancelText: opts.cancelText, resolve };
    emitDlg();
  });
}



const MSG_ICON: Record<MsgType, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 text-success" />,
  error: <XCircle className="w-4 h-4 text-danger" />,
  info: <Info className="w-4 h-4 text-primary" />,
  warning: <AlertTriangle className="w-4 h-4 text-warning" />,
};

export const CrmHost: React.FC = () => {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force(x => x + 1);
    _msgSubs.add(f); _dlgSubs.add(f);
    return () => { _msgSubs.delete(f); _dlgSubs.delete(f); };
  }, []);

  const dlg = _dialog;
  const [val, setVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dlg?.kind === 'prompt') { setVal(dlg.defaultValue ?? ''); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [dlg]);

  const closeDlg = (result: any) => { const d = _dialog; _dialog = null; emitDlg(); d?.resolve(result); };

  return (
    <>

      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] flex flex-col items-center gap-2 pointer-events-none">
        {_msgs.map(m => (
          <div key={m.id}
               onClick={() => removeMsg(m.id)}
               title="点击关闭"
               className="pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-md bg-n0 border border-n40 shadow-bottom text-sm text-n800 animate-slideDown cursor-pointer max-w-[560px]">
            <span className="shrink-0">{MSG_ICON[m.type]}</span>
            <span className="flex-1">{m.text}</span>
            <X className="w-3.5 h-3.5 text-n100 shrink-0" />
          </div>
        ))}
      </div>


      {dlg && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-n900/40 backdrop-blur-sm"
             onClick={e => { if (e.target === e.currentTarget) closeDlg(dlg.kind === 'confirm' ? false : null); }}>
          <div className="bg-n0 rounded-lg border border-n40 shadow-bottom w-full max-w-sm mx-4 animate-scaleIn">
            <div className="flex items-center gap-2 px-5 pt-4 pb-1">
              <h3 className="text-[15px] font-semibold text-n800 flex-1">{dlg.title}</h3>
              <button onClick={() => closeDlg(dlg.kind === 'confirm' ? false : null)}
                      className="p-1 rounded hover:bg-n20 text-n100 hover:text-n700"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-3">
              {dlg.kind === 'confirm' ? (
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className={`w-5 h-5 mt-0.5 shrink-0 ${dlg.type === 'danger' ? 'text-danger' : dlg.type === 'info' ? 'text-primary' : 'text-warning'}`} />
                  <p className="text-sm text-n700 leading-relaxed">{dlg.message}</p>
                </div>
              ) : (
                <div>
                  {dlg.label && <label className="block text-xs text-n300 mb-1.5">{dlg.label}</label>}
                  <input
                    ref={inputRef}
                    type={dlg.inputType}
                    value={val}
                    onChange={e => setVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { if (dlg.required && !val.trim()) return; closeDlg(val); } }}
                    placeholder={dlg.placeholder}
                    className="w-full bg-n0 border border-n40 rounded px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 pb-4">
              <button onClick={() => closeDlg(dlg.kind === 'confirm' ? false : null)}
                      className="px-3.5 py-1.5 rounded text-sm text-n700 bg-n0 hover:bg-n20 border border-n40">
                {dlg.cancelText ?? '取消'}
              </button>
              <button
                onClick={() => { if (dlg.kind === 'prompt' && dlg.required && !val.trim()) return; closeDlg(dlg.kind === 'confirm' ? true : val); }}
                className={`px-3.5 py-1.5 rounded text-sm text-white ${dlg.type === 'danger' ? 'bg-danger hover:bg-r400' : 'bg-primary hover:bg-primary-hover'}`}>
                {dlg.confirmText ?? '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};




export const CrmToolbar: React.FC<{
  title: string;
  count?: number;
  search?: { value: string; onChange: (v: string) => void; placeholder?: string; onSearch?: () => void };
  filters?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, count, search, filters, actions }) => (
  <div className="flex items-center gap-3 mb-3 flex-wrap">
    <div className="flex items-center gap-2">
      <h3 className="text-[15px] font-semibold text-n800">{title}</h3>
      {typeof count === 'number' && <span className="text-xs text-n100">（{count}）</span>}
    </div>
    <div className="ml-auto flex items-center gap-2">
      {filters}
      {search && (
        <div className="relative">
          <input
            value={search.value}
            onChange={e => search.onChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search.onSearch?.(); }}
            placeholder={search.placeholder ?? '搜索…'}
            className="bg-n0 border border-n40 rounded pl-2.5 pr-8 py-1.5 text-xs w-56 focus:border-primary focus:outline-none"
          />
          <button onClick={() => search.onSearch?.()}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-n100 hover:text-primary">
            <Search className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {actions}
    </div>
  </div>
);


export const CrmPrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', children, ...rest }) => (
  <button {...rest}
    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-primary hover:bg-primary-hover disabled:opacity-60 ${className}`}>
    {children}
  </button>
);


export const CrmTag: React.FC<{ type?: 'success' | 'danger' | 'warning' | 'info' | 'default'; children: React.ReactNode }> = ({ type = 'default', children }) => {
  const styles: Record<string, string> = {
    success: 'bg-success-light text-success',
    danger: 'bg-r50 text-danger',
    warning: 'bg-y50 text-y400',
    info: 'bg-primary-light text-primary',
    default: 'bg-n30 text-n300',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${styles[type]}`}>{children}</span>;
};


type CrmActionLinkProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  type?: 'primary' | 'danger' | 'default';
};

export const CrmActionLink: React.FC<CrmActionLinkProps> = ({ type = 'primary', className = '', children, ...rest }) => {
  const color = type === 'danger' ? 'text-danger hover:text-r400' : type === 'default' ? 'text-n300 hover:text-n700' : 'text-primary hover:text-primary-hover';
  return <button type="button" {...rest} className={`text-xs font-medium ${color} disabled:opacity-50 ${className}`}>{children}</button>;
};


export const CrmActionSep: React.FC = () => <span className="text-n40 mx-1.5">|</span>;


export const CrmPagination: React.FC<{
  total: number; page: number; pageSize: number; onChange: (page: number) => void;
}> = ({ total, page, pageSize, onChange }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const go = (p: number) => onChange(Math.min(pages, Math.max(1, p)));

  const nums: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) nums.push(p);
  return (
    <div className="flex items-center justify-end gap-1.5 mt-3 text-xs text-n300">
      <span className="mr-2">共 {total} 条</span>
      <button onClick={() => go(page - 1)} disabled={page <= 1}
              className="px-2 py-1 rounded border border-n40 bg-n0 hover:bg-n20 disabled:opacity-40">上一页</button>
      {nums[0] > 1 && <span className="px-1">…</span>}
      {nums.map(p => (
        <button key={p} onClick={() => go(p)}
                className={`min-w-[28px] px-2 py-1 rounded border ${p === page ? 'border-primary bg-primary text-white' : 'border-n40 bg-n0 hover:bg-n20'}`}>{p}</button>
      ))}
      {nums[nums.length - 1] < pages && <span className="px-1">…</span>}
      <button onClick={() => go(page + 1)} disabled={page >= pages}
              className="px-2 py-1 rounded border border-n40 bg-n0 hover:bg-n20 disabled:opacity-40">下一页</button>
    </div>
  );
};


export const CrmTable: React.FC<{ headers: React.ReactNode; children: React.ReactNode }> = ({ headers, children }) => (
  <div className="border border-n40 rounded-md overflow-hidden">
    <table className="w-full text-xs">
      <thead className="bg-n20 text-n300 border-b border-n40">{headers}</thead>
      <tbody className="divide-y divide-n40">{children}</tbody>
    </table>
  </div>
);
