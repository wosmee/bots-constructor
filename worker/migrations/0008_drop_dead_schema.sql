-- 0008: убираем мёртвую схему из самой первой миграции.
-- Таблицы users и outbox никто не читает (аккаунты живут в accounts, отложенные
-- отправки — в scheduled_sends), колонка bots.shard_id всегда писалась как 0.
-- Код перестал её трогать ДО этой миграции, поэтому рассинхрона нет.

DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS outbox;

-- SQLite 3.35+ (D1 — свежее): колонку можно дропнуть, если она не в индексе.
-- Индексов на shard_id нет ни в одной миграции.
ALTER TABLE bots DROP COLUMN shard_id;
