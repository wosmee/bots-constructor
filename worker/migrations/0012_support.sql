-- 0012: in-app support desk tickets and threaded messages.
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  author_user_id TEXT NOT NULL,
  author_login TEXT NOT NULL,
  bot_id TEXT,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new', 'in_progress', 'closed')),
  assignee_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status_message ON support_tickets(status, last_message_at);
CREATE INDEX IF NOT EXISTS idx_support_tickets_author_message ON support_tickets(author_user_id, last_message_at);

CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  author_role TEXT NOT NULL CHECK (author_role IN ('user', 'staff')),
  author_user_id TEXT NOT NULL,
  author_login TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created ON support_messages(ticket_id, created_at);
