// comparTICKET — Firestore adapter (replaces the old JSON-file DB)
// Same public API as before so server.js doesn't need to change shape.
// Collections (under Firebase project lifeos-74b8b):
//   comparticket_tickets/{ticketId}  — ticket docs
//   comparticket_tickets/{ticketId}/claims/{autoId}  — claim subcollection

const admin = require('firebase-admin');

// Initialize Firebase Admin once — env var is a JSON string.
if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.error('FIREBASE_SERVICE_ACCOUNT env var is missing — running without DB');
    // Initialize with application default credentials as fallback attempt
    try {
      admin.initializeApp();
    } catch (_) {
      admin.initializeApp({ projectId: 'lifeos-74b8b' });
    }
  } else {
    try {
      const svc = JSON.parse(raw);
      admin.initializeApp({
        credential: admin.credential.cert(svc),
        projectId: svc.project_id
      });
    } catch (err) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT:', err.message);
      admin.initializeApp({ projectId: 'lifeos-74b8b' });
    }
  }
}

const db = admin.firestore();
const TICKETS = 'comparticket_tickets';

function ticketRef(id) { return db.collection(TICKETS).doc(id); }
function claimsRef(id) { return ticketRef(id).collection('claims'); }

// --- Tickets ---

async function createTicket(id, items, total, imagePath, meta = {}) {
  const ticket = {
    id,
    items,
    total,
    imagePath: imagePath || null, // legacy field, nothing stored on disk anymore
    imagePaths: meta.imagePaths || [],
    restaurant: meta.restaurant || null,
    receiptDate: meta.receiptDate || null,
    payerName: null,
    expectedParticipants: null,
    creatorKey: meta.creatorKey || null,
    status: 'draft',
    createdAt: new Date().toISOString()
  };
  await ticketRef(id).set(ticket);
  return ticket;
}

async function getTicket(id) {
  const snap = await ticketRef(id).get();
  return snap.exists ? snap.data() : null;
}

async function getPublicTicket(id) {
  const ticket = await getTicket(id);
  if (!ticket) return null;
  const { creatorKey, ...safe } = ticket;
  return safe;
}

async function verifyCreatorKey(id, key) {
  const ticket = await getTicket(id);
  if (!ticket) return false;
  // Legacy tickets without a key — allow (dev backwards compat)
  if (!ticket.creatorKey) return true;
  return ticket.creatorKey === key;
}

async function setTicketPayer(id, payerName) {
  const ref = ticketRef(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ payerName: payerName || null });
  return (await ref.get()).data();
}

async function setTicketParticipants(id, expectedParticipants) {
  const ref = ticketRef(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const n = parseInt(expectedParticipants);
  await ref.update({
    expectedParticipants: Number.isFinite(n) && n > 0 ? n : null
  });
  return (await ref.get()).data();
}

async function updateTicketItems(id, items, total) {
  const ref = ticketRef(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const patch = { items };
  if (total !== undefined) patch.total = total;
  await ref.update(patch);
  return (await ref.get()).data();
}

async function setTicketStatus(id, status) {
  const ref = ticketRef(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ status });
  return (await ref.get()).data();
}

// --- Claims ---

async function addClaim(ticketId, personName, itemIds, itemCounts = null, itemUnits = null) {
  const ticket = await getTicket(ticketId);
  if (!ticket) return null;

  // Remove previous claim from the same person (case-insensitive name match)
  const lowerName = (personName || '').trim().toLowerCase();
  const dupSnap = await claimsRef(ticketId).get();
  const batch = db.batch();
  dupSnap.forEach(doc => {
    const d = doc.data();
    if ((d.personName || '').trim().toLowerCase() === lowerName) {
      batch.delete(doc.ref);
    }
  });
  await batch.commit();

  // Mark payer flag
  const isPayer = !!(ticket.payerName &&
    ticket.payerName.trim().toLowerCase() === lowerName);

  // Canonical path: derive ids/counts from itemUnits when present
  let finalItemIds = itemIds || [];
  let finalItemCounts = itemCounts || null;
  if (itemUnits && typeof itemUnits === 'object') {
    finalItemIds = Object.keys(itemUnits)
      .filter(k => Array.isArray(itemUnits[k]) && itemUnits[k].length > 0)
      .map(k => {
        const n = Number(k);
        return Number.isFinite(n) ? n : k;
      });
    finalItemCounts = {};
    finalItemIds.forEach(id => {
      finalItemCounts[id] = itemUnits[id].length;
    });
  }

  const claim = {
    id: Date.now(),
    ticketId,
    personName,
    itemIds: finalItemIds,
    itemCounts: finalItemCounts,
    itemUnits: itemUnits || null,
    isPayer,
    createdAt: new Date().toISOString()
  };
  await claimsRef(ticketId).add(claim);
  return claim;
}

async function getClaims(ticketId) {
  const snap = await claimsRef(ticketId).orderBy('createdAt', 'asc').get();
  return snap.docs.map(d => d.data());
}

async function removeClaim(ticketId, personName) {
  const snap = await claimsRef(ticketId).get();
  const batch = db.batch();
  snap.forEach(doc => {
    if (doc.data().personName === personName) {
      batch.delete(doc.ref);
    }
  });
  await batch.commit();
  return true;
}

module.exports = {
  createTicket,
  getTicket,
  getPublicTicket,
  verifyCreatorKey,
  updateTicketItems,
  setTicketStatus,
  setTicketPayer,
  setTicketParticipants,
  addClaim,
  getClaims,
  removeClaim
};
