-- Esquema REAL verificado en el proyecto Supabase de producción (2026-09-02),
-- documentado por introspección vía REST porque difería del que había aquí antes.
-- No es necesario volver a ejecutarlo si las tablas ya existen: es solo referencia
-- para que el código HTML use los mismos nombres de columna que la base de datos.

create table if not exists public.casos (
  id uuid primary key default gen_random_uuid(),
  modalidad text not null check (modalidad in ('Póster Científico', 'Ponencia Oral')),
  tipo_caso text not null,
  area text not null,
  titulo text not null,
  dictamen text,
  observaciones_comite text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.evaluaciones (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references public.casos(id),
  jurado_nombre text not null,
  categoria_jurado text,
  fecha_evaluacion date default current_date,
  puntaje numeric not null,
  max_puntaje numeric not null,
  puntajes_criterios jsonb not null default '{}'::jsonb,
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

-- Nota: no existen políticas de UPDATE ni DELETE para el rol "anon" (verificado:
-- un DELETE con la clave publicable no borra nada). Esto es correcto y deseable:
-- el formulario público solo puede insertar y leer, nunca modificar ni borrar
-- evaluaciones ya guardadas.

-- Nota: por decisión del equipo, no se recogen ni almacenan datos del
-- expositor (identificación, profesión, institución, correo, teléfono,
-- coautores). El esquema no tiene esas columnas y los formularios HTML no
-- las piden.

-- ────────────────────────────────────────────────────────────────────────
-- MIGRACIÓN 2026-09-07 — Categoría del participante
-- Solicitada por el comité: los casos compiten en cuatro categorías
-- (Profesional, Internado, Externado, Posgrado) y gana el de mayor puntaje
-- dentro de cada categoría.
--
-- EJECUTAR UNA SOLA VEZ en el SQL Editor de Supabase:
-- ────────────────────────────────────────────────────────────────────────

alter table public.casos
  add column if not exists categoria_participante text;

-- Opcional: restringir a las cuatro categorías oficiales.
-- alter table public.casos
--   add constraint casos_categoria_participante_check
--   check (categoria_participante in ('Profesional','Internado','Externado','Posgrado'));

-- Mientras esta columna no exista, los formularios siguen guardando el caso
-- sin categoría (ver insertarCaso() en los HTML) y el panel de resultados
-- muestra esos casos como "Sin categoría".

-- Nota 2026-09-08: solo el formulario de Póster registra categoria_participante;
-- la Ponencia compite por servicio (tipo_caso + area) y guarda esta columna en
-- null. Como tipo_caso y area son NOT NULL, el Póster los guarda con el texto
-- fijo 'No aplica'. Ningún formulario envía ya evaluaciones.categoria_jurado.
