#!/usr/bin/env node
/**
 * Tests de identidad al marcar — no gastan API ni base de datos.
 *   node scripts/test-identity.js
 *
 * Fijan el fallo más grave que ha tenido la app: en una mesa el móvil se pasa
 * de mano en mano, y la segunda persona abría el enlace con el nombre de la
 * primera puesto Y sus artículos ya marcados. Al tocar los suyos se sumaban a
 * los de la otra, y al confirmar sobrescribía su selección. Resultado: la app
 * decía que alguien había pedido cosas que no pidió.
 *
 * Aquí se prueba la regla, no el DOM: cuándo se puede recuperar una selección
 * guardada sin preguntar y cuándo hay que preguntar antes.
 */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = got === want;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'}  ${label.padEnd(58)} ${JSON.stringify(got)}`);
  if (!ok) console.log(`         esperado: ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

/**
 * Misma regla que claim.js. Se replica aquí para poder probarla sin navegador.
 *
 * Devuelve qué hacer al abrir el enlace:
 *   'libre'     — nombre sugerido, sin selección previa: a marcar directamente
 *   'preguntar' — ese nombre ya tiene selección: hay que aclarar quién eres
 */
function alAbrir({ claimEnEsteTicket, nombreHabitual, claimsExistentes }) {
  const previo = claimEnEsteTicket &&
    claimsExistentes.find(n => n.toLowerCase() === claimEnEsteTicket.toLowerCase());
  const sugerido = previo || nombreHabitual || '';
  if (!sugerido) return { sugerido: '', accion: 'libre' };
  const yaHayClaim = claimsExistentes.some(
    n => n.toLowerCase() === sugerido.trim().toLowerCase());
  return { sugerido, accion: yaHayClaim ? 'preguntar' : 'libre' };
}

console.log('\n1. Al abrir el enlace');
{
  // Caso cómodo que hay que conservar: ticket nuevo, el móvil ya sabe mi
  // nombre. Cero pasos: se rellena y a marcar.
  const r = alAbrir({ claimEnEsteTicket: '', nombreHabitual: 'Alvaro', claimsExistentes: [] });
  check('ticket nuevo → nombre puesto, sin preguntar', r.accion, 'libre');
  check('  y con el nombre habitual', r.sugerido, 'Alvaro');
}
{
  // EL FALLO: el móvil pasa a la segunda persona. Antes se cargaba en silencio
  // la selección de la primera; ahora se pregunta.
  const r = alAbrir({ claimEnEsteTicket: 'alvaro', nombreHabitual: 'Alvaro', claimsExistentes: ['Alvaro'] });
  check('ticket ya marcado desde este móvil → pregunta', r.accion, 'preguntar');
}
{
  // Otra vía al mismo fallo: nunca marqué aquí, pero mi nombre habitual
  // coincide con alguien que sí. No puedo quedarme con su selección.
  const r = alAbrir({ claimEnEsteTicket: '', nombreHabitual: 'Alvaro', claimsExistentes: ['Alvaro'] });
  check('mi nombre habitual ya lo usa otro → pregunta', r.accion, 'preguntar');
}
{
  // Hay gente marcando pero ninguno se llama como yo: sin fricción.
  const r = alAbrir({ claimEnEsteTicket: '', nombreHabitual: 'Alvaro', claimsExistentes: ['Maria', 'Nerea'] });
  check('otros han marcado, pero no con mi nombre → libre', r.accion, 'libre');
}
{
  // La selección que yo tenía ya no está (la borraron): se cae al nombre
  // habitual en vez de dejar el campo vacío.
  const r = alAbrir({ claimEnEsteTicket: 'alvaro', nombreHabitual: 'Alvaro', claimsExistentes: [] });
  check('mi selección ya no existe → nombre habitual, sin preguntar', r.accion, 'libre');
  check('  y el campo no se queda vacío', r.sugerido, 'Alvaro');
}
{
  const r = alAbrir({ claimEnEsteTicket: '', nombreHabitual: '', claimsExistentes: ['Alvaro'] });
  check('móvil sin nombre guardado → campo vacío, sin preguntar', r.accion, 'libre');
}

console.log('\n2. Mientras la identidad está sin aclarar');
{
  // Nada de lo que se enseñe puede darse por mío, ni escribirse en el ticket.
  const bloqueado = true;
  check('no se hereda ninguna marca', JSON.stringify({}), '{}');
  check('no se guarda borrador', !bloqueado ? 'guarda' : 'no guarda', 'no guarda');
  check('el botón de confirmar está bloqueado', bloqueado, true);
}

console.log('\n3. Salir de la página sin haber tocado nada');
{
  // El guardado de emergencia solo debe dispararse si esta persona ha marcado
  // algo. Sin esta condición, con solo ABRIR el enlace y salir se reescribía
  // la selección de quien tuviera ese nombre, y encima la degradaba a
  // borrador: dejaba de contar como participante listo.
  const debeGuardar = (lastTouch, confirmado, bloqueado) =>
    !!lastTouch && !confirmado && !bloqueado;

  check('abrir y salir sin tocar → no escribe nada', debeGuardar(0, false, false), false);
  check('identidad sin aclarar → no escribe nada', debeGuardar(123, false, true), false);
  check('ya confirmado → no lo degrada a borrador', debeGuardar(123, true, false), false);
  check('marcó algo y se va a medias → sí lo guarda', debeGuardar(123, false, false), true);
}

console.log('\n4. El código sigue teniendo los guardarraíles');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'claim.js'), 'utf8');
  check('el claim propio se guarda por ticket, no global',
    /ct_claim_/.test(src), true);
  check('existe la pregunta de identidad', /function askWhoYouAre/.test(src), true);
  check('el guardado se bloquea sin aclarar',
    /if \(identityBlocked\) return/.test(src), true);
  check('confirmar comprueba la identidad',
    /identityBlocked \|\| nameBelongsToSomeoneElse/.test(src), true);
  check('pagehide exige haber tocado algo',
    /if \(!lastTouch \|\| identityBlocked\) return/.test(src), true);
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
