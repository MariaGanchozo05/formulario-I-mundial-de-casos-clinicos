const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

// Los objetos creados dentro del contexto de vm tienen otro prototipo Object.
const plain = value => JSON.parse(JSON.stringify(value));

function loadForm(file) {
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
  events.get('DOMContentLoaded')();
  return {
    html, context, inserts, events,
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
  assert.equal(form.el('tituloCaso').value, 'Urgencia urológica quirúrgica, GANGRENA DE FOURNIER en paciente de 62 años');

  await form.context.addCaseToQueue();
  assert.equal(form.inserts.length, 2);
  assert.equal(form.inserts[0].table, 'casos');
  assert.deepEqual(plain(form.inserts[0].payload), {
    modalidad: 'Ponencia Oral', tipo_caso: 'Enfermería', area: 'Cirugía',
    titulo: 'Urgencia urológica quirúrgica, GANGRENA DE FOURNIER en paciente de 62 años'
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
