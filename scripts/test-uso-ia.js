#!/usr/bin/env node
/**
 * Tests de la medición del gasto de IA — no gastan API ni base de datos.
 *   node scripts/test-uso-ia.js
 *
 * Se simula la respuesta de Gemini para comprobar que cada lectura de ticket
 * deja constancia de lo que ha costado. Sin estos datos, optimizar el coste
 * sería adivinar: no habría forma de saber si el caché se aplica ni cuántas
 * veces entra el modelo de respaldo, que cuesta 6x la entrada y 5x la salida.
 *
 * Lo que se comprueba aquí es SOLO contabilidad. La medición no cambia nada
 * de lo que se le pide al modelo, así que no puede alterar un resultado.
 */

const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
function check(label, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  const ok = a === b;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'}  ${label.padEnd(52)} ${a}`);
  if (!ok) console.log(`         esperado: ${b}`);
  ok ? pass++ : fail++;
}

// --- Gemini simulado -------------------------------------------------------
// Cada elemento de GUION es lo que hará la siguiente llamada: 'ok' responde
// bien, 'cae' lanza un error reintentable (como el 429 del plan gratuito).
let GUION = [];
let LLAMADAS = [];

const respuestaBuena = (cache) => ({
  candidates: [{ finishReason: 'STOP' }],
  usageMetadata: {
    promptTokenCount: 2621,
    candidatesTokenCount: 1620,
    thoughtsTokenCount: 0,
    cachedContentTokenCount: cache
  },
  text: JSON.stringify({
    restaurant: 'BAR', total: 20,
    items: [{ name: 'Cafe', quantity: 2, unitPrice: 5, totalPrice: 10, shared: false },
            { name: 'Tostada', quantity: 1, unitPrice: 10, totalPrice: 10, shared: false }]
  })
});

const geminiFalso = {
  GoogleGenAI: class {
    constructor() {
      this.models = {
        generateContent: async ({ model }) => {
          LLAMADAS.push(model);
          const paso = GUION.shift() || 'ok';
          if (paso === 'cae') throw new Error('503 UNAVAILABLE: model overloaded');
          return respuestaBuena(paso === 'cache' ? 1536 : 0);
        }
      };
    }
  }
};

const cargaOriginal = Module._load;
Module._load = function (peticion) {
  if (peticion === '@google/genai') return geminiFalso;
  return cargaOriginal.apply(this, arguments);
};

process.env.GEMINI_API_KEY = 'test';
const ai = require(path.join(__dirname, '..', 'ai.js'));
const imagen = [{ buffer: Buffer.from('x'), mimeType: 'image/jpeg' }];

(async () => {
  console.log('\n1. Cada lectura deja constancia de lo que ha costado');
  {
    GUION = ['ok']; LLAMADAS = [];
    const r = await ai.extractItemsFromImages(imagen);
    check('se adjunta el bloque de uso', typeof r.uso, 'object');
    check('  tokens de entrada', r.uso.entrada, 2621);
    check('  tokens de salida', r.uso.salida, 1620);
    check('  modelo usado', r.uso.modelo, 'gemini-3.1-flash-lite');
    check('  intentos', r.uso.intentos, 1);
    check('  sin modelo caro', r.uso.conRespaldo, false);
    check('  mide el tiempo', typeof r.uso.ms, 'number');
    check('los artículos siguen intactos', r.items.length, 2);
  }

  console.log('\n2. El caché: saber si el descuento se aplica');
  {
    GUION = ['ok'];
    const sin = await ai.extractItemsFromImages(imagen);
    check('sin caché se registra 0', sin.uso.enCache, 0);

    GUION = ['cache'];
    const con = await ai.extractItemsFromImages(imagen);
    check('con caché se registran los tokens', con.uso.enCache, 1536);
  }

  console.log('\n3. Los reintentos se cuentan');
  {
    // Falla una vez y acierta a la segunda, como un 503 pasajero.
    GUION = ['cae', 'ok']; LLAMADAS = [];
    const r = await ai.extractItemsFromImages(imagen);
    check('cuenta los dos intentos', r.uso.intentos, 2);
    check('  pero NO usó el modelo caro', r.uso.conRespaldo, false);
    check('  y reintentó con el barato', LLAMADAS.every(m => m.includes('lite')), true);
  }

  console.log('\n4. El modelo caro queda registrado');
  {
    // Tres fallos seguidos: es cuando entra el respaldo.
    GUION = ['cae', 'cae', 'cae', 'ok']; LLAMADAS = [];
    const r = await ai.extractItemsFromImages(imagen);
    check('marca que se usó el respaldo', r.uso.conRespaldo, true);
    check('  y qué modelo fue', r.uso.modelo, 'gemini-3.6-flash');
    check('  tras agotar los 3 intentos', r.uso.intentos, 4);
    check('  el barato se probó 3 veces', LLAMADAS.filter(m => m.includes('lite')).length, 3);
  }

  console.log('\n5. El cálculo del coste');
  {
    // Misma fórmula que scripts/panel-ia.js
    const P = { in: 0.25, out: 1.50 };
    const coste = u => {
      const cacheados = u.enCache || 0;
      const normales = Math.max(0, u.entrada - cacheados);
      return (normales * P.in + cacheados * P.in * 0.10
            + (u.salida + (u.pensamiento || 0)) * P.out) / 1e6;
    };
    const sinCache = coste({ entrada: 2621, salida: 1620, enCache: 0 });
    const conCache = coste({ entrada: 2621, salida: 1620, enCache: 1536 });

    check('coste medido sin caché (céntimos)', +(sinCache * 100).toFixed(3), 0.309);
    check('el caché abarata de verdad', conCache < sinCache, true);
    check('  y ahorra en torno al 11%',
      Math.round((1 - conCache / sinCache) * 100), 11);
  }

  console.log('\n6. La medición no altera el resultado');
  {
    GUION = ['ok'];
    const r = await ai.extractItemsFromImages(imagen);
    // El reparto del dinero tiene que ser idéntico con o sin medición.
    check('el total se respeta', r.total, 20);
    check('los importes no se tocan', r.items.map(i => i.totalPrice), [10, 10]);
    check('uso va aparte, no dentro de items',
      r.items.every(i => i.uso === undefined), true);
  }

  console.log(`\n${pass} ok, ${fail} fallos\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nError:', e.message, '\n'); process.exit(1); });
