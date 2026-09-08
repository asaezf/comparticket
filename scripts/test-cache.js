#!/usr/bin/env node
/**
 * Qué se puede guardar en la caché del navegador y qué no.
 *   node scripts/test-cache.js
 *
 * EL PROBLEMA QUE RESUELVE. Vercel sirve los ficheros estáticos con
 * `Cache-Control: public, max-age=0, must-revalidate`, o sea que el navegador
 * tiene que preguntar por la red si cada fichero sigue siendo válido EN CADA
 * CAMBIO DE PANTALLA. Medido contra producción: 47 KB de CSS, 22 de claim.js,
 * 27 de i18n.js, y uno de los ficheros tardó 1,39 s. Toda esa espera se pagaba
 * otra vez en cada salto entre pantallas, y es buena parte de lo que se sentía
 * como "se queda congelado y luego aparece todo".
 *
 * LO QUE NO SE PUEDE CACHEAR, Y POR QUÉ ES DE DINERO. CLAUDE.md lo dice: el
 * cálculo bueno lo hace el servidor, y `money.js` y `settle.js` se sirven al
 * navegador DESDE EL MISMO FICHERO que usa el servidor, para que la pantalla no
 * pueda decir que la cuenta cuadra mientras el servidor opina lo contrario.
 *
 * Guardar esos dos en la caché rompe exactamente esa garantía: durante la
 * ventana de caché, el navegador estaría repartiendo con una versión y el
 * servidor con otra. Por eso se quedan sin cachear —cuestan una llamada a la
 * función en cada carga y ese es el precio de la garantía— y por eso esta
 * prueba existe: para que nadie los meta ahí por hacer limpieza.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'vercel.json'), 'utf8'));

let pass = 0, fail = 0;
function check(label, ok, detalle) {
  console.log(`  ${ok ? 'ok  ' : 'FALLA'}  ${label}`);
  if (!ok && detalle) console.log(`         ${detalle}`);
  ok ? pass++ : fail++;
}

const cabeceras = cfg.headers || [];
const cacheados = cabeceras
  .filter(h => (h.headers || []).some(c =>
    c.key.toLowerCase() === 'cache-control' && /max-age=[1-9]/.test(c.value)))
  .map(h => h.source);

console.log('\n1. El dinero no se guarda en la caché');
{
  // Las dos que no pueden cachearse, pase lo que pase.
  for (const prohibido of ['/js/money.js', '/js/settle.js']) {
    check(prohibido + ' NO está cacheado',
      !cacheados.includes(prohibido),
      'el navegador repartiría con una versión mientras el servidor usa otra; ' +
      'ver "El servidor no se fía del navegador" en CLAUDE.md');
  }

  // Y tampoco por un comodín que los pille de rebote.
  const comodines = cacheados.filter(s => /\(|\*|:/.test(s));
  check('no hay comodines que puedan alcanzarlos',
    comodines.length === 0,
    'con un comodín como ' + comodines.join(', ') + ' basta un fichero nuevo ' +
    'para cachear sin querer algo que no debe; se enumeran uno a uno a propósito');

  // Siguen sirviéndose desde el mismo fichero que usa el servidor.
  const rutas = (cfg.rewrites || []).map(r => r.source);
  for (const r of ['/js/money.js', '/js/settle.js']) {
    check(r + ' sigue saliendo del fichero del servidor', rutas.includes(r));
  }
}

console.log('\n2. Lo demás sí, para que cambiar de pantalla no pague la red');
{
  check('hay ficheros cacheados', cacheados.length > 0,
    'sin esto, cada cambio de pantalla revalida ~107 KB por la red');

  // Los tres gordos son los que de verdad importan.
  for (const f of ['/css/style.css', '/js/claim.js', '/js/i18n.js']) {
    check(f + ' está cacheado', cacheados.includes(f));
  }

  // Todo lo cacheado tiene que existir de verdad: una ruta que no corresponde
  // a ningún fichero es una regla muerta que despista al leerla.
  const inexistentes = cacheados.filter(s =>
    !fs.existsSync(path.join(RAIZ, 'public', s.replace(/^\//, ''))));
  check('todas las rutas cacheadas apuntan a un fichero que existe',
    inexistentes.length === 0, inexistentes.join(', '));

  // `stale-while-revalidate` es lo que hace que el salto sea instantáneo: el
  // navegador usa lo que tiene y comprueba por detrás, sin bloquear el pintado.
  const conSWR = cabeceras.every(h => (h.headers || []).every(c =>
    c.key.toLowerCase() !== 'cache-control' || /stale-while-revalidate/.test(c.value)));
  check('sirven lo guardado y revalidan por detrás', conSWR,
    'sin stale-while-revalidate, al caducar se vuelve a bloquear en la red');

  // Y la ventana no puede ser eterna: un despliegue tiene que llegar pronto.
  const largos = cabeceras.flatMap(h => (h.headers || [])
    .filter(c => c.key.toLowerCase() === 'cache-control')
    .map(c => +(c.value.match(/max-age=(\d+)/) || [])[1])
    .filter(v => v > 900));
  check('la ventana es corta, para que un despliegue llegue pronto',
    largos.length === 0, 'hay un max-age de ' + largos.join(', ') + ' s');
}

console.log('\n3. El HTML nunca se cachea');
{
  // Si el HTML se cacheara, alguien podría quedarse con una pantalla vieja
  // apuntando a ficheros que ya no existen.
  const html = cacheados.filter(s => /\.html$/.test(s) || s === '/');
  check('ninguna página HTML está cacheada', html.length === 0, html.join(', '));
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
