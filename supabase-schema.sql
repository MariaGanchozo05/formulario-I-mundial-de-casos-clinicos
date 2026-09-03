-- Ejecutar en Supabase > SQL Editor antes de usar los formularios.
create table if not exists public.casos (
  id uuid primary key default gen_random_uuid(),
  modalidad text not null check (modalidad in ('Póster Científico', 'Ponencia Oral')),
  tipo_caso text not null,
  area text not null,
  titulo text not null,
  datos jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.evaluaciones (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references public.casos(id),
  jurado text not null,
  categoria text not null default '',
  puntaje numeric not null,
  puntaje_maximo numeric not null,
  criterios jsonb not null default '{}'::jsonb,
  observaciones text not null default '',
  fecha_evaluacion date,
  created_at timestamptz not null default now()
);

alter table public.casos enable row level security;
alter table public.evaluaciones enable row level security;

create policy "Permitir insertar casos"
  on public.casos for insert to anon with check (true);
create policy "Permitir consultar casos"
  on public.casos for select to anon using (true);
create policy "Permitir insertar evaluaciones"
  on public.evaluaciones for insert to anon with check (true);
create policy "Permitir consultar evaluaciones"
  on public.evaluaciones for select to anon using (true);
