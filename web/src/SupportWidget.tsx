import { useEffect, useState } from 'react';
import { api, ticketLabel, type SupportMessage, type SupportTicket, type TicketKind, type TicketStatus } from './api';
import { friendlyApiError } from './journey';
import { useT } from './i18n';
import { useModalA11y } from './useModalA11y';

const kinds: TicketKind[] = ['bug', 'question', 'idea', 'billing', 'abuse', 'other'];
function date(ts: number) { return new Date(ts).toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short' }); }

export function SupportWidget() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [kind, setKind] = useState<TicketKind>('question');
  const [body, setBody] = useState('');
  const [reply, setReply] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try { const r = await api.support.listTickets(); setTickets(r.tickets); }
    catch (e) { setError(friendlyApiError(e, document.documentElement.lang === 'en' ? 'en' : 'ru')); }
  }
  async function openTicket(id: string) {
    try { const r = await api.support.getTicket(id); setSelected(r.ticket); setMessages(r.messages); }
    catch (e) { setError(friendlyApiError(e, document.documentElement.lang === 'en' ? 'en' : 'ru')); }
  }
  useEffect(() => { if (!open) return; void load(); const timer = window.setInterval(() => { if (selected) void openTicket(selected.id); else void load(); }, 10000); return () => window.clearInterval(timer); }, [open, selected?.id]);
  // S3-06: Esc, начальный фокус и Tab-цикл внутри диалога — общий хук, как у
  // остальных модалок (свой keydown-слушатель Esc заменён им). Callback-ref
  // фиксирует появление узла: диалог монтируется по условию.
  const dialogRef = useModalA11y<HTMLElement>(() => setOpen(false));

  async function create() {
    if (!body.trim()) return;
    // Отдельное поле «Тема» убрано как дубль категории: в subject пишем имя
    // выбранной категории, чтобы в списке обращений у тикета остался заголовок.
    const subject = t(`support.kind.${kind}`);
    try { const r = await api.support.createTicket({ kind, subject, body: body.trim() }); setBody(''); setCreating(false); setSelected(r.ticket); setMessages(r.messages); await load(); }
    catch (e) { setError(friendlyApiError(e, document.documentElement.lang === 'en' ? 'en' : 'ru')); }
  }
  async function send() {
    if (!selected || !reply.trim()) return;
    try { const r = await api.support.addMessage(selected.id, reply.trim()); setReply(''); setSelected(r.ticket); setMessages(r.messages); }
    catch (e) { setError(friendlyApiError(e, document.documentElement.lang === 'en' ? 'en' : 'ru')); }
  }

  return <>
    <button className="support-launcher" onClick={() => setOpen(true)} aria-label={t('support.open')}>{t('support.open')}</button>
    {open && <div className="support-widget-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section ref={dialogRef} className="support-widget" role="dialog" aria-modal="true" aria-label={t('support.title')}>
        <div className="support-widget-head"><strong>{t('support.title')}</strong><button onClick={() => setOpen(false)} aria-label={t('support.close')}>{t('support.close')}</button></div>
        {error && <div className="err">{error}</div>}
        {selected ? <>
          <button className="ghost" onClick={() => setSelected(null)}>{t('support.back')}</button><h3><span className="mono support-number" title={t('support.number')}>{ticketLabel(selected)}</span> {selected.subject}</h3>
          <div className="support-messages">{messages.map((m) => <article key={m.id} className={`support-message ${m.author_role}`}><div className="muted">{m.author_login} · {date(m.created_at)}</div><div>{m.body}</div></article>)}</div>
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t('support.reply.placeholder')} /><button className="primary" onClick={() => void send()} disabled={!reply.trim()}>{t('support.reply')}</button>
        </> : creating ? <>
          <select value={kind} onChange={(e) => setKind(e.target.value as TicketKind)} aria-label={t('support.subject')}>{kinds.map((k) => <option key={k} value={k}>{t(`support.kind.${k as TicketKind}`)}</option>)}</select><textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('support.body')} /><button className="primary" onClick={() => void create()} disabled={!body.trim()}>{t('support.submit')}</button>
        </> : <>
          <button className="primary" onClick={() => setCreating(true)}>{t('support.new')}</button><div className="support-widget-list">{tickets.length === 0 ? <p className="muted">{t('support.empty')}</p> : tickets.map((ticket) => <button key={ticket.id} onClick={() => void openTicket(ticket.id)}><strong><span className="mono support-number">{ticketLabel(ticket)}</span> {ticket.subject}</strong><span className="muted">{t(`support.status.${ticket.status as TicketStatus}`)} · {date(ticket.last_message_at)}</span></button>)}</div>
        </>}
      </section>
    </div>}
  </>;
}
