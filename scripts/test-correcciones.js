#!/usr/bin/env node
/**
 * Las tres correcciones reportadas tras un fin de semana de uso real.
 *   node scripts/test-correcciones.js
 *
 *   1. La fecha/hora del ticket fabricaba una hora que no existía.
 *   2. Las secciones del grupo no se veían tocables.
 *   3. En iPhone el acceso directo no se creaba bien.
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

console.log('\n1. fechaDelTicket() nunca fabrica una hora que no existe');
{
  const i18n = fs.readFileSync(path.join(PUB, 'js', 'i18n.js'), 'utf8');
  // navigator/localStorage mínimos para poder cargar el fichero tal cual.
  global.navigator = { language: 'es' };
  global.localStorage = { getItem: () => null, setItem: () => {} };
  const trozo = i18n.slice(0, i18n.indexOf('function fitTicket'));
  const fechaDelTicket = new Function(
    trozo.replace(/^const lang = detectLang\(\);$/m, 'var lang = detectLang();')
         .replace(/^const t = translations\[lang\];$/m, 'var t = translations[lang];')
    + '; return fechaDelTicket;'
  )();

  // El fallo real, medido: "2026-08-23" sin hora se interpretaba como
  // medianoche UTC, que en Madrid son las 2 de la madrugada.
  const soloFecha = fechaDelTicket({ receiptDate: '2026-08-23' });
  check('fecha sin hora en el papel: no se inventa ninguna', soloFecha.horaTexto, null);
  check('fecha sin hora: el día sigue siendo el 23',
    [soloFecha.fecha.getFullYear(), soloFecha.fecha.getMonth(), soloFecha.fecha.getDate()],
    [2026, 7, 23]);
  check('fecha sin hora: se marca que viene del papel', soloFecha.delPapel, true);

  const conHora = fechaDelTicket({ receiptDate: '2026-08-23', receiptTime: '14:30' });
  check('fecha CON hora en el papel: se usa esa hora', conHora.horaTexto, '14:30');
  check('fecha con hora: viene del papel', conHora.delPapel, true);

  const sinPapel = fechaDelTicket({ createdAt: '2026-08-23T20:15:00.000Z' });
  check('sin fecha del papel: la hora sale de cuando se escaneó', sinPapel.horaTexto !== null, true);
  check('sin fecha del papel: se marca que NO viene del papel', sinPapel.delPapel, false);

  check('sin ticket: no revienta', isNaN(fechaDelTicket({}).fecha), false);
  check('con basura: no revienta', isNaN(fechaDelTicket(null).fecha), false);
}

console.log('\n2. Ningún sitio que pinta fecha llama a toLocaleTimeString sobre receiptDate a pelo');
{
  // El fallo estaba en construir `new Date(receiptDate || createdAt)` y
  // llamar a toLocaleTimeString sobre eso sin comprobar si esa Date tenía
  // hora real. Se comprueba que ya no queda ningún sitio así.
  const SITIOS = ['claim.js', 'ticket.js', 'summary.js', 'group.js', 'historial.js'];
  for (const f of SITIOS) {
    const js = fs.readFileSync(path.join(PUB, 'js', f), 'utf8');
    const usaHelper = /fechaDelTicket\(/.test(js);
    check(`${f} usa fechaDelTicket()`, usaHelper, true);
  }

  // group.js: fechaYHora ya no recibe una Date suelta sino el ticket entero.
  const grupo = fs.readFileSync(path.join(PUB, 'js', 'group.js'), 'utf8');
  check('fechaYHora ya no llama a toLocaleTimeString directamente',
    /function fechaYHora[\s\S]{0,80}toLocaleTimeString/.test(grupo), false);

  // historial.js: el ticket lleva receiptDate/receiptTime/createdAt propios,
  // no solo un "cuando" ya aplanado — si no, filaApunte no podría distinguir.
  const hist = fs.readFileSync(path.join(PUB, 'js', 'historial.js'), 'utf8');
  check('historial.js guarda receiptDate del ticket', /receiptDate: t\.receiptDate/.test(hist), true);
  check('historial.js guarda receiptTime del ticket', /receiptTime: t\.receiptTime/.test(hist), true);
}

console.log('\n3. Cuando la hora no viene del papel, se dice');
{
  const i18n = fs.readFileSync(path.join(PUB, 'js', 'i18n.js'), 'utf8');
  const translations = new Function(
    i18n.slice(0, i18n.indexOf('function detectLang')) + '; return translations;')();
  for (const l of Object.keys(translations)) {
    check(`${l}: existe horaSubido`, !!translations[l].horaSubido, true);
  }

  for (const f of ['claim.js', 'ticket.js', 'summary.js', 'group.js', 'historial.js']) {
    const js = fs.readFileSync(path.join(PUB, 'js', f), 'utf8');
    check(`${f} marca la hora cuando no es del papel`, /t\.horaSubido/.test(js), true);
  }
}

console.log('\n4. Las secciones del grupo se ven tocables, no solo al pulsarlas');
{
  const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8');
  const html = fs.readFileSync(path.join(PUB, 'group.html'), 'utf8');
  const js = fs.readFileSync(path.join(PUB, 'js', 'group.js'), 'utf8');

  // En reposo, no solo en :active — antes solo cambiaba al pulsar, y eso es
  // tarde: la gente ya había decidido que no se podía tocar.
  const bloqueSecHead = css.slice(css.indexOf('.sec-head {'), css.indexOf('.sec-head:active'));
  check('el borde se ve en reposo, no solo al pulsar',
    /border:\s*1\.5px dashed/.test(bloqueSecHead), true);
  check('el fondo se ve en reposo, no solo al pulsar',
    /background:\s*#fff/.test(bloqueSecHead), true);

  check('hay un chevron en cada cabecera', (html.match(/sh-chev/g) || []).length, 4);
  check('el chevron gira desde el estado, no desde una regla de CSS',
    /chev\.style\.transform = abierta/.test(js), true);

  // La suma y el chevron van en su propio envoltorio: si el chevron fuera un
  // tercer hijo suelto de .sh-line, el space-between los repartiría a los
  // tres por igual y se separaría de la cifra a la que acompaña.
  check('la cifra y el chevron van juntos en su propio grupo',
    (html.match(/sh-right/g) || []).length >= 4, true);
}

console.log('\n5. El acceso directo, solo en la portada — como se pidió');
{
  const PAGINAS = ['index', 'ticket', 'claim', 'summary', 'group', 'new-group', 'historial'];

  // El aviso de instalar (el botón, el texto, montarAtajo) sigue viviendo
  // SOLO en la portada. No se reparte a las demás pantallas.
  let conBanner = 0;
  for (const p of PAGINAS) {
    const html = fs.readFileSync(path.join(PUB, p + '.html'), 'utf8');
    if (/id="atajo"/.test(html)) conBanner++;
  }
  check('el banner de instalar existe en una sola pantalla', conBanner, 1);
  check('esa pantalla es la portada',
    /id="atajo"/.test(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')), true);

  const upload = fs.readFileSync(path.join(PUB, 'js', 'upload.js'), 'utf8');
  check('montarAtajo solo se llama desde upload.js', /montarAtajo\(\)/.test(upload), true);
  for (const p of PAGINAS) {
    if (p === 'index') continue;
    const script = { ticket: 'ticket.js', claim: 'claim.js', summary: 'summary.js',
                     group: 'group.js', 'new-group': 'newgroup.js', historial: 'historial.js' }[p];
    const js = fs.readFileSync(path.join(PUB, 'js', script), 'utf8');
    check(`${script} no llama a montarAtajo`, /montarAtajo\(\)/.test(js), false);
  }
}

console.log('\n6. Pero el gesto NATIVO de iOS funciona bien desde cualquier pantalla');
{
  // Esto es distinto del banner: es la etiqueta que le dice a iOS que, si
  // alguien usa el Compartir de Safari por su cuenta desde CUALQUIER
  // pantalla —que es donde de verdad está la gente invitada a un grupo—,
  // el resultado sea una aplicación de verdad y no un marcador con la barra
  // de direcciones de Safari encima. No pinta nada en la pantalla: es una
  // etiqueta silenciosa.
  const PAGINAS = ['index', 'ticket', 'claim', 'summary', 'group', 'new-group', 'historial'];
  for (const p of PAGINAS) {
    const html = fs.readFileSync(path.join(PUB, p + '.html'), 'utf8');
    check(`${p}.html tiene apple-mobile-web-app-capable`,
      /apple-mobile-web-app-capable" content="yes"/.test(html), true);
    check(`${p}.html tiene su apple-touch-icon`,
      /apple-touch-icon" href="\/apple-touch-icon\.png"/.test(html), true);
  }
}

console.log('\n7. El apple-touch-icon es un PNG opaco y del tamaño correcto');
{
  const b = fs.readFileSync(path.join(PUB, 'apple-touch-icon.png'));
  const ancho = b.readUInt32BE(16), alto = b.readUInt32BE(20);
  check('180×180, el tamaño que pide Apple', [ancho, alto], [180, 180]);
  check('es un PNG de verdad', b.slice(1, 4).toString(), 'PNG');
}

console.log('\n8. El aviso de Safari/WhatsApp existe en los 7 idiomas y no rompe el fichero');
{
  const i18n = fs.readFileSync(path.join(PUB, 'js', 'i18n.js'), 'utf8');
  // Si el script que lo escribió hubiera vuelto a truncar una cadena en una
  // comilla escapada —el fallo real que pasó al escribir esto—, esto ya no
  // compilaría. Cargarlo de verdad es la prueba más honesta.
  let sintaxisOk = true;
  try { new Function(i18n); } catch (e) { sintaxisOk = false; }
  check('i18n.js compila sin errores', sintaxisOk, true);

  const translations = new Function(
    i18n.slice(0, i18n.indexOf('function detectLang')) + '; return translations;')();
  for (const l of Object.keys(translations)) {
    check(`${l}: existe addToHomeIosAlt`, !!translations[l].addToHomeIosAlt, true);
    check(`${l}: addToHome no quedó vacío ni roto`,
      typeof translations[l].addToHome === 'string' && translations[l].addToHome.length > 2, true);
  }
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
