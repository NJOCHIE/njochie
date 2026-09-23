create extension if not exists pgcrypto;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  title text not null,
  message text not null,
  question text not null,
  answer_hash text not null,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  attempts integer not null default 0,
  max_views integer not null default 1 check (max_views between 1 and 100),
  views integer not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists messages_creator_id_idx on public.messages(creator_id);
create index if not exists messages_token_idx on public.messages(token);

alter table public.messages enable row level security;

create or replace function public.reveal_message(p_token text, p_answer text)
returns table(status text, title text, message text, error_message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.messages%rowtype;
  hashed text;
begin
  select * into m from public.messages where messages.token = p_token for update;
  if not found then
    return query select 'not_found', null::text, null::text, 'This Njochie message does not exist.';
    return;
  end if;
  if not m.active then
    return query select 'disabled', null::text, null::text, 'This message has been disabled.';
    return;
  end if;
  if m.expires_at is not null and m.expires_at <= now() then
    return query select 'expired', null::text, null::text, 'This message has expired.';
    return;
  end if;
  if m.views >= m.max_views then
    return query select 'view_limit', null::text, null::text, 'This message has already reached its view limit.';
    return;
  end if;
  if m.attempts >= m.max_attempts then
    return query select 'attempt_limit', null::text, null::text, 'Too many incorrect attempts.';
    return;
  end if;

  hashed := encode(digest(lower(trim(p_answer)), 'sha256'), 'hex');
  if hashed = m.answer_hash then
    update public.messages set views = views + 1 where id = m.id;
    return query select 'revealed', m.title, m.message, null::text;
  end if;

  update public.messages set attempts = attempts + 1 where id = m.id;
  if m.attempts + 1 >= m.max_attempts then
    return query select 'attempt_limit', null::text, null::text, 'Too many incorrect attempts.';
  else
    return query select 'wrong_answer', null::text, null::text,
      format('That answer is not correct. %s attempt(s) remaining.', m.max_attempts - (m.attempts + 1));
  end if;
end;
$$;

revoke all on function public.reveal_message(text, text) from public;
grant execute on function public.reveal_message(text, text) to service_role;
