-- ZCashed Supabase Schema
-- Run this in the Supabase SQL editor after provisioning.

create table if not exists profiles (
  address text primary key,
  display_name text not null default '',
  role text not null default 'freelancer' check (role in ('freelancer','client','admin')),
  bio text not null default '',
  skills text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id text primary key,
  title text not null,
  description text not null,
  category text not null default 'Other',
  budget_zec numeric not null,
  assignment_mode text not null default 'application' check (assignment_mode in ('direct','application')),
  client_address text not null,
  escrow_address text not null,
  escrow_privkey text not null,
  worker_address text not null default '',
  status text not null default 'open',
  genlayer_contract_address text not null default '',
  deadline timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists applications (
  id text primary key,
  job_id text not null references jobs(id) on delete cascade,
  applicant_address text not null,
  applicant_name text not null default '',
  cover_letter text not null default '',
  proposed_price numeric not null default 0,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now()
);

create table if not exists submissions (
  id text primary key,
  job_id text not null references jobs(id) on delete cascade,
  worker_address text not null,
  submission_url text not null,
  notes text not null default '',
  status text not null default 'pending',
  ai_feedback text not null default '',
  attempt int not null default 1,
  genlayer_tx_hash text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id text primary key,
  recipient_address text not null,
  type text not null,
  title text not null,
  body text not null default '',
  link text not null default '',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_jobs_client on jobs(client_address);
create index if not exists idx_jobs_worker on jobs(worker_address);
create index if not exists idx_jobs_status on jobs(status);
create index if not exists idx_applications_job on applications(job_id);
create index if not exists idx_applications_applicant on applications(applicant_address);
create index if not exists idx_submissions_job on submissions(job_id);
create index if not exists idx_notifications_recipient on notifications(recipient_address);

-- Demo: open row-level access (tighten for production with auth)
alter table profiles enable row level security;
alter table jobs enable row level security;
alter table applications enable row level security;
alter table submissions enable row level security;
alter table notifications enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'public_all') then
    create policy public_all on profiles for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'jobs' and policyname = 'public_all') then
    create policy public_all on jobs for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'applications' and policyname = 'public_all') then
    create policy public_all on applications for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'submissions' and policyname = 'public_all') then
    create policy public_all on submissions for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'notifications' and policyname = 'public_all') then
    create policy public_all on notifications for all using (true) with check (true);
  end if;
end $$;
