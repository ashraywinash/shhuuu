-- Whispr initial schema
-- Message bodies, event types, reactions, receipts, filenames, and MIME types are
-- stored only inside client-side AES-GCM ciphertext.

begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  public_key jsonb not null,
  created_at timestamptz not null default now(),
  constraint valid_username check (
    username = lower(username)
    and username ~ '^[a-z0-9_]{3,24}$'
  )
);

create index profiles_username_prefix_idx on public.profiles (username text_pattern_ops);

create table public.key_vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_private_key text not null,
  private_key_iv text not null,
  private_key_salt text not null,
  key_version smallint not null default 1 check (key_version = 1),
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  pair_key text generated always as (
    least(user_a::text, user_b::text) || ':' || greatest(user_a::text, user_b::text)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint different_participants check (user_a <> user_b),
  constraint unique_direct_conversation unique (pair_key)
);

create index conversations_user_a_updated_idx on public.conversations (user_a, updated_at desc);
create index conversations_user_b_updated_idx on public.conversations (user_b, updated_at desc);

create table public.messages (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  ciphertext text not null check (length(ciphertext) between 16 and 262144),
  iv text not null check (length(iv) between 12 and 32),
  created_at timestamptz not null default now()
);

create index messages_conversation_created_idx on public.messages (conversation_id, created_at);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_username text := lower(trim(new.raw_user_meta_data ->> 'username'));
  public_jwk jsonb := new.raw_user_meta_data -> 'public_key';
begin
  if chosen_username is null or chosen_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'invalid pseudonym';
  end if;
  if public_jwk is null or jsonb_typeof(public_jwk) <> 'object' then
    raise exception 'missing public encryption key';
  end if;

  insert into public.profiles (id, username, public_key)
  values (new.id, chosen_username, public_jwk);

  insert into public.key_vaults (
    user_id, encrypted_private_key, private_key_iv, private_key_salt, key_version
  ) values (
    new.id,
    new.raw_user_meta_data ->> 'encrypted_private_key',
    new.raw_user_meta_data ->> 'private_key_iv',
    new.raw_user_meta_data ->> 'private_key_salt',
    coalesce((new.raw_user_meta_data ->> 'key_version')::smallint, 1)
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.create_direct_conversation(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  result_id uuid;
begin
  if caller is null then raise exception 'authentication required'; end if;
  if other_user is null or other_user = caller then raise exception 'invalid participant'; end if;
  if not exists (select 1 from public.profiles where id = other_user) then
    raise exception 'participant not found';
  end if;

  insert into public.conversations (user_a, user_b)
  values (caller, other_user)
  on conflict (pair_key) do update set updated_at = public.conversations.updated_at
  returning id into result_id;

  return result_id;
end;
$$;

revoke all on function public.create_direct_conversation(uuid) from public;
grant execute on function public.create_direct_conversation(uuid) to authenticated;

create or replace function private.is_conversation_member(channel_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversations conversation
    where channel_topic = 'conversation:' || conversation.id::text
      and auth.uid() in (conversation.user_a, conversation.user_b)
  );
$$;

revoke all on function private.is_conversation_member(text) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_conversation_member(text) to authenticated;

create or replace function private.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set updated_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

create trigger on_message_inserted
  after insert on public.messages
  for each row execute function private.touch_conversation();

alter table public.profiles enable row level security;
alter table public.key_vaults enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "authenticated people can search profiles"
on public.profiles for select to authenticated
using ((select auth.uid()) is not null);

create policy "people can read only their own key vault"
on public.key_vaults for select to authenticated
using ((select auth.uid()) = user_id);

create policy "participants can read conversations"
on public.conversations for select to authenticated
using ((select auth.uid()) in (user_a, user_b));

create policy "participants can read encrypted messages"
on public.messages for select to authenticated
using (private.is_conversation_member('conversation:' || conversation_id::text));

create policy "participants can insert encrypted messages"
on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and private.is_conversation_member('conversation:' || conversation_id::text)
);

revoke all on public.profiles, public.key_vaults, public.conversations, public.messages from anon;
grant select on public.profiles, public.key_vaults, public.conversations to authenticated;
grant select, insert on public.messages to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('encrypted-media', 'encrypted-media', false, 26215424, array['application/octet-stream'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "participants can download encrypted media"
on storage.objects for select to authenticated
using (
  bucket_id = 'encrypted-media'
  and private.is_conversation_member('conversation:' || (storage.foldername(name))[1])
);

create policy "participants can upload encrypted media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'encrypted-media'
  and owner_id = (select auth.uid()::text)
  and private.is_conversation_member('conversation:' || (storage.foldername(name))[1])
);

create policy "uploaders can remove encrypted media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'encrypted-media'
  and owner_id = (select auth.uid()::text)
  and private.is_conversation_member('conversation:' || (storage.foldername(name))[1])
);

alter table realtime.messages enable row level security;

create policy "participants can receive private conversation events"
on realtime.messages for select to authenticated
using (
  private.is_conversation_member((select realtime.topic()))
  and realtime.messages.extension in ('broadcast', 'presence')
);

create policy "participants can send private conversation events"
on realtime.messages for insert to authenticated
with check (
  private.is_conversation_member((select realtime.topic()))
  and realtime.messages.extension in ('broadcast', 'presence')
);

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.conversations;
exception
  when duplicate_object then null;
end;
$$;

commit;
