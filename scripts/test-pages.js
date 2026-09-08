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
  'summary.html': 'summary.js',
  'group.html':   'group.js',
  'new-group.html': 'newgroup.js',
  'historial.html': 'historial.js'
};
const GLOBALES = { 'money.js': 'Money', 'imgprep.js': 'ImgPrep', 'i18n.js': 't', 'settle.js': 'Settle' };

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

  const emerge = css.slice(css.indexOf('@keyframes ticketEmerge'),
                           css.indexOf('}\n', css.indexOf('@keyframes ticketEmerge') + 40));

  // EL FALLO DE LOS TIRONES. Esto animaba `max-height` y los dos `padding`
  // durante segundos, y las tres son propiedades de MAQUETACIÓN: el navegador
  // recolocaba las 35 líneas de un ticket del súper —y la página entera por
  // debajo— en cada fotograma. En un móvil eso va a trompicones, y así se veía.
  const layout = ['max-height', 'height', 'padding', 'padding-top',
                  'padding-bottom', 'margin', 'top', 'width'];
  const culpables = layout.filter(prop =>
    new RegExp('(^|[\\s;{])' + prop + ':').test(emerge));
  check('la impresión no anima nada que recoloque la página',
    culpables.length === 0,
    'ticketEmerge anima ' + culpables.join(', ') + ': eso obliga a recalcular ' +
    'la maquetación en cada fotograma y es exactamente lo que daba tirones');

  // `clip-path` solo cambia hasta dónde se ve: el contenido está colocado
  // desde el primer momento y no se mueve ni un píxel.
  check('se descubre recortando, que no cuesta maquetación',
    /clip-path:\s*inset\(/.test(emerge));

  // Y el ticket largo tampoco puede quedarse cortado. Antes pasaba: la
  // animación es `forwards`, así que un tope fijo en píxeles se quedaba puesto
  // para siempre y el ticket de Mercadona perdía el total y media lista.
  check('existe el estado .printed que suelta las ataduras', /\.ticket\.printed\b/.test(css));
  check('.printed quita el max-height', /\.ticket\.printed[^}]*max-height:\s*none/s.test(css));
  check('.printed devuelve el overflow', /\.ticket\.printed[^}]*overflow:\s*visible/s.test(css));
  check('.printed quita el recorte', /\.ticket\.printed[^}]*clip-path:\s*none/s.test(css),
    'sin esto el ticket se queda recortado para siempre, que es el fallo viejo');
  check('fitTicket sigue existiendo para soltar el ticket',
    /function fitTicket[\s\S]*classList\.add\('printed'\)/.test(i18n));
  check('fitTicket tiene red de seguridad por si no salta la animación',
    /function fitTicket[\s\S]*setTimeout\(liberar/.test(i18n));

  // La espera importa: es el rato que alguien está mirando la pantalla para
  // saber lo que tiene que pagar.
  const dur = css.match(/animation: ticketEmerge ([\d.]+)s/);
  check('la impresión no se eterniza', !!dur && parseFloat(dur[1]) <= 2.2,
    dur ? 'dura ' + dur[1] + ' s' : 'no se encuentra la duración');
  // Y la red de seguridad tiene que ir por detrás de la animación, no por
  // delante: si salta antes, corta la impresión a medias.
  const red = i18n.match(/setTimeout\(liberar, (\d+)\)/);
  check('la red de seguridad salta después de la animación',
    !!red && !!dur && +red[1] > parseFloat(dur[1]) * 1000,
    red && dur ? 'red a los ' + red[1] + ' ms, animación de ' + (parseFloat(dur[1]) * 1000) : '');

  // Las tres pantallas que dibujan un ticket tienen que remedir al pintar.
  for (const [pagina, script] of Object.entries(PAGINAS)) {
    if (pagina === 'index.html') continue;   // la portada no lleva lista
    const js = fs.readFileSync(path.join(PUB, 'js', script), 'utf8');
    check(`${script} remide tras pintar`, /fitTicket\(/.test(js),
      'sin fitTicket, un ticket largo se queda recortado');
  }
}

// --- Ninguna clase del HTML puede quedarse sin CSS -----------------------
//
// Un fallo real: al limpiar reglas viejas se borró `.grupo-banner`, que dos
// pantallas seguían usando. Sin la regla que le daba tamaño al icono, el SVG
// salía a su tamaño natural — una flecha morada gigante encima del ticket.
// El HTML seguía siendo válido y ninguna prueba se enteró.
{
  const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8');
  const huerfanas = [];

  for (const f of fs.readdirSync(PUB).filter(x => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PUB, f), 'utf8');
    const clases = new Set();
    for (const m of html.matchAll(/class="([^"]+)"/g)) {
      m[1].split(/\s+/).forEach(c => c && clases.add(c));
    }
    for (const c of clases) {
      if (c === 'hidden') continue;   // la pone y la quita el JavaScript
      if (!new RegExp('\\.' + c.replace(/-/g, '\\-') + '(?![\\w-])').test(css)) {
        huerfanas.push(f + ' → .' + c);
      }
    }
  }

  check('ninguna clase del HTML se ha quedado sin CSS',
    huerfanas.length === 0, huerfanas.join(', '));
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
