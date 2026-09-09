# Información del proyecto

- Sitio estático con HTML, CSS y JavaScript integrado en cada página; no requiere compilación.
- Los formularios de Ponencia y Póster comparten estructura (jurado, título, criterios, cola de casos) pero piden datos distintos del caso:
  - Ponencia: tipo de caso (Medicina/Enfermería/Nutrición) + servicio hospitalario. Compite por servicio en `resultados.html`; no registra categoría del participante.
  - Póster: categoría del participante (Profesional/Internado/Externado/Posgrado). Compite por categoría; guarda `tipo_caso` y `area` con el valor fijo `'No aplica'` porque son `NOT NULL` en la BD.
  - Los cambios en las partes compartidas deben verificarse en ambos.
- Ningún formulario pide ya la categoría profesional del jurado; `evaluaciones.categoria_jurado` queda `null` en registros nuevos.
- `resultados.html` solo tiene las pestañas Póster y Ponencia (sin "Todos" ni sección de ganadores); los filtros aplican a la tabla visible.
- Ejecutar `node --test test-formularios.cjs` para comprobar los campos de cada formulario, sus validaciones, el payload de guardado, el reinicio de sesión y la estructura de `resultados.html`. Las pruebas usan DOM y Supabase simulados, sin dependencias externas ni escrituras en producción.
- Ejecutar `git diff --check` para detectar problemas de espacios en los cambios.
- El esquema de referencia está en `supabase-schema.sql`. `casos.categoria_participante` se usa en el ranking de póster.
