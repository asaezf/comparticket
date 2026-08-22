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
    receiptTime: meta.receiptTime || null,
    address: meta.address || null,
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
  // Antes, un ticket sin clave lo podía cerrar cualquiera: la comprobación
  // devolvía true por compatibilidad con los tickets antiguos. Eso era una
  // puerta trasera — bastaba con crear el ticket de forma que no guardara
  // clave. Ahora sin clave no se cierra.
  if (!ticket.creatorKey) return false;
  if (typeof key !== 'string' || key.length !== ticket.creatorKey.length) return false;
  // Comparación en tiempo constante: evita deducir la clave midiendo cuánto
  // tarda en fallar.
  let diff = 0;
  for (let i = 0; i < key.length; i++) {
    diff |= key.charCodeAt(i) ^ ticket.creatorKey.charCodeAt(i);
  }
  return diff === 0;
}

async function setTicketPayer(id, payerName) {
  const ref = ticketRef(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  // Segunda capa: solo se guarda texto. Un objeto aquí dejaba el enlace del
  // ticket roto de forma permanente para todo el grupo, porque la vista previa
  // hace .trim() sobre este valor cada vez que alguien lo abre.
  const limpio = typeof payerName === 'string' ? payerName.trim().slice(0, 40) : '';
  await ref.update({ payerName: limpio || null });
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

  // Se apunta CUANDO se cierra, no solo que esta cerrado.
  //
  // Es la fecha que convierte una deuda en exigible: hasta que el ticket no
  // se cierra, lo que debe cada uno todavia puede cambiar, y no tiene sentido
  // contarle los dias a nadie. Desde el cierre si: es el momento a partir del
  // cual alguien lleva sin pagar.
  const campos = { status };
  if (status === 'closed' && !snap.data().closedAt) {
    campos.closedAt = new Date().toISOString();
  }
  await ref.update(campos);
  return (await ref.get()).data();
}

// --- Claims ---

// Un id de documento estable por persona: guardar la selección mientras se
// toca genera muchas escrituras, y con id determinista cada una sobrescribe
// la anterior en lugar de borrar y crear. Firestore no admite '/' ni '.' al
// principio, así que se codifica.
function claimDocId(personName) {
  // String() a propósito: aunque el servidor ya valida la entrada, esta función
  // construye el id de un documento y no puede permitirse reventar por un tipo
  // inesperado que llegue por otro camino.
  const clean = String(personName == null ? '' : personName).trim().toLowerCase();
  return 'p_' + Buffer.from(clean, 'utf8').toString('base64')
    .replace(/\//g, '_').replace(/\+/g, '-').slice(0, 400);
}

async function addClaim(ticketId, personName, itemIds, itemCounts = null, itemUnits = null, confirmed = true) {
  const ticket = await getTicket(ticketId);
  if (!ticket) return null;

  const lowerName = (personName || '').trim().toLowerCase();
  const docId = claimDocId(personName);

  // Limpieza de claims antiguos con id automático de la misma persona, de
  // antes de que los ids fueran deterministas.
  const dupSnap = await claimsRef(ticketId).get();
  const batch = db.batch();
  let hadLegacy = false;
  let createdAt = null;
  dupSnap.forEach(doc => {
    const d = doc.data();
    if (doc.id === docId) {
      createdAt = d.createdAt || null;   // se conserva de la primera vez
      return;
    }
    if ((d.personName || '').trim().toLowerCase() === lowerName) {
      batch.delete(doc.ref);
      hadLegacy = true;
    }
  });
  if (hadLegacy) await batch.commit();

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
    id: docId,
    ticketId,
    personName,
    itemIds: finalItemIds,
    itemCounts: finalItemCounts,
    itemUnits: itemUnits || null,
    isPayer,
    // Un borrador es alguien que todavía está eligiendo. Se ve en vivo en la
    // pantalla de reparto, pero no cuenta como participante listo ni entra en
    // el cuadre para cerrar la cuenta: podría abandonar sin confirmar.
    confirmed: confirmed !== false,
    updatedAt: new Date().toISOString()
  };
  // ¡SIN merge! Se reemplaza el documento entero, a propósito.
  //
  // Antes esto era `set(..., { merge: true })` y causaba el fallo más grave de
  // la app: Firestore FUSIONA los mapas anidados. `itemUnits` es un mapa
  // {"1":[0], "2":[0]}; al guardar {"1":[0]} la clave "2" sobrevivía. Es
  // decir: **deseleccionar un artículo nunca lo quitaba de lo guardado**. El
  // claim solo crecía y acababa acumulando todo lo que esa persona hubiera
  // tocado alguna vez, aunque lo hubiera desmarcado.
  //
  // Efecto visible: en el resumen a alguien le aparecían artículos que no
  // había marcado, la cuenta "cuadraba" sola y se cerraba con importes falsos.
  //
  // `createdAt` se conserva a mano (se ha leído arriba), que era lo único que
  // el merge aportaba.
  await claimsRef(ticketId).doc(docId).set({
    createdAt: createdAt || new Date().toISOString(),
    ...claim
  });

  await bumpClaimsVersion(ticketId);
  return claim;
}

/**
 * Contador que sube en cada cambio de los claims. La pantalla de reparto lo
 * consulta cada pocos segundos: leer este número es UNA lectura de documento,
 * mientras que releer toda la subcolección son tantas como participantes.
 * Con diez personas eligiendo a la vez, la diferencia es enorme en cuota.
 */
async function bumpClaimsVersion(ticketId) {
  try {
    await ticketRef(ticketId).update({
      claimsVersion: admin.firestore.FieldValue.increment(1)
    });
  } catch (_) { /* el ticket puede no existir; no es crítico */ }
}

/** Latido: lo mínimo para saber si hay novedades, en una sola lectura. */
async function getPulse(ticketId) {
  const snap = await ticketRef(ticketId).get();
  if (!snap.exists) return null;
  const d = snap.data();
  return { v: d.claimsVersion || 0, status: d.status || 'draft' };
}

async function getClaims(ticketId) {
  const snap = await claimsRef(ticketId).orderBy('createdAt', 'asc').get();
  // Los claims anteriores a los borradores no tienen el campo: se consideran
  // confirmados, que es lo que eran.
  return snap.docs.map(d => {
    const data = d.data();
    return { ...data, confirmed: data.confirmed !== false };
  });
}

async function removeClaim(ticketId, personName) {
  const snap = await claimsRef(ticketId).get();
  const batch = db.batch();
  let found = false;
  snap.forEach(doc => {
    if (doc.data().personName === personName) {
      batch.delete(doc.ref);
      found = true;
    }
  });
  if (found) {
    await batch.commit();
    await bumpClaimsVersion(ticketId);
  }
  return true;
}


// =============================================================
//  GRUPOS  (viajes, pisos compartidos)
// =============================================================
//  Un grupo junta muchos tickets y gastos a lo largo de dias y, al final,
//  dice quien le paga a quien con el minimo de transferencias.
//
//  Decision de diseno importante: el grupo tiene una LISTA CERRADA de
//  miembros, y dentro de un grupo la pantalla de marcar ensena botones con
//  esos nombres en vez de un campo de texto. Asi "Alvaro", "alvaro" y
//  "Alvarito" no pueden ser tres personas distintas al cuadrar el viaje.
//  Es menos friccion para el usuario Y mata de raiz los fallos de identidad.
//
//  El resto de la app no se entera: un ticket sin groupId funciona
//  exactamente igual que siempre.

const GROUPS = 'comparticket_groups';

function groupRef(id) { return db.collection(GROUPS).doc(id); }
function expensesRef(id) { return groupRef(id).collection('expenses'); }
function paymentsRef(id) { return groupRef(id).collection('payments'); }
function eventsRef(id) { return groupRef(id).collection('events'); }

async function createGroup(id, name, members, creatorKey) {
  const group = {
    id,
    name,
    members: members || [],
    creatorKey: creatorKey || null,
    status: 'open',
    createdAt: new Date().toISOString(),
    settledAt: null
  };
  await groupRef(id).set(group);
  return group;
}

async function getGroup(id) {
  const snap = await groupRef(id).get();
  return snap.exists ? snap.data() : null;
}

/** Sin la clave del creador: es lo unico que no puede salir al navegador. */
async function getPublicGroup(id) {
  const g = await getGroup(id);
  if (!g) return null;
  const rest = Object.assign({}, g);
  delete rest.creatorKey;
  return rest;
}

async function verifyGroupKey(id, key) {
  const g = await getGroup(id);
  if (!g || !g.creatorKey) return false;
  if (typeof key !== 'string' || key.length !== g.creatorKey.length) return false;
  // Comparacion en tiempo constante, igual que en los tickets.
  let diff = 0;
  for (let i = 0; i < key.length; i++) {
    diff |= key.charCodeAt(i) ^ g.creatorKey.charCodeAt(i);
  }
  return diff === 0;
}

async function setGroupMembers(id, members) {
  const ref = groupRef(id);
  if (!(await ref.get()).exists) return null;
  await ref.update({ members: members || [] });
  return (await ref.get()).data();
}

async function setGroupStatus(id, status) {
  const ref = groupRef(id);
  if (!(await ref.get()).exists) return null;
  await ref.update({
    status,
    settledAt: status === 'settled' ? new Date().toISOString() : null
  });
  return (await ref.get()).data();
}

// --- Gastos sin ticket (el taxi, las entradas, la gasolina) ---------------
//  En un viaje la mitad de lo que se paga no lleva ticket que escanear. Sin
//  esto el grupo no cuadra con la realidad.

async function addGroupExpense(groupId, expense) {
  const id = expense.id;
  const doc = {
    id,
    description: expense.description,
    amount: expense.amount,
    paidBy: expense.paidBy,
    splitBetween: expense.splitBetween || [],
    createdAt: new Date().toISOString()
  };
  await expensesRef(groupId).doc(id).set(doc);
  await bumpGroupVersion(groupId);
  return doc;
}

async function getGroupExpenses(groupId) {
  const snap = await expensesRef(groupId).orderBy('createdAt', 'asc').get();
  // Lo archivado no vuelve a salir: pertenece a un reparto ya liquidado.
  // No se borra —el documento sigue en la base de datos— pero deja de contar.
  return snap.docs.map(d => d.data()).filter(e => !e.archivedAt);
}

async function removeGroupExpense(groupId, expenseId) {
  await expensesRef(groupId).doc(expenseId).delete();
  await bumpGroupVersion(groupId);
  return true;
}

// --- Pagos entre personas -------------------------------------------------
//  La app NO mueve dinero: solo anota que alguien dice haber pagado. El
//  dinero va por Bizum entre ellos, como siempre. Meterse a mover dinero
//  convertiria esto en una entidad de pago, con licencia y todo lo que eso
//  arrastra.

async function addGroupPayment(groupId, payment) {
  const doc = {
    id: payment.id,
    from: payment.from,
    to: payment.to,
    amount: payment.amount,
    // Cuantos dias llevaba parada la deuda cuando este pago la salda.
    //
    // Se apunta AQUI, en el momento del pago, porque despues ya no se puede
    // saber: en cuanto entra otro gasto, el grupo vuelve a moverse y esa
    // espera se pierde para siempre. Es lo que permite decir quien tarda en
    // pagar y quien no.
    esperoDias: (typeof payment.esperoDias === 'number') ? payment.esperoDias : null,
    createdAt: new Date().toISOString()
  };
  await paymentsRef(groupId).doc(doc.id).set(doc);
  await bumpGroupVersion(groupId);
  return doc;
}

async function getGroupPayments(groupId) {
  const snap = await paymentsRef(groupId).orderBy('createdAt', 'asc').get();
  return snap.docs.map(d => d.data()).filter(p => !p.archivedAt);
}

async function removeGroupPayment(groupId, paymentId) {
  await paymentsRef(groupId).doc(paymentId).delete();
  await bumpGroupVersion(groupId);
  return true;
}

// --- Tickets que pertenecen a un grupo ------------------------------------

async function getGroupTickets(groupId) {
  const snap = await db.collection(TICKETS).where('groupId', '==', groupId).get();
  const tickets = snap.docs.map(d => {
    const t = d.data();
    const rest = Object.assign({}, t);
    delete rest.creatorKey;
    return rest;
  }).filter(t => !t.archivedAt);
  // Se ordena aqui y no en la consulta para no obligar a crear un indice
  // compuesto en Firestore. Un grupo maneja decenas de tickets, no miles.
  tickets.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return tickets;
}

async function setTicketGroup(ticketId, groupId) {
  const ref = ticketRef(ticketId);
  if (!(await ref.get()).exists) return null;
  await ref.update({ groupId: groupId || null });
  if (groupId) await bumpGroupVersion(groupId);
  return (await ref.get()).data();
}



/**
 * Reserva una identidad del grupo para un dispositivo.
 *
 * Sin cuentas de usuario, lo unico que identifica a alguien es su movil. Al
 * elegir su nombre se guarda un testigo aleatorio, y a partir de ahi ese
 * nombre es suyo: nadie mas puede cogerlo ni cambiarlo. Sin esto, cualquiera
 * con el enlace podia hacerse pasar por otro y quedarse con sus gastos.
 *
 * Va en transaccion porque dos personas pueden tocar el mismo nombre a la vez
 * en la misma mesa. Sin ella, los dos leerian "libre" y los dos lo cogerian.
 */
async function claimGroupMember(groupId, memberId, token) {
  const ref = groupRef(groupId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, code: 'NO_GROUP' };

    const g = snap.data();
    const miembros = (g.members || []).slice();
    const i = miembros.findIndex(m => m.id === memberId);
    if (i < 0) return { ok: false, code: 'NO_MEMBER' };

    const actual = miembros[i].claimedBy;
    // Volver a entrar desde el mismo movil no es coger nada nuevo.
    if (actual && actual !== token) return { ok: false, code: 'TAKEN', name: miembros[i].name };

    if (!actual) {
      miembros[i] = Object.assign({}, miembros[i], {
        claimedBy: token,
        claimedAt: new Date().toISOString()
      });
      tx.update(ref, { members: miembros });
    }
    return { ok: true, name: miembros[i].name };
  });
}

/** Suelta una identidad: solo puede hacerlo el movil que la cogio. */
async function releaseGroupMember(groupId, memberId, token) {
  const ref = groupRef(groupId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, code: 'NO_GROUP' };

    const g = snap.data();
    const miembros = (g.members || []).slice();
    const i = miembros.findIndex(m => m.id === memberId);
    if (i < 0) return { ok: false, code: 'NO_MEMBER' };
    if (miembros[i].claimedBy && miembros[i].claimedBy !== token) {
      return { ok: false, code: 'NOT_YOURS' };
    }
    const limpio = Object.assign({}, miembros[i]);
    delete limpio.claimedBy;
    delete limpio.claimedAt;
    miembros[i] = limpio;
    tx.update(ref, { members: miembros });
    return { ok: true };
  });
}


/**
 * Sube el contador de cambios del grupo.
 *
 * Sirve para que las pantallas abiertas se enteren de que hay algo nuevo sin
 * tener que releer todo el grupo cada pocos segundos: el latido lee UN
 * documento, y solo si el numero ha cambiado se pide el resumen entero. Con
 * un viaje de treinta tickets, la diferencia es entre una lectura y treinta.
 */
async function bumpGroupVersion(groupId) {
  try {
    await groupRef(groupId).update({
      version: admin.firestore.FieldValue.increment(1),
      updatedAt: new Date().toISOString()
    });
  } catch (_) { /* el grupo puede no existir; no es critico */ }
}

/** Latido: lo minimo para saber si hay novedades, en una sola lectura. */
async function getGroupPulse(groupId) {
  const snap = await groupRef(groupId).get();
  if (!snap.exists) return null;
  const d = snap.data();
  return { v: d.version || 0, status: d.status || 'open' };
}

/** Plantilla de los recordatorios de este grupo (el easter egg). */
async function setGroupTemplate(groupId, template) {
  const ref = groupRef(groupId);
  if (!(await ref.get()).exists) return null;
  await ref.update({ reminderTemplate: template || null });
  await bumpGroupVersion(groupId);
  return (await ref.get()).data();
}


/**
 * Bloquea o desbloquea el reparto del grupo.
 *
 * Mientras esta abierto, las deudas todavia se estan moviendo: cada gasto que
 * entra las recalcula, y no tiene sentido reclamarle nada a nadie ni ponerse
 * a contar dias. Al bloquear se congela el momento —`lockedAt`— y a partir de
 * ahi si: empiezan los recordatorios, los colores y el reloj.
 *
 * Bloqueado no se pueden anadir gastos ni tickets. Es lo que hace que la cifra
 * que ves sea la cifra que se paga.
 */
async function setGroupLocked(groupId, bloqueado) {
  const ref = groupRef(groupId);
  if (!(await ref.get()).exists) return null;
  await ref.update({ lockedAt: bloqueado ? new Date().toISOString() : null });
  await bumpGroupVersion(groupId);
  return (await ref.get()).data();
}

/**
 * Liquida el reparto y deja el grupo a cero.
 *
 * Para cuando todo el mundo ha pagado y se quiere empezar de nuevo: un viaje
 * que termina, un mes de piso que se cierra. Lo que habia deja de contar y el
 * reparto arranca vacio.
 *
 * NO borra nada. Marca cada gasto, cada pago y cada ticket con la fecha en que
 * se archivo, y las lecturas los ignoran. Borrar de verdad seria irreversible,
 * y esto es dinero: si alguien se equivoca al pulsar, los datos siguen ahi.
 */
async function clearGroupSettlement(groupId) {
  const ahora = new Date().toISOString();
  const ref = groupRef(groupId);
  if (!(await ref.get()).exists) return null;

  const [gastos, pagos, tickets] = await Promise.all([
    expensesRef(groupId).get(),
    paymentsRef(groupId).get(),
    db.collection(TICKETS).where('groupId', '==', groupId).get()
  ]);

  const lote = db.batch();
  let n = 0;
  for (const snap of [gastos, pagos, tickets]) {
    snap.docs.forEach(d => {
      if (d.data().archivedAt) return;
      lote.update(d.ref, { archivedAt: ahora });
      n++;
    });
  }
  await lote.commit();

  // Se queda desbloqueado: no hay nada que congelar.
  await ref.update({ lockedAt: null });
  await bumpGroupVersion(groupId);
  return { archivados: n };
}


/**
 * Apunta algo que ha pasado en el grupo.
 *
 * Sin esto, lo unico que se sabia era que el contador de version habia
 * cambiado: la pantalla se recargaba y ya. Con el diario se puede decir QUE
 * ha pasado y QUIEN lo ha hecho, que es lo que convierte una recarga
 * silenciosa en un aviso util.
 *
 * `actor` es el nombre dentro del grupo de quien lo provoco, y sirve para no
 * avisarte de tus propias acciones. Puede venir vacio —una accion hecha desde
 * un movil que todavia no ha elegido nombre— y entonces se avisa a todos.
 */
async function addGroupEvent(groupId, evento) {
  if (!groupId || !evento || !evento.tipo) return null;
  // El id lo pone Firestore. Aquí no hay nanoid —este fichero solo conoce
  // firebase-admin— y los ids de todo lo demás llegan ya hechos desde
  // server.js; un aviso no necesita un id con significado.
  const ref = eventsRef(groupId).doc();
  const doc = {
    id: ref.id,
    tipo: evento.tipo,
    actor: evento.actor || null,
    datos: evento.datos || {},
    createdAt: new Date().toISOString()
  };
  try {
    await ref.set(doc);
  } catch (_) {
    // Un aviso que no se puede guardar no puede tumbar la accion que lo
    // provoco: el gasto ya esta apuntado, y eso es lo que importa.
    return null;
  }
  return doc;
}

/**
 * Los ultimos avisos del grupo, del mas antiguo al mas reciente.
 *
 * Se limita a unos pocos a proposito: esto alimenta una notificacion, no un
 * historial. Quien quiera ver todo lo que ha pasado tiene las listas y el
 * historial completo.
 */
async function getGroupEvents(groupId, limite) {
  try {
    const snap = await eventsRef(groupId)
      .orderBy('createdAt', 'desc')
      .limit(Math.min(+limite || 12, 40))
      .get();
    return snap.docs.map(d => d.data()).reverse();
  } catch (_) {
    return [];
  }
}


// --- Las fotos del ticket -------------------------------------------------
//
// Cada foto va en SU PROPIO documento, no en un array dentro del ticket. Un
// documento de Firestore tiene un tope duro de 1 MB, y el ticket ya lleva
// dentro los articulos, el reparto y las marcas de cada persona: meterle ahi
// tres fotos lo reventaria en cuanto el ticket creciera un poco.
//
// Se guardan en base64 dentro del documento porque el almacenamiento de
// ficheros todavia no esta montado. Es una solucion de mientras, y hay un
// tope de tamano para que no pueda romper nada: el navegador manda una copia
// reducida de unos 120 KB (ver ImgPrep.archive), que en base64 son unos 160.
// Cuando haya bucket, esto se cambia por una URL y lo demas no se entera.

const TOPE_FOTO = 700 * 1024;   // holgura de sobra bajo el 1 MB del documento

function photosRef(ticketId) { return ticketRef(ticketId).collection('photos'); }

/**
 * Guarda una foto de un ticket. Devuelve null si no cabe.
 *
 * Nunca lanza: una foto que no se puede guardar no puede tumbar el escaneo,
 * que es lo que de verdad importa. El ticket funciona igual sin foto.
 */
async function addTicketPhoto(ticketId, buffer, mime) {
  if (!ticketId || !buffer || !buffer.length) return null;
  const b64 = buffer.toString('base64');
  if (b64.length > TOPE_FOTO) return null;

  try {
    const ref = photosRef(ticketId).doc();
    const doc = {
      id: ref.id,
      mime: mime || 'image/jpeg',
      datos: b64,
      bytes: buffer.length,
      createdAt: new Date().toISOString()
    };
    await ref.set(doc);

    // Cuantas hay, apuntado en el propio ticket: asi la pantalla sabe si
    // ensenar el boton de la foto sin tener que leer la subcoleccion entera
    // de cada ticket para averiguarlo.
    await ticketRef(ticketId).update({
      photoCount: admin.firestore.FieldValue.increment(1)
    });
    return { id: doc.id, bytes: doc.bytes };
  } catch (_) {
    return null;
  }
}

/** Las fotos de un ticket. Solo se piden cuando alguien las quiere ver. */
async function getTicketPhotos(ticketId) {
  try {
    const snap = await photosRef(ticketId).orderBy('createdAt', 'asc').get();
    return snap.docs.map(d => d.data());
  } catch (_) {
    return [];
  }
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
  removeClaim,
  getPulse,
  // Grupos
  createGroup,
  getGroup,
  getPublicGroup,
  verifyGroupKey,
  setGroupMembers,
  setGroupStatus,
  addGroupExpense,
  getGroupExpenses,
  removeGroupExpense,
  addGroupPayment,
  getGroupPayments,
  removeGroupPayment,
  getGroupTickets,
  setTicketGroup,
  claimGroupMember,
  releaseGroupMember,
  bumpGroupVersion,
  getGroupPulse,
  setGroupTemplate,
  setGroupLocked,
  clearGroupSettlement,
  addGroupEvent,
  getGroupEvents,
  addTicketPhoto,
  getTicketPhotos
};
