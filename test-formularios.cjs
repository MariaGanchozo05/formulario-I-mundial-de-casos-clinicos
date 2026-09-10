const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

// Los objetos creados dentro del contexto de vm tienen otro prototipo Object.
const plain = value => JSON.parse(JSON.stringify(value));

function loadForm(file, { initialize = true } = {}) {
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
  const client = {
    from(table) {
      return {
        insert(payload) {
          inserts.push({ table, payload });
          return table === 'casos'
            ? { select: () => ({ single: async () => ({ data: { id: 'test-case' }, error: null }) }) }
            : Promise.resolve({ error: null });
        }
      };
    }
  };
  const context = vm.createContext({
    document, window: { supabase: { createClient: () => client } },
    console, setTimeout() {}, alert(message) { assert.fail(message); }
  });
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1], { filename: file }).runInContext(context);
  }
  if (initialize) events.get('DOMContentLoaded')();
  return {
    html, context, inserts,
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

test('formulario-ponencia.html: guarda tipo y servicio sin categoría de participante ni de jurado', async () => {
  const form = loadForm('formulario-ponencia.html');
  assert.equal(form.has('categoriaParticipante'), false);
  assert.equal(form.has('areaServicio'), true);
  assert.equal(form.has('btn-medicina'), true);

  form.el('jurado').value = 'Dra. Ana';
  form.el('tituloCaso').value = 'Caso de prueba';
  form.fillCriteria();

  // Sin tipo ni servicio no se inserta nada.
  await form.context.addCaseToQueue();
  assert.equal(form.inserts.length, 0);
  assert.equal(form.el('err-tipo').style.display, 'block');
  assert.equal(form.el('areaServicio').classList.contains('err'), true);

  form.context.selectTipo('Enfermería');
  form.el('areaServicio').value = 'Cirugía';
  await form.context.addCaseToQueue();
  assert.equal(form.inserts.length, 2);
  assert.equal(form.inserts[0].table, 'casos');
  assert.deepEqual(plain(form.inserts[0].payload),
    { modalidad: 'Ponencia Oral', tipo_caso: 'Enfermería', area: 'Cirugía', titulo: 'Caso de prueba' });
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

function loadResults() {
  const page = loadForm('resultados.html', { initialize: false });
  page.context.records = [
    ['cirugia-1', 'Caso renal', 'Cirugía', 'Medicina', 'Ponencia Oral', 18, 20, 'Sin categoría'],
    ['cirugia-2', 'Caso nutricional', 'Cirugía', 'Nutrición', 'Ponencia Oral', 8, 20, 'Sin categoría'],
    ['pediatria-1', 'Caso renal pediátrico', 'Pediatría', 'Medicina', 'Ponencia Oral', 20, 20, 'Sin categoría'],
    ['poster-1', 'Póster profesional', 'No aplica', 'No aplica', 'Póster Científico', 60, 100, 'Profesional'],
    ['poster-2', 'Póster internado', 'No aplica', 'No aplica', 'Póster Científico', 90, 100, 'Internado']
  ].map(([casoId, titulo, area, tipo_caso, modalidad, puntaje, maxPuntaje, categoria], i) => ({
    casoId, titulo, area, tipo_caso, modalidad, puntaje, maxPuntaje, categoria,
    jurado: 'Jurado de prueba', fecha: `2026-09-0${i + 1}`, _createdAt: `2026-09-0${i + 1}`
  }));
  vm.runInContext('allRecords = records; allCases = agruparPorCaso(allRecords); renderAll();', page.context);
  return page;
}

test('resultados.html: sin pestaña Todos ni sección de ganadores', () => {
  const html = readFileSync(join(__dirname, 'resultados.html'), 'utf8');
  assert.doesNotMatch(html, /tab-todos|switchTab\('todos'\)/);
  assert.doesNotMatch(html, /winnersSection|renderWinners|Ganadores por categoría|podium/);
  assert.match(html, /let currentTab = 'poster'/);
  assert.match(html, /id="tab-poster"[^>]*|class="tab active"[^>]*id="tab-poster"/);
  assert.match(html, /<div class="filters">[\s\S]*?<\/div>\s*<!--[^>]*-->\s*<div class="table-wrap" id="casesTableWrap">/,
    'los filtros deben ir justo encima de la tabla de resultados');
});

test('resultados.html: el filtro de servicio ofrece los mismos servicios que el formulario', () => {
  const html = readFileSync(join(__dirname, 'resultados.html'), 'utf8');
  const form = readFileSync(join(__dirname, 'formulario-ponencia.html'), 'utf8');
  const select = html.match(/<select\b[^>]*id="filterArea"[^>]*>[\s\S]*?<\/select>/)?.[0];
  assert.ok(select, 'debe existir el filtro de servicio');
  assert.match(select, /aria-label="Filtrar por servicio"/);
  assert.match(select, /onchange="renderAll\(\)"/);
  assert.match(select, /style="display:none"/);
  assert.match(select, /<option value="">Todos los servicios<\/option>/);
  const options = text => [...text.matchAll(/<option>([^<]+)<\/option>/g)].map(match => match[1]);
  assert.deepEqual(options(select), options(form.match(/id="areaServicio"[\s\S]*?<\/select>/)[0]));
});

test('resultados.html: combina servicio, título y orden sin agrupar los casos', () => {
  const page = loadResults();
  const ids = () => plain(page.context.getFilteredCases()).map(c => c.casoId);
  page.context.switchTab('ponencia');
  assert.deepEqual(ids(), ['pediatria-1', 'cirugia-1', 'cirugia-2']);
  page.el('filterArea').value = 'Cirugía';
  page.context.renderAll();
  assert.deepEqual(ids(), ['cirugia-1', 'cirugia-2']);
  const body = page.el('ponenciaBody').innerHTML;
  assert.equal((body.match(/class="main-row"/g) || []).length, 2);
  assert.match(body, /90\.0%/);
  assert.match(body, /40\.0%/);
  assert.doesNotMatch(body, /Caso renal pediátrico/);

  page.el('filterSort').value = 'score_asc';
  assert.deepEqual(ids(), ['cirugia-2', 'cirugia-1']);
  page.el('filterSort').value = 'date_desc';
  assert.deepEqual(ids(), ['cirugia-2', 'cirugia-1']);
  page.el('filterSort').value = 'date_asc';
  assert.deepEqual(ids(), ['cirugia-1', 'cirugia-2']);
  page.el('filterSearch').value = 'RENAL';
  assert.deepEqual(ids(), ['cirugia-1']);
  page.el('filterSearch').value = 'sin coincidencias';
  page.context.renderAll();
  assert.deepEqual(ids(), []);
  assert.match(page.el('ponenciaBody').innerHTML, /class="empty-state"/);
  page.el('filterSearch').value = '';
  page.el('filterArea').value = 'Neonatología';
  assert.deepEqual(ids(), []);
  page.el('filterArea').value = '';
  assert.equal(ids().length, 3);
});

test('resultados.html: categoría y servicio solo afectan a su pestaña y conservan la selección', () => {
  const page = loadResults();
  const ids = () => plain(page.context.getFilteredCases()).map(c => c.casoId);
  assert.equal(page.el('filterArea').style.display, 'none');
  page.el('filterCategoria').value = 'Profesional';
  assert.deepEqual(ids(), ['poster-1']);
  page.context.switchTab('ponencia');
  assert.equal(page.el('filterArea').style.display, '');
  assert.equal(page.el('filterCategoria').style.display, 'none');
  assert.deepEqual(ids(), ['pediatria-1', 'cirugia-1', 'cirugia-2']);
  page.el('filterArea').value = 'Cirugía';
  page.context.switchTab('poster');
  assert.equal(page.el('filterArea').style.display, 'none');
  assert.equal(page.el('filterCategoria').style.display, '');
  assert.deepEqual(ids(), ['poster-1']);
  page.el('filterCategoria').value = '';
  assert.deepEqual(ids(), ['poster-2', 'poster-1']);
  page.context.switchTab('ponencia');
  assert.equal(page.el('filterArea').value, 'Cirugía');
  assert.deepEqual(ids(), ['cirugia-1', 'cirugia-2']);
});

test('resultados.html: el CSV de ponencia respeta el filtro por servicio', async () => {
  const page = loadResults();
  page.context.switchTab('ponencia');
  page.el('filterArea').value = 'Cirugía';
  let exported;
  let clicked = false;
  page.context.Blob = Blob;
  page.context.URL = { createObjectURL(blob) { exported = blob; return 'blob:test'; }, revokeObjectURL() {} };
  page.context.document.createElement = () => ({ click() { clicked = true; } });
  page.context.exportCSV();
  assert.equal(clicked, true);
  const csv = await exported.text();
  assert.match(csv, /Caso renal/);
  assert.match(csv, /Caso nutricional/);
  assert.doesNotMatch(csv, /Caso renal pediátrico|Póster profesional|Póster internado/);
});

for (const [tab, bodyId, casoId] of [
  ['poster', 'resultsBody', 'poster-1'],
  ['ponencia', 'ponenciaBody', 'cirugia-1']
]) {
  for (const [scenario, names] of [
    ['un jurado', ['Dra. Ana']],
    ['varios jurados con caracteres especiales', ['Dra. Ana', 'Dr. Luis <Gómez> & "Equipo"']],
    ['un nombre sin registrar', ['Dra. Ana', null]]
  ]) {
    test(`resultados.html: ${tab} muestra los nombres visibles con ${scenario}`, () => {
      const page = loadResults();
      const base = page.context.records.find(r => r.casoId === casoId);
      page.context.records = names.map(jurado => ({ ...base, jurado }));
      vm.runInContext('allRecords = records; allCases = agruparPorCaso(allRecords);', page.context);
      page.context.switchTab(tab);
      const body = page.el(bodyId).innerHTML;
      assert.match(body, new RegExp(`class="jurados-chip"[^>]*>${names.length}</span>`));
      const list = body.match(/<ul class="jurados-nombres">([\s\S]*?)<\/ul>/)?.[1];
      assert.ok(list, 'los nombres deben aparecer en la celda, no solo en el tooltip');
      const visibleNames = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(match => match[1]);
      assert.deepEqual(visibleNames, names.map(name => page.context.esc(name || 'Sin nombre registrado')));
      assert.doesNotMatch(list, /<Gómez>/);
      assert.equal((body.match(/class="main-row"/g) || []).length, 1);
      assert.match(body, new RegExp(`${base.puntaje} / ${base.maxPuntaje}`));
    });
  }
}

test('resultados.html: la tabla de ponencia lista un caso por fila con columnas por tipo', () => {
  const html = readFileSync(join(__dirname, 'resultados.html'), 'utf8');
  const tabla = html.match(/id="ponenciaTableWrap"[\s\S]*?<\/thead>/)[0];
  assert.match(tabla, /<th[^>]*>Pos\.<\/th>\s*<th>Título del Caso<\/th>\s*<th>Servicio<\/th>/);
  ['Medicina', 'Enfermería', 'Nutrición'].forEach(tipo => {
    assert.match(tabla, new RegExp(`<th[^>]*>Caso Clínico<br>${tipo} <small>\\(0–20 pts\\)</small></th>`));
  });
  assert.equal((tabla.match(/<th[\s>]/g) || []).length, 9);
  // Ya no se agrupa por servicio: no vuelve el total 0-60 de la tabla anterior.
  assert.doesNotMatch(html, /getPonenciaPorServicio|MAX_TOTAL_PONENCIA|SERVICIOS_PONENCIA/);
  const render = html.match(/function renderPonenciaTable\(\)[\s\S]*?\n\}\n\n/)[0];
  assert.match(render, /colspan="9"/);
  // La posición sale del índice del caso dentro del ranking global ya ordenado.
  assert.match(render, /const cases = getFilteredCases\(\);/);
  assert.match(render, /cases\.map\(\(c, idx\) => \{[\s\S]*?const pos\s*=\s*idx \+ 1;/);
  // El puntaje cae solo en la columna del tipo del caso; las otras quedan vacías.
  assert.match(render, /TIPOS_PONENCIA\.map\(t => celdaTipo\(c, t\)\)/);
  assert.match(render, /norm\(c\.tipoCaso\) !== norm\(tipo\)/);
});
