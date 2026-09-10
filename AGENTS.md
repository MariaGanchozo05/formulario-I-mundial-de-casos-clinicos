# Información del proyecto

- Sitio estático con HTML, CSS y JavaScript integrado en cada página; no requiere compilación.
- Los formularios de Ponencia y Póster comparten estructura (jurado, título, criterios, cola de casos) pero piden datos distintos del caso:
  - Ponencia: tipo de caso (Medicina/Enfermería/Nutrición) + servicio hospitalario. En `resultados.html` cada caso ocupa su propia fila con puntaje y porcentaje individual, en un ranking global sin agrupar por servicio; no registra categoría del participante.
  - Póster: categoría del participante (Profesional/Internado/Externado/Posgrado). Compite por categoría; guarda `tipo_caso` y `area` con el valor fijo `'No aplica'` porque son `NOT NULL` en la BD.
  - Los cambios en las partes compartidas deben verificarse en ambos.
- Ningún formulario pide ya la categoría profesional del jurado; `evaluaciones.categoria_jurado` queda `null` en registros nuevos.
- `resultados.html` solo tiene las pestañas Póster y Ponencia (sin "Todos" ni sección de ganadores); los filtros aplican a la tabla visible.
- La columna Jurados de ambas tablas muestra el conteo y los nombres visibles, uno por evaluación, no solo en el tooltip; si falta un nombre, muestra "Sin nombre registrado". Se conserva esta información al imprimir.
- El filtro de categoría solo se muestra y aplica en Póster; el de servicio (`filterArea`) solo en Ponencia, con las mismas opciones que `areaServicio` del formulario. Ambos conservan su selección al cambiar de pestaña y se combinan con la búsqueda y el orden; el CSV respeta los filtros activos.
- Ejecutar `node --test test-formularios.cjs` para comprobar los campos de cada formulario, sus validaciones, el payload de guardado, el reinicio de sesión, la estructura de `resultados.html`, los filtros por pestaña y la exportación CSV filtrada. Las pruebas usan DOM y Supabase simulados, sin dependencias externas ni escrituras en producción.
- Ejecutar `git diff --check` para detectar problemas de espacios en los cambios.
- El esquema de referencia está en `supabase-schema.sql`. `casos.categoria_participante` se usa en el ranking de póster.

# Estilos

- Tipografía: `Geist` (Google Fonts) en las cuatro páginas; los puntajes y posiciones usan `font-variant-numeric: tabular-nums`.
- Tokens compartidos en `:root` de cada página: `--primary` (#123b5d, institucional), `--accent` (#0b7a75, Póster), `--accent2` (#584c99, Ponencia; indigo desaturado, no usar violetas saturados), grises `--text/--text-soft/--text-muted`, `--surface-2`, `--border/--border-soft`, sombras `--shadow-sm/md/lg` teñidas con el azul primario (nunca negro puro), radios `--radius-sm/md/lg` (8/12/16 px) y `--z-sticky/--z-modal`.
- Todo elemento interactivo debe tener estado `:hover`, `:active` (leve `scale`) y `:focus-visible`; se respeta `prefers-reduced-motion`.
- Las reglas de impresión (`@media print`) al final de cada `<style>` se usan también por `html2pdf`; al cambiar el estado marcado de `.option` verificar que siga siendo legible en papel.
- Comprobación visual rápida: `python3 -m http.server 8765` y capturas con `google-chrome --headless=new --screenshot=... --window-size=1280,1400 http://localhost:8765/<pagina>.html`.
