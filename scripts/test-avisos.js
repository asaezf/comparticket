#!/usr/bin/env node
/**
 * Los avisos del grupo.
 *   node scripts/test-avisos.js
 *
 * Un aviso mal filtrado no rompe ninguna cuenta, pero convierte la pantalla
 * en ruido y la gente deja de mirarla — que es justo lo contrario de lo que
 * se busca. Las dos reglas que lo evitan:
 *
 *   1. Nadie ve sus propias acciones. Acabas de añadir el gasto: ya lo sabes.
 *   2. Un recordatorio o un pago solo le sale a los dos implicados. Al resto
 *      del grupo no le cambia nada.
 *
 * Aquí se prueba la regla, replicada en JavaScript puro, más el cableado:
 * que el servidor apunte un evento en cada acción y que la pantalla cargue
 * el motor.
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

console.log('\n1. El servidor apunta un evento en cada acción');
{
  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const bd = fs.readFileSync(path.join(RAIZ, 'db.js'), 'utf8');

  for (const tipo of ['gasto-nuevo', 'ticket-nuevo', 'ticket-cerrado',
                      'pago-hecho', 'recordatorio']) {
    check(`emite '${tipo}'`, new RegExp(`tipo: '${tipo}'`).test(srv), true);
  }
  // El bloqueo sale de un ternario —'reparto-bloqueado' o 'reparto-abierto'
  // según lo que se pida— así que aquí no vale buscar `tipo: '...'`.
  check("emite 'reparto-bloqueado'", /'reparto-bloqueado'/.test(srv), true);
  check("emite 'reparto-abierto'", /'reparto-abierto'/.test(srv), true);
  check('existe la ruta de recordatorio', /\/api\/groups\/:id\/remind/.test(srv), true);
  check('los avisos viajan dentro del resumen', /db\.getGroupEvents\(groupId/.test(srv), true);

  // db.js solo conoce firebase-admin: un nanoid ahí reventaría en producción.
  check('db.js no usa nanoid para el id del evento',
    /nanoid\(/.test(bd), false);
  check('el id del evento lo pone Firestore', /eventsRef\(groupId\)\.doc\(\)/.test(bd), true);
  // Un aviso que no se puede guardar no puede tumbar la acción que lo provocó.
  check('addGroupEvent se traga sus propios errores',
    /await ref\.set\(doc\);\s*\n\s*\} catch \(_\) \{/.test(bd), true);
}

console.log('\n2. La pantalla de grupo carga el motor');
{
  const html = fs.readFileSync(path.join(PUB, 'group.html'), 'utf8');
  const js = fs.readFileSync(path.join(PUB, 'js', 'group.js'), 'utf8');
  check('group.html carga notify.js', /\/js\/notify\.js/.test(html), true);
  check('group.js pinta los avisos', /pintarAvisos\(\)/.test(js), true);
  check('la primera vez no salta nada', /primeraPasadaDeAvisos/.test(js), true);
  check('se recuerda lo ya avisado', /ct_avisos_/.test(js), true);
  check('recordar deja constancia en el servidor', /\/remind'/.test(js), true);
  // Si el aviso falla, WhatsApp se abre igual: el recordatorio lo manda la
  // persona, no la aplicación.
  check('un fallo al apuntar el recordatorio no rompe el envío',
    /\/remind[\s\S]{0,400}?\.catch\(\(\) => \{\}\)/.test(js), true);
}

console.log('\n3. Nadie ve sus propias acciones');
{
  // La misma regla que pintarAvisos() en group.js.
  const meSale = (ev, yo) => !(yo && ev.actor === yo);

  check('quien añadió el gasto no se avisa a sí mismo',
    meSale({ tipo: 'gasto-nuevo', actor: 'Dani' }, 'Dani'), false);
  check('a los demás sí les llega',
    meSale({ tipo: 'gasto-nuevo', actor: 'Dani' }, 'Nerea'), true);
  check('sin nombre elegido, llega todo',
    meSale({ tipo: 'gasto-nuevo', actor: 'Dani' }, ''), true);
  check('un evento sin actor llega a todos',
    meSale({ tipo: 'reparto-bloqueado', actor: null }, 'Dani'), true);
}

console.log('\n4. Recordatorios y pagos, solo a los implicados');
{
  // La misma regla que textoDelAviso() en group.js.
  function leIncumbe(ev, yo) {
    const d = ev.datos || {};
    if (ev.tipo === 'recordatorio' || ev.tipo === 'pago-hecho') {
      return !!(yo && (d.de === yo || d.a === yo));
    }
    return true;   // el resto son cosas del grupo entero
  }

  const recordatorio = { tipo: 'recordatorio', datos: { de: 'Nerea', a: 'Maria', importe: 21 } };
  check('a quien debe, le llega',            leIncumbe(recordatorio, 'Nerea'), true);
  check('a quien cobra, le llega',           leIncumbe(recordatorio, 'Maria'), true);
  check('a un tercero, no',                  leIncumbe(recordatorio, 'Dani'), false);
  check('sin nombre elegido, tampoco',       leIncumbe(recordatorio, ''), false);

  const pago = { tipo: 'pago-hecho', datos: { de: 'Nerea', a: 'Maria', importe: 21 } };
  check('un pago le llega a quien paga',     leIncumbe(pago, 'Nerea'), true);
  check('y a quien cobra',                   leIncumbe(pago, 'Maria'), true);
  check('a un tercero, no',                  leIncumbe(pago, 'Dani'), false);

  // Estos sí son del grupo entero.
  for (const tipo of ['gasto-nuevo', 'ticket-nuevo', 'ticket-cerrado', 'reparto-bloqueado']) {
    check(`'${tipo}' le llega a cualquiera`, leIncumbe({ tipo, datos: {} }, 'Dani'), true);
  }
}

console.log('\n5. Los avisos no se repiten');
{
  // La misma regla que pintarAvisos(): todo evento nuevo pasa a "visto", se
  // enseñe o no. Uno que no te incumbe tampoco debe volver a evaluarse en el
  // siguiente latido.
  function pasada(eventos, vistos) {
    const nuevos = eventos.filter(e => !vistos.has(e.id));
    nuevos.forEach(e => vistos.add(e.id));
    return nuevos.map(e => e.id);
  }

  const vistos = new Set();
  const evs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  check('primera pasada: los tres son nuevos', pasada(evs, vistos), ['a', 'b', 'c']);
  check('segunda pasada: ninguno',             pasada(evs, vistos), []);
  check('llega uno más: solo ese',
    pasada(evs.concat([{ id: 'd' }]), vistos), ['d']);
}

console.log('\n6. El interruptor de silencio');
{
  const up = fs.readFileSync(path.join(PUB, 'js', 'upload.js'), 'utf8');
  const gr = fs.readFileSync(path.join(PUB, 'js', 'group.js'), 'utf8');
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8');

  check('la portada tiene el botón de la campana', /id="btnCampana"/.test(html), true);
  check('la campana lleva su raya para tacharla', /campana-tacha/.test(html), true);
  check('la preferencia se guarda en el móvil', /ct_avisos_silencio/.test(up), true);
  check('el grupo la respeta', /ct_avisos_silencio/.test(gr), true);

  // La raya la pone el JavaScript, no la cascada: getComputedStyle no es de
  // fiar para esto y una regla que no gana deja la campana sin tachar.
  check('la raya se dibuja desde el estado',
    /raya\.style\.strokeDashoffset = callado/.test(up), true);
  check('el CSS ya no fija el trazo',
    /\.silenciado \.campana-tacha/.test(css), false);

  // Se comprueba el silencio DESPUÉS de marcar los eventos como vistos: si no,
  // al quitar el silencio caerían de golpe todos los de los últimos días.
  const bloque = gr.slice(gr.indexOf('function pintarAvisos'));
  const cuerpo = bloque.slice(0, bloque.indexOf('\n}\n'));
  check('primero se marcan como vistos, luego se mira el silencio',
    cuerpo.indexOf('guardarVistos') < cuerpo.indexOf('ct_avisos_silencio'), true);
}

console.log('\n7. Las fotos del ticket');
{
  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const bd = fs.readFileSync(path.join(RAIZ, 'db.js'), 'utf8');
  const up = fs.readFileSync(path.join(PUB, 'js', 'upload.js'), 'utf8');
  const prep = fs.readFileSync(path.join(PUB, 'js', 'imgprep.js'), 'utf8');
  const hist = fs.readFileSync(path.join(PUB, 'js', 'historial.js'), 'utf8');

  check('existe la ruta para guardarlas', /\/api\/tickets\/:id\/photos', upload\.array/.test(srv), true);
  check('existe la ruta para verlas', /app\.get\('\/api\/tickets\/:id\/photos'/.test(srv), true);

  // Cada foto en su propio documento: el ticket ya lleva dentro artículos,
  // reparto y marcas, y un array de fotos reventaría el tope de 1 MB.
  check('cada foto va en su propio documento', /photosRef\(ticketId\)\.doc\(\)/.test(bd), true);
  check('hay un tope de tamaño', /TOPE_FOTO/.test(bd), true);
  check('el tope deja holgura bajo el 1 MB del documento',
    /const TOPE_FOTO = 700 \* 1024/.test(bd), true);
  // Una foto que no se puede guardar no puede tumbar el escaneo.
  check('addTicketPhoto nunca lanza', /catch \(_\) \{\s*\n\s*return null;\s*\n\s*\}/.test(bd), true);

  check('el navegador hace una copia reducida', /function archive\(/.test(prep), true);
  check('la copia va a 1000 px', /1000 \/ Math\.max\(w, h\)/.test(prep), true);
  check('archive está exportado', /return \{ prepare, shrink, archive/.test(prep), true);

  // Va DESPUÉS de crear el ticket y en otra petición: el escaneo ya va justo
  // contra el límite de Vercel, y si esto falla el ticket debe quedar creado.
  check('las fotos se suben aparte del escaneo',
    /\/photos', \{ method: 'POST', body: fdFotos \}/.test(up), true);
  check('un fallo al guardarlas no rompe el escaneo',
    /ImgPrep\.archive[\s\S]{0,500}?catch \(_\) \{/.test(up), true);

  check('el historial enseña el botón solo si hay fotos', /a\.fotos\s*\n?\s*\?/.test(hist), true);
  check('las fotos se piden al abrir el visor, no antes',
    /verFotos[\s\S]{0,600}?fetch\('\/api\/tickets\/'/.test(hist), true);
  // Ver la foto y entrar al ticket caen en el mismo sitio: sin esto, tocar la
  // cámara acabaría navegando.
  check('tocar la cámara no navega al ticket',
    /ev\.preventDefault\(\);\s*\n\s*ev\.stopPropagation\(\);\s*\n\s*verFotos/.test(hist), true);
  check('al cerrar se sueltan las imágenes de memoria',
    /cerrarVisor[\s\S]{0,400}?visorContenido'\)\.innerHTML = ''/.test(hist), true);
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
