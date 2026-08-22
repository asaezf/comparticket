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

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
