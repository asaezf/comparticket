#!/usr/bin/env node
/**
 * Panel del gasto de IA.
 *   node scripts/panel-ia.js [días]
 *
 * Lee lo que la app va guardando en cada ticket (el bloque `uso`) y responde
 * a las tres preguntas que hacen falta para optimizar con datos y no a ojo:
 *
 *   1. ¿Está funcionando el caché? Los tokens en caché se cobran al ~10%.
 *   2. ¿Cuántas veces salta el modelo de respaldo? Cuesta 6x la entrada
 *      y 5x la salida — si sale a menudo, pesa más que ninguna otra cosa.
 *   3. ¿Cuánto cuesta de verdad un ticket?
 *
 * Cuesta una lectura por ticket del periodo. Con leerlo una vez por semana
 * sobra.
 */

require('dotenv').config();
const db = require('../db');

// Precios por millón de tokens. Ajustar si Google los cambia.
const PRECIOS = {
  'gemini-3.1-flash-lite': { in: 0.25, out: 1.50 },
  'gemini-3.6-flash':      { in: 1.50, out: 7.50 },
  'gemini-3-flash':        { in: 0.50, out: 3.00 },
  'gemini-2.5-flash':      { in: 0.30, out: 2.50 }
};
const DESCUENTO_CACHE = 0.10;   // los tokens cacheados cuestan ~10%

function coste(u) {
  const p = PRECIOS[u.modelo] || PRECIOS['gemini-3.1-flash-lite'];
  const cacheados = u.enCache || 0;
  const normales = Math.max(0, (u.entrada || 0) - cacheados);
  return (normales * p.in + cacheados * p.in * DESCUENTO_CACHE
        + ((u.salida || 0) + (u.pensamiento || 0)) * p.out) / 1e6;
}

const eur = n => n.toFixed(4).replace('.', ',');
const linea = () => console.log('─'.repeat(58));

(async () => {
  const dias = parseInt(process.argv[2], 10) || 30;
  const desde = new Date(Date.now() - dias * 86400000).toISOString();

  const tickets = await db.listTicketsSince(desde);
  const con = tickets.filter(t => t.uso);

  console.log('');
  console.log(`  GASTO DE IA · últimos ${dias} días`);
  linea();

  if (!tickets.length) {
    console.log('  No hay tickets en el periodo.');
    return process.exit(0);
  }
  if (!con.length) {
    console.log(`  ${tickets.length} tickets, pero ninguno con datos de uso.`);
    console.log('  Es normal si acabas de desplegar: solo los tickets nuevos');
    console.log('  los llevan. Vuelve a mirarlo en unos días.');
    return process.exit(0);
  }

  const tot = con.reduce((a, t) => {
    const u = t.uso;
    a.n++;
    a.entrada += u.entrada || 0;
    a.salida += u.salida || 0;
    a.pensamiento += u.pensamiento || 0;
    a.cache += u.enCache || 0;
    a.coste += coste(u);
    if (u.conRespaldo) a.respaldo++;
    if ((u.intentos || 1) > 1) a.reintentos++;
    a.ms += u.ms || 0;
    return a;
  }, { n: 0, entrada: 0, salida: 0, pensamiento: 0, cache: 0, coste: 0, respaldo: 0, reintentos: 0, ms: 0 });

  console.log(`  Tickets escaneados        ${tot.n}`);
  console.log(`  Coste total               ${eur(tot.coste)} $`);
  console.log(`  Coste por ticket          ${eur(tot.coste / tot.n)} $`);
  console.log(`  Tiempo medio              ${(tot.ms / tot.n / 1000).toFixed(1)} s`);
  linea();

  // 1. El caché
  const pctCache = tot.entrada ? (tot.cache / tot.entrada) * 100 : 0;
  console.log(`  Tokens de entrada         ${Math.round(tot.entrada / tot.n)} por ticket`);
  console.log(`  De ellos, en caché        ${Math.round(tot.cache / tot.n)} (${pctCache.toFixed(0)}%)`);
  if (pctCache < 5) {
    console.log('    → ⚠️  El caché NO se está aplicando.');
    console.log('       Hay ~11% de ahorro esperando ahí.');
  } else {
    const ahorrado = tot.cache * 0.25 * (1 - DESCUENTO_CACHE) / 1e6;
    console.log(`    → ✅ Funcionando. Te ha ahorrado ${eur(ahorrado)} $`);
  }
  linea();

  // 2. El modelo caro
  const pctResp = (tot.respaldo / tot.n) * 100;
  console.log(`  Con reintentos            ${tot.reintentos} (${((tot.reintentos / tot.n) * 100).toFixed(0)}%)`);
  console.log(`  Con el modelo CARO        ${tot.respaldo} (${pctResp.toFixed(0)}%)`);
  if (pctResp > 5) {
    console.log('    → 🔴 Salta demasiado. Cuesta 6x la entrada y 5x la salida.');
    console.log('       Suele ser por los límites del plan gratuito de Gemini.');
  } else if (tot.respaldo) {
    console.log('    → 🟡 Puntual. Normal: es la red de seguridad.');
  } else {
    console.log('    → ✅ Nunca ha hecho falta.');
  }
  linea();

  // 3. Dónde está el dinero
  const p = PRECIOS['gemini-3.1-flash-lite'];
  const cIn = (tot.entrada - tot.cache) * p.in / 1e6 + tot.cache * p.in * DESCUENTO_CACHE / 1e6;
  const cOut = (tot.salida + tot.pensamiento) * p.out / 1e6;
  const suma = cIn + cOut || 1;
  console.log(`  Entrada                   ${((cIn / suma) * 100).toFixed(0)}% del gasto`);
  console.log(`  Salida (el JSON)          ${((cOut / suma) * 100).toFixed(0)}% del gasto`);
  if (tot.pensamiento > 0) {
    console.log(`  ⚠️  Tokens de "pensar"     ${Math.round(tot.pensamiento / tot.n)} por ticket`);
    console.log('       Se facturan como salida y no hacen falta para transcribir.');
  }
  linea();

  // Proyección
  const porTicket = tot.coste / tot.n;
  console.log('  A este ritmo:');
  [100, 1000, 10000].forEach(n =>
    console.log(`    ${String(n).padStart(6)} tickets  →  ${(n * porTicket).toFixed(2)} $`));
  console.log('');
  process.exit(0);
})().catch(e => {
  console.error('\n  No se ha podido leer:', e.message, '\n');
  process.exit(1);
});
