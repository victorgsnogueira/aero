import { useEffect, useRef, useState } from 'react';
import { TEMPLATE_VARIABLES } from '@aero/shared';
import { api } from '../lib/api';

interface Preview {
  text: string;
  missing: string[];
  unknown: string[];
  companyName: string | null;
}

export function TemplateEditor({ id, label, value, onChange, campaignId, rows = 6, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; campaignId: number; rows?: number; hint?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .post<Preview>(`/campaigns/${campaignId}/preview`, { template: value })
        .then((p) => {
          setPreview(p);
          setPreviewError(null);
        })
        .catch((e: Error) => setPreviewError(e.message));
    }, 400);
    return () => clearTimeout(t);
  }, [value, campaignId]);

  const insert = (name: string) => {
    const el = ref.current;
    const token = `{{${name}}}`;
    if (!el) return onChange(value + token);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <textarea id={id} ref={ref} className="textarea w-full font-mono text-sm" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} maxLength={4000} />
        {hint ? <p className="text-xs text-base-content/60">{hint}</p> : null}
        <div className="flex flex-wrap gap-1" aria-label="Inserir variável">
          {Object.entries(TEMPLATE_VARIABLES).map(([k, desc]) => (
            <button key={k} type="button" className="btn btn-ghost btn-xs font-mono" title={desc} onClick={() => insert(k)}>
              {`{{${k}}}`}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Prévia {preview?.companyName ? `(com dados de ${preview.companyName})` : '(empresa de exemplo)'}</p>
        <div className="min-h-32 whitespace-pre-wrap break-words border-y border-base-300 bg-base-200/50 p-4 text-base">{value.trim() ? (preview?.text ?? '…') : <span className="text-base-content/70">Sem texto: esta mensagem não será enviada.</span>}</div>
        {preview?.missing.length ? (
          <p className="text-xs text-warning" role="alert">
            Sem valor: {preview.missing.join(', ')}. Contatos sem esse dado não receberão a mensagem.
          </p>
        ) : null}
        {preview?.unknown.length ? (
          <p className="text-xs text-error" role="alert">
            Variáveis desconhecidas: {preview.unknown.join(', ')}
          </p>
        ) : null}
        {previewError ? <p className="text-xs text-error">{previewError}</p> : null}
      </div>
    </div>
  );
}
