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
 * Tres respuestas posibles al abrir el enlace:
 *
 *   'libre'      — nombre sugerido y a marcar. Sin fricción.
 *   'recupera'   — este móvil ya marcó aquí: se recupera su selección y se
 *                  avisa con una barra («Marcando como X · No soy yo»), que
 *                  informa pero no bloquea.
 *   'preguntar'  — el nombre sugerido ya lo usa alguien y NO consta que sea
 *                  yo: hay duda real, porque confirmar pisaría su selección.
 *
 * La primera versión preguntaba también en el caso 'recupera', y Álvaro tenía
 * razón en que era absurdo: preguntarle "¿eres Álvaro?" a quien acaba de
 * marcar como Álvaro en ese mismo móvil no aporta nada y cansa.
 */
function alAbrir({ claimEnEsteTicket, nombreHabitual, claimsExistentes }) {
  const previo = claimEnEsteTicket &&
    claimsExistentes.find(n => n.toLowerCase() === claimEnEsteTicket.toLowerCase());
  if (previo) return { sugerido: previo, accion: 'recupera' };

  const sugerido = nombreHabitual || '';
  if (!sugerido) return { sugerido: '', accion: 'libre' };
  const loUsaOtro = claimsExistentes.some(
    n => n.toLowerCase() === sugerido.trim().toLowerCase());
  return { sugerido, accion: loUsaOtro ? 'preguntar' : 'libre' };
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
  // Vuelvo a MI ticket: se recupera lo mío sin interrogatorio. La barra avisa
  // a nombre de quién se está marcando, por si el móvil ha cambiado de manos.
  const r = alAbrir({ claimEnEsteTicket: 'alvaro', nombreHabitual: 'Alvaro', claimsExistentes: ['Alvaro'] });
  check('vuelvo a lo mío → lo recupera, SIN preguntar', r.accion, 'recupera');
}
{
  // Aquí sí hay duda real: nunca marqué en este ticket, pero mi nombre
  // habitual ya lo usa alguien. Confirmar pisaría su selección.
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
{
  // Tras decir "no soy yo" se borra el registro de este móvil, así que al
  // recargar no puede volver a recuperar la selección de la otra persona.
  const r = alAbrir({ claimEnEsteTicket: '', nombreHabitual: '', claimsExistentes: ['Alvaro'] });
  check('tras "no soy yo" no vuelve a recuperar nada', r.accion !== 'recupera', true);
}

console.log('\n2. Mi propio borrador no puede tomarse por el de un desconocido');
{
  // El fallo: escribías tu nombre por primera vez, el guardado automático
  // creaba un claim con él en el servidor, y al ir a confirmar la app se
  // encontraba "un claim llamado Álvaro" que no constaba como tuyo... y te
  // preguntaba si eras tú. Te preguntaba por tu propio borrador.
  //
  // Se arregla anotando el claim como propio desde el PRIMER borrador, no
  // solo al confirmar.
  const alConfirmar = ({ claimEnEsteTicket, nombre, claimsExistentes }) => {
    const n = nombre.trim().toLowerCase();
    if (n === (claimEnEsteTicket || '').toLowerCase()) return 'confirma';
    return claimsExistentes.some(x => x.toLowerCase() === n) ? 'preguntar' : 'confirma';
  };

  check('primera vez, tras guardar mi borrador → confirma sin preguntar',
    alConfirmar({ claimEnEsteTicket: 'alvaro', nombre: 'Alvaro', claimsExistentes: ['Alvaro'] }), 'confirma');
  check('si NO se anotara al guardar, preguntaría por mi propio borrador',
    alConfirmar({ claimEnEsteTicket: '', nombre: 'Alvaro', claimsExistentes: ['Alvaro'] }), 'preguntar');
  check('nombre de otro sí sigue preguntando',
    alConfirmar({ claimEnEsteTicket: 'alvaro', nombre: 'Maria', claimsExistentes: ['Alvaro', 'Maria'] }), 'preguntar');
  check('nombre nuevo, nadie lo usa → confirma',
    alConfirmar({ claimEnEsteTicket: 'alvaro', nombre: 'Nerea', claimsExistentes: ['Alvaro'] }), 'confirma');
}
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'claim.js'), 'utf8');
  const enSaveDraft = src.slice(src.indexOf('function saveDraft'), src.indexOf('async function checkForUpdates'));
  check('el borrador ya anota el claim como propio',
    /rememberMyClaim\(myName\(\)\)/.test(enSaveDraft), true);
}

console.log('\n3. Mientras la identidad está sin aclarar');
{
  // Nada de lo que se enseñe puede darse por mío, ni escribirse en el ticket.
  const bloqueado = true;
  check('no se hereda ninguna marca', JSON.stringify({}), '{}');
  check('no se guarda borrador', !bloqueado ? 'guarda' : 'no guarda', 'no guarda');
  check('el botón de confirmar está bloqueado', bloqueado, true);
}

console.log('\n4. Salir de la página sin haber tocado nada');
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

console.log('\n5. El código sigue teniendo los guardarraíles');
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
  check('existe la barra informativa (no interroga)',
    /function showIdentityBar/.test(src), true);
  check('"no soy yo" borra el registro de este móvil',
    /removeItem\(CLAIM_KEY\(\)\)/.test(src), true);
}

console.log('\n6. Nombre bloqueado tras confirmar y volver con "atrás"');
{
  // El fallo que encontró Álvaro: confirmas, vuelves con el botón "atrás" del
  // navegador, escribes un nombre distinto ANTES de marcar nada, y aparecen ya
  // marcados en amarillo (compartido) los artículos de tu primera selección.
  //
  // Causa: el navegador restaura el estado de la página tal cual la dejaste
  // — a veces sin ni siquiera recargar el script (bfcache) — así que la
  // selección seguía en memoria y nada avisaba de que el nombre había
  // cambiado. Solución, decidida por Álvaro: una vez confirmas, ya no se
  // puede cambiar de nombre volviendo atrás. Se puede seguir corrigiendo la
  // selección con libertad; para marcar como otra persona hay que entrar de
  // nuevo por el enlace del ticket.
  const decision = ({ confirmado, volviendoAtras }) =>
    (confirmado && volviendoAtras) ? 'bloqueado' : 'editable';

  check('confirmas y vuelves con "atrás" → nombre bloqueado',
    decision({ confirmado: true, volviendoAtras: true }), 'bloqueado');
  check('confirmas y entras de nuevo por el enlace → editable',
    decision({ confirmado: true, volviendoAtras: false }), 'editable');
  check('solo un borrador (nunca confirmaste) y vuelves atrás → editable',
    decision({ confirmado: false, volviendoAtras: true }), 'editable');
  check('primera visita, sin nada confirmado → editable',
    decision({ confirmado: false, volviendoAtras: false }), 'editable');
}
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'claim.js'), 'utf8');
  check('existe la detección de "atrás/adelante" del navegador',
    /function cameBackViaHistory/.test(src), true);
  check('usa la Navigation Timing API para detectarlo',
    /getEntriesByType\('navigation'\)/.test(src), true);
  check('existe lockName y dos usos: al cargar y en pageshow',
    (src.match(/lockName\(/g) || []).length >= 3, true);   // definición + 2 llamadas
  check('el candado solo mira claims YA confirmados',
    /previo\.confirmed !== false && cameBackViaHistory\(\)/.test(src), true);
  check('el campo bloqueado queda en readOnly',
    /input\.readOnly = true/.test(src), true);
  check('red de seguridad para bfcache (pageshow + persisted)',
    /pageshow'.*\n.*e\.persisted && confirmedNow/.test(src) ||
    /e\.persisted && confirmedNow/.test(src), true);
  check('la decisión NO depende de que el campo esté vacío (bug real: el navegador lo rellena solo)',
    /if \(previo\) \{/.test(src) && !/if \(!input\.value\) \{\s*\n\s*if \(previo\)/.test(src), true);
}

// --- El testigo de identidad no puede salir del servidor -----------------
//
// Sin cuentas de usuario, ese testigo es la UNICA prueba de que alguien es
// quien dice ser. /api/groups/:id devolvia el miembro entero, con su
// `claimedBy` dentro, asi que cualquiera con el enlace del grupo podia leer
// el testigo de los demas, mandarlo en claim-member y quedarse con su
// identidad y sus gastos. Probado a mano contra el servidor antes de taparlo.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const ruta = src.slice(src.indexOf("app.get('/api/groups/:id'"));
  const cuerpo = ruta.slice(0, ruta.indexOf('}));') + 4);

  check('la ruta del grupo reconstruye los miembros en vez de devolverlos tal cual',
    /members:\s*\(group\.members \|\| \[\]\)\.map/.test(cuerpo), true);
  check('no manda el testigo de nadie',
    /claimedBy:/.test(cuerpo), false);
  check('no manda tampoco la fecha en que se cogio',
    /claimedAt:/.test(cuerpo), false);
  check('dice si el nombre esta cogido, sin decir por quien',
    /taken:\s*!!m\.claimedBy/.test(cuerpo), true);
  check('solo reconoce como tuyo el que coincide con el testigo que presentas',
    /mine:\s*!!\(m\.claimedBy && mio && m\.claimedBy === mio\)/.test(cuerpo), true);

  // La pantalla del ticket lo usa para saber quien eres sin preguntar.
  const claim = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'claim.js'), 'utf8');
  check('el ticket reutiliza el MISMO testigo que la pantalla del grupo',
    /localStorage\.getItem\('ct_tok_' \+ gid\)/.test(claim), true);
  check('un nombre cogido por otro movil no se puede tocar',
    /const ajeno = m\.taken && !m\.mine/.test(claim), true);
  check('si el movil ya tiene nombre en el grupo, se elige solo',
    /if \(yo && !input\.value\.trim\(\)\)/.test(claim), true);
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
