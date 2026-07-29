// comparTICKET — Claim page (per-unit picking)
// Each item exposes one pill per unit. Tapping a pill toggles whether
// the current user consumed that specific unit. If multiple users tap the
// same unit, it becomes "shared" and the price is split among them.
// El id llega por /t/abc123 (enlace corto que se comparte, con vista previa)
// o por ?id=abc123 (enlaces antiguos, que deben seguir funcionando).
const params = new URLSearchParams(window.location.search);
const ticketId = params.get('id') || (location.pathname.match(/^\/t\/([^/?#]+)/) || [])[1];
if (!ticketId) window.location.href = '/';

document.getElementById('barTitle').textContent = t.claimTitle;
document.getElementById('nameLabel').textContent = t.yourName.toUpperCase();
document.getElementById('nameInput').placeholder = t.yourNamePlaceholder;
document.getElementById('lblTotal').textContent = t.total;
document.getElementById('confirmBtn').textContent = t.confirm;
// Tutorial texts
const _ctut1 = document.getElementById('ctut1');
const _ctut2 = document.getElementById('ctut2');
const _ctut3 = document.getElementById('ctut3');
if (_ctut1) _ctut1.textContent = t.ctut1;
if (_ctut2) _ctut2.textContent = t.ctut2;
if (_ctut3) _ctut3.textContent = t.ctut3;
const _help = document.getElementById('helpSummary');
if (_help) _help.textContent = t.tutTitle;

let ticketData = null;
let claimsData = [];
// myUnits: { [itemId]: Set<unitIdx> }
const myUnits = {};

// --- Tiempo real ---
// La selección se guarda como borrador según se toca, para que los demás la
// vean mientras eligen. Sin esto no había nada que enseñar: hasta ahora no se
// escribía nada hasta pulsar "Confirmar", así que dos personas eligiendo a la
// vez eran invisibles la una para la otra.
let lastVersion = -1;      // último claimsVersion visto
let lastTouch = 0;         // cuándo tocó el usuario por última vez
let saveTimer = null;
let polling = null;
let lastSaved = null;      // firma del último borrador enviado
let confirmedNow = false;  // ya se confirmó: no degradar a borrador al salir
const SAVE_DEBOUNCE = 700;

// Sondeo adaptativo. Un intervalo fijo obliga a elegir entre "va con retardo"
// y "gasta cuota todo el rato". Cuando hay movimiento en la mesa se pregunta
// cada 900 ms —que es cuando importa que se vea en vivo— y si no pasa nada se
// va relajando hasta 6 s. Todos eligen a la vez durante un minuto y luego la
// pantalla se queda quieta: el ritmo debe seguir eso.
const POLL_FAST = 900;
const POLL_SLOW = 3000;   // techo bajo a propósito: el peor caso es el primero
                          // que se mueve tras un rato de calma, y ese momento
                          // no puede tardar 6 s en verse.
const IDLE_BEFORE_BACKOFF = 12;  // ~11 s quieto antes de empezar a relajarse
let pollMs = POLL_FAST;
let idleRounds = 0;

function myName() {
  return (document.getElementById('nameInput').value || '').trim();
}

// --- Recordar el nombre ---
// La gente parte cuentas con el mismo móvil una y otra vez. Guardarlo hace que
// a partir de la segunda vez no haya que escribir nada: el paso desaparece en
// lugar de añadirse.
//
// Pero hay que distinguir dos cosas que antes se confundían, y esa confusión
// era un fallo grave:
//
//   ct_name          — cómo me suelo llamar. Sirve para rellenar el campo.
//   ct_claim_<id>    — con qué nombre he marcado YO en ESTE ticket concreto.
//
// Solo lo segundo autoriza a cargar una selección guardada. Con lo primero se
// rellena el campo y nada más. El caso que rompía: en una mesa el móvil se
// pasa de mano en mano, y la segunda persona abría el enlace con el nombre de
// la primera puesto Y sus artículos ya marcados. Al tocar los suyos se sumaban
// a los de la otra, y al confirmar se sobrescribía su selección. La app
// acababa diciendo que alguien había pedido cosas que no pidió.
const NAME_KEY = 'ct_name';
const CLAIM_KEY = () => 'ct_claim_' + ticketId;

function rememberName(name) {
  try { if (name) localStorage.setItem(NAME_KEY, name); } catch (_) {}
}

function recalledName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch (_) { return ''; }
}

/** Deja constancia de que esta selección de este ticket es mía. */
function rememberMyClaim(name) {
  try { if (name) localStorage.setItem(CLAIM_KEY(), name.trim().toLowerCase()); } catch (_) {}
}

/** Con qué nombre he marcado yo en este ticket, si es que lo he hecho. */
function myClaimOnThisTicket() {
  try { return localStorage.getItem(CLAIM_KEY()) || ''; } catch (_) { return ''; }
}

/** ¿Existe ya una selección guardada con este nombre, y no es mía? */
function nameBelongsToSomeoneElse(name) {
  const n = (name || '').trim().toLowerCase();
  if (!n) return false;
  if (n === myClaimOnThisTicket()) return false;   // soy yo volviendo
  return claimsData.some(c => (c.personName || '').trim().toLowerCase() === n);
}

// Mientras esto esté puesto, el nombre escrito pertenece a otra persona y no
// se guarda nada: haría falta que el usuario diga primero quién es.
let identityBlocked = false;

/**
 * Avisa de que el nombre escrito ya tiene una selección guardada, y pregunta
 * de quién es. Hasta que se responda no se carga ni se guarda nada.
 *
 * Es el guardarraíl del fallo más grave que ha tenido la app: dos personas
 * usando el mismo móvil acababan compartiendo un único claim, y la selección
 * de la primera se perdía sin que nadie se enterara.
 */
function askWhoYouAre(name) {
  const box = document.getElementById('nameTaken');
  if (!box) return;
  identityBlocked = true;
  // Nada de lo que hubiera cargado es de fiar hasta que se responda.
  Object.keys(myUnits).forEach(k => delete myUnits[k]);
  prefilledFrom = null;
  box.classList.remove('hidden');
  document.getElementById('nameTakenText').textContent =
    t.nameTaken.replace('{name}', name);
  document.getElementById('nameTakenMine').textContent = t.nameTakenMine;
  document.getElementById('nameTakenOther').textContent = t.nameTakenOther;
}

function clearWhoYouAre() {
  const box = document.getElementById('nameTaken');
  if (box) box.classList.add('hidden');
  identityBlocked = false;
}

// Se pone a true tras confirmar y volver con el botón "atrás" del navegador.
// Con el nombre bloqueado se puede seguir corrigiendo la selección con toda
// libertad — lo único que no se puede es cambiar de identidad sin recargar el
// enlace del ticket. Ver lockName() para el porqué.
let nameLocked = false;

/**
 * Barra bajo el nombre. Dos modos:
 *
 *   normal  — "Marcando como Álvaro · No soy yo". Informa, no bloquea: quien
 *             vuelve a lo suyo la ignora, y quien acaba de recibir el móvil
 *             sale de ahí con un toque.
 *   locked  — sin botón de acción: el campo ya está bloqueado (ver lockName),
 *             así que no hay nada que ofrecer salvo explicar por qué.
 */
function showIdentityBar(name, locked) {
  const bar = document.getElementById('identityBar');
  if (!bar) return;
  bar.classList.remove('hidden');
  const btn = document.getElementById('identityBarBtn');
  if (locked) {
    document.getElementById('identityBarText').innerHTML =
      `${esc(t.markingAs)} <strong>${esc(name)}</strong> — ${esc(t.nameLockedHint)}`;
    btn.classList.add('hidden');
  } else {
    document.getElementById('identityBarText').innerHTML =
      `${esc(t.markingAs)} <strong>${esc(name)}</strong>`;
    btn.classList.remove('hidden');
    btn.textContent = t.notMe;
  }
}

function hideIdentityBar() {
  const bar = document.getElementById('identityBar');
  if (bar) bar.classList.add('hidden');
}

/**
 * Bloquea el campo del nombre. Regla que pidió Álvaro tras encontrar un fallo
 * muy concreto: al confirmar, volver con el botón "atrás" y escribir un
 * nombre distinto, aparecían en amarillo (compartido) los artículos de la
 * primera selección, porque el navegador restaura la página en el mismo
 * estado en que la dejaste (con tu selección todavía en memoria) y nada
 * avisaba de que el nombre había cambiado.
 *
 * En vez de perseguir ese caso concreto con más lógica de limpieza — arriesgo
 * de meter un bug nuevo por uno que ya de por sí es raro de provocar — se
 * cierra la puerta de raíz: una vez confirmas, ya no puedes cambiar de nombre
 * volviendo atrás. Puedes seguir corrigiendo tu propia selección con total
 * libertad; para marcar como otra persona hay que volver a entrar por el
 * enlace del ticket, que es una carga nueva y sin este problema.
 */
function lockName(name) {
  nameLocked = true;
  const input = document.getElementById('nameInput');
  input.value = name;
  input.readOnly = true;
  input.closest('.name-field')?.classList.add('locked');
  clearWhoYouAre();
  showIdentityBar(name, true);
}

/**
 * ¿Ha llegado esta carga volviendo con "atrás/adelante", en vez de por un
 * enlace nuevo? Es la señal que distingue "corrijo lo mío" (se permite
 * cambiar de nombre) de "vuelvo a una pantalla que ya confirmé" (no se
 * permite): entrar de nuevo por el enlace del ticket —desde WhatsApp, o
 * pulsando "Marcar lo mío" en el resumen— siempre cuenta como entrada nueva,
 * aunque la URL sea la misma.
 */
function cameBackViaHistory() {
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) return nav.type === 'back_forward';
  } catch (_) {}
  try { return performance.navigation && performance.navigation.type === 2; }
  catch (_) { return false; }
}

/** "Sí, soy yo": se recupera la selección guardada y se toma esa identidad. */
function claimThisIdentity() {
  const name = myName();
  clearWhoYouAre();
  rememberMyClaim(name);       // a partir de ahora este ticket es mío con ese nombre
  prefillMineFromName(true);
  renderItems();
  update();
  renderLivePeople();
}

/** "No, soy otra persona": se limpia todo y se pide un nombre distinto. */
function rejectThisIdentity() {
  clearWhoYouAre();
  hideIdentityBar();
  Object.keys(myUnits).forEach(k => delete myUnits[k]);
  prefilledFrom = null;
  // Este móvil deja de considerarse dueño de aquella selección: si no, al
  // recargar volvería a recuperarla.
  try { localStorage.removeItem(CLAIM_KEY()); } catch (_) {}
  const input = document.getElementById('nameInput');
  input.value = '';
  input.focus();
  renderItems();
  update();
  renderLivePeople();
  toast(t.nameTakenPickAnother);
}

/**
 * Marcar sin nombre no se bloquea: se deja marcar y se señala el campo. Cortar
 * al usuario en el primer toque sería justo lo contrario de "dos gestos".
 */
function nudgeName() {
  const input = document.getElementById('nameInput');
  const field = input.closest('.name-field') || input;
  field.classList.add('needs-name');
  input.focus({ preventScroll: true });
  field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  input.animate([
    { transform: 'translateX(0)' }, { transform: 'translateX(-4px)' },
    { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }
  ], { duration: 240 });
}

/** Guarda el borrador, agrupando pulsaciones seguidas en una sola escritura. */
function saveDraft() {
  if (!myName()) return;      // sin nombre no hay a quién atribuir la selección
  if (identityBlocked) return; // el nombre es de otro y aún no se ha aclarado

  // Este móvil pasa a ser el dueño de esa selección DESDE EL PRIMER BORRADOR,
  // no solo al confirmar.
  //
  // Antes se anotaba únicamente al confirmar, y provocaba una pregunta absurda
  // la primera vez que alguien usaba la app: escribías tu nombre, el borrador
  // creaba un claim con él en el servidor, y al ir a confirmar la app se
  // encontraba "un claim llamado Álvaro" que no constaba como tuyo y te
  // preguntaba si eras tú. Te preguntaba por tu propio borrador.
  rememberMyClaim(myName());

  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const payload = {};
    Object.keys(myUnits).forEach(id => {
      const arr = [...myUnits[id]].sort((a, b) => a - b);
      if (arr.length) payload[id] = arr;
    });

    // No reescribir lo mismo: cada guardado sube el contador de versión y hace
    // que TODOS los demás recarguen la lista. Escribir sin cambios les haría
    // gastar cuota para nada.
    const signature = myName().toLowerCase() + '|' + JSON.stringify(payload);
    if (signature === lastSaved) return;
    lastSaved = signature;

    try {
      await fetch(`/api/tickets/${ticketId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName: myName(), itemUnits: payload, confirmed: false })
      });
      setLiveState('saved');
    } catch (_) {
      setLiveState('offline');
    }
  }, SAVE_DEBOUNCE);
}

/**
 * Sondeo barato: pide solo el contador de versión (una lectura) y únicamente
 * recarga la lista completa de claims cuando algo ha cambiado de verdad.
 */
async function checkForUpdates(force) {
  if (!force && Date.now() - lastTouch < 900) return; // está tocando: no molestar
  try {
    const r = await fetch(`/api/tickets/${ticketId}/pulse`);
    if (!r.ok) return;
    const { v, status } = await r.json();
    setLiveState('saved');
    if (status === 'closed') {
      return window.location.href = `/summary.html?id=${ticketId}`;
    }

    if (v === lastVersion) {
      // Nada nuevo: relajar el ritmo poco a poco.
      if (++idleRounds >= IDLE_BEFORE_BACKOFF && pollMs < POLL_SLOW) {
        pollMs = Math.min(POLL_SLOW, Math.round(pollMs * 1.4));
        restartPolling();
      }
      return;
    }

    lastVersion = v;
    goFast();   // hay gente moviéndose: volver al ritmo rápido
    const cr = await fetch(`/api/tickets/${ticketId}/claims`);
    if (!cr.ok) return;
    claimsData = await cr.json();
    repaintOthers();
  } catch (_) { setLiveState('offline'); }
}

/** Vuelve al ritmo rápido: alguien se ha movido, o me he movido yo. */
function goFast() {
  idleRounds = 0;
  if (pollMs !== POLL_FAST) {
    pollMs = POLL_FAST;
    restartPolling();
  }
}

function restartPolling() {
  clearInterval(polling);
  polling = setInterval(() => {
    if (document.hidden) return;   // en segundo plano no se gasta cuota
    checkForUpdates(false);
  }, pollMs);
}

function startPolling() {
  if (polling) return;
  restartPolling();

  // Al volver de otra app hay que refrescar ya: mientras estabas fuera no se
  // ha sondeado, y quedarte mirando datos viejos es justo lo que rompía la
  // sensación de "en vivo".
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { goFast(); checkForUpdates(true); }
  });
}

/**
 * Repinta lo que han marcado los demás SIN tocar la selección propia ni
 * reconstruir la lista: rehacer el DOM entero perdería el scroll justo cuando
 * el usuario está eligiendo.
 */
function repaintOthers() {
  const others = otherClaimants();
  document.querySelectorAll('.claim-row-v2').forEach(row => {
    const item = ticketData.items.find(i => String(i.id) === String(row.dataset.id));
    if (item) refreshPills(row, item, others);
  });
  update();
  renderLivePeople();
}

/** Quién más está en el ticket ahora mismo y si ya ha terminado. */
function renderLivePeople() {
  const box = document.getElementById('livePeople');
  if (!box) return;
  const mine = myName().toLowerCase();
  const others = claimsData.filter(c => (c.personName || '').trim().toLowerCase() !== mine);
  if (!others.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = others.map(c => `
    <span class="live-person ${c.confirmed ? 'done' : 'picking'}">
      ${esc(c.personName)}${c.confirmed ? '' : ' ' + esc(t.picking)}
    </span>`).join('');
}

// --- Aviso de primera vez ---
// Tres líneas de texto dentro del ticket no las lee nadie, y menos en un bar.
// En su lugar, una etiqueta flotante señalando la primera píldora. Sale UNA
// vez en la vida de este navegador y desaparece al primer toque.
const TIP_KEY = 'ct_seen_claim_tip';

function maybeShowTip() {
  let seen = true;
  try { seen = !!localStorage.getItem(TIP_KEY); } catch (_) {}
  if (seen) return;

  const first = document.querySelector('.unit-pill');
  if (!first) return;

  const tip = document.createElement('div');
  tip.className = 'coach-tip';
  tip.id = 'coachTip';
  tip.innerHTML = `<span>${esc(t.tipFirstPill)}</span>`;
  document.body.appendChild(tip);

  const place = () => {
    const r = first.getBoundingClientRect();
    if (!r.width) return;
    tip.style.top = (window.scrollY + r.bottom + 10) + 'px';
    tip.style.left = (window.scrollX + r.left + r.width / 2) + 'px';
  };
  place();
  requestAnimationFrame(place);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });
  first.classList.add('coach-target');

  tip.addEventListener('click', dismissTip);
  // Red de seguridad: si nadie lo toca, se va solo.
  setTimeout(dismissTip, 12000);
}

function dismissTip() {
  const tip = document.getElementById('coachTip');
  if (!tip) return;
  try { localStorage.setItem(TIP_KEY, '1'); } catch (_) {}
  document.querySelectorAll('.coach-target').forEach(el => el.classList.remove('coach-target'));
  tip.classList.add('leaving');
  setTimeout(() => tip.remove(), 250);
}

function setLiveState(state) {
  const dot = document.getElementById('liveDot');
  if (dot) dot.className = 'live-dot ' + state;
}

async function loadTicket() {
  const [tRes, cRes] = await Promise.all([
    fetch(`/api/tickets/${ticketId}`),
    fetch(`/api/tickets/${ticketId}/claims`)
  ]);
  if (!tRes.ok) return window.location.href = '/';
  ticketData = await tRes.json();
  claimsData = cRes.ok ? await cRes.json() : [];

  // If the bill is already closed, send guest directly to the summary
  // so they can see who owes what and download the receipt image.
  if (ticketData.status === 'closed') {
    window.location.href = `/summary.html?id=${ticketId}`;
    return;
  }

  const d = new Date(ticketData.receiptDate || ticketData.createdAt);
  const storeEl = document.getElementById('ticketStore');
  if (storeEl) storeEl.textContent = (ticketData.restaurant || t.restaurant).toUpperCase();
  document.getElementById('ticketDate').textContent =
    d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
      day: '2-digit', month: 'short', year: 'numeric'
    }).toUpperCase() + ' | ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Nombre recordado: para quien repite no hay ningún paso que dar.
  //
  // Pero si ese nombre YA tiene una selección en este ticket, no se carga sin
  // preguntar. Desde el navegador es imposible distinguir estos dos casos:
  //
  //   a) vuelvo yo a ajustar lo mío   → quiero recuperar mi selección
  //   b) le paso el móvil al siguiente → necesita empezar en blanco
  //
  // Y el coste de equivocarse no es simétrico: en (a) son unos toques de más;
  // en (b) se sobrescribe la selección de otro y la app acaba diciendo que
  // alguien pidió cosas que no pidió. Así que se pregunta.
  //
  // Solo pasa al reabrir un ticket ya marcado. Abrir uno nuevo sigue sin
  // ningún paso: se rellena el nombre y a marcar.
  const input = document.getElementById('nameInput');
  const mio = myClaimOnThisTicket();
  const previo = mio && claimsData.find(
    c => (c.personName || '').trim().toLowerCase() === mio);

  // OJO: esto NO se condiciona a "si el campo está vacío". Al volver con el
  // botón atrás, el navegador restaura por su cuenta lo último que había en
  // el campo de un formulario — incluso en una recarga completa, sin bfcache
  // de por medio — así que `input.value` puede llegar ya relleno antes de que
  // este script corra. Si la decisión dependiera de encontrarlo vacío, el
  // navegador se adelantaba y toda esta lógica se saltaba entera: era la
  // causa real de que el bloqueo no se aplicara al volver atrás.
  if (previo) {
    // Este móvil ya marcó aquí con este nombre: se recupera la selección sin
    // preguntar nada. Preguntar "¿eres Álvaro?" a quien acaba de marcar como
    // Álvaro es absurdo, y era lo que hacía la versión anterior.
    input.value = previo.personName;
    prefillMineFromName(true);

    // Si ya está CONFIRMADO y se ha llegado volviendo atrás (no por un
    // enlace nuevo), el nombre se bloquea: solo se puede corregir la
    // selección, no cambiar de identidad. Ver lockName() para el porqué.
    if (previo.confirmed !== false && cameBackViaHistory()) {
      lockName(previo.personName);
    } else {
      // El riesgo de que el móvil haya cambiado de manos no se ignora: se
      // avisa con una barra que dice a nombre de quién se está marcando,
      // con salida a un toque. Informar en vez de interrogar.
      showIdentityBar(previo.personName, false);
    }
  } else if (!input.value) {
    const habitual = recalledName();
    if (habitual) {
      input.value = habitual;
      // El nombre habitual ya lo está usando alguien y no consta que sea yo:
      // aquí sí hay duda real, porque confirmar pisaría su selección.
      if (nameBelongsToSomeoneElse(habitual)) askWhoYouAre(habitual);
    }
  }

  renderItems();
  update();
  renderLivePeople();
  startPolling();
  setLiveState('saved');
  maybeShowTip();
}

function myNameNormalized() {
  return (document.getElementById('nameInput').value || '').trim().toLowerCase();
}

// Build { [itemId]: { [unitIdx]: [name, ...] } } from other claimants only.
// Excludes the current user (by name match) so their picks show as "mine".
function otherClaimants() {
  const mine = myNameNormalized();
  const map = {};
  claimsData.forEach(c => {
    const name = (c.personName || '').trim();
    if (name.toLowerCase() === mine) return; // that's me — skip
    if (c.itemUnits && typeof c.itemUnits === 'object') {
      Object.keys(c.itemUnits).forEach(id => {
        const units = c.itemUnits[id] || [];
        if (!map[id]) map[id] = {};
        units.forEach(u => {
          if (!map[id][u]) map[id][u] = [];
          map[id][u].push(name);
        });
      });
    } else if (c.itemCounts) {
      // Fallback for legacy claims w/o itemUnits — assign sequentially
      Object.keys(c.itemCounts).forEach(id => {
        const count = c.itemCounts[id];
        if (!map[id]) map[id] = {};
        for (let u = 0; u < count; u++) {
          if (!map[id][u]) map[id][u] = [];
          map[id][u].push(name);
        }
      });
    }
  });
  return map;
}

// Escribir tu nombre recupera al instante lo que ya habías marcado: es la
// forma rápida de volver y cambiar algo sin repetir toda la selección.
//
// Efecto lateral a controlar: al teclear se pasa por nombres intermedios, y si
// uno coincide con otra persona ("Mar" camino de "Marta") se cargan SUS
// unidades. Antes eso solo se veía un instante; ahora que la selección se
// guarda sola, podría escribirse un participante fantasma con las cosas de
// otro. Por eso se anota de quién se cargó, para poder deshacerlo.
let prefilledFrom = null;

function prefillMineFromName(autorizado) {
  const mine = myNameNormalized();

  // Solo se recupera una selección guardada si consta que es MÍA en este
  // ticket, o si el usuario acaba de decir "sí, soy yo". En cualquier otro
  // caso se pregunta antes: cargar en silencio lo de otro es exactamente lo
  // que hacía que la app dijera que alguien pidió cosas que no pidió.
  if (!autorizado && nameBelongsToSomeoneElse(mine)) {
    Object.keys(myUnits).forEach(k => delete myUnits[k]);
    prefilledFrom = null;
    askWhoYouAre(document.getElementById('nameInput').value.trim());
    return false;
  }
  if (identityBlocked) clearWhoYouAre();

  const prev = mine && claimsData.find(c => (c.personName || '').trim().toLowerCase() === mine);
  if (!prev) {
    // Lo que había cargado era de otra persona y el nombre ya no coincide:
    // se descarta. Si eran marcas propias (prefilledFrom vacío) no se tocan.
    if (prefilledFrom && prefilledFrom !== mine) {
      Object.keys(myUnits).forEach(k => delete myUnits[k]);
      prefilledFrom = null;
    }
    return false;
  }
  prefilledFrom = mine;
  Object.keys(myUnits).forEach(k => delete myUnits[k]);
  if (prev.itemUnits && typeof prev.itemUnits === 'object') {
    Object.keys(prev.itemUnits).forEach(id => {
      myUnits[id] = new Set(prev.itemUnits[id] || []);
    });
  } else if (prev.itemCounts) {
    Object.keys(prev.itemCounts).forEach(id => {
      const count = prev.itemCounts[id];
      myUnits[id] = new Set(Array.from({ length: count }, (_, u) => u));
    });
  }
  return true;
}

function renderItems() {
  const list = document.getElementById('itemsList');
  list.innerHTML = '';
  const others = otherClaimants();

  ticketData.items.forEach(item => {
    const qty = Math.max(1, item.quantity || 1);
    const row = document.createElement('div');
    row.className = 'claim-row-v2';
    row.dataset.id = item.id;

    const header = document.createElement('div');
    header.className = 'ci-head';
    header.innerHTML = `
      <div class="ci-name">${esc(item.name)}</div>
      <div class="ci-price">${Money.formatEUR(item.unitPrice, lang)}${esc(t.perUnit)}</div>
    `;

    const unitsWrap = document.createElement('div');
    unitsWrap.className = 'ci-units';

    for (let u = 0; u < qty; u++) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'unit-pill';
      pill.dataset.itemId = item.id;
      pill.dataset.unit = u;
      pill.innerHTML = pillInner(item, u, others);
      pill.addEventListener('click', onPillClick);
      unitsWrap.appendChild(pill);
    }

    row.appendChild(header);
    row.appendChild(unitsWrap);
    list.appendChild(row);
    refreshPills(row, item, others);
  });

  // Esta es la pantalla donde más dolía el recorte: con un ticket largo la
  // lista se cortaba a media altura y había artículos que era IMPOSIBLE
  // marcar. Remedir en cada pintado lo garantiza para cualquier longitud.
  fitTicket();

  if (highlightPending) markPendingUnits();
}

// Se llega desde el resumen pulsando "¿qué falta por marcar?".
const highlightPending = new URLSearchParams(location.search).get('pendientes') === '1';

/**
 * Señala con un latido rojo las unidades que no ha cogido nadie.
 *
 * Con un ticket largo, averiguar qué quedaba suelto obligaba a ir comparando
 * la lista a ojo. Aquí se ven de un vistazo y se puede tocar directamente.
 */
function markPendingUnits() {
  const others = otherClaimants();
  let primera = null;
  let n = 0;

  document.querySelectorAll('.unit-pill').forEach(pill => {
    const id = pill.dataset.itemId;
    const u = +pill.dataset.unit;
    const laTieneOtro = !!(others[id] && others[id][u] && others[id][u].length);
    const laTengoYo = !!(myUnits[id] && myUnits[id].has(u));
    if (laTieneOtro || laTengoYo) return;

    pill.classList.add('pending-beat');
    if (!primera) primera = pill;
    n++;
  });

  if (!n) return;
  toast(t.pendingHint.replace('{n}', n));
  if (primera) {
    // Un respiro antes de desplazar: si se hace a la vez que se pinta, el
    // navegador todavía está colocando el ticket y salta a un sitio raro.
    setTimeout(() => primera.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350);
  }
}

/** El latido se apaga en cuanto tocas esa unidad: ya no está pendiente. */
function stopBeat(pill) {
  if (pill) pill.classList.remove('pending-beat');
}

function pillInner(item, u, others) {
  // Always show unit number — cleaner and consistent
  return `<span class="up-num">${u + 1}</span><span class="up-body"></span>`;
}

function refreshPills(row, item, othersMap) {
  const others = othersMap || otherClaimants();
  const mineSet = myUnits[item.id] || new Set();
  row.querySelectorAll('.unit-pill').forEach(pill => {
    const u = +pill.dataset.unit;
    const theirNames = (others[item.id] && others[item.id][u]) ? others[item.id][u] : [];
    const isMine = mineSet.has(u);
    const hasTheirs = theirNames.length > 0;

    // Destello cuando cambia lo de OTRA persona. Los cambios propios ya se ven
    // solos al pulsar; los ajenos aparecían en silencio y no se notaban.
    // La firma solo mira los nombres ajenos, así tocar yo no dispara el aviso.
    const sig = theirNames.join('|');
    if (pill.dataset.sig !== undefined && pill.dataset.sig !== sig) {
      pill.classList.remove('just-changed');
      void pill.offsetWidth;               // reinicia la animación
      pill.classList.add('just-changed');
    }
    pill.dataset.sig = sig;

    pill.classList.remove('mine', 'theirs', 'shared');
    let bodyHTML = '';
    if (isMine && hasTheirs) {
      pill.classList.add('shared');
      // Each name on its own line so long lists don't get truncated
      const names = [t.mineBadge, ...theirNames];
      bodyHTML = names.map(n => `<span class="up-claim">${esc(n)}</span>`).join('');
    } else if (isMine) {
      pill.classList.add('mine');
      bodyHTML = `<svg class="up-check" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`;
    } else if (hasTheirs) {
      pill.classList.add('theirs');
      bodyHTML = theirNames.map(n => `<span class="up-claim">${esc(n)}</span>`).join('');
    }
    const body = pill.querySelector('.up-body');
    if (body) body.innerHTML = bodyHTML;
  });
}

function onPillClick(e) {
  const pill = e.currentTarget;
  stopBeat(pill);            // si latía por estar pendiente, deja de hacerlo
  const itemId = +pill.dataset.itemId;
  const u = +pill.dataset.unit;
  if (!myUnits[itemId]) myUnits[itemId] = new Set();
  const wasMine = myUnits[itemId].has(u);
  if (wasMine) myUnits[itemId].delete(u);
  else myUnits[itemId].add(u);
  if (myUnits[itemId].size === 0) delete myUnits[itemId];

  // Refresh this row
  const row = pill.closest('.claim-row-v2');
  const item = ticketData.items.find(i => String(i.id) === String(itemId));
  if (row && item) refreshPills(row, item);
  update();

  // Al marcar una unidad que ya tiene alguien, decir en el momento con quién
  // se comparte y cuánto paga cada uno. Antes había que deducirlo.
  if (!wasMine && item) {
    const others = otherClaimants();
    const names = (others[item.id] && others[item.id][u]) || [];
    if (names.length) {
      const each = item.unitPrice / (names.length + 1);
      toast(`${t.sharedWith} ${names.join(', ')} · ${Money.formatEUR(each, lang)} ${t.each}`);
    }
  }

  // A partir del primer toque propio, lo marcado es mío y ya no procede de
  // haber cargado la selección de otra persona al escribir el nombre.
  prefilledFrom = null;
  dismissTip();

  lastTouch = Date.now();
  goFast();      // si yo me muevo, los demás probablemente también

  // Sin nombre no se puede atribuir la selección ni compartirla en vivo. No se
  // bloquea el toque: se marca igual y se señala el campo.
  if (!myName()) nudgeName();
  else saveDraft();
}

function update() {
  // For each unit I claim, my share = unitPrice / (1 + others on that unit)
  const others = otherClaimants();
  let tot = 0;
  ticketData.items.forEach(item => {
    const mineSet = myUnits[item.id];
    if (!mineSet || mineSet.size === 0) return;
    mineSet.forEach(u => {
      const otherNames = (others[item.id] && others[item.id][u]) ? others[item.id][u] : [];
      const divider = 1 + otherNames.length;
      tot += item.unitPrice / divider;
    });
  });
  document.getElementById('yourTotal').textContent = Money.formatEUR(tot, lang);

  const name = document.getElementById('nameInput').value.trim();
  const anyPicked = Object.values(myUnits).some(s => s && s.size > 0);
  document.getElementById('confirmBtn').disabled = !name || !anyPicked || identityBlocked;
}

document.getElementById('nameTakenMine').addEventListener('click', claimThisIdentity);
document.getElementById('nameTakenOther').addEventListener('click', rejectThisIdentity);
// El botón se oculta cuando el nombre está bloqueado (showIdentityBar con
// locked:true), así que si se llega a pulsar es que no lo está.
document.getElementById('identityBarBtn').addEventListener('click', rejectThisIdentity);

// Si el usuario escribe su nombre a mano, ya ha dicho quién es: la barra sobra.
document.getElementById('nameInput').addEventListener('input', hideIdentityBar);

let nameSettle = null;
document.getElementById('nameInput').addEventListener('input', () => {
  prefillMineFromName();
  // Re-render to reflect "mine vs theirs" reclassification
  renderItems();
  update();
  renderLivePeople();
  document.querySelector('.name-field')?.classList.remove('needs-name');

  // El guardado espera a que se termine de escribir. Mandar cada estado
  // intermedio crearía un participante por cada letra ("M", "Ma", "Mar"...).
  clearTimeout(nameSettle);
  nameSettle = setTimeout(() => {
    if (!myName() || !Object.keys(myUnits).length) return;
    rememberName(myName());
    saveDraft();
  }, 1500);
});

// Red de seguridad para el caso concreto que encontró Álvaro: confirmas,
// vuelves con el botón "atrás" del navegador, y el navegador puede restaurar
// la página desde su caché de retroceso (bfcache) SIN volver a ejecutar este
// script — con lo que loadTicket() nunca vuelve a correr y el bloqueo de más
// arriba no llega a aplicarse. `pageshow` con `persisted:true` es la señal de
// que ha pasado justo eso, y se bloquea el nombre en el acto, antes de que dé
// tiempo a teclear nada en el campo.
window.addEventListener('pageshow', (e) => {
  if (e.persisted && confirmedNow && !nameLocked) {
    lockName(document.getElementById('nameInput').value.trim());
  }
});

// Guardar lo pendiente si el usuario cierra o cambia de app a media selección.
// OJO: al confirmar se navega al resumen, lo que dispara pagehide. Sin la
// guarda de `confirmedNow`, este guardado de emergencia llegaba DESPUÉS de la
// confirmación y la degradaba otra vez a borrador.
window.addEventListener('pagehide', () => {
  if (confirmedNow) return;
  // Solo se guarda si esta persona ha tocado algo. Sin esta condición, con
  // solo ABRIR el enlace y salir se reescribía la selección de quien tuviera
  // ese nombre — y encima la degradaba a borrador, así que dejaba de contar
  // como participante listo.
  if (!lastTouch || identityBlocked) return;
  if (!myName() || !Object.keys(myUnits).length) return;
  const payload = {};
  Object.keys(myUnits).forEach(id => {
    const arr = [...myUnits[id]].sort((a, b) => a - b);
    if (arr.length) payload[id] = arr;
  });
  // sendBeacon sobrevive al cierre de la pestaña; fetch normal no.
  try {
    navigator.sendBeacon(`/api/tickets/${ticketId}/claim`, new Blob([JSON.stringify({
      personName: myName(), itemUnits: payload, confirmed: false
    })], { type: 'application/json' }));
  } catch (_) {}
});

document.getElementById('confirmBtn').addEventListener('click', async () => {
  const name = document.getElementById('nameInput').value.trim();
  const itemUnitsPayload = {};
  Object.keys(myUnits).forEach(id => {
    const arr = [...myUnits[id]].sort((a, b) => a - b);
    if (arr.length > 0) itemUnitsPayload[id] = arr;
  });
  if (!name || Object.keys(itemUnitsPayload).length === 0) return;

  // Último cinturón: nunca confirmar sobre la selección de otra persona.
  if (identityBlocked || nameBelongsToSomeoneElse(name)) {
    askWhoYouAre(name);
    document.getElementById('nameTaken').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const btn = document.getElementById('confirmBtn');
  btn.disabled = true;
  confirmedNow = true;       // bloquea el guardado de emergencia de pagehide
  clearTimeout(saveTimer);   // que el borrador pendiente no pise la confirmación
  rememberMyClaim(name);     // este ticket queda asociado a mí con este nombre

  try {
    await fetch(`/api/tickets/${ticketId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName: name, itemUnits: itemUnitsPayload, confirmed: true })
    });
    clearInterval(polling);
    window.location.href = `/summary.html?id=${ticketId}`;
  } catch (err) {
    btn.disabled = false;
  }
});

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

loadTicket();
