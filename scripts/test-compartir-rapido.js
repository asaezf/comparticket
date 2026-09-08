#!/usr/bin/env node
/**
 * Compartir un ticket: una peticion, no cuatro.
 *   node scripts/test-compartir-rapido.js
 *
 * Alvaro reporto que el boton de compartir "pega un lagazo". La causa medida
 * en el codigo: tres esperas encadenadas -PUT /items, luego /payer y
 * /participants, luego /share- y cada una con su arranque en frio de la
 * funcion en Vercel y su ida y vuelta a Firestore. Ocho operaciones para un
 * gesto.
 *
 * Estas pruebas fijan las dos cosas que hacen que no vuelva: que la pantalla
 * mande todo junto, y que el servidor compruebe el cuadre ANTES de escribir.
 */
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? 'ok   ' : 'FALLA'}  ${l}`);
  if (!c && d !== undefined) console.log('         ' + d); c ? pass++ : fail++; };

const cli = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'ticket.js'), 'utf8');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');

console.log('\n1. La pantalla manda todo en la misma peticion');
{
  const i = cli.indexOf("const textoOriginal = btn.textContent;");
  const j = cli.indexOf("showShare();", i);
  const bloque = cli.slice(i, j);
  const peticiones = (bloque.match(/await fetch\(|fetch\(`/g) || []).length;
  ok('el gesto de compartir hace UNA peticion, no cuatro', peticiones === 1,
    'se contaron ' + peticiones);
  ok('y lleva los articulos dentro', /items: ticketData\.items/.test(bloque));
  ok('  el total', /total: ticketData\.total/.test(bloque));
  ok('  el pagador', /payerName,/.test(bloque));
  ok('  y los participantes', /expectedParticipants: pVal/.test(bloque));
  ok('ya no hay un PUT de articulos suelto en este camino',
    !/tickets\/\$\{ticketId\}\/items/.test(bloque));
}

console.log('\n2. El servidor lo acepta, y valida lo que llega');
{
  const i = srv.indexOf("app.post('/api/tickets/:id/share'");
  const bloque = srv.slice(i, srv.indexOf("app.post('/api/tickets/:id/close'"));
  ok('los articulos pasan por asItems', /asItems\(cuerpo\.items\)/.test(bloque));
  ok('unos articulos invalidos se rechazan', /BAD_ITEMS/.test(bloque));
  ok('el total pasa por asNumber', /asNumber\(cuerpo\.total/.test(bloque));
  ok('el pagador pasa por asText', /asText\(cuerpo\.payerName, 40\)/.test(bloque));
  ok('los participantes se acotan', /min: 1, max: 50/.test(bloque));
}

console.log('\n3. Es dinero: el cuadre se mira ANTES de escribir');
{
  const i = srv.indexOf("app.post('/api/tickets/:id/share'");
  const bloque = srv.slice(i, srv.indexOf("app.post('/api/tickets/:id/close'"));
  const posCuadre = bloque.indexOf('money.reconcileTicket');
  const posEscritura = bloque.indexOf('db.updateTicketItems');
  ok('reconcileTicket va antes de la primera escritura',
    posCuadre !== -1 && posEscritura !== -1 && posCuadre < posEscritura,
    `cuadre en ${posCuadre}, escritura en ${posEscritura}`);
  ok('y se comprueba sobre lo que se VA a guardar, no sobre lo ya guardado',
    /reconcileTicket\(itemsFinales, totalFinal\)/.test(bloque));
  ok('un ticket descuadrado sigue devolviendo 409', /UNBALANCED_TICKET/.test(bloque));
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
