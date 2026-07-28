require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const { nanoid } = require('nanoid');
const db = require('./db');
const ai = require('./ai');
const money = require('./money');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '1mb' }));

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
app.post('/api/tickets', rateLimit({ windowMs: 60_000, max: 8 }), handleUpload, async (req, res) => {
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
});

// Set payer for a ticket
app.post('/api/tickets/:id/payer', async (req, res) => {
  const { payerName } = req.body;
  const ticket = await db.setTicketPayer(req.params.id, payerName);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
});

// Set expected participants count
app.post('/api/tickets/:id/participants', async (req, res) => {
  const { expectedParticipants } = req.body;
  const ticket = await db.setTicketParticipants(req.params.id, expectedParticipants);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
});

// Get ticket data (public — creatorKey stripped)
app.get('/api/tickets/:id', async (req, res) => {
  const ticket = await db.getPublicTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
});

// Update ticket items
app.put('/api/tickets/:id/items', async (req, res) => {
  const { items, total } = req.body;

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
});

// Share ticket (change status to shared)
// Gate #1: the extracted lines must add up to the receipt total before anyone
// is invited in. Sharing a ticket that doesn't reconcile guarantees the split
// will be wrong and nobody will notice.
app.post('/api/tickets/:id/share', async (req, res) => {
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
});

// Close ticket — creator only
app.post('/api/tickets/:id/close', async (req, res) => {
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
});

// Add a claim (person selects items)
app.post('/api/tickets/:id/claim', async (req, res) => {
  const { personName, itemIds, itemCounts, itemUnits, confirmed } = req.body;
  const hasUnits = itemUnits && typeof itemUnits === 'object' &&
    Object.values(itemUnits).some(a => Array.isArray(a) && a.length > 0);
  const hasIds = itemIds && itemIds.length;
  if (!personName) {
    return res.status(400).json({ error: 'Name required' });
  }
  // Un borrador puede quedarse sin nada marcado (alguien que deselecciona todo);
  // una confirmación no.
  if (confirmed !== false && !hasUnits && !hasIds) {
    return res.status(400).json({ error: 'Name and items required' });
  }
  const claim = await db.addClaim(
    req.params.id,
    personName,
    itemIds || [],
    itemCounts || null,
    itemUnits || null,
    confirmed !== false
  );
  res.json(claim);
});

// Latido para el tiempo real: una sola lectura de documento. La pantalla de
// reparto lo consulta cada pocos segundos y solo recarga la lista completa de
// claims cuando el número cambia.
app.get('/api/tickets/:id/pulse', async (req, res) => {
  const pulse = await db.getPulse(req.params.id);
  if (!pulse) return res.status(404).json({ error: 'Ticket not found' });
  res.set('Cache-Control', 'no-store');
  res.json(pulse);
});

// Get all claims for a ticket
app.get('/api/tickets/:id/claims', async (req, res) => {
  const claims = await db.getClaims(req.params.id);
  res.json(claims);
});

// Remove a claim
app.delete('/api/tickets/:id/claim/:personName', async (req, res) => {
  await db.removeClaim(req.params.id, decodeURIComponent(req.params.personName));
  res.json({ ok: true });
});

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
app.get('/t/:id', async (req, res) => {
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
    const meta = shareMeta(ticket, claims);
    html = html
      .replace(/<meta property="og:title" content="[^"]*">/,
        `<meta property="og:title" content="${escAttr(meta.title)}">`)
      .replace(/<meta property="og:description" content="[^"]*">/,
        `<meta property="og:description" content="${escAttr(meta.description)}">`)
      .replace(/<title>[^<]*<\/title>/, `<title>${escAttr(meta.title)}</title>`);
  }

  // 60 s en el CDN, y mientras se revalida se sigue sirviendo lo anterior.
  res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.type('html').send(html);
});

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Texto de la vista previa. Cambia según el estado de la cuenta, porque lo que
 * empuja a tocar el enlace no es lo mismo cuando aún no ha marcado nadie que
 * cuando faltas tú y los demás ya han terminado.
 */
function shareMeta(ticket, claims) {
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

  return { title: `${sitio} · ${eur}`, description };
}

// SPA fallback — serve HTML pages
app.get('/ticket.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ticket.html')));
app.get('/claim.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'claim.html')));
app.get('/summary.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'summary.html')));

// Export for Vercel serverless; listen only when run directly (local dev)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  🎟️  comparTICKET running at http://localhost:${PORT}\n`);
  });
}

module.exports = app;
