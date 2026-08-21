#!/usr/bin/env node
/**
 * Tests de validación de entrada — no gastan API ni base de datos real.
 *   node scripts/test-validacion.js
 *
 * Arrancan el server.js DE VERDAD con db.js simulado, y le lanzan peticiones
 * malformadas. Fijan los tres fallos que salieron en la auditoría de seguridad:
 *
 *   1. Un tipo de dato inesperado se guardaba tal cual, y a partir de ahí CADA
 *      apertura del enlace reventaba con `.trim is not a function`. Como el
 *      valor malo quedaba escrito en la base de datos, el enlace quedaba roto
 *      para todo el grupo de forma permanente.
 *   2. PUT /items aceptaba cualquier cosa; una cantidad con texto acababa
 *      dentro de un atributo HTML de la pantalla de revisión y permitía
 *      ejecutar código en el navegador del creador.
 *   3. Ninguna ruta async tenía try/catch ni había manejador de errores: un
 *      fallo tumbaba la instancia entera, arrastrando peticiones de otra gente.
 */

const path = require('path');
const Module = require('module');

// --- db.js simulado, en memoria -------------------------------------------
const TICKET = {
  id: 'test1234', restaurant: 'BAR', total: 20, status: 'shared',
  payerName: null, expectedParticipants: 2, creatorKey: 'k'.repeat(24),
  items: [{ id: 1, name: 'Cafe', quantity: 2, unitPrice: 5, totalPrice: 10 }],
  claimsVersion: 0
};
let CLAIMS = [];
const guardado = { payerName: undefined, items: undefined, total: undefined, claim: undefined };

const dbFalso = {
  getTicket: async () => ({ ...TICKET }),
  getPublicTicket: async () => { const { creatorKey, ...s } = TICKET; return s; },
  getClaims: async () => CLAIMS,
  setTicketPayer: async (id, payerName) => { guardado.payerName = payerName; return { ...TICKET, payerName }; },
  setTicketParticipants: async (id, n) => ({ ...TICKET }),
  updateTicketItems: async (id, items, total) => { guardado.items = items; guardado.total = total; return { ...TICKET, items }; },
  setTicketStatus: async () => ({ ...TICKET }),
  addClaim: async (id, personName, itemIds, itemCounts, itemUnits, confirmed) => {
    guardado.claim = { personName, itemIds, itemCounts, itemUnits, confirmed };
    return guardado.claim;
  },
  removeClaim: async () => true,
  verifyCreatorKey: async (id, k) => k === TICKET.creatorKey,
  getPulse: async () => ({ v: 0, status: TICKET.status }),
  createTicket: async () => ({ ...TICKET })
};

// Se intercepta el require de ./db para no tocar Firestore.
const cargaOriginal = Module._load;
Module._load = function (peticion, padre, esPrincipal) {
  if (peticion === './db' || peticion === './db.js') return dbFalso;
  return cargaOriginal.apply(this, arguments);
};

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';
const app = require(path.join(__dirname, '..', 'server.js'));

let pass = 0, fail = 0;
function check(label, ok, detalle) {
  console.log(`  ${ok ? 'ok  ' : 'FALLA'}  ${label}`);
  if (!ok && detalle !== undefined) console.log(`         ${detalle}`);
  ok ? pass++ : fail++;
}

/** Lanza una petición contra la app real y devuelve { status, body }. */
function pedir(metodo, ruta, cuerpo) {
  return new Promise((resolve) => {
    const req = {
      method: metodo, url: ruta, originalUrl: ruta, path: ruta.split('?')[0],
      headers: { host: 'test', 'content-type': 'application/json' },
      body: cuerpo, params: {}, query: {}, socket: { remoteAddress: '127.0.0.1' },
      get(h) { return this.headers[String(h).toLowerCase()]; },
      accepts: () => 'json', is: () => 'json'
    };
    let cuerpoResp = '';
    const res = {
      statusCode: 200, headersSent: false, locals: {},
      set() { return this; }, setHeader() { return this; }, getHeader() {}, type() { return this; },
      status(c) { this.statusCode = c; return this; },
      json(o) { cuerpoResp = o; this.headersSent = true; resolve({ status: this.statusCode, body: o }); return this; },
      send(o) { cuerpoResp = o; this.headersSent = true; resolve({ status: this.statusCode, body: o }); return this; },
      end() { this.headersSent = true; resolve({ status: this.statusCode, body: cuerpoResp }); return this; }
    };
    // Si nadie responde en 3s, se considera colgada.
    setTimeout(() => resolve({ status: 0, body: 'sin respuesta' }), 3000);
    app(req, res, (err) => resolve({ status: err ? 500 : 404, body: err ? String(err.message) : 'not found' }));
  });
}

(async () => {
  const NO_TEXTO = [
    ['objeto',   { a: 1 }],
    ['array',    ['x']],
    ['numero',   123],
    ['booleano', true],
  ];

  console.log('\n1. El nombre del pagador tiene que ser texto');
  console.log('   (un objeto aquí rompía el enlace para TODO el grupo, de forma permanente)');
  for (const [etiqueta, valor] of NO_TEXTO) {
    guardado.payerName = undefined;
    const r = await pedir('POST', '/api/tickets/test1234/payer', { payerName: valor });
    check(`${etiqueta} → se rechaza con 400`, r.status === 400, `devolvió ${r.status}`);
    check(`${etiqueta} → NO llega a guardarse`, guardado.payerName === undefined,
      `se guardó: ${JSON.stringify(guardado.payerName)}`);
  }
  {
    guardado.payerName = undefined;
    const r = await pedir('POST', '/api/tickets/test1234/payer', { payerName: '  Alvaro  ' });
    check('un nombre normal sigue funcionando', r.status === 200, `devolvió ${r.status}`);
    check('  y se guarda recortado', guardado.payerName === 'Alvaro', JSON.stringify(guardado.payerName));
  }
  {
    const r = await pedir('POST', '/api/tickets/test1234/payer', { payerName: 'A'.repeat(200) });
    check('un nombre absurdamente largo se rechaza', r.status === 400, `devolvió ${r.status}`);
  }

  console.log('\n2. El nombre de quien marca tiene que ser texto');
  for (const [etiqueta, valor] of NO_TEXTO) {
    guardado.claim = undefined;
    const r = await pedir('POST', '/api/tickets/test1234/claim', { personName: valor, itemUnits: { 1: [0] } });
    check(`${etiqueta} → se rechaza con 400`, r.status === 400, `devolvió ${r.status}`);
    check(`${etiqueta} → NO llega a guardarse`, guardado.claim === undefined);
  }

  console.log('\n3. La lista de artículos: el vector del XSS');
  {
    // El ataque real: romper el atributo value="..." y colar un manejador.
    guardado.items = undefined;
    const r = await pedir('PUT', '/api/tickets/test1234/items', {
      items: [{ id: 1, name: 'Cafe', quantity: '1" autofocus onfocus="alert(1)', unitPrice: 5 }],
      total: 20
    });
    check('cantidad con texto inyectado → se rechaza', r.status === 400, `devolvió ${r.status}`);
    check('  y no se guarda nada', guardado.items === undefined);
  }
  {
    guardado.items = undefined;
    const r = await pedir('PUT', '/api/tickets/test1234/items', { items: 'no soy una lista', total: 20 });
    check('items que no es un array → se rechaza', r.status === 400, `devolvió ${r.status}`);
  }
  {
    const r = await pedir('PUT', '/api/tickets/test1234/items', {
      items: [{ id: 1, name: 'Cafe', quantity: 2, unitPrice: 5 }], total: { a: 1 }
    });
    check('total que es un objeto → se rechaza', r.status === 400, `devolvió ${r.status}`);
  }
  {
    guardado.items = undefined;
    const r = await pedir('PUT', '/api/tickets/test1234/items', {
      items: [{ id: 1, name: 'Cafe', quantity: 2, unitPrice: 5, veneno: '<script>' }], total: 10
    });
    check('una lista correcta pasa', r.status === 200, `devolvió ${r.status}`);
    const g = guardado.items && guardado.items[0];
    check('  la cantidad se guarda como número', g && typeof g.quantity === 'number', JSON.stringify(g));
    check('  se descartan las claves que no toca', g && g.veneno === undefined, JSON.stringify(g));
  }

  console.log('\n4. La selección de unidades tiene que tener la forma esperada');
  {
    const r = await pedir('POST', '/api/tickets/test1234/claim',
      { personName: 'Alvaro', itemUnits: { '__proto__': [0] } });
    check('una clave __proto__ se rechaza', r.status === 400, `devolvió ${r.status}`);
  }
  {
    const r = await pedir('POST', '/api/tickets/test1234/claim',
      { personName: 'Alvaro', itemUnits: { 1: 'no soy un array' } });
    check('unidades que no son un array se rechazan', r.status === 400, `devolvió ${r.status}`);
  }
  {
    guardado.claim = undefined;
    const r = await pedir('POST', '/api/tickets/test1234/claim',
      { personName: 'Alvaro', itemUnits: { 1: [0, 1, 1, 0] } });
    check('una selección correcta pasa', r.status === 200, `devolvió ${r.status}`);
    check('  y se quitan las unidades repetidas',
      guardado.claim && JSON.stringify(guardado.claim.itemUnits) === JSON.stringify({ 1: [0, 1] }),
      JSON.stringify(guardado.claim && guardado.claim.itemUnits));
  }

  console.log('\n5. Un fallo no puede tumbar el servidor');
  {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const asyncSinEnvolver = (src.match(/^app\.(get|post|put|delete)\([^\n]*async \(req/gm) || [])
      .filter(l => !l.includes('ruta(async'));
    check('todas las rutas async van envueltas', asyncSinEnvolver.length === 0,
      'sin envolver: ' + asyncSinEnvolver.join(' | '));
    check('existe el manejador de errores final', /app\.use\(\(err, req, res, next\)/.test(src), true);
    check('el manejador no filtra detalles internos al cliente',
      /SERVER_ERROR/.test(src) && !/res\.status\(500\)\.json\(\{[^}]*err\.(message|stack)/.test(src), true);
    check('shareMeta va protegido, para no romper el enlace de todos',
      /try \{ meta = shareMeta/.test(src), true);
  }
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'js', 'ticket.js'), 'utf8');
    check('la pantalla de revisión fuerza número en la cantidad',
      /value="\$\{\+item\.quantity \|\| 1\}"/.test(src), true);
    check('  y en el precio', /\(\+item\.unitPrice \|\| 0\)\.toFixed\(2\)/.test(src), true);
  }


  console.log('\n6. Grupos: la lista de miembros');
  {
    // La pantalla ya impide crear un grupo mal, pero la API tiene que
    // hacerlo tambien: si no, se pueden crear grupos inutiles llamandola
    // directamente. Y un grupo de una sola persona no reparte con nadie.
    const NO_VALE = [
      ['sin miembros',          { name: 'Viaje' }],
      ['lista vacia',           { name: 'Viaje', members: [] }],
      ['un solo miembro',       { name: 'Viaje', members: ['Ana'] }],
      ['nombres repetidos',     { name: 'Viaje', members: ['Ana', 'ana'] }],
      ['miembro que es objeto', { name: 'Viaje', members: [{ a: 1 }] }],
      ['miembro que es numero', { name: 'Viaje', members: ['Ana', 123] }],
      ['sin nombre de grupo',   { members: ['Ana', 'Beto'] }]
    ];
    for (const [etiqueta, cuerpo] of NO_VALE) {
      const r = await pedir('POST', '/api/groups', cuerpo);
      check(etiqueta + ' se rechaza', r.status === 400, 'devolvio ' + r.status);
    }
  }

  console.log(`\n${pass} ok, ${fail} fallos\n`);
  process.exit(fail ? 1 : 0);
})();
