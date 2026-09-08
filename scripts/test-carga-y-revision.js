#!/usr/bin/env node
/**
 * La pantalla de revisar la foto y la de esperar a que la IA lea el ticket.
 *   node scripts/test-carga-y-revision.js
 *
 * Cinco fallos reales, todos encontrados usando la app:
 *
 *   1. En la vista previa, el botón de girar iba FLOTANDO sobre la foto. Es
 *      casi blanco, así que sobre un ticket blanco desaparecía por el centro y
 *      solo asomaban sus dos extremos contra el fondo negro: parecía que el
 *      papel partía el botón en dos. Además tapaba los últimos píxeles de la
 *      foto, que es justo donde un ticket lleva el total.
 *   2. El velo de esa pantalla estaba al 88 %, y la cabecera y la firma se
 *      transparentaban por detrás de las fotos.
 *   3. La cifra del precio se salía de la casilla. La casilla mide 42 px y el
 *      precio salía a 0,9 rem fijos: desbordaba ya con un "12,50", aunque no
 *      cantaba hasta los tres dígitos.
 *   4. Un ticket tumbado se leía fatal y aun así se dejaba escanear. El aviso
 *      era suave y se ignoraba; el fallo no se descubría hasta el final, con
 *      gente ya marcando lo suyo sobre unos importes equivocados.
 *   5. La firma "desarrollado por A.S.F" estaba en las siete pantallas.
 *
 * Las de CSS y JS miran el fuente: no hay navegador aquí. No demuestran que se
 * vea bien -eso se comprueba mirándolo-, pero sí impiden que alguien deshaga
 * la corrección sin enterarse, que es como volvieron los tres primeros.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const PUB = path.join(RAIZ, 'public');
const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8');
const upload = fs.readFileSync(path.join(PUB, 'js', 'upload.js'), 'utf8');
const claim = fs.readFileSync(path.join(PUB, 'js', 'claim.js'), 'utf8');

let pass = 0, fail = 0;
function check(label, ok, detalle) {
  console.log(`  ${ok ? 'ok  ' : 'FALLA'}  ${label}`);
  if (!ok && detalle) console.log(`         ${detalle}`);
  ok ? pass++ : fail++;
}

// Devuelve el cuerpo de las reglas de un selector, para no dar por bueno un
// valor que en realidad está en otro selector del fichero. Junta TODAS sus
// apariciones: un selector puede repetirse -y aquí se repite- y quedarse con
// la primera daba por ausente una propiedad que estaba en la segunda.
function bloque(selector) {
  let desde = 0, salida = '';
  for (;;) {
    const i = css.indexOf(selector + ' {', desde);
    if (i === -1) break;
    // Que no cuele `.a .b {` cuando se busca `.b {`: delante solo puede haber
    // una coma, un salto de línea o el principio del fichero.
    const antes = css[i - 1];
    if (i === 0 || antes === '\n' || antes === ',' || antes === ' ' && css[i - 2] === ',') {
      salida += css.slice(i, css.indexOf('}', i)) + '\n';
    }
    desde = i + selector.length;
  }
  return salida || null;
}

console.log('\n1. En la vista previa nada se monta encima de la foto');
{
  const rot = bloque('.preview-overlay .thumb-rot');
  check('el botón de girar existe en la vista previa', !!rot);
  // `absolute` es lo que lo ponía flotando sobre la imagen. Tiene que ser una
  // fila de verdad, debajo de la foto.
  check('el botón de girar NO flota sobre la foto',
    !!rot && /position:\s*static/.test(rot),
    'position debe ser static; con absolute vuelve a montarse sobre la imagen');

  const ficha = bloque('.preview-overlay .thumb');
  check('la ficha es una columna: foto arriba, botón debajo',
    !!ficha && /flex-direction:\s*column/.test(ficha));

  // El hueco de la foto es quien lleva la proporción de papel. Si la perdiera,
  // la pantalla dejaría de enseñar la forma del ticket, que es a lo que viene.
  const hueco = bloque('.preview-overlay .thumb-foto');
  check('la foto conserva la proporción de un papel',
    !!hueco && /aspect-ratio:\s*3\s*\/\s*4/.test(hueco));

  // Y `contain`, no `cover`: recortando no se ve si el ticket está tumbado.
  const img = bloque('.preview-overlay .thumb img');
  check('la foto se ve entera, no recortada',
    !!img && /object-fit:\s*contain/.test(img),
    'con cover se recorta el centro y la orientación deja de verse');

  // Con el alto limitado, la rejilla aplastaba las primeras filas en vez de
  // dejarlas desplazarse: las fotos de arriba perdían la proporción.
  const rejilla = bloque('.preview-overlay .thumbs');
  check('las filas no se aplastan para que quepa todo',
    !!rejilla && /grid-auto-rows:\s*max-content/.test(rejilla));
}

console.log('\n2. Detrás de la vista previa no se transparenta nada');
{
  const velo = bloque('.preview-overlay');
  const fondo = velo && velo.match(/background:\s*([^;]+);/);
  check('el fondo es opaco', !!fondo && !/rgba?\([^)]*,\s*0?\.\d+\s*\)/.test(fondo[1]),
    fondo ? 'fondo actual: ' + fondo[1].trim() : 'no se encuentra el fondo');
}

console.log('\n3. La cifra cabe en la casilla');
{
  const precio = bloque('.up-price');
  check('el precio nunca se parte en dos líneas',
    !!precio && /white-space:\s*nowrap/.test(precio));
  check('hay un ajuste de tamaño para que quepa',
    /function ajustarPrecio/.test(claim));
  check('el ajuste se aplica al enseñar el precio',
    /ajustarPrecio\(pill, flash\)/.test(claim));
  // El fallo estaba en medir la CAJA: con `inset: 0` su ancho es el de la
  // casilla pase lo que pase, así que daba la misma cifra para un "2,50" que
  // para un "999,95" y encogía también los precios que cabían de sobra.
  check('mide el texto, no la caja',
    /createRange\(\)/.test(claim) && /selectNodeContents\(flash\)/.test(claim),
    'con scrollWidth se encogen también las cifras cortas');

  // La regla de tres se queda corta por subpíxeles en las cifras largas: hay
  // que comprobar de verdad, no fiarse de la estimación.
  check('comprueba que ha cabido en vez de estimarlo',
    /for \(let i = 0; i < 3; i\+\+\)/.test(claim));
}

console.log('\n4. Un ticket tumbado no se escanea');
{
  check('el botón de escanear se bloquea si hay alguna foto tumbada',
    /scanBtn\.disabled = cuantas > 0/.test(upload),
    'sin esto vuelve a dejarse escanear de lado, y la lectura sale mal');
  check('la foto culpable se señala una por una',
    /classList\.toggle\('tumbada'/.test(upload),
    'con varias fotos, "alguna está girada" obliga a mirarlas todas');
  const marca = bloque('.preview-overlay .thumb.tumbada');
  check('la tumbada se marca en rojo en la propia foto',
    !!marca && /var\(--red\)/.test(marca));
}

console.log('\n5. La ayuda de repasar el ticket no se mueve');
{
  // Lleva las dos clases, y con .claim-help se llevaba el latido que se puso
  // para la pantalla de las casillas. Ahi tiene sentido -es la unica ayuda y
  // nadie la abria-; en la de repasar el ticket no: lo que hay que mirar son
  // las cifras, y un texto moviendose al lado se lleva la vista a otro sitio.
  const rev = bloque('.review-help > summary') || '';
  check('la linea de "\u00bffalta algo o no cuadra?" no respira',
    /animation:\s*none/.test(rev),
    'hereda el latido de .claim-help si no se le apaga aqui');
  // Y la de las casillas sigue respirando: apagar una no puede apagar la otra.
  const ayuda = bloque('.claim-help > summary') || '';
  check('la de "\u00bfcomo funciona?" si sigue respirando',
    /animation:\s*ayuda-respira/.test(ayuda));
}

console.log('\n6. La firma solo donde toca');
{
  const conFirma = fs.readdirSync(PUB)
    .filter(f => f.endsWith('.html'))
    .filter(f => /A\.S\.F/.test(fs.readFileSync(path.join(PUB, f), 'utf8')));
  check('"desarrollado por A.S.F" solo está en index.html',
    conFirma.length === 1 && conFirma[0] === 'index.html',
    'aparece en: ' + conFirma.join(', '));

  const index = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  check('la pantalla de carga lleva la suya', /class="easter-egg proc-firma"/.test(index));

  // Estuvo con `absolute`, y `absolute` la ata a la caja de .processing: esa
  // caja acaba donde acaba su min-height, no donde acaba el movil, asi que la
  // firma se quedaba flotando a media altura. `fixed` la ata a la pantalla.
  const firma = bloque('.proc-firma') || '';
  check('va abajo del todo de la PANTALLA, no de su caja',
    /position:\s*fixed/.test(firma) && /bottom:/.test(firma),
    'con absolute vuelve a quedarse a media altura');
  // Y sin esto, la barra de gestos del iPhone se la come.
  check('esquiva la barra de gestos del iPhone',
    /env\(safe-area-inset-bottom/.test(firma));
}

console.log('\n7. Los consejos de la pantalla de carga');
{
  const ctx = { window: {}, document: { documentElement: {} }, navigator: {},
                localStorage: { getItem: () => null, setItem: () => {} }, out: null };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(PUB, 'js', 'i18n.js'), 'utf8') +
                  '\nout = translations;', ctx);
  const T = ctx.out;
  const idiomas = Object.keys(T);

  // Al principio rotaban cada 4,6 s. Escanear tarda menos que eso: no daba
  // tiempo a leer el segundo, y un texto que se va a media lectura molesta
  // mas de lo que aporta. Uno por escaneo, quieto hasta que acabe.
  check('el consejo no rota en pantalla',
    !/setInterval/.test(upload),
    'volvio la rueda: escanear acaba antes de que se lea el segundo');
  check('cada escaneo trae uno distinto',
    /ct_ultimo_consejo/.test(upload),
    'sin recordar el anterior, con ocho frases sale repetida mas de lo que parece');

  check('los siete idiomas tienen consejos',
    idiomas.every(l => Array.isArray(T[l].tips)),
    'sin consejos: ' + idiomas.filter(l => !Array.isArray(T[l].tips)).join(', '));
  check('todos tienen los mismos ocho',
    idiomas.every(l => T[l].tips && T[l].tips.length === 8),
    idiomas.map(l => l + ':' + (T[l].tips || []).length).join(' '));
  check('ninguno está vacío',
    idiomas.every(l => (T[l].tips || []).every(x => x && x.trim().length > 10)));

  // El fallo típico al añadir un idioma es copiar el bloque de al lado y
  // dejarse los textos sin traducir. Si dos idiomas comparten una frase
  // literal, es que alguien copió y no tradujo.
  const sinTraducir = [];
  for (let i = 0; i < idiomas.length; i++) {
    for (let j = i + 1; j < idiomas.length; j++) {
      const a = T[idiomas[i]].tips || [], b = T[idiomas[j]].tips || [];
      a.forEach((frase, k) => {
        if (frase === b[k]) sinTraducir.push(idiomas[i] + '=' + idiomas[j] + ' #' + (k + 1));
      });
    }
  }
  check('ninguno se ha quedado sin traducir', sinTraducir.length === 0,
    sinTraducir.join(', '));

  // Van dentro de cadenas con comillas simples: una apóstrofe recta las parte.
  // Ya rompió el fichero entero una vez.
  const crudo = fs.readFileSync(path.join(PUB, 'js', 'i18n.js'), 'utf8');
  const zona = crudo.match(/tips: \[[\s\S]*?\],/g) || [];
  check('las apóstrofes son tipográficas, no rectas',
    zona.every(z => !/[^,\[\s]'[a-zA-Z]/.test(z)),
    'una apóstrofe recta dentro de una cadena de comillas simples parte el fichero');
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
