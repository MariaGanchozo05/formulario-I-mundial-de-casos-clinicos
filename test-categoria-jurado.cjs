const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function loadForm(file) {
  const html = readFileSync(join(__dirname, file), 'utf8');
  const elements = new Map();
  const events = new Map();
  const inserts = [];
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const classes = new Set();
    const attributes = new Map();
    elements.set(match[1], {
      value: '', style: {}, innerHTML: '', textContent: '',
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
    html, context, inserts,
    el: id => document.getElementById(id),
    select(value) {
      document.getElementById('categoriaJurado').value = value;
      events.get('categoriaJurado:change')();
    },
    fillCase() {
      document.getElementById('jurado').value = 'Dra. Ana';
      document.getElementById('categoriaParticipante').value = 'Profesional';
      document.getElementById('areaServicio').value = 'Cirugía';
      document.getElementById('tituloCaso').value = 'Caso de prueba';
      vm.runInContext("selectTipo('Medicina'); CRITERIA.forEach((item, i) => setScore(i, item[1]));", context);
    }
  };
}

for (const file of ['formulario-ponencia.html', 'formulario-poster.html']) {
  test(`${file}: muestra y oculta el campo manual`, () => {
    const form = loadForm(file);
    assert.match(form.html, /<option value="Otros">Otros<\/option>/);
    assert.equal(form.el('categoriaJuradoOtraField').hidden, true);
    assert.equal(form.el('categoriaJuradoOtra').disabled, true);
    form.select('Otros');
    assert.equal(form.el('categoriaJuradoOtraField').hidden, false);
    assert.equal(form.el('categoriaJuradoOtra').disabled, false);
    assert.equal(form.el('categoriaJuradoOtra').required, true);
    form.select('Medicina');
    assert.equal(form.el('categoriaJuradoOtraField').hidden, true);
    assert.equal(form.el('categoriaJuradoOtra').required, false);
  });

  test(`${file}: rechaza Otros vacío antes de insertar`, async () => {
    const form = loadForm(file);
    form.fillCase();
    form.select('Otros');
    for (const value of ['', '   ']) {
      form.el('categoriaJuradoOtra').value = value;
      await form.context.addCaseToQueue();
      assert.equal(form.inserts.length, 0);
      assert.equal(form.el('categoriaJuradoOtra').classList.contains('err'), true);
      assert.equal(form.el('err-categoriaJuradoOtra').classList.contains('show'), true);
    }
    form.select('Medicina');
    assert.equal(form.el('categoriaJuradoOtra').classList.contains('err'), false);
    assert.equal(form.el('err-categoriaJuradoOtra').classList.contains('show'), false);
  });

  test(`${file}: guarda texto manual y gestiona sesiones`, async () => {
    const form = loadForm(file);
    form.fillCase();
    form.select('Otros');
    form.el('categoriaJuradoOtra').value = '  Psicología / Rehabilitación  ';
    await form.context.addCaseToQueue();
    assert.equal(form.inserts[1].table, 'evaluaciones');
    assert.equal(form.inserts[1].payload.categoria_jurado, 'Psicología / Rehabilitación');
    assert.equal(form.inserts[0].payload.categoria_participante, 'Profesional');
    assert.equal(form.el('categoriaJurado').value, 'Otros');
    assert.equal(form.el('categoriaJuradoOtra').value, '  Psicología / Rehabilitación  ');
    assert.equal(form.el('categoriaJuradoOtraField').hidden, false);
    form.fillCase();
    await form.context.addCaseToQueue();
    assert.equal(form.inserts[3].payload.categoria_jurado, 'Psicología / Rehabilitación');
    form.context.nuevaSesion();
    assert.equal(form.el('categoriaJurado').value, '');
    assert.equal(form.el('categoriaJuradoOtra').value, '');
    assert.equal(form.el('categoriaJuradoOtraField').hidden, true);
    assert.equal(form.el('categoriaJuradoOtra').disabled, true);
    assert.equal(form.el('categoriaJuradoOtra').required, false);
  });

  test(`${file}: conserva categorías existentes y categoría opcional`, async () => {
    const form = loadForm(file);
    form.el('categoriaJuradoOtra').value = 'No debe enviarse';
    for (const category of ['Medicina', 'Enfermería', 'Nutrición', 'Docencia / Investigación', '']) {
      form.fillCase();
      form.select(category);
      await form.context.addCaseToQueue();
      assert.equal(form.inserts.at(-1).payload.categoria_jurado, category || null);
    }
  });
}
