#!/usr/bin/env node
/**
 * Tests de cómo se guarda un claim — no gastan API ni base de datos.
 *   node scripts/test-claim-write.js
 *
 * Fijan el fallo más caro que ha tenido la app, y el que más tardó en salir
 * porque el servidor de pruebas en memoria NO lo reproducía.
 *
 * Firestore, con `set(datos, { merge: true })`, **fusiona los mapas
 * anidados**. `itemUnits` es un mapa {"1":[0], "2":[0]}: al guardar
 * {"1":[0]} la clave "2" sobrevivía. Deseleccionar un artículo no lo quitaba
 * nunca de lo guardado, así que el claim acumulaba todo lo que la persona
 * hubiera tocado alguna vez.
 *
 * Se veía así: en el resumen aparecían artículos que nadie había marcado, la
 * cuenta cuadraba sola y se cerraba con importes falsos.
 */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(label, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  const ok = a === b;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'}  ${label.padEnd(56)} ${a}`);
  if (!ok) console.log(`         esperado: ${b}`);
  ok ? pass++ : fail++;
}

/** Réplica de cómo fusiona Firestore: los mapas anidados se combinan. */
function firestoreSet(doc, datos, opciones) {
  if (!opciones || !opciones.merge) return { ...datos };
  const out = { ...doc };
  for (const [k, v] of Object.entries(datos)) {
    const esMapa = o => o && typeof o === 'object' && !Array.isArray(o);
    out[k] = (esMapa(v) && esMapa(doc[k])) ? { ...doc[k], ...v } : v;
  }
  return out;
}

console.log('\n1. Por qué merge:true rompía el recuento');
{
  // Alguien marca dos artículos y luego se arrepiente de uno.
  let doc = firestoreSet({}, { personName: 'Alvaro', itemUnits: { 1: [0], 2: [0] } }, { merge: true });
  doc = firestoreSet(doc, { personName: 'Alvaro', itemUnits: { 1: [0] } }, { merge: true });
  check('con merge, el artículo desmarcado NO se va', Object.keys(doc.itemUnits), ['1', '2']);

  let doc2 = firestoreSet({}, { personName: 'Alvaro', itemUnits: { 1: [0], 2: [0] } });
  doc2 = firestoreSet(doc2, { personName: 'Alvaro', itemUnits: { 1: [0] } });
  check('reemplazando entero, se va como debe', Object.keys(doc2.itemUnits), ['1']);
}
{
  // El caso exacto que describió Álvaro: quedan dos artículos por marcar, la
  // última persona toca los dos para ver el precio y deja solo uno.
  let doc = firestoreSet({}, { itemUnits: { 34: [0] } });
  doc = firestoreSet(doc, { itemUnits: { 34: [0], 35: [0] } });   // toca el otro
  doc = firestoreSet(doc, { itemUnits: { 35: [0] } });            // se queda con uno

  const conMerge = (() => {
    let d = firestoreSet({}, { itemUnits: { 34: [0] } }, { merge: true });
    d = firestoreSet(d, { itemUnits: { 34: [0], 35: [0] } }, { merge: true });
    d = firestoreSet(d, { itemUnits: { 35: [0] } }, { merge: true });
    return Object.keys(d.itemUnits);
  })();

  check('así se le colaban los dos últimos artículos', conMerge, ['34', '35']);
  check('ya solo se queda el que dejó marcado', Object.keys(doc.itemUnits), ['35']);
}
{
  // Vaciar la selección del todo tiene que quedar vacía de verdad.
  let doc = firestoreSet({}, { itemUnits: { 1: [0], 2: [0] } });
  doc = firestoreSet(doc, { itemUnits: {} });
  check('desmarcarlo todo deja el claim vacío', Object.keys(doc.itemUnits), []);
}
{
  // Quitar una unidad de un artículo con varias: el array sí se reemplaza.
  let doc = firestoreSet({}, { itemUnits: { 1: [0, 1, 2] } });
  doc = firestoreSet(doc, { itemUnits: { 1: [0] } });
  check('quitar unidades sueltas también funciona', doc.itemUnits[1], [0]);
}

console.log('\n2. Lo que el merge sí aportaba, conservado a mano');
{
  const original = { createdAt: '2026-07-25T10:00:00.000Z', personName: 'Alvaro', itemUnits: { 1: [0] } };
  // Al reescribir se relee createdAt del documento y se vuelve a poner.
  const nuevo = firestoreSet(original, {
    createdAt: original.createdAt,
    personName: 'Alvaro',
    itemUnits: { 2: [0] }
  });
  check('createdAt sobrevive a las reescrituras', nuevo.createdAt, '2026-07-25T10:00:00.000Z');
  check('y la selección sí se reemplaza', Object.keys(nuevo.itemUnits), ['2']);
}

console.log('\n3. El código no puede volver a usar merge al guardar un claim');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  const bloque = src.slice(src.indexOf('async function addClaim'),
                           src.indexOf('async function bumpClaimsVersion'))
    // Fuera los comentarios: el propio aviso de "no usar merge" los menciona.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  check('addClaim no usa merge', /merge:\s*true/.test(bloque), false);
  check('addClaim relee createdAt para conservarlo', /createdAt = d\.createdAt/.test(src), true);
}

console.log(`\n${pass} ok, ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
