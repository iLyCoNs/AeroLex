-- Execute once in Supabase SQL editor. No case data or passwords are stored here.
create table if not exists public.desktop_licenses (
 id uuid primary key, email text not null unique, display_name text not null,
 status text not null default 'trial' check (status in ('trial','active','suspended')),
 expires_at timestamptz not null, revision bigint not null default 1,
 activation_hash text unique, activation_expires_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.desktop_license_devices (
 token_hash text primary key, license_id uuid not null references public.desktop_licenses(id),
 revoked boolean not null default false, created_at timestamptz not null default now(), last_seen_at timestamptz
);
create table if not exists public.desktop_license_audit (
 request_id uuid primary key, license_id uuid not null references public.desktop_licenses(id),
 operation text not null, days integer not null default 0, created_at timestamptz not null default now()
);
alter table public.desktop_licenses enable row level security;
alter table public.desktop_license_devices enable row level security;
alter table public.desktop_license_audit enable row level security;
revoke all on public.desktop_licenses, public.desktop_license_devices, public.desktop_license_audit from anon, authenticated;
grant all on public.desktop_licenses, public.desktop_license_devices, public.desktop_license_audit to service_role;

create or replace function public.desktop_license_admin(p_id uuid, p_request_id uuid, p_operation text, p_days integer, p_email text, p_name text, p_code_hash text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare item desktop_licenses; previous desktop_license_audit;
begin
 if p_operation not in ('create','extend','suspend','resume','activation','revoke') then raise exception 'invalid operation'; end if;
 if p_operation in ('create','extend') and (p_days < 1 or p_days > 3650) then raise exception 'invalid days'; end if;
 if p_operation = 'create' then
   insert into desktop_licenses(id,email,display_name,expires_at,activation_hash,activation_expires_at)
   values(p_id,lower(trim(p_email)),trim(p_name),now()+make_interval(days=>p_days),p_code_hash,now()+interval '7 days') on conflict(id) do nothing;
 end if;
 select * into item from desktop_licenses where id=p_id for update;
 if not found then raise exception 'not found'; end if;
 select * into previous from desktop_license_audit where request_id=p_request_id;
 if found then
   if previous.license_id <> p_id or previous.operation <> p_operation or previous.days <> p_days then raise exception 'request conflict'; end if;
   return to_jsonb(item) - 'activation_hash';
 end if;
 if p_operation = 'extend' then
   update desktop_licenses set expires_at=greatest(expires_at,now())+make_interval(days=>p_days), revision=revision+1 where id=p_id;
 elsif p_operation in ('suspend','resume') then
   update desktop_licenses set status=case when p_operation='suspend' then 'suspended' else 'trial' end,revision=revision+1 where id=p_id;
 elsif p_operation = 'activation' then
   update desktop_licenses set activation_hash=p_code_hash,activation_expires_at=now()+interval '7 days',revision=revision+1 where id=p_id;
 elsif p_operation = 'revoke' then
   update desktop_license_devices set revoked=true where license_id=p_id;
   update desktop_licenses set activation_hash=null,revision=revision+1 where id=p_id;
 end if;
 insert into desktop_license_audit(request_id,license_id,operation,days) values(p_request_id,p_id,p_operation,p_days);
 select * into item from desktop_licenses where id=p_id;
 return to_jsonb(item) - 'activation_hash';
end $$;

create or replace function public.desktop_license_activate(p_code_hash text,p_email text,p_token_hash text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare item desktop_licenses;
begin
 select * into item from desktop_licenses where activation_hash=p_code_hash and email=lower(trim(p_email)) and activation_expires_at>now() for update;
 if not found then return null; end if;
 insert into desktop_license_devices(token_hash,license_id) values(p_token_hash,item.id);
 update desktop_licenses set activation_hash=null,activation_expires_at=null where id=item.id;
 return to_jsonb(item) - 'activation_hash';
end $$;

create or replace function public.desktop_license_sync(p_token_hash text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare item desktop_licenses;
begin
 select l.* into item from desktop_licenses l join desktop_license_devices d on d.license_id=l.id where d.token_hash=p_token_hash and not d.revoked;
 if not found then return null; end if;
 update desktop_license_devices set last_seen_at=now() where token_hash=p_token_hash;
 return to_jsonb(item) - 'activation_hash';
end $$;
revoke all on function public.desktop_license_admin(uuid,uuid,text,integer,text,text,text), public.desktop_license_activate(text,text,text), public.desktop_license_sync(text) from public,anon,authenticated;
grant execute on function public.desktop_license_admin(uuid,uuid,text,integer,text,text,text), public.desktop_license_activate(text,text,text), public.desktop_license_sync(text) to service_role;
