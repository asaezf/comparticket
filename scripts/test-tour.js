#!/usr/bin/env node
/**
 * El tutorial guiado (tour.js) y su cableado en las siete pantallas.
 *   node scripts/test-tour.js
 *
 * No abre un navegador: comprueba texto contra texto —que cada pantalla
 * carga tour.js, que cada clave i18n que usa un paso existe en los siete
 * idiomas, que el posicionamiento nunca puede salirse de la pantalla— y
 * replica en JavaScript puro la aritmética de tour.js para probarla sin
 * levantar un DOM.
 */

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const PUB = path.join(RAIZ, 'public');

let pass = 0, fail = 0;
function check(label, got, want) {
  const bien = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${bien ? 'ok   ' : 'FALLA'}  ${label}`);
  if (!bien) console.log(`         obtenido ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`);
  bien ? pass++ : fail++;
}

console.log('\n1. Las siete pantallas cargan tour.js, después de i18n.js');
const PAGINAS = {
  'index.html': 'upload.js', 'ticket.html': 'ticket.js', 'claim.html': 'claim.js',
  'summary.html': 'summary.js', 'group.html': 'group.js', 'new-group.html': 'newgroup.js',
  'historial.html': 'historial.js'
};
for (const [pagina, script] of Object.entries(PAGINAS)) {
  const html = fs.readFileSync(path.join(PUB, pagina), 'utf8');
  const orden = html.indexOf('/js/i18n.js');
  const ordenTour = html.indexOf('/js/tour.js');
  check(`${pagina} carga tour.js`, ordenTour > -1, true);
  check(`${pagina}: tour.js va después de i18n.js`, ordenTour > orden, true);
}

console.log('\n2. Cada pantalla llama a Tour.iniciar con un id propio');
const IDS_ESPERADOS = {
  'upload.js': 'index', 'ticket.js': 'ticket', 'summary.js': 'summary',
  'group.js': 'group', 'newgroup.js': 'newgroup', 'historial.js': 'historial'
};
for (const [script, id] of Object.entries(IDS_ESPERADOS)) {
  const js = fs.readFileSync(path.join(PUB, 'js', script), 'utf8');
  check(`${script} arranca el tutorial '${id}'`,
    new RegExp(`Tour\\.iniciar\\('${id}'`).test(js), true);
}
// claim.js arranca el suyo desde una función propia, no en línea.
{
  const js = fs.readFileSync(path.join(PUB, 'js', 'claim.js'), 'utf8');
  check("claim.js arranca el tutorial 'claim'", /Tour\.iniciar\('claim'/.test(js), true);
  check('claim.js ya no tiene el coach-tip antiguo', /coach-tip|maybeShowTip/.test(js), false);
}

console.log('\n3. Ninguna clave de tour usada en el código falta en ningún idioma');
{
  const i18n = fs.readFileSync(path.join(PUB, 'js', 'i18n.js'), 'utf8');
  const translations = new Function(
    i18n.slice(0, i18n.indexOf('function detectLang')) + '; return translations;')();
  const idiomas = Object.keys(translations);

  const usadas = new Set();
  for (const script of ['upload.js', 'ticket.js', 'claim.js', 'summary.js', 'group.js', 'newgroup.js', 'historial.js']) {
    const js = fs.readFileSync(path.join(PUB, 'js', script), 'utf8');
    for (const m of js.matchAll(/t\.(tour[A-Za-z0-9]+)/g)) usadas.add(m[1]);
  }
  check('se han encontrado claves de tour en el código', usadas.size > 20, true);

  for (const l of idiomas) {
    const faltan = [...usadas].filter(k => !(k in translations[l]) || !String(translations[l][k]).trim());
    check(`${l}: ninguna clave de tour usada falta o está vacía`, faltan, []);
  }
}

console.log('\n4. La posición nunca se sale de la pantalla (aritmética de tour.js)');
{
  // La misma fórmula que clamp() y posicionar() en tour.js, para probarla
  // sin necesitar un DOM real.
  const clamp = (n, min, max) => Math.max(min, Math.min(max, max >= min ? n : min));

  function posicion(vw, vh, anchoBubble, altoBubble, r) {
    const margen = 16;
    const anchoDeseado = Math.min(anchoBubble, vw - margen * 2);
    const centroX = r.left + r.width / 2;
    const cabeDebajo = r.bottom + 14 + altoBubble <= vh - margen;
    const cabeEncima = r.top - 14 - altoBubble >= margen;
    let top, piquito;
    if (cabeDebajo) { top = r.bottom + 14; piquito = 'arriba'; }
    else if (cabeEncima) { top = r.top - 14 - altoBubble; piquito = 'abajo'; }
    else { top = Math.max(margen, (vh - altoBubble) / 2); piquito = null; }
    const left = clamp(centroX - anchoDeseado / 2, margen, vw - anchoDeseado - margen);
    // La misma última red de seguridad que tour.js: por mucho que diga el
    // cálculo de arriba, el resultado se recorta siempre dentro de la
    // pantalla.
    top = clamp(top, margen, Math.max(margen, vh - altoBubble - margen));
    return { left, top, right: left + anchoDeseado, bottom: top + altoBubble, piquito };
  }

  const casos = [
    { t: 'objetivo pegado al borde IZQUIERDO', vw: 375, vh: 800, r: { left: 4, right: 60, top: 200, bottom: 230, width: 56 } },
    { t: 'objetivo pegado al borde DERECHO',   vw: 375, vh: 800, r: { left: 320, right: 371, top: 200, bottom: 230, width: 51 } },
    { t: 'objetivo muy ARRIBA (no cabe encima)', vw: 375, vh: 800, r: { left: 100, right: 200, top: 10, bottom: 40, width: 100 } },
    { t: 'objetivo muy ABAJO (no cabe debajo)', vw: 375, vh: 800, r: { left: 100, right: 200, top: 760, bottom: 790, width: 100 } },
    { t: 'pantalla estrechísima (reloj viejo)', vw: 240, vh: 320, r: { left: 20, right: 220, top: 100, bottom: 130, width: 200 } },
    { t: 'objetivo en el centro exacto',        vw: 414, vh: 896, r: { left: 180, right: 234, top: 400, bottom: 430, width: 54 } },
    // El fallo real que se detectó a mano: un objetivo lejos por debajo de
    // la pantalla, cuyo scroll hacia la vista todavía no ha terminado
    // cuando se mide. Sin la red de seguridad final, "cabeEncima" daba por
    // buena una posición muy por debajo de vh porque solo miraba que
    // hubiera hueco ENCIMA del objetivo, sin comprobar que ese hueco
    // estuviera dentro de la pantalla.
    { t: 'objetivo todavía fuera de la vista (scroll sin terminar)',
      vw: 375, vh: 812, r: { left: 20, right: 354, top: 1150, bottom: 1180, width: 334 } },
  ];

  for (const c of casos) {
    const p = posicion(c.vw, c.vh, 340, 140, c.r);
    const dentroX = p.left >= 16 - 0.01 && p.right <= c.vw - 16 + 0.01;
    const dentroY = p.top >= 16 - 0.01 && p.bottom <= c.vh - 16 + 0.01;
    check(c.t + ': nunca se sale por los lados', dentroX, true);
    check(c.t + ': nunca se sale por arriba/abajo', dentroY, true);
  }
}

console.log('\n5. El scroll hacia el objetivo es instantáneo, no suave');
{
  // Con "smooth" hay una animación de varios cientos de milisegundos; si
  // posicionar() mide antes de que termine, calcula la burbuja para donde
  // el objetivo ESTABA. Detectado a mano: en la pantalla de grupo, con
  // cuatro pasos, los tres últimos aparecían fuera de la pantalla.
  const js = fs.readFileSync(path.join(PUB, 'js', 'tour.js'), 'utf8');
  check("scrollIntoView usa behavior: 'instant'", /behavior:\s*'instant'/.test(js), true);
  check("ya no queda ningún scroll 'smooth'", /behavior:\s*'smooth'/.test(js), false);
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
