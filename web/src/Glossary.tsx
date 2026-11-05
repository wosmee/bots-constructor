// Глоссарий: «переменная», «ветка», «webhook», «сценарий» встречаются по всему
// интерфейсу и нигде не объясняются. Термин кликабелен и открывает поповер с
// одним предложением. Тексты — из словаря, поэтому работают и в EN.
import { useCallback, useEffect, useState } from 'react';
import { useT } from './i18n';
import type { TKey } from './i18n';
import { useExitAnimation } from './useExitAnimation';

export interface GlossaryTerm {
  id: string;
  term: TKey;
  text: TKey;
  /** Категория для группировки в списке словаря (Guide). */
  group: 'scenario' | 'telegram' | 'commerce' | 'referral' | 'payments' | 'audience' | 'library' | 'mini';
}

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  // --- сценарий ---
  { id: 'var', term: 'glossary.var', text: 'glossary.var.text', group: 'scenario' },
  { id: 'branch', term: 'glossary.branch', text: 'glossary.branch.text', group: 'scenario' },
  { id: 'scenario', term: 'glossary.scenario', text: 'glossary.scenario.text', group: 'scenario' },
  { id: 'webhook', term: 'glossary.webhook', text: 'glossary.webhook.text', group: 'scenario' },
  { id: 'scenblock', term: 'glossary.scenblock', text: 'glossary.scenblock.text', group: 'scenario' },
  { id: 'edge', term: 'glossary.edge', text: 'glossary.edge.text', group: 'scenario' },
  { id: 'fallback', term: 'glossary.fallback', text: 'glossary.fallback.text', group: 'scenario' },
  { id: 'snapshot', term: 'glossary.snapshot', text: 'glossary.snapshot.text', group: 'scenario' },
  { id: 'version', term: 'glossary.version', text: 'glossary.version.text', group: 'scenario' },
  { id: 'publish', term: 'glossary.publish', text: 'glossary.publish.text', group: 'scenario' },
  { id: 'validation', term: 'glossary.validation', text: 'glossary.validation.text', group: 'scenario' },
  { id: 'dryrun', term: 'glossary.dryrun', text: 'glossary.dryrun.text', group: 'scenario' },
  { id: 'backedge', term: 'glossary.backedge', text: 'glossary.backedge.text', group: 'scenario' },
  { id: 'counter', term: 'glossary.counter', text: 'glossary.counter.text', group: 'scenario' },
  // --- Telegram ---
  { id: 'polling', term: 'glossary.polling', text: 'glossary.polling.text', group: 'telegram' },
  { id: 'update', term: 'glossary.update', text: 'glossary.update.text', group: 'telegram' },
  { id: 'command', term: 'glossary.command', text: 'glossary.command.text', group: 'telegram' },
  { id: 'deeplink', term: 'glossary.deeplink', text: 'glossary.deeplink.text', group: 'telegram' },
  { id: 'startparam', term: 'glossary.startparam', text: 'glossary.startparam.text', group: 'telegram' },
  { id: 'inlinequery', term: 'glossary.inlinequery', text: 'glossary.inlinequery.text', group: 'telegram' },
  { id: 'callbackquery', term: 'glossary.callbackquery', text: 'glossary.callbackquery.text', group: 'telegram' },
  { id: 'sendmessage', term: 'glossary.sendmessage', text: 'glossary.sendmessage.text', group: 'telegram' },
  { id: 'editmessage', term: 'glossary.editmessage', text: 'glossary.editmessage.text', group: 'telegram' },
  { id: 'answercallbackquery', term: 'glossary.answercallbackquery', text: 'glossary.answercallbackquery.text', group: 'telegram' },
  { id: 'setmycommands', term: 'glossary.setmycommands', text: 'glossary.setmycommands.text', group: 'telegram' },
  { id: 'getchatmember', term: 'glossary.getchatmember', text: 'glossary.getchatmember.text', group: 'telegram' },
  { id: 'chattype', term: 'glossary.chattype', text: 'glossary.chattype.text', group: 'telegram' },
  { id: 'chatid', term: 'glossary.chatid', text: 'glossary.chatid.text', group: 'telegram' },
  { id: 'chataction', term: 'glossary.chataction', text: 'glossary.chataction.text', group: 'telegram' },
  { id: 'pollanswer', term: 'glossary.pollanswer', text: 'glossary.pollanswer.text', group: 'telegram' },
  { id: 'messageid', term: 'glossary.messageid', text: 'glossary.messageid.text', group: 'telegram' },
  { id: 'cbtoast', term: 'glossary.cbtoast', text: 'glossary.cbtoast.text', group: 'telegram' },
  { id: 'editvssend', term: 'glossary.editvssend', text: 'glossary.editvssend.text', group: 'telegram' },
  // --- коммерция ---
  { id: 'invoice', term: 'glossary.invoice', text: 'glossary.invoice.text', group: 'commerce' },
  { id: 'sendinvoice', term: 'glossary.sendinvoice', text: 'glossary.sendinvoice.text', group: 'commerce' },
  { id: 'precheckout', term: 'glossary.precheckout', text: 'glossary.precheckout.text', group: 'commerce' },
  { id: 'successfulpayment', term: 'glossary.successfulpayment', text: 'glossary.successfulpayment.text', group: 'commerce' },
  { id: 'providertoken', term: 'glossary.providertoken', text: 'glossary.providertoken.text', group: 'commerce' },
  { id: 'payload', term: 'glossary.payload', text: 'glossary.payload.text', group: 'commerce' },
  // --- рефералы ---
  { id: 'referrer', term: 'glossary.referrer', text: 'glossary.referrer.text', group: 'referral' },
  { id: 'referee', term: 'glossary.referee', text: 'glossary.referee.text', group: 'referral' },
  { id: 'reflink', term: 'glossary.reflink', text: 'glossary.reflink.text', group: 'referral' },
  { id: 'attribution', term: 'glossary.attribution', text: 'glossary.attribution.text', group: 'referral' },
  { id: 'antifraud', term: 'glossary.antifraud', text: 'glossary.antifraud.text', group: 'referral' },
  { id: 'multilevel', term: 'glossary.multilevel', text: 'glossary.multilevel.text', group: 'referral' },
  // --- платёжный провайдер (своя платёжка, набор 2026-09) ---
  { id: 'checkoutlink', term: 'glossary.checkoutlink', text: 'glossary.checkoutlink.text', group: 'payments' },
  { id: 'providersig', term: 'glossary.providersig', text: 'glossary.providersig.text', group: 'payments' },
  { id: 'idempotency', term: 'glossary.idempotency', text: 'glossary.idempotency.text', group: 'payments' },
  // --- аудитория ---
  { id: 'segment', term: 'glossary.segment', text: 'glossary.segment.text', group: 'audience' },
  // --- библиотека фрагментов (подсценарии) ---
  { id: 'subflow', term: 'glossary.subflow', text: 'glossary.subflow.text', group: 'library' },
  { id: 'revision', term: 'glossary.revision', text: 'glossary.revision.text', group: 'library' },
  { id: 'callsite', term: 'glossary.callsite', text: 'glossary.callsite.text', group: 'library' },
  { id: 'subflowio', term: 'glossary.subflowio', text: 'glossary.subflowio.text', group: 'library' },
  { id: 'scope', term: 'glossary.scope', text: 'glossary.scope.text', group: 'library' },
  { id: 'expansion', term: 'glossary.expansion', text: 'glossary.expansion.text', group: 'library' },
  { id: 'danglingref', term: 'glossary.danglingref', text: 'glossary.danglingref.text', group: 'library' },
  { id: 'subflowcycle', term: 'glossary.subflowcycle', text: 'glossary.subflowcycle.text', group: 'library' },
  { id: 'drillin', term: 'glossary.drillin', text: 'glossary.drillin.text', group: 'library' },
  { id: 'pinnedrev', term: 'glossary.pinnedrev', text: 'glossary.pinnedrev.text', group: 'library' },
  // --- мини-аппы (справочный слой фазы C) ---
  { id: 'miniapp', term: 'glossary.miniapp', text: 'glossary.miniapp.text', group: 'mini' },
  { id: 'tabbar', term: 'glossary.tabbar', text: 'glossary.tabbar.text', group: 'mini' },
  { id: 'slug', term: 'glossary.slug', text: 'glossary.slug.text', group: 'mini' },
  { id: 'accessrule', term: 'glossary.accessrule', text: 'glossary.accessrule.text', group: 'mini' },
  { id: 'initdata', term: 'glossary.initdata', text: 'glossary.initdata.text', group: 'mini' },
  { id: 'datatable', term: 'glossary.datatable', text: 'glossary.datatable.text', group: 'mini' },
  { id: 'elaction', term: 'glossary.elaction', text: 'glossary.elaction.text', group: 'mini' },
  { id: 'ministartparam', term: 'glossary.ministartparam', text: 'glossary.ministartparam.text', group: 'mini' },
  { id: 'minirevision', term: 'glossary.minirevision', text: 'glossary.minirevision.text', group: 'mini' },
  { id: 'visiblewhen', term: 'glossary.visiblewhen', text: 'glossary.visiblewhen.text', group: 'mini' },
  { id: 'filebase', term: 'glossary.filebase', text: 'glossary.filebase.text', group: 'mini' },
];

// Заголовки категорий словаря — ключи i18n, чтобы список читался на обоих языках.
export const GLOSSARY_GROUPS: { id: GlossaryTerm['group']; title: TKey }[] = [
  { id: 'scenario', title: 'glossary.group.scenario' },
  { id: 'telegram', title: 'glossary.group.telegram' },
  { id: 'commerce', title: 'glossary.group.commerce' },
  { id: 'payments', title: 'glossary.group.payments' },
  { id: 'referral', title: 'glossary.group.referral' },
  { id: 'audience', title: 'glossary.group.audience' },
  { id: 'library', title: 'glossary.group.library' },
  { id: 'mini', title: 'glossary.group.mini' },
];

// Термин внутри текста: подчёркнут, кликабелен, открывает объяснение рядом с
// собой. Поповер закрывается по клику вне и по Escape — как остальные в
// приложении, чтобы не было второго поведения на ту же ситуацию.
export function Term({
  id,
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  id: string;
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const [localOpen, setLocalOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : localOpen;
  const setOpen = useCallback((value: boolean) => {
    if (!controlled) setLocalOpen(value);
    onOpenChange?.(value);
  }, [controlled, onOpenChange]);
  // Поповер живёт по условию `{open && …}`: без этого хука он исчезал
  // мгновенно, пока остальные поверхности выезжали.
  const { mounted, closing } = useExitAnimation(open);
  const entry = GLOSSARY_TERMS.find((g) => g.id === id);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, controlled, setOpen]);

  if (!entry) return <>{children}</>;
  return (
    <span className="term-wrap" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="term" aria-expanded={open} onClick={() => setOpen(!open)}>
        {children ?? t(entry.term)}
      </button>
      {mounted && (
        <span className={`term-pop${closing ? ' is-closing' : ''}`} role="tooltip">
          <b>{t(entry.term)}</b> — {t(entry.text)}
        </span>
      )}
    </span>
  );
}
