#!/usr/bin/env node
/**
 * Prueba de humo de las páginas — no gasta API ni base de datos.
 *   node scripts/test-pages.js
 *
 * Caza dos fallos que ya han roto la app de verdad y que no dan la cara hasta
 * que alguien abre esa pantalla concreta:
 *
 *   1. El JS usa un elemento que ya no existe en el HTML (fue lo que dejó la
 *      pantalla de revisión completamente muerta en producción).
 *   2. El JS usa un módulo global que esa página no carga (fue lo que rompió
 *      la pantalla de reparto al empezar a usar Money.formatEUR en ella).
 */

const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');

let pass = 0, fail = 0;
function check(label, ok, detalle) {
  console.log(`  ${ok ? 'ok  ' : 'FALLA'}  ${label}`);
  if (!ok && detalle) console.log(`         ${detalle}`);
  ok ? pass++ : fail++;
}

// Qué script acompaña a cada página y qué globales aporta cada fichero.
const PAGINAS = {
  'index.html':   'upload.js',
  'ticket.html':  'ticket.js',
  'claim.html':   'claim.js',
  'summary.html': 'summary.js'
};
const GLOBALES = { 'money.js': 'Money', 'imgprep.js': 'ImgPrep', 'i18n.js': 't' };

console.log('\n1. Cada id que usa el JS existe en su HTML');
for (const [pagina, script] of Object.entries(PAGINAS)) {
  const html = fs.readFileSync(path.join(PUB, pagina), 'utf8');
  const js = fs.readFileSync(path.join(PUB, 'js', script), 'utf8');

  const idsEnHtml = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  // Solo los accesos directos y sin guarda: getElementById('x').algo
  const usados = [...js.matchAll(/getElementById\('([^']+)'\)\s*\./g)].map(m => m[1]);
  const faltan = [...new Set(usados)].filter(id => !idsEnHtml.has(id));

  check(`${pagina} ← ${script}`, faltan.length === 0,
    faltan.length ? `ids que el JS usa sin guarda y no existen: ${faltan.join(', ')}` : '');
}

console.log('\n2. Cada global que usa el JS lo carga su HTML');
for (const [pagina, script] of Object.entries(PAGINAS)) {
  const html = fs.readFileSync(path.join(PUB, pagina), 'utf8');
  const js = fs.readFileSync(path.join(PUB, 'js', script), 'utf8');
  const cargados = [...html.matchAll(/src="\/js\/([a-z0-9]+\.js)"/g)].map(m => m[1]);

  const faltan = [];
  for (const [fichero, global] of Object.entries(GLOBALES)) {
    const usa = new RegExp(`\\b${global}\\.`).test(js);
    if (usa && !cargados.includes(fichero)) faltan.push(`${global} (falta ${fichero})`);
  }
  check(`${pagina} carga lo que ${script} necesita`, faltan.length === 0, faltan.join(', '));
}

console.log('\n3. Cada página tiene lo básico del <head>');
for (const pagina of Object.keys(PAGINAS)) {
  const html = fs.readFileSync(path.join(PUB, pagina), 'utf8');
  const falta = [];
  if (!/<title>[^<]+<\/title>/.test(html)) falta.push('title');
  if (!/rel="icon"/.test(html)) falta.push('favicon');
  if (!/og:title/.test(html)) falta.push('og:title');
  if (!/og:image/.test(html)) falta.push('og:image');
  if (!/preconnect/.test(html)) falta.push('preconnect de fuentes');
  check(`${pagina}`, falta.length === 0, falta.length ? `falta: ${falta.join(', ')}` : '');
}

console.log('\n4. La animación de impresión no puede recortar tickets largos');
{
  const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8');
  const i18n = fs.readFileSync(path.join(PUB, 'js', 'i18n.js'), 'utf8');

  // Un tope fijo en píxeles cortaba el ticket de Mercadona por la mitad: el
  // total desaparecía en la pantalla de revisión y en la de marcar había
  // artículos imposibles de tocar. La altura debe venir del contenido.
  const topeFijo = /max-height:\s*\d+px[^;]*;\s*\n?\s*padding-top:\s*18px/.test(css);
  check('el fotograma final no usa un alto fijo', !topeFijo,
    'ticketEmerge vuelve a tener un max-height en píxeles fijos');
  check('el alto final sale de --ticket-h', /max-height:\s*var\(--ticket-h/.test(css));
  check('existe el estado .printed que suelta las ataduras', /\.ticket\.printed\b/.test(css));
  check('.printed quita el max-height', /\.ticket\.printed[^}]*max-height:\s*none/s.test(css));
  check('.printed devuelve el overflow', /\.ticket\.printed[^}]*overflow:\s*visible/s.test(css));
  check('fitTicket existe y mide el contenido', /function fitTicket[\s\S]*scrollHeight/.test(i18n));
  check('fitTicket tiene red de seguridad por si no salta la animación',
    /function fitTicket[\s\S]*setTimeout\(liberar/.test(i18n));

  // Las tres pantallas que dibujan un ticket tienen que remedir al pintar.
  for (const [pagina, script] of Object.entries(PAGINAS)) {
    if (pagina === 'index.html') continue;   // la portada no lleva lista
    const js = fs.readFileSync(path.join(PUB, 'js', script), 'utf8');
    check(`${script} remide tras pintar`, /fitTicket\(/.test(js),
      'sin fitTicket, un ticket largo se queda recortado');
  }
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
