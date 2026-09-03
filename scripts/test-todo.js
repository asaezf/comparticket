#!/usr/bin/env node
/**
 * Ejecuta TODAS las pruebas del proyecto y devuelve un único resultado.
 *   npm test
 *
 * Hasta ahora las pruebas existían -cientos- pero no había ninguna forma de
 * lanzarlas todas de una: había que acordarse del bucle de shell. Eso hace que
 * en la práctica solo las ejecute quien ya sabe que están ahí, y que nada las
 * ejecute sola al subir código.
 *
 * Va en Node y no en un script de shell a propósito: aquí se desarrolla en
 * Windows y la CI corre en Linux, y un bucle de bash no sirve en los dos.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ficheros = fs.readdirSync(DIR)
  .filter(f => /^test-.*\.js$/.test(f))
  // test-extract.js no es una prueba: es un banco de pruebas manual que gasta
  // llamadas de IA de verdad y necesita fotos como argumento. No entra aquí.
  .filter(f => f !== 'test-todo.js' && f !== 'test-extract.js')
  .sort();

let totalOk = 0, totalFallos = 0;
const rotos = [];

for (const f of ficheros) {
  let salida = '';
  let codigo = 0;
  try {
    salida = execFileSync(process.execPath, [path.join(DIR, f)], { encoding: 'utf8' });
  } catch (e) {
    // Una prueba que falla sale con código 1: la salida sigue siendo útil.
    salida = (e.stdout || '') + (e.stderr || '');
    codigo = e.status === undefined ? 1 : e.status;
  }

  const m = /(\d+) ok, (\d+) fallos/.exec(salida);
  const ok = m ? +m[1] : 0;
  const fallos = m ? +m[2] : 0;
  totalOk += ok;
  totalFallos += fallos;

  // Sin resumen reconocible y con código de salida distinto de 0, la prueba
  // reventó antes de poder contar nada: eso también es un fallo.
  const reventado = !m && codigo !== 0;
  if (fallos || reventado) {
    rotos.push({ f, salida });
    console.log(`FALLA  ${f}` + (reventado ? ' (reventó)' : ` — ${fallos} fallos`));
  } else {
    console.log(`ok     ${f.padEnd(28)} ${ok}`);
  }
}

if (rotos.length) {
  console.log('\n--- detalle de lo que falla ---');
  for (const r of rotos) {
    console.log(`\n### ${r.f}`);
    console.log(r.salida.split('\n').filter(l => /FALLA|revent|Error/.test(l)).slice(0, 20).join('\n'));
  }
}

console.log(`\n${ficheros.length} ficheros · ${totalOk} pruebas ok · ${totalFallos} fallos`);
process.exit(rotos.length ? 1 : 0);
