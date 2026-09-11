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

-- ════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 2026-09-11 — UN CASO = UNA FILA (tres jurados por caso)
--
-- Problema: cada jurado que guardaba un caso creaba una fila nueva en
-- `casos`, así que el mismo caso aparecía tres veces en resultados.html con
-- un solo puntaje cada una, en vez de una vez con el promedio de los tres.
-- Los formularios ahora hacen buscar-o-insertar; estos índices son la red de
-- seguridad ante dos jurados que guardan en el mismo instante.
--
-- EJECUTAR UNA SOLA VEZ en el SQL Editor de Supabase:
-- ════════════════════════════════════════════════════════════════════════

-- 1) Título normalizado: el póster no tiene lista fija de títulos, así que su
--    identidad es el título sin mayúsculas ni espacios sobrantes. Columna
--    generada: se calcula sola, los formularios nunca la escriben.
--    normalizarTitulo() en formulario-poster.html debe dar el mismo resultado.
alter table public.casos
  add column if not exists titulo_norm text
  generated always as (lower(btrim(regexp_replace(titulo, '\s+', ' ', 'g')))) stored;

-- 2) Ponencia Oral: el caso se identifica por tipo de caso + servicio, porque
--    el título se autocompleta desde una lista fija (uno por combinación).
create unique index if not exists casos_ponencia_unica
  on public.casos (tipo_caso, area)
  where modalidad = 'Ponencia Oral';

-- 3) Póster Científico: tipo_caso y area valen 'No aplica', así que el caso se
--    identifica por su título normalizado.
create unique index if not exists casos_poster_unico
  on public.casos (titulo_norm)
  where modalidad = 'Póster Científico';

-- 4) Un jurado no puede calificar dos veces el mismo caso: un guardado
--    repetido falsearía el promedio y no hay política de UPDATE/DELETE para
--    corregirlo desde el formulario.
--    Se normalizan tambien los espacios INTERNOS: btrim solo quita los de los
--    extremos, asi que "Dr.  Juan" y "Dr. Juan" pasaban como dos jurados
--    distintos (detectado el 2026-09-11 con datos reales).
create unique index if not exists evaluaciones_jurado_caso_unica
  on public.evaluaciones (caso_id, lower(btrim(regexp_replace(jurado_nombre, '\s+', ' ', 'g'))));

-- 5) La FK de PostgreSQL no crea índice; resultados.html une por caso_id.
create index if not exists evaluaciones_caso_id_idx
  on public.evaluaciones (caso_id);

-- 6) Las cuatro categorías oficiales del póster (reemplaza al CHECK que quedó
--    comentado más arriba). NOT VALID evita fallar si hubiera filas previas.
alter table public.casos
  drop constraint if exists casos_categoria_participante_check;
alter table public.casos
  add constraint casos_categoria_participante_check
  check (categoria_participante is null
         or categoria_participante in ('Profesional','Internado','Externado','Posgrado'))
  not valid;

-- Nota: `casos.titulo` conserva el texto del PRIMER jurado que registró el
-- caso; los siguientes reutilizan la fila y su título no se escribe. En
-- Ponencia da igual (viene de la lista fija); en Póster es intencional para
-- no tener un título cambiando según quién guarda de último.

-- ════════════════════════════════════════════════════════════════════════
-- CORRECCIONES 2026-09-11 (verificadas contra producción por REST)
-- ════════════════════════════════════════════════════════════════════════

-- El proyecto tenía un CHECK que limitaba tipo_caso a los tres tipos de
-- ponencia. El póster guarda 'No aplica' (la columna es NOT NULL y ese
-- formulario no pregunta el tipo), así que NINGÚN póster podía guardarse.
alter table public.casos drop constraint if exists casos_tipo_caso_check;
alter table public.casos
  add constraint casos_tipo_caso_check
  check (tipo_caso in ('Medicina','Enfermería','Nutrición','No aplica'));

-- La unicidad del jurado estaba como constraint UNIQUE sobre jurado_nombre en
-- crudo; una constraint no admite expresiones, así que "Dr. Juan" y "dr.  juan"
-- contaban dos veces. Debe ser un ÍNDICE con expresión (ojo: para soltar la
-- constraint hace falta `alter table ... drop constraint`, no `drop index`).
alter table public.evaluaciones drop constraint if exists evaluaciones_caso_jurado_unique;
drop index if exists public.evaluaciones_jurado_caso_unica;
create unique index if not exists evaluaciones_jurado_caso_unica
  on public.evaluaciones (caso_id, lower(btrim(regexp_replace(jurado_nombre, '\s+', ' ', 'g'))));
