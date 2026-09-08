# Información del proyecto

- Sitio estático con HTML, CSS y JavaScript integrado en cada página; no requiere compilación.
- Los formularios de Ponencia y Póster mantienen implementaciones paralelas. Los cambios comunes deben verificarse en ambos.
- Ejecutar `node --test test-categoria-jurado.cjs` para comprobar la categoría del jurado, su validación, el payload de guardado y el reinicio de sesión. Las pruebas usan DOM y Supabase simulados, sin dependencias externas ni escrituras en producción.
- Ejecutar `git diff --check` para detectar problemas de espacios en los cambios.
- El esquema de referencia está en `supabase-schema.sql`. `evaluaciones.categoria_jurado` es texto libre y es independiente de `casos.categoria_participante`, que se usa en el ranking.
