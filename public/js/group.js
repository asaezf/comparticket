// comparTICKET — pantalla de grupo (viajes, pisos compartidos)
//
// Un grupo junta muchos tickets y gastos a lo largo de días y, al final, dice
// quién le paga a quién con el mínimo de transferencias.
//
// El cálculo bueno lo hace el servidor: aquí solo se pinta lo que devuelve
// /summary. Así nadie puede cambiar lo que debe tocando el JavaScript de su
// móvil. settle.js se carga igualmente porque comparte fichero con el
// servidor y sirve para recalcular al vuelo sin esperar a la red.

// El id llega por /g/abc123 (enlace corto que se comparte) o por ?id=abc123.
const params = new URLSearchParams(window.location.search);
const groupId = params.get('id') || (location.pathname.match(/^\/g\/([^/?#]+)/) || [])[1];
if (!groupId) window.location.href = '/';

// Quién eres TÚ dentro de este grupo. Se recuerda por grupo, no globalmente:
// el mismo móvil puede pasar de mano en mano, y en un grupo distinto eres otro.
const YO_KEY = 'ct_yo_' + groupId;

let datos = null;      // lo último que devolvió /summary
let yo = leerYo();

function leerYo() {
  try { return localStorage.getItem(YO_KEY) || ''; } catch (_) { return ''; }
}
function guardarYo(nombre) {
  try { nombre ? localStorage.setItem(YO_KEY, nombre) : localStorage.removeItem(YO_KEY); } catch (_) {}
  yo = nombre;
}

const eur = n => Money.formatEUR(n, lang);
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

// ---------------------------------------------------------------- carga

async function cargar() {
  let res;
  try {
    res = await fetch('/api/groups/' + groupId + '/summary');
  } catch (_) {
    return toast('Sin conexión. Inténtalo de nuevo.');
  }
  if (!res.ok) return window.location.href = '/';
  datos = await res.json();
  pintar();
}

function pintar() {
  const g = datos.group;

  document.getElementById('barTitle').textContent = g.name;
  document.getElementById('groupName').textContent = (g.name || '').toUpperCase();
  document.getElementById('groupDates').textContent = rangoFechas();

  document.getElementById('groupTotal').textContent = eur(datos.stats.total);
  document.getElementById('groupCount').textContent =
    datos.stats.apuntes + (datos.stats.apuntes === 1 ? ' gasto' : ' gastos');

  pintarQuienEres();
  pintarMiSaldo();
  pintarSaldos();
  pintarTransferencias();
  pintarTickets();
  pintarGastos();

  // El ticket acaba de cambiar de alto: hay que remedir para que la animación
  // de impresión no lo recorte, igual que en las demás pantallas.
  fitTicket();
}

/** Desde el primer gasto hasta el último, para dar contexto de viaje. */
function rangoFechas() {
  const fechas = []
    .concat(datos.tickets.map(t => t.receiptDate || t.createdAt))
    .concat(datos.expenses.map(e => e.createdAt))
    .filter(Boolean)
    .map(f => new Date(f))
    .filter(d => !isNaN(d));

  if (!fechas.length) {
    const d = new Date(datos.group.createdAt);
    return isNaN(d) ? '' : fmtFecha(d);
  }
  fechas.sort((a, b) => a - b);
  const ini = fmtFecha(fechas[0]), fin = fmtFecha(fechas[fechas.length - 1]);
  return ini === fin ? ini : ini + ' — ' + fin;
}

function fmtFecha(d) {
  return d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US',
    { day: '2-digit', month: 'short' }).toUpperCase();
}

// ---------------------------------------------------------------- quién eres

function pintarQuienEres() {
  const cont = document.getElementById('whoPills');
  const bloque = document.getElementById('whoBlock');
  cont.innerHTML = '';

  datos.group.members.forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'who-pill' + (m.name === yo ? ' active' : '');
    b.textContent = m.name;
    b.addEventListener('click', () => {
      // Volver a tocar tu propio nombre lo deselecciona: útil si el móvil
      // cambia de manos a mitad del viaje.
      guardarYo(m.name === yo ? '' : m.name);
      pintar();
    });
    cont.appendChild(b);
  });

  // Elegido ya quién eres, el selector estorba: se encoge a una línea.
  bloque.classList.toggle('picked', !!yo);
  document.getElementById('whoLabel').textContent = yo ? 'ERES' : '¿QUIÉN ERES?';
}

function pintarMiSaldo() {
  const caja = document.getElementById('myBalance');
  if (!yo) { caja.classList.add('hidden'); return; }
  caja.classList.remove('hidden');

  const saldo = +(datos.balances[yo] || 0);
  const cerca = Math.abs(saldo) <= Settle.TOL;

  caja.classList.toggle('is-positive', !cerca && saldo > 0);
  caja.classList.toggle('is-negative', !cerca && saldo < 0);
  caja.classList.toggle('is-zero', cerca);

  document.getElementById('myBalanceLabel').textContent =
    cerca ? 'ESTÁS EN PAZ' : (saldo > 0 ? 'TE DEBEN' : 'DEBES');
  document.getElementById('myBalanceAmount').textContent = eur(Math.abs(saldo));

  // A quién, en concreto. Un número sin destinatario no sirve de nada.
  let pista = '';
  if (cerca) {
    pista = 'No tienes nada pendiente en este grupo';
  } else if (saldo < 0) {
    const mios = datos.transfers.filter(t => t.de === yo);
    pista = mios.length
      ? 'A ' + mios.map(t => t.a + ' (' + eur(t.importe) + ')').join(', ')
      : '';
  } else {
    const mios = datos.transfers.filter(t => t.a === yo);
    pista = mios.length
      ? 'Te los deben ' + mios.map(t => t.de + ' (' + eur(t.importe) + ')').join(', ')
      : '';
  }
  document.getElementById('myBalanceHint').textContent = pista;
}

// ---------------------------------------------------------------- saldos

function pintarSaldos() {
  const cont = document.getElementById('balancesList');
  cont.innerHTML = '';

  const nombres = Object.keys(datos.balances)
    .sort((a, b) => datos.balances[b] - datos.balances[a]);

  if (!nombres.length) {
    cont.innerHTML = '<div class="empty-line">Todavía no hay gastos</div>';
    return;
  }

  nombres.forEach(nombre => {
    const saldo = +datos.balances[nombre];
    const cerca = Math.abs(saldo) <= Settle.TOL;
    const fila = document.createElement('div');
    fila.className = 'bal-row' + (nombre === yo ? ' is-me' : '') +
      (cerca ? ' is-zero' : (saldo > 0 ? ' is-positive' : ' is-negative'));
    fila.innerHTML =
      '<span class="bal-name">' + esc(nombre) +
        (nombre === yo ? '<span class="bal-tag">tú</span>' : '') + '</span>' +
      '<span class="bal-amount">' +
        (cerca ? eur(0) : (saldo > 0 ? '+' : '−') + eur(Math.abs(saldo))) +
      '</span>';
    cont.appendChild(fila);
  });
}

// ---------------------------------------------------------------- el cuadre

function pintarTransferencias() {
  const cont = document.getElementById('transfersList');
  const nota = document.getElementById('settleNote');
  cont.innerHTML = '';

  // Los tickets sin cerrar no entran en el cuadre: a quien pagó se le
  // acreditaría el total mientras solo está repartido lo marcado, y el dinero
  // se crearía de la nada. Se dice cuánto queda fuera y por qué.
  nota.textContent = datos.ticketsAbiertos
    ? eur(datos.pendienteDeCerrar || 0) + ' sin contar · ' +
      datos.ticketsAbiertos + (datos.ticketsAbiertos === 1 ? ' ticket sin cerrar' : ' tickets sin cerrar')
    : '';
  nota.className = 'sec-note' + (datos.ticketsAbiertos ? ' warn' : '');

  if (!datos.transfers.length) {
    cont.innerHTML = datos.stats.apuntes
      ? '<div class="all-settled">✓ Todo cuadrado, nadie debe nada</div>'
      : '<div class="empty-line">Añade gastos y aquí saldrá el reparto</div>';
  }

  datos.transfers.forEach(t => {
    const fila = document.createElement('div');
    fila.className = 'tr-row' + (t.de === yo || t.a === yo ? ' is-mine' : '');
    fila.innerHTML =
      '<div class="tr-main">' +
        '<span class="tr-from">' + esc(t.de) + '</span>' +
        '<span class="tr-arrow">→</span>' +
        '<span class="tr-to">' + esc(t.a) + '</span>' +
        '<span class="tr-amount">' + eur(t.importe) + '</span>' +
      '</div>' +
      '<div class="tr-actions">' +
        '<button class="tr-btn tr-remind" type="button">Recordar</button>' +
        '<button class="tr-btn tr-paid" type="button">Ya pagado</button>' +
      '</div>';

    fila.querySelector('.tr-remind').addEventListener('click', () => recordar(t));
    fila.querySelector('.tr-paid').addEventListener('click', () => marcarPagado(t));
    cont.appendChild(fila);
  });

  // Pagos ya anotados, por si alguien se equivocó y hay que deshacerlo.
  datos.payments.forEach(p => {
    const fila = document.createElement('div');
    fila.className = 'tr-row is-done';
    fila.innerHTML =
      '<div class="tr-main">' +
        '<span class="tr-check">✓</span>' +
        '<span class="tr-from">' + esc(p.from) + '</span>' +
        '<span class="tr-arrow">→</span>' +
        '<span class="tr-to">' + esc(p.to) + '</span>' +
        '<span class="tr-amount">' + eur(p.amount) + '</span>' +
      '</div>' +
      '<div class="tr-actions">' +
        '<button class="tr-btn tr-undo" type="button">Deshacer</button>' +
      '</div>';
    fila.querySelector('.tr-undo').addEventListener('click', () => deshacerPago(p));
    cont.appendChild(fila);
  });
}

/** Mensaje ya escrito para WhatsApp. La app no cobra: solo recuerda. */
function recordar(t) {
  const texto = t.de + ', te toca pasarle ' + eur(t.importe) + ' a ' + t.a +
    ' de «' + datos.group.name + '» 💸\n' + location.origin + '/g/' + groupId;
  const url = 'https://wa.me/?text=' + encodeURIComponent(texto);
  window.open(url, '_blank', 'noopener');
}

async function marcarPagado(t) {
  if (!confirm(t.de + ' → ' + t.a + ': ' + eur(t.importe) + '\n\n¿Confirmas que este pago ya se ha hecho?')) return;
  try {
    const r = await fetch('/api/groups/' + groupId + '/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: t.de, to: t.a, amount: t.importe })
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se ha podido anotar');
    toast('Pago anotado');
    await cargar();
  } catch (e) {
    toast(e instanceof TypeError ? 'Sin conexión' : e.message);
  }
}

async function deshacerPago(p) {
  if (!confirm('¿Deshacer este pago anotado?')) return;
  try {
    await fetch('/api/groups/' + groupId + '/payments/' + p.id, { method: 'DELETE' });
    toast('Pago deshecho');
    await cargar();
  } catch (_) { toast('Sin conexión'); }
}

// ---------------------------------------------------------------- tickets

function pintarTickets() {
  const cont = document.getElementById('ticketsList');
  const nota = document.getElementById('ticketsNote');
  cont.innerHTML = '';
  nota.textContent = datos.tickets.length ? String(datos.tickets.length) : '';

  if (!datos.tickets.length) {
    cont.innerHTML = '<div class="empty-line">Ningún ticket escaneado todavía</div>';
    return;
  }

  datos.tickets.forEach(t => {
    const abierto = t.status !== 'closed';
    const fila = document.createElement('a');
    fila.className = 'item-row' + (abierto ? ' is-open' : '');
    fila.href = '/summary.html?id=' + encodeURIComponent(t.id);
    fila.innerHTML =
      '<div class="item-main">' +
        '<span class="item-name">' + esc(t.restaurant || 'Ticket') + '</span>' +
        '<span class="item-amount">' + eur(t.total) + '</span>' +
      '</div>' +
      '<div class="item-sub">' +
        esc(t.payerName || 'sin pagador') + ' · ' + t.lineas + ' líneas' +
        (abierto ? '<span class="item-tag warn">sin cerrar</span>' : '') +
      '</div>';
    cont.appendChild(fila);
  });
}

// ---------------------------------------------------------------- gastos sueltos

function pintarGastos() {
  const cont = document.getElementById('expensesList');
  cont.innerHTML = '';

  if (!datos.expenses.length) {
    cont.innerHTML = '<div class="empty-line">El taxi, las entradas, la gasolina…</div>';
    return;
  }

  datos.expenses.forEach(e => {
    const fila = document.createElement('div');
    fila.className = 'item-row';
    const entre = (e.splitBetween || []).length === datos.group.members.length
      ? 'entre todos'
      : 'entre ' + (e.splitBetween || []).length;
    fila.innerHTML =
      '<div class="item-main">' +
        '<span class="item-name">' + esc(e.description) + '</span>' +
        '<span class="item-amount">' + eur(e.amount) + '</span>' +
      '</div>' +
      '<div class="item-sub">' +
        'pagó ' + esc(e.paidBy) + ' · ' + entre +
        '<button class="item-del" type="button" title="Borrar">&times;</button>' +
      '</div>';
    fila.querySelector('.item-del').addEventListener('click', () => borrarGasto(e));
    cont.appendChild(fila);
  });
}

async function borrarGasto(e) {
  if (!confirm('¿Borrar «' + e.description + '» (' + eur(e.amount) + ')?')) return;
  try {
    await fetch('/api/groups/' + groupId + '/expenses/' + e.id, { method: 'DELETE' });
    toast('Gasto borrado');
    await cargar();
  } catch (_) { toast('Sin conexión'); }
}

// --- Formulario de gasto suelto -------------------------------------------

let pagadorSel = '';
let repartoSel = [];

function abrirFormulario() {
  const f = document.getElementById('expenseForm');
  f.classList.remove('hidden');
  document.getElementById('addExpenseBtn').classList.add('hidden');

  // Por defecto: lo pagas tú (si has dicho quién eres) y se reparte entre todos,
  // que es el caso de nueve de cada diez gastos de viaje.
  pagadorSel = yo || '';
  repartoSel = datos.group.members.map(m => m.name);
  pintarPildorasFormulario();
  document.getElementById('expDesc').focus();
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cerrarFormulario() {
  document.getElementById('expenseForm').classList.add('hidden');
  document.getElementById('addExpenseBtn').classList.remove('hidden');
  document.getElementById('expDesc').value = '';
  document.getElementById('expAmount').value = '';
}

function pintarPildorasFormulario() {
  const cp = document.getElementById('expPaidBy');
  const cs = document.getElementById('expSplit');
  cp.innerHTML = '';
  cs.innerHTML = '';

  datos.group.members.forEach(m => {
    const p = document.createElement('button');
    p.type = 'button';
    p.className = 'who-pill small' + (m.name === pagadorSel ? ' active' : '');
    p.textContent = m.name;
    p.addEventListener('click', () => { pagadorSel = m.name; pintarPildorasFormulario(); });
    cp.appendChild(p);

    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'who-pill small' + (repartoSel.includes(m.name) ? ' active' : '');
    s.textContent = m.name;
    s.addEventListener('click', () => {
      repartoSel = repartoSel.includes(m.name)
        ? repartoSel.filter(n => n !== m.name)
        : repartoSel.concat([m.name]);
      pintarPildorasFormulario();
    });
    cs.appendChild(s);
  });
}

async function guardarGasto() {
  const description = document.getElementById('expDesc').value.trim();
  const amount = parseFloat(document.getElementById('expAmount').value);

  if (!description) return toast('¿Qué era el gasto?');
  if (!Number.isFinite(amount) || amount <= 0) return toast('Pon un importe');
  if (!pagadorSel) return toast('¿Quién lo pagó?');
  if (!repartoSel.length) return toast('¿Entre quiénes se reparte?');

  const btn = document.getElementById('expSave');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    const r = await fetch('/api/groups/' + groupId + '/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, amount, paidBy: pagadorSel, splitBetween: repartoSel })
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se ha podido guardar');
    cerrarFormulario();
    toast('Gasto añadido');
    await cargar();
  } catch (e) {
    toast(e instanceof TypeError ? 'Sin conexión' : e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar gasto';
  }
}

// ---------------------------------------------------------------- compartir

function compartirGrupo() {
  const url = location.origin + '/g/' + groupId;
  const texto = '«' + datos.group.name + '» en comparTICKET — apunta aquí los gastos del grupo';
  if (navigator.share) {
    navigator.share({ title: datos.group.name, text: texto, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => toast('¡Enlace copiado!'));
  }
}

// ---------------------------------------------------------------- arranque

document.getElementById('addExpenseBtn').addEventListener('click', abrirFormulario);
document.getElementById('expCancel').addEventListener('click', cerrarFormulario);
document.getElementById('expSave').addEventListener('click', guardarGasto);
document.getElementById('shareGroupBtn').addEventListener('click', compartirGrupo);
document.getElementById('shareTopBtn').addEventListener('click', compartirGrupo);

// Escanear un ticket que caerá dentro de este grupo. El id viaja para que la
// portada sepa a qué grupo asignarlo al terminar.
document.getElementById('addTicketBtn').addEventListener('click', () => {
  window.location.href = '/?grupo=' + encodeURIComponent(groupId);
});

cargar();
