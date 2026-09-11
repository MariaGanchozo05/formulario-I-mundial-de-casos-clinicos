const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

// Los objetos creados dentro del contexto de vm tienen otro prototipo Object.
const plain = value => JSON.parse(JSON.stringify(value));

/* ══════════════════════════════════════════════════════════════════
   SUPABASE SIMULADO
   Reproduce en memoria lo que hace la base real: `titulo_norm` como
   columna generada y los índices únicos de supabase-schema.sql, para que
   las pruebas detecten los casos duplicados entre jurados.
══════════════════════════════════════════════════════════════════ */
const createDb = () => ({ casos: [], evaluaciones: [], seq: 0 });

const normalizar = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Devuelve la clave del índice único de la fila, o null si no le aplica ninguno.
function claveUnica(table, row) {
  if (table === 'evaluaciones') return `${row.caso_id}|${normalizar(row.jurado_nombre)}`;
  if (row.modalidad === 'Ponencia Oral') return `ponencia|${row.tipo_caso}|${row.area}`;
  if (row.modalidad === 'Póster Científico') return `poster|${row.titulo_norm}`;
  return null;
}

function createClient(db, inserts) {
  return {
    from(table) {
      const filtros = [];
      const builder = {
        select: () => builder,
        eq(columna, valor) { filtros.push([columna, valor]); return builder; },
        order: () => builder,
        limit: () => builder,
        async maybeSingle() {
          const fila = db[table].find(row => filtros.every(([c, v]) => row[c] === v));
          return { data: fila ? { id: fila.id } : null, error: null };
        },
        insert(payload) {
          inserts.push({ table, payload });
          const row = { id: `${table}-${++db.seq}`, ...JSON.parse(JSON.stringify(payload)) };
          if (table === 'casos') row.titulo_norm = normalizar(row.titulo);
          const clave = claveUnica(table, row);
          const duplicada = clave !== null && db[table].some(r => claveUnica(table, r) === clave);
          const resultado = duplicada
            ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
            : { data: { id: row.id }, error: null };
          if (!duplicada) db[table].push(row);
          const promesa = Promise.resolve(resultado);
          promesa.select = () => ({ single: async () => resultado });
          return promesa;
        }
      };
      return builder;
    }
  };
}

function loadForm(file, db = createDb(), alerts = null) {
  const html = readFileSync(join(__dirname, file), 'utf8');
  const elements = new Map();
  const events = new Map();
  const inserts = [];
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const classes = new Set();
    const attributes = new Map();
    elements.set(match[1], {
      value: '', style: {}, innerHTML: '', textContent: '', selectedIndex: -1,
      hidden: /\bhidden\b/.test(match[0]),
      disabled: /\bdisabled\b/.test(match[0]),
      required: /\brequired\b/.test(match[0]),
      classList: {
        add: value => classes.add(value),
        remove: value => classes.delete(value),
        contains: value => classes.has(value),
        toggle(value, active) { active ? classes.add(value) : classes.delete(value); }
      },
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: key => attributes.delete(key),
      addEventListener(type, callback) { events.set(`${match[1]}:${type}`, callback); },
      scrollIntoView() {}
    });
  }
  const document = {
    getElementById(id) {
      assert.ok(elements.has(id), `Missing element: ${id}`);
      return elements.get(id);
    },
    addEventListener: (type, callback) => events.set(type, callback),
    querySelectorAll(selector) {
      if (selector === '.err') return [...elements.values()].filter(el => el.classList.contains('err'));
      if (selector === '.err-msg.show') return [...elements.values()].filter(el => el.classList.contains('show'));
      return [];
    },
    querySelector: () => ({ scrollIntoView() {} })
  };
  const client = createClient(db, inserts);
  const context = vm.createContext({
    document, window: { supabase: { createClient: () => client } },
    console, setTimeout() {}, alert(message) { alerts ? alerts.push(message) : assert.fail(message); }
  });
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1], { filename: file }).runInContext(context);
  }
  events.get('DOMContentLoaded')();
  return {
    html, context, inserts, events, db, alerts,
    el: id => document.getElementById(id),
    has: id => elements.has(id),
    fillCriteria() {
      vm.runInContext('CRITERIA.forEach((item, i) => setScore(i, item[1]));', context);
    }
  };
}

for (const file of ['formulario-ponencia.html', 'formulario-poster.html']) {
  test(`${file}: ya no pide categoría profesional del jurado ni las notas retiradas`, () => {
    const form = loadForm(file);
    for (const id of ['categoriaJurado', 'categoriaJuradoOtra', 'categoriaJuradoOtraField']) {
      assert.equal(form.has(id), false, `${id} no debe existir`);
    }
    assert.doesNotMatch(form.html, /Los registros guardados no pueden editarse/);
    assert.doesNotMatch(form.html, /Seleccione la categoría del participante, el servicio y el tipo/);
    assert.doesNotMatch(form.html, /<!--\s*<(div|select|label|p|span)\b/, 'no debe quedar HTML comentado');
  });
}

for (const file of ['formulario-ponencia.html', 'formulario-poster.html']) {
  test(`${file}: confirma el fin de la evaluación con el resumen y los botones de la referencia`, () => {
    const form = loadForm(file);
    const modal = form.html.match(/<div class="modal-overlay" id="saveModal">[\s\S]*?<\/script>/)[0];
    assert.match(modal, /<h3 class="modal-title">¿Desea terminar la evaluación con los casos que ha evaluado\?<\/h3>/);
    const cancel = modal.match(/<button[^>]*class="modal-cancel"[^>]*onclick="([^"]+)"[^>]*>Cancelar<\/button>/);
    const confirm = modal.match(/<button[^>]*class="modal-confirm"[^>]*onclick="([^"]+)"[^>]*>Sí<\/button>/);
    assert.ok(cancel);
    assert.ok(confirm);

    form.el('jurado').value = 'Dra. Ana';
    vm.runInContext('sessionQueue.push({puntaje: MAX_PUNTAJE}, {puntaje: MAX_PUNTAJE - 2});', form.context);
    form.context.finalizarSesion();
    const max = file.includes('poster') ? 100 : 20;
    assert.equal(form.el('saveModal').classList.contains('active'), true);
    assert.match(form.el('modalDesc').innerHTML, /Jurado: <strong>Dra\. Ana<\/strong>/);
    assert.match(form.el('modalDesc').innerHTML, /Casos evaluados: <strong>2<\/strong>/);
    assert.ok(form.el('modalDesc').innerHTML.includes(`Puntaje promedio: <strong>${(max - 1).toFixed(1)} / ${max} pts</strong>`));
    assert.doesNotMatch(form.el('modalDesc').innerHTML, /<a\b/);

    vm.runInContext(cancel[1], form.context);
    assert.equal(form.el('saveModal').classList.contains('active'), false);
    assert.equal(form.el('jurado').value, 'Dra. Ana');
    assert.equal(vm.runInContext('sessionQueue.length', form.context), 2);

    form.context.finalizarSesion();
    vm.runInContext(confirm[1], form.context);
    assert.equal(form.el('saveModal').classList.contains('active'), false);
    assert.equal(form.el('jurado').value, '');
    assert.equal(vm.runInContext('sessionQueue.length', form.context), 0);
    assert.equal(form.el('btnGuardarTodo').disabled, true);
    assert.equal(form.inserts.length, 0);
  });
}

test('formulario-ponencia.html: autocompleta los 15 títulos oficiales actualizados', () => {
  const form = loadForm('formulario-ponencia.html');
  const casos = [
    ['Medicina', 'Pediatría', 'Glioma pediátrico de bajo grado compatible con astrocitoma pilocítico supratentorial asociado a hidrocefalia, deterioro neurológico y pérdida visual progresiva.'],
    ['Medicina', 'Ginecología y Obstetricia', 'Uropatía Obstructiva en el Embarazo asociado a Lesión Renal Aguda'],
    ['Medicina', 'Cirugía', 'PEQUEÑAS INCISIONES, GRAN TRANSFORMACIÓN: UN CASO DE PECTUS EXCAVATUM TRATADO CON TECNICA DE NUSS'],
    ['Medicina', 'Medicina Interna', 'Parálisis flácida por secuestro iónico masivo: El valor del potasio urinario frente al consumo crónico de camelia sinensis y suplementos herbarios.'],
    ['Medicina', 'Neonatología', 'HIPERAMONIEMIA NEONATAL PERSISTENTE COMO MANIFESTACIÓN INICIAL DE UN ERROR CONGÉNITO DEL METABOLISMO. PRESENTACIÓN DE CASO.'],
    ['Enfermería', 'Pediatría', 'Proceso de atención de enfermería en preescolar con neumonía adquirida en la comunidad, hipotonía muscular y secuelas neurológicas'],
    ['Enfermería', 'Ginecología y Obstetricia', 'Proceso de atención de enfermería en un preescolar con neumonía adquirida en la comunidad, hipotonía muscular y secuelas neurológicas'],
    ['Enfermería', 'Cirugía', 'Gangrena de Fournier en un paciente con paraplejía crónica secundaria, lesión medular L1-L2. Proceso de atención de enfermería.'],
    ['Enfermería', 'Medicina Interna', 'Proceso de atención de enfermería en una adulta mayor con trombocitopenia inmune y sangrado activo.'],
    ['Enfermería', 'Neonatología', 'Caso clínico de Hiperamonemia neonatal persistente'],
    ['Nutrición', 'Pediatría', 'Abordaje nutricional en paciente pediátrico con tumor benigno encefálico supratentorial y obesidad durante hospitalización'],
    ['Nutrición', 'Ginecología y Obstetricia', 'Embarazo, hidronefrosis en injuria renal aguda'],
    ['Nutrición', 'Cirugía', 'Manejo nutricional en paciente con celulitis en mano y diabetes mellitus tipo II'],
    ['Nutrición', 'Medicina Interna', 'Abordaje nutricional en paciente femenino con dengue más signos de alarma con obesidad tipo 1'],
    ['Nutrición', 'Neonatología', 'Ictericia neonatal de causa nutricional: aporte insuficiente de leche materna']
  ];
  for (const [tipo, servicio, titulo] of casos) {
    form.context.selectTipo(tipo);
    form.el('areaServicio').value = servicio;
    form.events.get('areaServicio:change')();
    assert.equal(form.el('tituloCaso').value, titulo, `${tipo}: ${servicio}`);
    assert.ok(titulo.length <= 250);
  }
});

test('formulario-ponencia.html: guarda tipo y servicio sin categoría de participante ni de jurado', async () => {
  const form = loadForm('formulario-ponencia.html');
  assert.equal(form.has('categoriaParticipante'), false);
  assert.equal(form.has('areaServicio'), true);
  assert.equal(form.has('btn-medicina'), true);

  form.el('jurado').value = 'Dra. Ana';
  form.fillCriteria();

  // Sin tipo ni servicio no se inserta nada.
  await form.context.addCaseToQueue();
  assert.equal(form.inserts.length, 0);
  assert.equal(form.el('err-tipo').style.display, 'block');
  assert.equal(form.el('areaServicio').classList.contains('err'), true);

  // El título oficial se asigna al elegir tipo de caso y servicio.
  form.context.selectTipo('Enfermería');
  assert.equal(form.el('tituloCaso').value, '');
  form.el('areaServicio').value = 'Cirugía';
  form.events.get('areaServicio:change')();
  assert.equal(form.el('tituloCaso').value, 'Gangrena de Fournier en un paciente con paraplejía crónica secundaria, lesión medular L1-L2. Proceso de atención de enfermería.');

  await form.context.addCaseToQueue();
  assert.equal(form.inserts.length, 2);
  assert.equal(form.inserts[0].table, 'casos');
  assert.deepEqual(plain(form.inserts[0].payload), {
    modalidad: 'Ponencia Oral', tipo_caso: 'Enfermería', area: 'Cirugía',
    titulo: 'Gangrena de Fournier en un paciente con paraplejía crónica secundaria, lesión medular L1-L2. Proceso de atención de enfermería.'
  });
  assert.equal(form.inserts[1].table, 'evaluaciones');
  assert.equal('categoria_jurado' in form.inserts[1].payload, false);
  assert.equal(form.inserts[1].payload.jurado_nombre, 'Dra. Ana');
  assert.equal(form.inserts[1].payload.puntaje, 20);

  // El reset del caso conserva al jurado y limpia el caso.
  assert.equal(form.el('jurado').value, 'Dra. Ana');
  assert.equal(form.el('areaServicio').selectedIndex, 0);
  assert.equal(form.el('tituloCaso').value, '');
  form.context.nuevaSesion();
  assert.equal(form.el('jurado').value, '');
});

test('formulario-poster.html: guarda categoría de participante y rellena tipo/servicio con "No aplica"', async () => {
  const form = loadForm('formulario-poster.html');
  assert.equal(form.has('categoriaParticipante'), true);
  for (const id of ['areaServicio', 'btn-medicina', 'btn-enfermeria', 'btn-nutricion', 'err-tipo', 'err-area']) {
    assert.equal(form.has(id), false, `${id} no debe existir`);
  }

  form.el('jurado').value = 'Dra. Ana';
  form.el('tituloCaso').value = 'Caso de prueba';
  form.fillCriteria();

  // Sin categoría no se inserta nada.
  await form.context.addCaseToQueue();
  assert.equal(form.inserts.length, 0);
  assert.equal(form.el('categoriaParticipante').classList.contains('err'), true);
  assert.equal(form.el('err-categoria').classList.contains('show'), true);

  form.el('categoriaParticipante').value = 'Internado';
  await form.context.addCaseToQueue();
  assert.equal(form.inserts.length, 2);
  assert.equal(form.inserts[0].table, 'casos');
  assert.deepEqual(plain(form.inserts[0].payload), {
    modalidad: 'Póster Científico', tipo_caso: 'No aplica',
    categoria_participante: 'Internado', area: 'No aplica', titulo: 'Caso de prueba'
  });
  assert.equal(form.inserts[1].table, 'evaluaciones');
  assert.equal('categoria_jurado' in form.inserts[1].payload, false);
  assert.equal(form.inserts[1].payload.puntaje, 100);

  assert.equal(form.el('categoriaParticipante').selectedIndex, 0);
  assert.equal(form.el('tituloCaso').value, '');
  form.context.nuevaSesion();
  assert.equal(form.el('jurado').value, '');
});

/* ══════════════════════════════════════════════════════════════════
   UN CASO, TRES JURADOS: todos deben escribir en la MISMA fila de `casos`
   para que el panel de resultados lo muestre una sola vez con el promedio.
══════════════════════════════════════════════════════════════════ */
async function evaluarPonencia(db, jurado, tipo, servicio, alerts) {
  const form = loadForm('formulario-ponencia.html', db, alerts);
  form.el('jurado').value = jurado;
  form.context.selectTipo(tipo);
  form.el('areaServicio').value = servicio;
  form.events.get('areaServicio:change')();
  form.fillCriteria();
  await form.context.addCaseToQueue();
  return form;
}

async function evaluarPoster(db, jurado, categoria, titulo, alerts) {
  const form = loadForm('formulario-poster.html', db, alerts);
  form.el('jurado').value = jurado;
  form.el('categoriaParticipante').value = categoria;
  form.el('tituloCaso').value = titulo;
  form.fillCriteria();
  await form.context.addCaseToQueue();
  return form;
}

test('formulario-ponencia.html: tres jurados del mismo servicio comparten un solo caso', async () => {
  const db = createDb();
  for (const jurado of ['Dr. Uno', 'Dra. Dos', 'Dr. Tres']) {
    const form = await evaluarPonencia(db, jurado, 'Medicina', 'Cirugía');
    assert.equal(vm.runInContext('sessionQueue.length', form.context), 1, jurado);
  }
  assert.equal(db.casos.length, 1);
  assert.equal(db.evaluaciones.length, 3);
  assert.deepEqual(db.evaluaciones.map(e => e.caso_id), Array(3).fill(db.casos[0].id));

  // Otro servicio sí crea un caso nuevo.
  await evaluarPonencia(db, 'Dr. Uno', 'Medicina', 'Pediatría');
  assert.equal(db.casos.length, 2);
});

test('formulario-poster.html: el mismo título con otras mayúsculas o espacios no duplica el caso', async () => {
  const db = createDb();
  const variantes = [
    ['Dr. Uno',  'Caso clínico de prueba'],
    ['Dra. Dos', '  caso   CLÍNICO de prueba  '],
    ['Dr. Tres', 'CASO CLÍNICO DE PRUEBA']
  ];
  for (const [jurado, titulo] of variantes) {
    await evaluarPoster(db, jurado, 'Internado', titulo);
  }
  assert.equal(db.casos.length, 1);
  assert.equal(db.casos[0].titulo, 'Caso clínico de prueba', 'se conserva el título del primer jurado');
  assert.equal(db.evaluaciones.length, 3);
  assert.deepEqual(db.evaluaciones.map(e => e.caso_id), Array(3).fill(db.casos[0].id));

  await evaluarPoster(db, 'Dr. Uno', 'Profesional', 'Otro caso distinto');
  assert.equal(db.casos.length, 2);
});

for (const [file, evaluar, args] of [
  ['formulario-ponencia.html', evaluarPonencia, ['Medicina', 'Cirugía']],
  ['formulario-poster.html',   evaluarPoster,   ['Internado', 'Caso clínico de prueba']]
]) {
  test(`${file}: avisa y no guarda si un jurado evalúa dos veces el mismo caso`, async () => {
    const db = createDb();
    await evaluar(db, 'Dr. Uno', ...args);
    const alerts = [];
    // Con espacios de mas: debe reconocerse como el mismo jurado.
    const form = await evaluar(db, '  Dr.   Uno  ', ...args, alerts);

    assert.equal(db.casos.length, 1);
    assert.equal(db.evaluaciones.length, 1, 'la segunda evaluación no se guarda');
    assert.match(alerts.join(' '), /Dr\. Uno.*ya registró una evaluación para este caso/);
    assert.equal(vm.runInContext('sessionQueue.length', form.context), 0);
    assert.equal(form.el('btnGuardarTodo').disabled, true);
  });
}

test('resultados.html: sin pestaña Todos, sin filtro de servicio y sin sección de ganadores', () => {
  const html = readFileSync(join(__dirname, 'resultados.html'), 'utf8');
  assert.doesNotMatch(html, /tab-todos|switchTab\('todos'\)/);
  assert.doesNotMatch(html, /filterArea/);
  assert.doesNotMatch(html, /winnersSection|renderWinners|Ganadores por categoría|podium/);
  assert.match(html, /let currentTab = 'poster'/);
  assert.match(html, /id="tab-poster"[^>]*|class="tab active"[^>]*id="tab-poster"/);
  assert.match(html, /<div class="filters">[\s\S]*?<\/div>\s*<!--[^>]*-->\s*<div class="table-wrap" id="casesTableWrap">/,
    'los filtros deben ir justo encima de la tabla de resultados');
});
