require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const { nanoid } = require('nanoid');
const db = require('./db');
const ai = require('./ai');
const money = require('./money');
const settle = require('./settle');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '1mb' }));

/* =============================================================
   VALIDACIÓN DE ENTRADA
   =============================================================
   Nada de lo que llega en el cuerpo de una petición se guardaba
   comprobando el tipo. Eso no era solo suciedad: un `payerName` que fuese un
   objeto en vez de un texto se guardaba tal cual, y a partir de ahí CADA
   apertura del enlace reventaba con `.trim is not a function`. Como el valor
   malo queda escrito en la base de datos, el enlace quedaba roto para todo el
   grupo de forma permanente.

   La regla ahora: lo que no tenga la forma esperada se rechaza en la puerta,
   nunca se guarda. */

/** Texto de verdad, recortado y con tope de longitud. null si no vale. */
function asText(v, max = 60) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

/** Número finito y razonable. null si no vale. */
function asNumber(v, { min = -1e6, max = 1e6 } = {}) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v) : NaN);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/**
 * Deja la lista de artículos en una forma conocida, o devuelve null.
 *
 * Se reconstruye campo a campo en lugar de aceptar lo que venga: así ni se
 * cuelan claves extra en Firestore ni llega texto donde el resto de la app
 * espera un número. La pantalla de revisión pinta la cantidad dentro de un
 * atributo HTML, y un valor no numérico ahí permitía inyectar código.
 */
function asItems(v) {
  if (!Array.isArray(v) || v.length === 0 || v.length > 300) return null;
  const out = [];
  for (const it of v) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return null;
    const id = asNumber(it.id, { min: 0, max: 1e9 });
    const name = typeof it.name === 'string' ? it.name.trim().slice(0, 120) : null;
    const quantity = asNumber(it.quantity, { min: 1, max: 9999 });
    const unitPrice = asNumber(it.unitPrice, { min: -100000, max: 100000 });
    if (id === null || name === null || quantity === null || unitPrice === null) return null;
    out.push({
      id: Math.round(id),
      name,
      quantity: Math.round(quantity),
      unitPrice: +unitPrice.toFixed(2),
      totalPrice: +(Math.round(quantity) * unitPrice).toFixed(2),
      shared: it.shared === true
    });
  }
  return out;
}

/**
 * Comprueba el mapa de unidades marcadas: { "3": [0,1], "7": [0] }.
 * Sin esto se podía guardar un objeto de cualquier forma y tamaño.
 */
function asItemUnits(v) {
  if (v === null || v === undefined) return {};
  if (typeof v !== 'object' || Array.isArray(v)) return null;
  const claves = Object.keys(v);
  if (claves.length > 300) return null;
  const out = {};
  for (const k of claves) {
    // __proto__ y compañía nunca deben viajar como clave de datos.
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return null;
    if (!/^\d{1,9}$/.test(k)) return null;
    const arr = v[k];
    if (!Array.isArray(arr) || arr.length > 999) return null;
    const unidades = [];
    for (const u of arr) {
      const n = asNumber(u, { min: 0, max: 9998 });
      if (n === null) return null;
      const i = Math.round(n);
      if (!unidades.includes(i)) unidades.push(i);
    }
    if (unidades.length) out[k] = unidades.sort((a, b) => a - b);
  }
  return out;
}

/**
 * Lista de miembros de un grupo. Se normaliza a [{ id, name }].
 *
 * El nombre es la clave de todo el cuadre —money.js reparte por nombre— así
 * que aquí se garantiza que no haya dos miembros que se llamen igual: si los
 * hubiera, sus gastos se sumarían como si fueran la misma persona y el viaje
 * cuadraría mal sin que nadie lo notase.
 */
function asMembers(v) {
  // Minimo dos: un grupo de una sola persona no reparte nada con nadie. La
  // pantalla ya lo impide, pero la API tambien tiene que hacerlo — si no, se
  // pueden crear grupos inutiles llamando directamente.
  if (!Array.isArray(v) || v.length < 2 || v.length > 50) return null;
  const out = [];
  const vistos = new Set();
  for (const m of v) {
    const nombre = asText(typeof m === 'string' ? m : (m && m.name), 40);
    if (!nombre) return null;
    const k = nombre.toLowerCase();
    if (vistos.has(k)) return null;   // nombre repetido: no se podría cuadrar
    vistos.add(k);
    out.push({ id: (m && m.id) || 'm_' + nanoid(8), name: nombre });
  }
  return out;
}

/**
 * Envuelve una ruta async para que un fallo no tumbe el proceso.
 *
 * Express 4 no recoge los rechazos de un manejador async: se convertían en un
 * `unhandled rejection` y Node mata la instancia, llevándose por delante las
 * peticiones de otra gente que estuvieran en vuelo.
 */
const ruta = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Cabeceras de seguridad. Sin dependencias: son cuatro líneas y evitan que la
// app se pueda embeber en un iframe ajeno o que el navegador adivine tipos.
app.use((req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), payment=()');
  next();
});

/**
 * Límite de peticiones para el único endpoint que cuesta dinero.
 *
 * En Vercel cada invocación puede caer en una instancia distinta, así que un
 * contador en memoria NO es un límite global: es un amortiguador que corta el
 * caso obvio (alguien con un bucle) sin añadir dependencias ni base de datos.
 * El límite de verdad, con almacén compartido, va en la lista de lanzamiento.
 */
const hits = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const rec = hits.get(ip);
    if (!rec || now > rec.reset) {
      hits.set(ip, { count: 1, reset: now + windowMs });
    } else if (++rec.count > max) {
      const wait = Math.ceil((rec.reset - now) / 1000);
      res.set('Retry-After', String(wait));
      return res.status(429).json({
        error: `Demasiados escaneos seguidos. Espera ${wait}s.`,
        code: 'RATE_LIMITED'
      });
    }
    // Purga perezosa para que el mapa no crezca sin fin.
    if (hits.size > 500) {
      for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    }
    next();
  };
}

// El navegador recibe EXACTAMENTE el mismo fichero de cálculo que usa el
// servidor, no una copia. Así la pantalla nunca puede decir que la cuenta
// cuadra mientras el servidor opina lo contrario.
app.get('/js/money.js', (req, res) => {
  res.type('application/javascript').sendFile(path.join(__dirname, 'money.js'));
});

// Lo mismo con el cuadre de grupos: navegador y servidor comparten el fichero,
// no una copia. Si divergieran, la pantalla podria decir que Nerea debe 40 y el
// servidor pensar que debe 45.
app.get('/js/settle.js', (req, res) => {
  res.type('application/javascript').sendFile(path.join(__dirname, 'settle.js'));
});

app.use(express.static(path.join(__dirname, 'public')));

// Multer — memory storage (images are sent to Gemini and then discarded).
// El tope real no lo pone multer sino Vercel, que rechaza con 413 cualquier
// petición de más de 4,5 MB en total y lo hace antes de ejecutar esta función.
// El cliente reduce las fotos por debajo de ese límite; esto es la red de
// seguridad para desarrollo local y para clientes que no ejecuten el JS.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4.5 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|heic/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext || mime);
  }
});

// Sin esto, superar el límite caía en el 500 genérico y el usuario no sabía
// que el problema era el tamaño de la foto.
function handleUpload(req, res, next) {
  upload.array('images', 6)(req, res, err => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    console.error('Upload error:', err.code || err.message);
    res.status(413).json({
      error: tooBig
        ? 'La foto pesa demasiado. Hazla de nuevo con menos resolución.'
        : 'No hemos podido recibir las fotos. Inténtalo de nuevo.',
      code: err.code || 'UPLOAD_ERROR'
    });
  });
}

// --- API Routes ---

// Upload images → Gemini extracts items → ticket created in Firestore
app.post('/api/tickets', rateLimit({ windowMs: 60_000, max: 8 }), handleUpload, ruta(async (req, res) => {
  try {
    const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : []);
    if (!files.length) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    // Build buffer+mime array for Gemini
    const images = files.map(f => ({
      buffer: f.buffer,
      mimeType: f.mimetype || 'image/jpeg'
    }));

    let extracted;
    try {
      extracted = await ai.extractItemsFromImages(images);
    } catch (aiErr) {
      console.error('Gemini AI error:', aiErr.code || '', aiErr.message || aiErr);
      // Turn internal failure codes into something a diner can act on, instead
      // of leaking "AI failed: <stack trace>" into a toast.
      const FRIENDLY = {
        NO_ITEMS:  ['No hemos podido leer ningún artículo. Asegúrate de que la foto es de un ticket y se ve entero.', 422],
        TRUNCATED: ['El ticket es muy largo. Prueba a hacer dos fotos, una de cada mitad, y súbelas juntas.', 422],
        EMPTY:     ['La IA no ha devuelto nada. Vuelve a intentarlo.', 503],
        BAD_JSON:  ['La IA ha devuelto una respuesta inválida. Vuelve a intentarlo.', 503]
      };
      const [message, status] = FRIENDLY[aiErr.code] ||
        ['No hemos podido procesar el ticket. Inténtalo de nuevo en unos segundos.', 503];
      return res.status(status).json({ error: message, code: aiErr.code || 'AI_ERROR' });
    }

    const id = nanoid(8);
    const creatorKey = nanoid(24);
    const ticket = await db.createTicket(id, extracted.items, extracted.total, null, {
      imagePaths: [],
      restaurant: extracted.restaurant,
      receiptDate: extracted.date,
      receiptTime: extracted.time,
      address: extracted.address,
      creatorKey
    });

    res.json({ id: ticket.id, redirect: `/ticket.html?id=${ticket.id}`, creatorKey });
  } catch (err) {
    console.error('Error creating ticket:', err);
    res.status(500).json({ error: 'Failed to process image' });
  }
}));

// Set payer for a ticket
app.post('/api/tickets/:id/payer', ruta(async (req, res) => {
  // Se admite vaciarlo (null), pero si viene algo tiene que ser texto: un
  // objeto aquí dejaba el enlace del ticket roto para todo el grupo.
  const bruto = (req.body || {}).payerName;
  const payerName = (bruto === null || bruto === undefined || bruto === '')
    ? null
    : asText(bruto, 40);
  if (bruto !== null && bruto !== undefined && bruto !== '' && payerName === null) {
    return res.status(400).json({ error: 'Nombre de pagador no válido', code: 'BAD_PAYER' });
  }
  const ticket = await db.setTicketPayer(req.params.id, payerName);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
}));

// Set expected participants count
app.post('/api/tickets/:id/participants', ruta(async (req, res) => {
  const { expectedParticipants } = req.body || {};

  // Si el ticket va dentro de un grupo, no puede haber mas participantes que
  // gente en el grupo: el reparto no cuadraria nunca y nadie entenderia por
  // que. La pantalla ya lo impide, pero la API tambien tiene que hacerlo.
  const actual = await db.getTicket(req.params.id);
  if (actual && actual.groupId) {
    const g = await db.getGroup(actual.groupId);
    const tope = g && Array.isArray(g.members) ? g.members.length : 0;
    const n = parseInt(expectedParticipants);
    if (tope && Number.isFinite(n) && n > tope) {
      return res.status(400).json({
        error: 'El grupo es de ' + tope + ' personas, no puede haber más',
        code: 'MAS_QUE_EL_GRUPO'
      });
    }
  }

  const ticket = await db.setTicketParticipants(req.params.id, expectedParticipants);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
}));

// Get ticket data (public — creatorKey stripped)
app.get('/api/tickets/:id', ruta(async (req, res) => {
  const ticket = await db.getPublicTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
}));

// Update ticket items
app.put('/api/tickets/:id/items', ruta(async (req, res) => {
  // La lista se reconstruye campo a campo. Antes se guardaba lo que viniera:
  // una cantidad con texto acababa dentro de un atributo HTML de la pantalla
  // de revisión y permitía ejecutar código en el navegador del creador.
  const items = asItems((req.body || {}).items);
  if (!items) {
    return res.status(400).json({ error: 'Lista de artículos no válida', code: 'BAD_ITEMS' });
  }
  const brutoTotal = (req.body || {}).total;
  const total = brutoTotal === undefined ? undefined : asNumber(brutoTotal, { min: 0, max: 1e6 });
  if (brutoTotal !== undefined && total === null) {
    return res.status(400).json({ error: 'Total no válido', code: 'BAD_TOTAL' });
  }

  // Claims point at items by id. Once somebody has picked their units, editing
  // the item list silently reassigns or destroys what they owe — so the list is
  // frozen from the first claim onwards, not from the moment it's shared.
  const claims = await db.getClaims(req.params.id);
  if (claims.length > 0) {
    return res.status(409).json({
      error: 'Ya hay gente que ha marcado lo suyo, los artículos no se pueden cambiar.',
      code: 'HAS_CLAIMS'
    });
  }

  const ticket = await db.updateTicketItems(req.params.id, items, total);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
}));

// Share ticket (change status to shared)
// Gate #1: the extracted lines must add up to the receipt total before anyone
// is invited in. Sharing a ticket that doesn't reconcile guarantees the split
// will be wrong and nobody will notice.
app.post('/api/tickets/:id/share', ruta(async (req, res) => {
  const ticket = await db.getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const check = money.reconcileTicket(ticket.items, ticket.total);
  if (!check.balanced) {
    return res.status(409).json({
      error: check.delta > 0
        ? `Los artículos suman ${check.sum.toFixed(2)}€ pero el total del ticket es ${check.total.toFixed(2)}€. Faltan ${Math.abs(check.delta).toFixed(2)}€ por desglosar.`
        : `Los artículos suman ${check.sum.toFixed(2)}€, más que el total del ticket (${check.total.toFixed(2)}€). Sobran ${Math.abs(check.delta).toFixed(2)}€.`,
      code: 'UNBALANCED_TICKET',
      reconciliation: check
    });
  }

  const updated = await db.setTicketStatus(req.params.id, 'shared');
  res.json(updated);
}));

// Close ticket — creator only
app.post('/api/tickets/:id/close', ruta(async (req, res) => {
  const { creatorKey } = req.body || {};
  const valid = await db.verifyCreatorKey(req.params.id, creatorKey);
  if (!valid) {
    return res.status(403).json({ error: 'Only the ticket creator can close it' });
  }

  const ticket = await db.getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  // Gate #2: what everyone pays has to add up to the receipt total. Anything
  // left over is money the payer eats without being told.
  const claims = await db.getClaims(req.params.id);
  const check = money.reconcileClaims(ticket.items, ticket.total, claims);
  if (!check.balanced) {
    return res.status(409).json({
      error: check.pending > 0
        ? `Quedan ${check.pending.toFixed(2)}€ sin asignar. Nadie los está pagando.`
        : `Lo repartido supera el total del ticket en ${Math.abs(check.pending).toFixed(2)}€.`,
      code: 'UNBALANCED_CLAIMS',
      reconciliation: check
    });
  }

  const updated = await db.setTicketStatus(req.params.id, 'closed');
  const { creatorKey: _k, ...safe } = updated;
  res.json(safe);
}));

// Add a claim (person selects items)
app.post('/api/tickets/:id/claim', ruta(async (req, res) => {
  const { itemIds, itemCounts, itemUnits, confirmed } = req.body || {};

  // Antes bastaba con que el nombre fuera "truthy": un número pasaba el
  // control y luego reventaba al construir el id del documento.
  const personName = asText((req.body || {}).personName, 40);
  if (!personName) {
    return res.status(400).json({ error: 'Nombre no válido', code: 'BAD_NAME' });
  }

  const unidades = asItemUnits(itemUnits);
  if (unidades === null) {
    return res.status(400).json({ error: 'Selección no válida', code: 'BAD_UNITS' });
  }

  const ids = Array.isArray(itemIds)
    ? itemIds.map(x => asNumber(x, { min: 0, max: 1e9 })).filter(x => x !== null).map(Math.round)
    : [];

  const hasUnits = Object.keys(unidades).length > 0;
  // Un borrador puede quedarse sin nada marcado (alguien que deselecciona todo);
  // una confirmación no.
  if (confirmed !== false && !hasUnits && !ids.length) {
    return res.status(400).json({ error: 'Name and items required' });
  }

  const claim = await db.addClaim(
    req.params.id,
    personName,
    ids,
    (itemCounts && typeof itemCounts === 'object' && !Array.isArray(itemCounts)) ? itemCounts : null,
    hasUnits ? unidades : null,
    confirmed !== false
  );
  res.json(claim);
}));

// Latido para el tiempo real: una sola lectura de documento. La pantalla de
// reparto lo consulta cada pocos segundos y solo recarga la lista completa de
// claims cuando el número cambia.
app.get('/api/tickets/:id/pulse', ruta(async (req, res) => {
  const pulse = await db.getPulse(req.params.id);
  if (!pulse) return res.status(404).json({ error: 'Ticket not found' });
  res.set('Cache-Control', 'no-store');
  res.json(pulse);
}));

// Get all claims for a ticket
app.get('/api/tickets/:id/claims', ruta(async (req, res) => {
  const claims = await db.getClaims(req.params.id);
  res.json(claims);
}));

// Remove a claim
app.delete('/api/tickets/:id/claim/:personName', ruta(async (req, res) => {
  await db.removeClaim(req.params.id, decodeURIComponent(req.params.personName));
  res.json({ ok: true });
}));

/**
 * Enlace corto para compartir: /t/:id
 *
 * Todo el producto se apoya en pegar un enlace en el grupo de WhatsApp, y ese
 * es el único momento en que hay que convencer a nueve personas de que toquen.
 * Hasta ahora salía como texto pelado.
 *
 * Sirve la misma pantalla de reparto pero con las etiquetas Open Graph
 * rellenadas con el sitio y el importe reales. Va por una ruta propia y no por
 * /claim.html para que solo esta pase por la función: el resto sigue saliendo
 * del CDN. Y se cachea en el CDN para que una ráfaga de diez personas abriendo
 * el enlace a la vez no despierte diez funciones.
 */
app.get('/t/:id', ruta(async (req, res) => {
  const file = path.join(__dirname, 'public', 'claim.html');
  let html;
  try {
    html = require('fs').readFileSync(file, 'utf8');
  } catch (_) {
    return res.status(500).send('No se ha podido cargar la página');
  }

  let ticket = null;
  try { ticket = await db.getPublicTicket(req.params.id); } catch (_) {}

  if (ticket) {
    const claims = await db.getClaims(req.params.id).catch(() => []);
    // Si la vista previa falla por lo que sea, se sirve la página igual sin
    // ella. Un enlace que abre sin tarjeta bonita es un problema menor; un
    // enlace que devuelve error a todo el grupo es un problema grave.
    // Si el ticket va dentro de un grupo, la vista previa lo dice.
    let grupo = null;
    if (ticket.groupId) {
      try { grupo = await db.getPublicGroup(ticket.groupId); } catch (_) {}
    }
    let meta = null;
    try { meta = shareMeta(ticket, claims, grupo); }
    catch (e) { console.error('shareMeta falló:', e && e.message); }
    if (meta) html = html
      .replace(/<meta property="og:title" content="[^"]*">/,
        `<meta property="og:title" content="${escAttr(meta.title)}">`)
      .replace(/<meta property="og:description" content="[^"]*">/,
        `<meta property="og:description" content="${escAttr(meta.description)}">`)
      .replace(/<title>[^<]*<\/title>/, `<title>${escAttr(meta.title)}</title>`);
  }

  // 60 s en el CDN, y mientras se revalida se sigue sirviendo lo anterior.
  res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.type('html').send(html);
}));

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Texto de la vista previa. Cambia según el estado de la cuenta, porque lo que
 * empuja a tocar el enlace no es lo mismo cuando aún no ha marcado nadie que
 * cuando faltas tú y los demás ya han terminado.
 */
function shareMeta(ticket, claims, grupo) {
  const eur = money.formatEUR(ticket.total, 'es');
  const sitio = ticket.restaurant || 'La cuenta';
  const quien = (ticket.payerName || '').trim();
  const listos = money.confirmedOnly(claims).length;
  const esperados = ticket.expectedParticipants || 0;

  let description;
  if (ticket.status === 'closed') {
    description = `Cuenta cerrada. Mira cómo quedó el reparto de ${eur}.`;
  } else if (esperados && listos >= esperados) {
    description = `Ya han marcado todos. Mira cuánto te toca.`;
  } else if (listos > 0 && esperados) {
    // El más eficaz: nombra a los que faltan sin señalar a nadie.
    description = `Ya han marcado ${listos} de ${esperados}. Faltas tú.`;
  } else if (listos > 0) {
    description = `Ya hay ${listos} marcando lo suyo. Te toca.`;
  } else if (quien) {
    description = `${quien} ha pagado ${eur}. Marca lo que has tomado para saber cuánto le debes. 💸`;
  } else {
    description = `${eur} sobre la mesa. Marca lo que has tomado para saber cuánto le debes. 💸`;
  }

  // Si el ticket pertenece a un grupo, se dice en el titulo: al pegarlo en el
  // chat del viaje, lo primero que hay que saber es de que grupo viene.
  const titulo = grupo && grupo.name
    ? `${grupo.name} · ${sitio} · ${eur}`
    : `${sitio} · ${eur}`;
  return { title: titulo, description };
}


// =============================================================
//  GRUPOS  (viajes, pisos compartidos)
// =============================================================

/**
 * Todo lo que hay que saber de un grupo, ya calculado.
 *
 * El cuadre se hace AQUÍ, en el servidor, y no en el navegador. El navegador
 * lo repite para pintar sin esperar, pero la cifra buena es esta: si alguien
 * manipulara el JavaScript de su móvil no podría cambiar lo que debe.
 */
async function groupSummary(groupId, req_token) {
  const group = await db.getPublicGroup(groupId);
  if (!group) return null;

  const [tickets, expenses, payments] = await Promise.all([
    db.getGroupTickets(groupId),
    db.getGroupExpenses(groupId),
    db.getGroupPayments(groupId)
  ]);

  const apuntes = [];
  const detalleTickets = [];
  let abiertos = 0;
  let pendiente = 0;   // dinero atrapado en tickets sin cerrar

  for (const t of tickets) {
    // Un borrador todavía no lo ha visto nadie: no cuenta como gasto.
    if (t.status !== 'shared' && t.status !== 'closed') continue;

    const claims = await db.getClaims(t.id).catch(() => []);
    // El reparto de cada ticket lo sigue haciendo money.js, intacto.
    const r = money.splitByUnits(t.items, money.confirmedOnly(claims));

    // SOLO los tickets cerrados entran en el cuadre, y esto es importante.
    //
    // En uno a medio marcar, a quien pagó se le acredita el total pero solo
    // está repartido lo que la gente lleva marcado. Meterlo dejaría los saldos
    // sin sumar cero —el dinero se crearía de la nada— y el reparto final
    // saldría mal. Se enseña en la lista con su aviso, pero no cuenta hasta
    // que se cierre.
    if (t.status !== 'closed') {
      abiertos++;
      pendiente += (+t.total || 0);
    } else {
      apuntes.push({ pagador: t.payerName, total: t.total, reparto: r.perPerson });
    }

    detalleTickets.push({
      id: t.id,
      restaurant: t.restaurant,
      total: t.total,
      payerName: t.payerName,
      status: t.status,
      // Hace falta para saber si YA ha marcado todo el mundo, que es lo que
      // dice "ve y cierralo".
      expectedParticipants: t.expectedParticipants || null,
      receiptDate: t.receiptDate,
      createdAt: t.createdAt,
      lineas: (t.items || []).length,
      reparto: r.perPerson
    });
  }

  for (const e of expenses) {
    apuntes.push({
      pagador: e.paidBy,
      total: e.amount,
      reparto: settle.splitEqually(e.amount, e.splitBetween)
    });
  }

  // Se dice quien esta cogido, pero NUNCA el testigo: publicarlo permitiria
  // a cualquiera hacerse pasar por otro.
  const miTestigo = asText(req_token, 80);
  group.members = (group.members || []).map(m => ({
    id: m.id,
    name: m.name,
    taken: !!m.claimedBy,
    mine: !!(m.claimedBy && miTestigo && m.claimedBy === miTestigo)
  }));
  const libres = group.members.filter(m => !m.taken).length;

  const pagos = payments.map(p => ({ de: p.from, a: p.to, importe: p.amount }));
  const balances = settle.computeBalances(apuntes, pagos, group.members);
  const transfers = settle.minimalTransfers(balances);
  const stats = settle.groupStats(apuntes);

  return {
    group,
    tickets: detalleTickets,
    expenses,
    payments,
    balances,
    transfers,
    stats,
    // Los tickets sin cerrar NO entran en el cuadre (ver arriba). Se informa
    // de cuántos son y de cuánto dinero hay dentro, para que se sepa que el
    // reparto todavía no está completo y qué falta por hacer.
    ticketsAbiertos: abiertos,
    pendienteDeCerrar: +pendiente.toFixed(2),
    // Cuando no queda ninguna identidad libre, el grupo esta completo y no
    // admite a nadie mas.
    plazasLibres: libres,
    completo: libres === 0,
    settled: settle.isSettled(balances)
  };
}

app.post('/api/groups', rateLimit({ windowMs: 60000, max: 10 }), ruta(async (req, res) => {
  const name = asText((req.body || {}).name, 60);
  if (!name) return res.status(400).json({ error: 'Nombre de grupo no válido', code: 'BAD_NAME' });

  const members = asMembers((req.body || {}).members);
  if (!members) {
    return res.status(400).json({
      error: 'Hacen falta los nombres de quienes van, sin repetir',
      code: 'BAD_MEMBERS'
    });
  }

  const id = nanoid(8);
  const creatorKey = nanoid(24);
  const group = await db.createGroup(id, name, members, creatorKey);
  const safe = Object.assign({}, group);
  delete safe.creatorKey;
  res.json({ group: safe, creatorKey, redirect: '/g/' + id });
}));

app.get('/api/groups/:id', ruta(async (req, res) => {
  const group = await db.getPublicGroup(req.params.id);
  if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
  res.json(group);
}));

app.get('/api/groups/:id/summary', ruta(async (req, res) => {
  const s = await groupSummary(req.params.id, (req.query || {}).tok);
  if (!s) return res.status(404).json({ error: 'Grupo no encontrado' });
  res.json(s);
}));

app.post('/api/groups/:id/members', ruta(async (req, res) => {
  const members = asMembers((req.body || {}).members);
  if (!members) return res.status(400).json({ error: 'Lista de nombres no válida', code: 'BAD_MEMBERS' });
  const group = await db.setGroupMembers(req.params.id, members);
  if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
  const safe = Object.assign({}, group);
  delete safe.creatorKey;
  res.json(safe);
}));

// --- Gastos sin ticket ----------------------------------------------------
//  En un viaje la mitad de lo que se paga no lleva ticket que escanear: el
//  taxi, las entradas, la gasolina. Sin esto el grupo no cuadra con la
//  realidad.

app.post('/api/groups/:id/expenses', ruta(async (req, res) => {
  const group = await db.getGroup(req.params.id);
  if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });

  const description = asText((req.body || {}).description, 60);
  const amount = asNumber((req.body || {}).amount, { min: 0.01, max: 100000 });
  const paidBy = asText((req.body || {}).paidBy, 40);
  if (!description || amount === null || !paidBy) {
    return res.status(400).json({ error: 'Faltan datos del gasto', code: 'BAD_EXPENSE' });
  }

  // Solo se admiten nombres que estén en el grupo: si se colara uno de fuera,
  // aparecería un participante fantasma en el cuadre final.
  const nombres = (group.members || []).map(m => m.name);
  const dentro = n => nombres.some(x => x.toLowerCase() === String(n).trim().toLowerCase());
  if (!dentro(paidBy)) {
    return res.status(400).json({ error: 'Quien paga no está en el grupo', code: 'NOT_MEMBER' });
  }

  const brutoEntre = (req.body || {}).splitBetween;
  const splitBetween = Array.isArray(brutoEntre) && brutoEntre.length
    ? brutoEntre.map(n => asText(n, 40)).filter(Boolean).filter(dentro)
    : nombres;                       // por defecto, entre todos
  if (!splitBetween.length) {
    return res.status(400).json({ error: 'Falta entre quién se reparte', code: 'BAD_SPLIT' });
  }

  const gasto = await db.addGroupExpense(req.params.id, {
    id: nanoid(10),
    description,
    amount: +amount.toFixed(2),
    paidBy,
    splitBetween
  });
  res.json(gasto);
}));

app.delete('/api/groups/:id/expenses/:expenseId', ruta(async (req, res) => {
  await db.removeGroupExpense(req.params.id, req.params.expenseId);
  res.json({ ok: true });
}));

// --- Pagos entre personas -------------------------------------------------
//  Solo se ANOTA que alguien dice haber pagado. El dinero va por Bizum entre
//  ellos: la app no lo toca nunca. Moverlo convertiría esto en una entidad de
//  pago, con licencia del Banco de España y todo lo que arrastra.

app.post('/api/groups/:id/payments', ruta(async (req, res) => {
  const group = await db.getGroup(req.params.id);
  if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });

  const from = asText((req.body || {}).from, 40);
  const to = asText((req.body || {}).to, 40);
  const amount = asNumber((req.body || {}).amount, { min: 0.01, max: 100000 });
  if (!from || !to || amount === null) {
    return res.status(400).json({ error: 'Faltan datos del pago', code: 'BAD_PAYMENT' });
  }
  if (from.toLowerCase() === to.toLowerCase()) {
    return res.status(400).json({ error: 'No puedes pagarte a ti mismo', code: 'SELF_PAYMENT' });
  }

  const pago = await db.addGroupPayment(req.params.id, {
    id: nanoid(10), from, to, amount: +amount.toFixed(2)
  });
  res.json(pago);
}));

app.delete('/api/groups/:id/payments/:paymentId', ruta(async (req, res) => {
  await db.removeGroupPayment(req.params.id, req.params.paymentId);
  res.json({ ok: true });
}));

// --- Meter un ticket en un grupo ------------------------------------------

app.post('/api/tickets/:id/group', ruta(async (req, res) => {
  const bruto = (req.body || {}).groupId;
  const groupId = (bruto === null || bruto === '') ? null : asText(bruto, 40);
  if (bruto !== null && bruto !== '' && !groupId) {
    return res.status(400).json({ error: 'Grupo no válido', code: 'BAD_GROUP' });
  }
  if (groupId && !(await db.getGroup(groupId))) {
    return res.status(404).json({ error: 'Grupo no encontrado' });
  }
  const ticket = await db.setTicketGroup(req.params.id, groupId);
  if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
  const safe = Object.assign({}, ticket);
  delete safe.creatorKey;
  res.json(safe);
}));


// --- Reserva de identidades ----------------------------------------------
//  Sin cuentas de usuario, lo unico que identifica a alguien es su movil. Al
//  elegir su nombre en el grupo se guarda un testigo, y a partir de ahi ese
//  nombre es suyo. Sin esto, cualquiera con el enlace podia hacerse pasar por
//  otro y quedarse con sus gastos.

app.post('/api/groups/:id/claim-member', ruta(async (req, res) => {
  const memberId = asText((req.body || {}).memberId, 40);
  const token = asText((req.body || {}).token, 80);
  if (!memberId || !token) {
    return res.status(400).json({ error: 'Faltan datos', code: 'BAD_CLAIM' });
  }
  const r = await db.claimGroupMember(req.params.id, memberId, token);
  if (!r.ok) {
    if (r.code === 'TAKEN') {
      return res.status(409).json({
        error: 'Ese nombre ya lo está usando otra persona',
        code: 'TAKEN'
      });
    }
    return res.status(404).json({ error: 'No encontrado', code: r.code });
  }
  res.json({ ok: true, name: r.name });
}));

app.post('/api/groups/:id/release-member', ruta(async (req, res) => {
  const memberId = asText((req.body || {}).memberId, 40);
  const token = asText((req.body || {}).token, 80);
  if (!memberId || !token) {
    return res.status(400).json({ error: 'Faltan datos', code: 'BAD_CLAIM' });
  }
  const r = await db.releaseGroupMember(req.params.id, memberId, token);
  if (!r.ok) {
    return res.status(r.code === 'NOT_YOURS' ? 403 : 404)
      .json({ error: 'No se puede soltar ese nombre', code: r.code });
  }
  res.json({ ok: true });
}));

/** Texto de la vista previa del grupo al pegarlo en WhatsApp. */
function groupShareMeta(s) {
  const eur = n => money.formatEUR(n, 'es');
  const nombre = s.group.name || 'Nuestro grupo';
  const gente = (s.group.members || []).length;

  let description;
  if (s.settled) {
    description = 'Todo saldado. ' + eur(s.stats.total) + ' entre ' + gente + '.';
  } else if (s.stats.apuntes === 0) {
    description = 'Grupo reci\u00e9n creado para ' + gente + '. A\u00f1ade el primer gasto.';
  } else if (s.transfers.length) {
    description = eur(s.stats.total) + ' en ' + s.stats.apuntes + ' gastos. Quedan ' +
      s.transfers.length + ' pagos por hacer.';
  } else {
    description = eur(s.stats.total) + ' en ' + s.stats.apuntes + ' gastos entre ' + gente + '.';
  }
  return { title: nombre + ' \u00b7 ' + eur(s.stats.total), description };
}

/**
 * Enlace corto del grupo: /g/:id
 *
 * Mismo planteamiento que /t/:id: solo esta ruta pasa por la función, para que
 * el resto siga saliendo del CDN, y se cachea unos segundos para que diez
 * personas abriéndolo a la vez no despierten diez funciones.
 */
app.get('/g/:id', ruta(async (req, res) => {
  const file = path.join(__dirname, 'public', 'group.html');
  let html;
  try {
    html = require('fs').readFileSync(file, 'utf8');
  } catch (_) {
    return res.status(500).send('No se ha podido cargar la p\u00e1gina');
  }

  let s = null;
  try { s = await groupSummary(req.params.id); } catch (_) {}

  if (s) {
    // Si la vista previa falla, la página se sirve igual. Un enlace sin
    // tarjeta bonita es un problema menor; uno que da error a todo el grupo
    // es grave.
    try {
      const meta = groupShareMeta(s);
      html = html
        .replace(/<meta property="og:title" content="[^"]*">/,
          '<meta property="og:title" content="' + escAttr(meta.title) + '">')
        .replace(/<meta property="og:description" content="[^"]*">/,
          '<meta property="og:description" content="' + escAttr(meta.description) + '">')
        .replace(/<title>[^<]*<\/title>/, '<title>' + escAttr(meta.title) + '</title>');
    } catch (e) {
      console.error('groupShareMeta fall\u00f3:', e && e.message);
    }
  }

  res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
  res.type('html').send(html);
}));

// SPA fallback — serve HTML pages
app.get('/ticket.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ticket.html')));
app.get('/claim.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'claim.html')));
app.get('/summary.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'summary.html')));

/**
 * Manejador de errores final. Cualquier fallo que se escape de una ruta acaba
 * aquí en vez de tumbar la instancia.
 *
 * Se registra el error entero en el log del servidor, pero al cliente solo le
 * llega una frase: los mensajes internos pueden delatar rutas de ficheros o
 * detalles de la base de datos.
 */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // Un cuerpo que no es JSON valido es culpa de quien llama, no nuestra.
  // Devolvia 500, lo que al depurar hacia buscar el fallo en el sitio
  // equivocado: parecia que se habia caido el servidor.
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError) && err.status === 400) {
    return res.status(400).json({ error: 'Peticion mal formada', code: 'BAD_JSON' });
  }

  console.error('Error no controlado:', req.method, req.path, err && (err.stack || err.message || err));
  res.status(500).json({
    error: 'Algo ha fallado por nuestra parte. Inténtalo de nuevo en unos segundos.',
    code: 'SERVER_ERROR'
  });
});

// Export for Vercel serverless; listen only when run directly (local dev)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  🎟️  comparTICKET running at http://localhost:${PORT}\n`);
  });
}

module.exports = app;
