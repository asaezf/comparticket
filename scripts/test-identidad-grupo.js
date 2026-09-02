#!/usr/bin/env node
/**
 * Identidad de grupo sin cuentas: las cuatro medidas contra perder tu nombre.
 *   node scripts/test-identidad-grupo.js
 *
 * El problema de fondo: sin cuentas, ser "tú" en un grupo es un token en el
 * localStorage de UN navegador. Se pierde al borrar datos, al cambiar de
 * móvil, al entrar desde el navegador de dentro de WhatsApp (que en iPhone
 * guarda aparte), o porque Safari limpia solo el almacenamiento de sitios que
 * llevas días sin abrir. El grupo NO se pierde —vive en el servidor— pero la
 * persona sí se queda sin su nombre, y hasta ahora eso no tenía arreglo.
 */

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const PUB = path.join(RAIZ, 'public');

let pass = 0, fail = 0;
function ok(label, cond, detalle) {
  console.log(`  ${cond ? 'ok   ' : 'FALLA'}  ${label}`);
  if (!cond && detalle !== undefined) console.log('         ' + detalle);
  cond ? pass++ : fail++;
}

const grupoJs = fs.readFileSync(path.join(PUB, 'js', 'group.js'), 'utf8');
const grupoHtml = fs.readFileSync(path.join(PUB, 'group.html'), 'utf8');
const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const dbJs = fs.readFileSync(path.join(RAIZ, 'db.js'), 'utf8');

console.log('\n1. Un nombre cogido ya no es un botón muerto');
{
  // Antes la pastilla de un nombre cogido por otro salía deshabilitada:
  // tocarla no hacía nada y no se explicaba en ningún sitio que la causa más
  // probable eres tú mismo desde otro navegador.
  ok('la pastilla de otro ya no se deshabilita',
    !/b\.disabled = deOtro/.test(grupoJs));
  ok('tocarla lleva a la explicación',
    /deOtro \? nombreCogido\(m\) : elegirse\(m\)/.test(grupoJs));
  ok('la explicación menciona la causa real (otro móvil o navegador)',
    /otro móvil, otro navegador/.test(grupoJs));
  ok('y menciona el navegador de dentro de WhatsApp',
    /navegador de dentro de WhatsApp/.test(grupoJs));
  ok('un TAKEN del servidor entra por ahí y no por un toast seco',
    /err\.code === 'TAKEN'\) return nombreCogido\(m\)/.test(grupoJs));
}

console.log('\n2. Quien creó el grupo puede desatascar el nombre de otro');
{
  ok('db: releaseGroupMember acepta forzar', /function releaseGroupMember\(groupId, memberId, token, forzar\)/.test(dbJs));
  ok('db: forzar se salta la comprobación de propiedad',
    /if \(!forzar && miembros\[i\]\.claimedBy && miembros\[i\]\.claimedBy !== token\)/.test(dbJs));
  ok('servidor: la ruta acepta creatorKey', /const creatorKey = asText\(\(req\.body \|\| \{\}\)\.creatorKey, 40\)/.test(srv));
  ok('servidor: la clave se verifica de verdad contra el grupo',
    /forzar = await db\.verifyGroupKey\(req\.params\.id, creatorKey\)/.test(srv));
  ok('servidor: una clave inválida se rechaza con 403', /BAD_KEY/.test(srv));
  ok('servidor: sin testigo Y sin permiso de forzar, no se hace nada',
    /if \(!memberId \|\| \(!token && !forzar\)\)/.test(srv));
  ok('cliente: lee la clave del creador de este móvil',
    /localStorage\.getItem\('gk_' \+ groupId\)/.test(grupoJs));
  ok('cliente: solo ofrece el rescate si tiene esa clave',
    /const puedoRescatar = !!claveDeCreador/.test(grupoJs));
}

console.log('\n3. El enlace personal, para llevarte tu nombre a otro móvil');
{
  ok('se adopta el testigo que venga en la URL', /adoptarTestigoDeLaUrl/.test(grupoJs));
  ok('y se guarda como el testigo de este navegador',
    /localStorage\.setItem\(TOK_KEY, tok\)/.test(grupoJs));
  // Si el ?tok= se queda en la barra, acaba pegado en un chat sin querer y
  // quien lo abra pasa a ser esa persona.
  ok('el tok se quita de la barra de direcciones enseguida',
    /history\.replaceState\(null, '', limpia\)/.test(grupoJs));
  ok('hay botón para copiar/compartir tu enlace', /id="enlacePersonalBtn"/.test(grupoHtml));
  ok('el botón está enganchado',
    /getElementById\('enlacePersonalBtn'\)\.addEventListener/.test(grupoJs));
  ok('el enlace lleva el testigo', /\?tok=' \+ encodeURIComponent\(testigo\)/.test(grupoJs));
  ok('avisa de no pegarlo en el grupo', /No lo pegues en el grupo/.test(grupoJs));
  ok('no se ofrece antes de tener nombre',
    /\.who-block:not\(\.picked\) \.who-link \{ display: none; \}/.test(css));
}

console.log('\n4. Aviso cuando la sesión corre peligro');
{
  ok('existe el hueco del aviso', /id="avisoSesion"/.test(grupoHtml));
  ok('se comprueba si el navegador deja guardar de verdad',
    /localStorage\.setItem\('ct_probe', '1'\)/.test(grupoJs));
  ok('se detecta el navegador embebido de WhatsApp y compañía',
    /WhatsApp\|FBAN\|FBAV\|Instagram/.test(grupoJs));
  ok('sin almacenamiento se explica que no podrá coger nombre',
    /no deja guardar la sesión/.test(grupoJs));
  ok('el aviso se pinta al pintar quién eres', /pintarAvisoSesion\(\);/.test(grupoJs));
  ok('tiene su estilo propio', /\.aviso-sesion \{/.test(css));
}

console.log('\n5. Lo que NO debe haber cambiado');
{
  // Coger un nombre libre sigue exigiendo testigo, y el servidor sigue sin
  // dejar que nadie se cuele en el nombre de otro sin la clave del creador.
  ok('claim-member sigue exigiendo token', /if \(!memberId \|\| !token\) \{/.test(srv));
  ok('claimGroupMember sigue rechazando el nombre de otro',
    /if \(actual && actual !== token\) return \{ ok: false, code: 'TAKEN'/.test(dbJs));
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
