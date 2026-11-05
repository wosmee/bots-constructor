import { useEffect, useState } from 'react';
import { api, ticketLabel, type SupportMessage, type SupportTicket, type TicketKind, type TicketStatus } from './api';
import { friendlyApiError } from './journey';
import { useT } from './i18n';

const kinds: TicketKind[] = ['bug', 'question', 'idea', 'billing', 'abuse', 'other'];
const statuses: Array<TicketStatus | ''> = ['', 'new', 'in_progress', 'closed'];

function formatDate(ts: number, locale: string): string {
  return new Date(ts).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

export function SupportPage({ onBack }: { onBack: () => void }) {
  const t = useT();
  const locale = document.documentElement.lang === 'en' ? 'en-GB' : 'ru-RU';
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [status, setStatus] = useState<TicketStatus | ''>('');
  const [kind, setKind] = useState<TicketKind | ''>('');
  const [assignee, setAssignee] = useState('');
  const [q, setQ] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadList() {
    try {
      const r = await api.support.listTickets({ status: status || undefined, kind: kind || undefined, assignee: assignee || undefined, q: q || undefined });
      setTickets(r.tickets);
      if (selected) {
        const current = r.tickets.find((item) => item.id === selected.id);
        if (current) setSelected(current);
      }
    } catch (e) { setError(friendlyApiError(e, locale === 'en-GB' ? 'en' : 'ru')); }
  }
  async function loadTicket(id: string) {
    try {
      const r = await api.support.getTicket(id);
      setSelected(r.ticket); setMessages(r.messages);
    } catch (e) { setError(friendlyApiError(e, locale === 'en-GB' ? 'en' : 'ru')); }
  }
  useEffect(() => { void loadList(); }, [status, kind, assignee]);
  useEffect(() => {
    if (!selected) return;
    void loadTicket(selected.id);
    const timer = window.setInterval(() => void loadTicket(selected.id), 10000);
    return () => window.clearInterval(timer);
  }, [selected?.id]);

  async function action(fn: () => Promise<{ ticket: SupportTicket; messages: SupportMessage[] }>) {
    if (!selected) return;
    setBusy(true); setError('');
    try { const r = await fn(); setSelected(r.ticket); setMessages(r.messages); await loadList(); }
    catch (e) { setError(friendlyApiError(e, locale === 'en-GB' ? 'en' : 'ru')); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!selected || !reply.trim() || busy) return;
    const body = reply.trim(); setReply('');
    await action(() => api.support.addMessage(selected.id, body));
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="back-control" onClick={onBack}>{t('support.back')}</button>
        <h1>{t('support.staff.title')}</h1>
      </header>
      <main className="support-page">
        <h1 className="sr-only">{t('support.staff.title')}</h1>
        {error && <div className="err">{error}</div>}
        <section className="support-filters">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void loadList(); }} placeholder={t('support.search')} />
          <select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus | '')}>{statuses.map((value) => <option key={value} value={value}>{value ? t(`support.status.${value as TicketStatus}`) : t('support.filter.all')}</option>)}</select>
          <select value={kind} onChange={(e) => setKind(e.target.value as TicketKind | '')}>{['', ...kinds].map((value) => <option key={value} value={value}>{value ? t(`support.kind.${value as TicketKind}`) : t('support.filter.all')}</option>)}</select>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">{t('support.filter.any')}</option><option value="mine">{t('support.filter.mine')}</option><option value="unassigned">{t('support.filter.unassigned')}</option></select>
        </section>
        <div className="support-layout">
          <section className="support-list">
            {tickets.length === 0 ? <p className="muted">{t('support.empty')}</p> : tickets.map((ticket) => (
              <button key={ticket.id} className={`support-list-item ${selected?.id === ticket.id ? 'active' : ''}`} onClick={() => void loadTicket(ticket.id)}>
                <strong><span className="mono support-number" title={t('support.number')}>{ticketLabel(ticket)}</span> {ticket.subject}</strong><span className="tag">{t(`support.kind.${ticket.kind as TicketKind}`)}</span><span className="muted">{t(`support.status.${ticket.status}`)} · {formatDate(ticket.last_message_at, locale)}</span><span className="muted">{ticket.author_login}</span>
              </button>
            ))}
          </section>
          <section className="support-thread">
            {!selected ? <p className="muted">{t('support.select')}</p> : <>
              <div className="support-thread-head"><div><h3><span className="mono support-number" title={t('support.number')}>{ticketLabel(selected)}</span> {selected.subject}</h3><p className="muted">{selected.author_login} · {t(`support.kind.${selected.kind as TicketKind}`)} · {t(`support.status.${selected.status}`)}</p></div><div className="row-actions"><button onClick={() => void action(() => api.support.assign(selected.id))} disabled={busy || !!selected.assignee_user_id}>{t('support.assign')}</button>{selected.status === 'closed' ? <button onClick={() => void action(() => api.support.reopen(selected.id))} disabled={busy}>{t('support.reopen')}</button> : <button className="danger" onClick={() => void action(() => api.support.close(selected.id))} disabled={busy}>{t('support.close')}</button>}</div></div>
              <div className="support-messages">{messages.map((message) => <article key={message.id} className={`support-message ${message.author_role}`}><div className="muted">{message.author_login} · {formatDate(message.created_at, locale)}</div><div>{message.body}</div></article>)}</div>
              <div className="support-reply"><textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t('support.reply.placeholder')} /><button className="primary" onClick={() => void send()} disabled={busy || !reply.trim()}>{t('support.reply')}</button></div>
            </>}
          </section>
        </div>
      </main>
    </div>
  );
}
