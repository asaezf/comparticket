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

console.log('\n4. El ticket sale POR LA RANURA');
{
  const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8');
  const i18n = fs.readFileSync(path.join(PUB, 'js', 'i18n.js'), 'utf8');
  const bloque = (sel) => {
    const i = css.indexOf(sel + ' {');
    return i === -1 ? '' : css.slice(i, css.indexOf('}', i));
  };

  // EL FALLO QUE COSTO TRES RONDAS, Y ERA DE ORDEN DE CAPAS.
  // El papel iba DETRAS de la carcasa, asi que esta lo tapaba hasta su canto de
  // abajo: el ticket asomaba "de debajo del dibujo" en vez de salir por la
  // boca. El papel de una impresora de verdad cuelga POR DELANTE de la maquina.
  const maquina = bloque('.printer-body');
  const ventana = bloque('.ticket-wrap');
  const zMaq = +(maquina.match(/z-index:\s*(\d+)/) || [])[1];
  const zVen = +(ventana.match(/z-index:\s*(\d+)/) || [])[1];
  check('el papel va por DELANTE de la carcasa', zVen > zMaq,
    'papel z-index ' + zVen + ', maquina ' + zMaq + ': si la maquina va delante, ' +
    'el ticket asoma por debajo del dibujo y no por la ranura');

  // Y SE METE DENTRO DE SU SILUETA: si no, sale pegado al canto de abajo.
  const dentro = ventana.match(/margin:\s*-(\d+)px/);
  check('el papel arranca dentro de la maquina', !!dentro && +dentro[1] >= 12,
    dentro ? 'solo ' + dentro[1] + ' px' : 'la ventana no se mete en la maquina');

  // LA RANURA TIENE QUE SER MAS ANCHA QUE LO QUE PASA POR ELLA.
  //
  // Es de perogrullo y aun asi estuvo mal dos veces. La primera, boca al 84 % y
  // ticket al 82 %. La segunda fue peor y mas instructiva: se subio la boca al
  // 90 %, pero `.pantalla-ancha` sube el ticket al 93 % en otra parte del
  // fichero — y ahi el papel salia por una ranura mas ESTRECHA que el. Dos
  // numeros sueltos en dos sitios se descuadran solos.
  //
  // Por eso ya no se comparan dos porcentajes: el ancho del papel es UNA
  // variable y la boca se calcula restandole holgura. Asi no pueden separarse
  // aunque alguien cambie el ancho en un tercer sitio. Esta prueba vigila esa
  // derivacion, no unos valores concretos.
  const boca = bloque('.printer-slot-line');
  check('el ancho del papel esta en una sola variable',
    /--papel-ancho:/.test(css) && /width:\s*var\(--papel-ancho\)/.test(ventana),
    'si el ancho se escribe a mano en varios sitios, se descuadra solo');
  const holgura = boca.match(/left:\s*calc\(\(100% - var\(--papel-ancho\)\) \/ 2 - (\d+)px\)/);
  check('la ranura sale de ese ancho, con holgura', !!holgura && +holgura[1] >= 5,
    holgura ? 'solo ' + holgura[1] + ' px de holgura' :
      'la boca no se deriva del ancho del papel: puede quedarse mas estrecha que el');
  // Y toda anulacion del ancho tiene que tocar la VARIABLE, no el ticket.
  const anulaciones = [...css.matchAll(/\.ticket-wrap\s*\{\s*width:\s*(\d+)%/g)];
  check('nadie cambia el ancho del ticket por su cuenta', anulaciones.length === 0,
    'hay una regla que le pone un ancho fijo al ticket sin tocar la variable: ' +
    'eso es lo que dejo la ranura mas estrecha que el papel');

  // La ranura es el canto de arriba de la ventana: sin recorte no hay ranura.
  check('la ventana recorta lo que aun no ha salido',
    /overflow:\s*hidden/.test(ventana));

  // Y tiene que quedar carcasa POR DEBAJO de la boca, o no se ve maquina a los
  // lados del papel y vuelve a parecer que sale de detras.
  const abajo = +(maquina.match(/padding:\s*\d+px\s+\d+px\s+(\d+)px/) || [])[1];
  const altoBoca = +(boca.match(/bottom:\s*(\d+)px/) || [])[1];
  check('queda carcasa por debajo de la boca', altoBoca >= 20,
    'solo ' + altoBoca + ' px entre la boca y el canto de abajo');
  check('el cuerpo tiene sitio para esa carcasa', abajo >= altoBoca);
}

console.log('\n5. El movimiento no puede costar fotogramas');
{
  const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8');
  const i18n = fs.readFileSync(path.join(PUB, 'js', 'i18n.js'), 'utf8');

  // LA REGLA, Y VIENE DE TRES VERSIONES FALLIDAS DE ESTA MISMA ANIMACION:
  //   1a — animaba `max-height` y los `padding`: MAQUETACION en cada fotograma.
  //   2a — `clip-path` con `will-change` sobre un elemento de 2.700 px: capa
  //        enorme, y el texto aparecia de golpe al terminar de rasterizarla.
  //   3a — solo `transform`, que no cuesta ni maquetacion ni repintado.
  for (const nombre of ['papel-corto', 'papel-largo']) {
    const i = css.indexOf('@keyframes ' + nombre);
    // Hasta el cierre del BLOQUE ("\n}"), no hasta el primer "}": cada
    // fotograma acaba en "}", así que cortaba en la primera línea y la
    // comprobación solo miraba un fotograma de los veintinueve.
    const cuerpo = i === -1 ? '' : css.slice(i, css.indexOf('\n}', i));
    check(nombre + ' existe', i !== -1);
    const props = [...new Set([...cuerpo.matchAll(/(?:^|[\s;{])([a-z-]+)\s*:/g)].map(m => m[1]))];
    const malas = props.filter(x => x !== 'transform');
    check(nombre + ' solo anima transform', malas.length === 0,
      'anima tambien ' + malas.join(', '));
  }

  const imprimiendo = css.slice(css.indexOf('.ticket.printing,'),
                                css.indexOf('}', css.indexOf('.ticket.printing,')));
  check('el ticket NO pide capa propia con will-change',
    !/will-change/.test(imprimiendo));

  // EL RITMO. Catorce empujones con su pausa: si alguien quita los fotogramas
  // repetidos, el papel vuelve a deslizarse y deja de parecer una impresora.
  // Hasta el cierre del BLOQUE ("\n}"), no hasta el primer "}": cada fotograma
  // acaba en "}" y la búsqueda cortaba en la primera línea.
  const corto = css.slice(css.indexOf('@keyframes papel-corto'),
                          css.indexOf('\n}', css.indexOf('@keyframes papel-corto')));
  const valores = [...corto.matchAll(/translateY\(calc\(var\(--papel-h\) \* (-[\d.]+)\)\)/g)].map(m => m[1]);
  const repetidos = valores.filter((v, i) => i > 0 && v === valores[i - 1]).length;
  check('el papel avanza a pasos, no de un tiron', repetidos >= 10,
    'solo ' + repetidos + ' pausas: sin fotogramas repetidos no hay ritmo');

  // El recorrido es el alto del propio ticket, y lo mide el JS.
  check('el JS mide el ticket y se lo pasa al CSS',
    /setProperty\('--papel-h'/.test(i18n));
  check('y elige ritmo y duracion segun lo largo que sea',
    /setProperty\('--papel-anim'/.test(i18n) && /setProperty\('--papel-dur'/.test(i18n));

  // Un ticket del super tardaria 10,5 s a velocidad constante. Con tope.
  const tope = i18n.match(/largo \? ([\d.]+) :/);
  check('ningun ticket se eterniza', !!tope && +tope[1] <= 3,
    tope ? 'tope de ' + tope[1] + ' s' : 'no hay tope');
}

console.log('\n6. La impresion arranca cuando hay algo que imprimir');
{
  const i18n = fs.readFileSync(path.join(PUB, 'js', 'i18n.js'), 'utf8');

  // `class="ticket printing"` estaba en el HTML, asi que la animacion corria
  // en cuanto el navegador leia la pagina —con el ticket VACIO— y el contenido
  // no llegaba de la API hasta uno o dos segundos despues. Se veia: se imprime
  // la caja vacia, paron, y las lineas apareciendo de golpe.
  // TODAS las paginas que imprimen un ticket, no una lista escrita a mano:
  // group, new-group e historial se quedaron atras la primera vez justamente
  // porque la lista era manual y nadie se acordo de ampliarla.
  const conTicket = fs.readdirSync(PUB)
    .filter(f => f.endsWith('.html'))
    .filter(f => /class="ticket /.test(fs.readFileSync(path.join(PUB, f), 'utf8')));
  check('hay paginas que imprimen ticket', conTicket.length >= 6,
    'solo ' + conTicket.length + ': si el filtro deja de encontrarlas esta prueba no prueba nada');
  for (const pagina of conTicket) {
    const h = fs.readFileSync(path.join(PUB, pagina), 'utf8');
    check(pagina + ' no arranca con el ticket vacio',
      !/class="ticket printing"/.test(h) && /class="ticket esperando"/.test(h));
    // Y sin i18n.js no hay quien la arranque: el ticket se quedaria invisible.
    check(pagina + ' carga quien arranca la animacion', /js\/i18n\.js/.test(h));
    // Una sola ranura, y la nueva. `historial.html` tenia la vieja —mas
    // estrecha que el propio ticket— y el papel salia por una boca imposible.
    check(pagina + ' usa la ranura buena',
      /class="printer-slot-line"/.test(h) && !/class="printer-slot"/.test(h));
  }
  check('la arranca el JS al pintar el contenido',
    /classList\.contains\('esperando'\)[\s\S]{0,2200}classList\.add\('printing'\)/.test(i18n));
  check('espera el final de la animacion que existe',
    /animationName === 'papel-(corto|largo|sale)'/.test(i18n) ||
    /animationName\.startsWith\('papel-'\)/.test(i18n),
    'si escucha un nombre que ya no existe, el ticket solo se suelta por el temporizador');
  // Si algo falla, el ticket NO puede quedarse invisible: seria una pantalla en
  // blanco donde tendria que haber una cuenta.
  check('si algo falla, el ticket se ensena igualmente',
    /querySelectorAll\('\.ticket\.esperando, \.ticket\.listo'\)/.test(i18n));
  const red = i18n.match(/setTimeout\(liberar, (\d+)\)/);
  check('la red de seguridad salta despues de la animacion',
    !!red && +red[1] > 2300, red ? 'salta a los ' + red[1] + ' ms' : '');
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
