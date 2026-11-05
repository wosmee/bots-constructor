export const SUPPORT_KINDS = ['bug', 'question', 'idea', 'billing', 'abuse', 'other'] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

export const SUPPORT_STATUSES = ['new', 'in_progress', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

const SUBJECT_MIN = 3;
const SUBJECT_MAX = 140;
const BODY_MAX = 4000;

export function normalizeTicketInput(input: { kind?: unknown; subject?: unknown; body?: unknown }):
  | { kind: SupportKind; subject: string; body: string }
  | { error: 'invalid kind' | 'subject length' | 'body length' } {
  if (!SUPPORT_KINDS.includes(input.kind as SupportKind)) return { error: 'invalid kind' };
  const subject = String(input.subject ?? '').trim();
  const body = String(input.body ?? '').trim();
  if (subject.length < SUBJECT_MIN || subject.length > SUBJECT_MAX) return { error: 'subject length' };
  if (body.length < 1 || body.length > BODY_MAX) return { error: 'body length' };
  return { kind: input.kind as SupportKind, subject, body };
}

export function canAccessTicket(args: { staff: boolean; actorId: string; authorId: string }): boolean {
  return args.staff || args.actorId === args.authorId;
}

export function nextTicketStatus(current: SupportStatus, authorRole: 'user' | 'staff', assigned: boolean): SupportStatus {
  if (authorRole === 'user' && current === 'closed') return 'new';
  if (authorRole === 'staff' && current === 'new') return 'in_progress';
  if (authorRole === 'staff' && assigned && current === 'new') return 'in_progress';
  return current;
}
