require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const { nanoid } = require('nanoid');
const db = require('./db');
const ai = require('./ai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer — memory storage (images are sent to Gemini and then discarded)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|heic/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext || mime);
  }
});

// --- API Routes ---

// Upload images → Gemini extracts items → ticket created in Firestore
app.post('/api/tickets', upload.array('images', 6), async (req, res) => {
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

    const extracted = await ai.extractItemsFromImages(images);

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
  const ticket = await db.updateTicketItems(req.params.id, items, total);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
});

// Share ticket (change status to shared)
app.post('/api/tickets/:id/share', async (req, res) => {
  const ticket = await db.setTicketStatus(req.params.id, 'shared');
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
});

// Close ticket — creator only
app.post('/api/tickets/:id/close', async (req, res) => {
  const { creatorKey } = req.body || {};
  const valid = await db.verifyCreatorKey(req.params.id, creatorKey);
  if (!valid) {
    return res.status(403).json({ error: 'Only the ticket creator can close it' });
  }
  const ticket = await db.setTicketStatus(req.params.id, 'closed');
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  const { creatorKey: _k, ...safe } = ticket;
  res.json(safe);
});

// Add a claim (person selects items)
app.post('/api/tickets/:id/claim', async (req, res) => {
  const { personName, itemIds, itemCounts, itemUnits } = req.body;
  const hasUnits = itemUnits && typeof itemUnits === 'object' &&
    Object.values(itemUnits).some(a => Array.isArray(a) && a.length > 0);
  const hasIds = itemIds && itemIds.length;
  if (!personName || (!hasUnits && !hasIds)) {
    return res.status(400).json({ error: 'Name and items required' });
  }
  const claim = await db.addClaim(
    req.params.id,
    personName,
    itemIds || [],
    itemCounts || null,
    itemUnits || null
  );
  res.json(claim);
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
