import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONVERSATION_STATES, CONVERSATION_STATE_LABELS, MESSAGE_ORIGIN_LABELS, SERVICE_LABELS, type ConversationState } from '@aero/shared';
import { api, errorMessage, newClientKey } from '../lib/api';
import type { ChatMessage, ConversationDetail, ConversationListItem, Paged } from '../lib/types';
import { EmptyState, ErrorAlert, Loading, PageHeader, Pagination } from '../components/ui';
import { ConversationBadge, MessageStatusLabel, ParticipationBadge, StageBadge, WaBadge } from '../components/status';
import { useToast } from '../components/toast';
import { fmtDateTime, fmtRelative, fmtTime, formatMoney } from '../lib/format';
import { offerPrice } from '../lib/offer';

/** Inicia uma conversa manual com um número (confere no WhatsApp; não envia nada). */
function NewConversation() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const start = useMutation({
    mutationFn: () => api.post<{ id: number; e164: string; whatsapp: string }>('/inbox/conversations', { phone }),
    onSuccess: (r) => {
      setPhone('');
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      if (r.whatsapp !== 'found') toast('info', 'Não foi possível confirmar o WhatsApp agora; o envio informará o resultado.');
      navigate(`/inbox/${r.id}`);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (phone.trim()) start.mutate();
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <label htmlFor="new-conversation" className="sr-only">
        Número para nova conversa
      </label>
      <input id="new-conversation" type="tel" className="input input-sm flex-1" placeholder="Nova conversa: +55 12 99999-9999" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button type="submit" className="btn btn-primary btn-sm" disabled={!phone.trim() || start.isPending}>
        Abrir
      </button>
    </form>
  );
}

export default function Inbox() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const state = (params.get('state') as ConversationState | null) ?? undefined;
  const unread = params.get('unread') === 'true' || undefined;
  const campaignId = params.get('campaignId') ? Number(params.get('campaignId')) : undefined;
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const list = useQuery({
    queryKey: ['inbox', 'list', state, unread, campaignId, debounced, page],
    queryFn: () => api.get<Paged<ConversationListItem> & { totalUnread: number }>('/inbox/conversations', { state, unread, campaignId, q: debounced || undefined, page, pageSize: 40 }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const setFilter = (k: string, v: string | undefined) => {
    setPage(1);
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (v) n.set(k, v);
      else n.delete(k);
      return n;
    });
  };

  return (
    <>
      <PageHeader title="Caixa de entrada" description="Conversas do seu número. Mensagens e estados atualizam sem recarregar a página." />
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <aside className={`flex min-w-0 flex-col gap-2 ${id ? "hidden lg:flex" : ""}`} aria-label="Conversas">
          <NewConversation />
          <label className="input input-sm w-full">
            <span className="sr-only">Buscar conversa</span>
            <input type="search" placeholder="Buscar nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="inbox-state">
              Situação
            </label>
            <select id="inbox-state" className="select select-sm flex-1" value={state ?? ''} onChange={(e) => setFilter('state', e.target.value || undefined)}>
              <option value="">Todas as situações</option>
              {CONVERSATION_STATES.map((s) => (
                <option key={s} value={s}>
                  {CONVERSATION_STATE_LABELS[s]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" className="checkbox checkbox-xs" checked={!!unread} onChange={(e) => setFilter('unread', e.target.checked ? 'true' : undefined)} />
              Não lidas
            </label>
          </div>
          {list.isPending ? (
            <Loading />
          ) : list.isError ? (
            <ErrorAlert error={list.error} />
          ) : list.data.items.length === 0 ? (
            <EmptyState title="Nenhuma conversa" description="Conversas aparecem após o primeiro envio ou quando alguém escreve para o seu número." />
          ) : (
            <ul className="max-h-[70vh] divide-y divide-base-300 overflow-y-auto rounded-box border border-base-300 bg-base-100">
              {list.data.items.map((c) => (
                <li key={c.id}>
                  <Link to={`/inbox/${c.id}${location.search}`} className={`block px-3 py-2 hover:bg-base-200 ${String(c.id) === id ? 'bg-primary/10' : ''}`} aria-current={String(c.id) === id ? 'page' : undefined}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`min-w-0 truncate ${c.unreadCount ? "font-semibold" : ""}`}>{c.title}</span>
                      <span className="shrink-0 text-xs text-base-content/60">{fmtRelative(c.lastMessageAt)}</span>
                    </div>
                    <p className="truncate text-xs text-base-content/70">
                      {c.lastDirection === 'out' ? 'Você: ' : ''}
                      {c.lastBody ?? '(mídia)'}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <ConversationBadge state={c.state} />
                      {c.automationPaused ? <span className="badge badge-ghost badge-xs">Automação pausada</span> : null}
                      {c.unreadCount ? <span className="badge badge-primary badge-xs">{c.unreadCount}</span> : null}
                      {c.campaignName ? <span className="truncate text-xs text-base-content/60">{c.campaignName}</span> : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {list.data ? <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} /> : null}
        </aside>
        <section className={id ? '' : 'hidden lg:block'}>{id ? <Conversation key={id} id={Number(id)} /> : <EmptyState title="Selecione uma conversa" />}</section>
      </div>
    </>
  );
}

function Conversation({ id }: { id: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const endRef = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['inbox', 'conversation', id], queryFn: () => api.get<ConversationDetail>(`/inbox/conversations/${id}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['inbox'] });
  const markRead = useMutation({ mutationFn: () => api.post(`/inbox/conversations/${id}/read`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['attention'] }) });
  const unreadCount = q.data?.conversation.unreadCount ?? 0;
  useEffect(() => {
    if (unreadCount > 0) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadCount, id]);
  const lastId = q.data?.messages.at(-1)?.id;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lastId]);

  const action = useMutation({
    mutationFn: (a: 'takeover' | 'resume-automation') => api.post(`/inbox/conversations/${id}/${a}`),
    onSuccess: (_d, a) => {
      refresh();
      toast('success', a === 'takeover' ? 'Atendimento assumido: automação pausada' : 'Automação retomada');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/inbox/conversations/${id}`, body),
    onSuccess: refresh,
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const c = d.conversation;
  const title = d.companies[0]?.name ?? c.displayName ?? d.phone?.e164 ?? 'Conversa';
  const human = c.automationPaused || c.state === 'human';
  return (
    <div className="grid gap-4 2xl:grid-cols-[1fr_300px]">
      <div className="flex h-[75vh] flex-col overflow-hidden rounded-box border border-base-300 bg-base-100">
        <header className="flex flex-wrap items-center gap-2 border-b border-base-300 px-4 py-2">
          <button type="button" className="btn btn-ghost btn-xs lg:hidden" onClick={() => navigate('/inbox')}>
            ← Voltar
          </button>
          <div className="min-w-40 flex-1">
            <p className="truncate font-semibold">{title}</p>
            <p className="text-xs text-base-content/60">{d.phone?.e164 ?? d.phone?.raw_sample}</p>
          </div>
          <ConversationBadge state={c.state} />
          {human ? (
            <button type="button" className="btn btn-sm" onClick={() => action.mutate('resume-automation')} disabled={action.isPending}>
              Retomar automação
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => action.mutate('takeover')} disabled={action.isPending}>
              Assumir conversa
            </button>
          )}
          {c.state !== 'closed' ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch.mutate({ state: 'closed' })}>
              Encerrar
            </button>
          ) : null}
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
          {d.hasMore ? <p className="mb-2 text-center text-xs text-base-content/60">Mostrando as últimas 100 mensagens.</p> : null}
          <ol className="flex flex-col gap-2">
            {d.messages.map((m) => (
              <MessageBubble key={m.id} m={m} onChanged={refresh} />
            ))}
          </ol>
          <div ref={endRef} />
        </div>
        <Composer conversationId={id} onSent={refresh} human={human} />
      </div>
      <ContextPanel d={d} onPatch={(b) => patch.mutate(b)} />
    </div>
  );
}

function MessageBubble({ m, onChanged }: { m: ChatMessage; onChanged: () => void }) {
  const toast = useToast();
  const out = m.direction === 'out';
  const resolve = useMutation({
    mutationFn: (as: 'sent' | 'not_sent') => api.post(`/inbox/messages/${m.id}/resolve-unknown`, { as }),
    onSuccess: onChanged,
    onError: (e) => toast('error', errorMessage(e)),
  });
  const cancel = useMutation({ mutationFn: () => api.post(`/inbox/messages/${m.id}/cancel`), onSuccess: onChanged, onError: (e) => toast('error', errorMessage(e)) });
  return (
    <li className={`chat ${out ? 'chat-end' : 'chat-start'}`}>
      <div className="chat-header mb-0.5 flex items-center gap-1 text-xs text-base-content/60">
        <span>{out ? MESSAGE_ORIGIN_LABELS[m.origin] : 'Contato'}</span>
        <time dateTime={m.occurredAt}>{fmtTime(m.occurredAt)}</time>
      </div>
      <div className={`chat-bubble whitespace-pre-wrap text-sm ${out ? (m.status === 'cancelled' ? 'opacity-50' : 'chat-bubble-primary') : ''}`}>
        {m.media ? (
          <p className="mb-1">
            {m.media.available ? (
              <a href={`/api/inbox/messages/${m.id}/media`} target="_blank" rel="noreferrer" className="link">
                📎 {m.media.fileName || m.media.kind}
              </a>
            ) : (
              <span>📎 {m.media.kind} (não disponível)</span>
            )}
          </p>
        ) : null}
        {m.body ?? (m.media ? null : <em>(sem texto)</em>)}
      </div>
      {out ? (
        <div className="chat-footer mt-0.5 flex flex-wrap items-center gap-1">
          <MessageStatusLabel status={m.status} />
          {m.error ? <span className="max-w-xs truncate text-xs text-base-content/60" title={m.error}>{m.error}</span> : null}
          {m.status === 'unknown' ? (
            <>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => resolve.mutate('sent')}>
                Confirmei: foi enviada
              </button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => resolve.mutate('not_sent')}>
                Não foi enviada
              </button>
            </>
          ) : null}
          {m.status === 'scheduled' ? (
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => cancel.mutate()}>
              Cancelar envio
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Composer({ conversationId, onSent, human }: { conversationId: number; onSent: () => void; human: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState(newClientKey);
  const send = useMutation({
    mutationFn: async () => {
      if (file) {
        const form = new FormData();
        form.set('caption', text);
        form.set('clientKey', key);
        form.set('file', file);
        return api.post<ChatMessage>(`/inbox/conversations/${conversationId}/attachments`, form);
      }
      return api.post<ChatMessage>(`/inbox/conversations/${conversationId}/messages`, { text, clientKey: key });
    },
    onSuccess: (m) => {
      setText('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setKey(newClientKey());
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      onSent();
      if (m.status === 'failed') toast('error', `Falha no envio: ${m.error ?? ''}`);
      else if (m.status === 'unknown') toast('error', 'Resultado desconhecido: confira no celular antes de reenviar.');
      else if (m.status === 'scheduled') toast('info', m.error ?? 'Envio adiado');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !file) return;
    send.mutate();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-base-300 p-3">
      {!human ? <p className="text-xs text-base-content/60">Enviar uma mensagem manual assume a conversa e pausa a automação.</p> : null}
      {file ? (
        <p className="text-xs">
          Anexo: {file.name} ({Math.round(file.size / 1024)} KB){' '}
          <button type="button" className="link" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>
            remover
          </button>
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <label className="btn btn-ghost btn-sm" title="Anexar arquivo">
          <span aria-hidden="true">📎</span>
          <span className="sr-only">Anexar arquivo</span>
          <input ref={fileRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp,video/mp4,audio/mpeg,audio/ogg,application/pdf,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label htmlFor={`composer-${conversationId}`} className="sr-only">
          Mensagem
        </label>
        <textarea
          id={`composer-${conversationId}`}
          className="textarea textarea-sm flex-1"
          rows={2}
          value={text}
          maxLength={4096}
          placeholder={file ? 'Legenda (opcional)' : 'Escreva uma mensagem'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (text.trim() || file) send.mutate();
            }
          }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={send.isPending || (!text.trim() && !file)}>
          {send.isPending ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </form>
  );
}

function ContextPanel({ d, onPatch }: { d: ConversationDetail; onPatch: (b: Record<string, unknown>) => void }) {
  const c = d.conversation;
  const [nextAction, setNextAction] = useState(c.nextAction ?? '');
  const [due, setDue] = useState(c.nextActionDueAt ? c.nextActionDueAt.slice(0, 16) : '');
  const [notes, setNotes] = useState(c.notes ?? '');
  const part = d.participations[0];
  return (
    <aside className="flex flex-col gap-4 text-sm" aria-label="Contexto do contato">
      <section className="rounded-box border border-base-300 bg-base-100 p-3">
        <h2 className="mb-2 font-semibold">Lead</h2>
        {d.companies.length === 0 ? <p className="text-base-content/60">Contato não está na base de leads.</p> : null}
        {d.companies.map((co) => (
          <div key={co.id} className="mb-2">
            <Link to={`/leads?q=${encodeURIComponent(co.name)}`} className="link link-hover font-medium">
              {co.name}
            </Link>
            <p className="text-xs text-base-content/60">{[co.category, co.city, co.state].filter(Boolean).join(' · ')}</p>
          </div>
        ))}
        {d.companies.length > 1 ? <p className="text-xs text-info">Telefone compartilhado por {d.companies.length} empresas.</p> : null}
        {d.phone ? (
          <div className="mt-1 flex flex-wrap gap-1">
            <WaBadge status={d.phone.wa_status} />
            {Number(d.phone.suppressed) ? <span className="badge badge-error badge-soft badge-sm">Bloqueado (recusa)</span> : null}
          </div>
        ) : null}
      </section>
      {part ? (
        <section className="rounded-box border border-base-300 bg-base-100 p-3">
          <h2 className="mb-2 font-semibold">Campanha</h2>
          <Link to={`/campanhas/${part.campaignId}`} className="link link-hover">
            {part.campaignName}
          </Link>
          <p className="text-xs text-base-content/60">{SERVICE_LABELS[part.service]}</p>
          <div className="mt-1">
            <ParticipationBadge status={part.status} />
          </div>
          {part.offerSnapshot ? (
            <div className="mt-2 rounded-box bg-base-200 p-2 text-xs">
              <p className="font-medium">Oferta apresentada: {part.offerSnapshot.name}</p>
              <p>{offerPrice(part.offerSnapshot)}</p>
              {part.offerSnapshot.setupCents !== null ? <p>Implantação: {formatMoney(part.offerSnapshot.setupCents, part.offerSnapshot.currency)}</p> : null}
              {part.offerSnapshot.monthlyCents !== null ? <p>Mensalidade: {formatMoney(part.offerSnapshot.monthlyCents, part.offerSnapshot.currency)}</p> : null}
              <p className="text-base-content/60">Registrada em {fmtDateTime(part.offerSnapshot.capturedAt)}</p>
            </div>
          ) : null}
          {part.answers && Object.keys(part.answers).length ? (
            <dl className="mt-2 text-xs">
              {Object.entries(part.answers).map(([k, v]) => (
                <div key={k} className="mb-1">
                  <dt className="font-medium">{k}</dt>
                  <dd className="whitespace-pre-wrap">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ) : null}
      <section className="rounded-box border border-base-300 bg-base-100 p-3">
        <h2 className="mb-2 font-semibold">Oportunidades</h2>
        {d.opportunities.length === 0 ? <p className="text-base-content/60">Nenhuma.</p> : null}
        {d.opportunities.map((o) => (
          <div key={o.id} className="mb-1 flex items-center justify-between gap-2">
            <Link to={`/oportunidades/${o.id}`} className="link link-hover truncate">
              {o.title}
            </Link>
            <StageBadge stage={o.stage} />
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-3">
        <h2 className="font-semibold">Próxima ação</h2>
        <label className="sr-only" htmlFor="next-action">
          Próxima ação
        </label>
        <input id="next-action" className="input input-sm w-full" value={nextAction} maxLength={255} onChange={(e) => setNextAction(e.target.value)} placeholder="Ex.: enviar proposta" />
        <label className="text-xs" htmlFor="next-due">
          Prazo
        </label>
        <input id="next-due" type="datetime-local" className="input input-sm w-full" value={due} onChange={(e) => setDue(e.target.value)} />
        <label className="text-xs" htmlFor="conv-notes">
          Anotações
        </label>
        <textarea id="conv-notes" className="textarea textarea-sm w-full" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button
          type="button"
          className="btn btn-sm self-start"
          onClick={() => onPatch({ nextAction: nextAction || null, nextActionDueAt: due ? new Date(due).toISOString() : null, notes: notes || null })}
        >
          Salvar
        </button>
      </section>
    </aside>
  );
}
