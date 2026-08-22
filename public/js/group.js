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

// Testigo de ESTE móvil para ESTE grupo.
//
// Sin cuentas de usuario, lo único que identifica a alguien es su dispositivo.
// Al coger un nombre se reserva con este testigo, y a partir de ahí ese nombre
// es suyo: nadie más puede cogerlo ni cambiarlo. Sin esto, cualquiera con el
// enlace podía hacerse pasar por otro y quedarse con sus gastos.
const TOK_KEY = 'ct_tok_' + groupId;

function miTestigo() {
  try {
    let t = localStorage.getItem(TOK_KEY);
    if (!t) {
      t = (crypto.randomUUID && crypto.randomUUID()) ||
          (Date.now().toString(36) + Math.random().toString(36).slice(2, 14));
      localStorage.setItem(TOK_KEY, t);
    }
    return t;
  } catch (_) {
    // Sin almacenamiento no hay identidad estable; se sigue en modo lectura.
    return '';
  }
}

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
    res = await fetch('/api/groups/' + groupId + '/summary?tok=' + encodeURIComponent(miTestigo()));
  } catch (_) {
    return toast('Sin conexión. Inténtalo de nuevo.');
  }
  if (!res.ok) return window.location.href = '/';
  datos = await res.json();
  recordarGrupo();
  pintar();
}

/**
 * Deja constancia en ESTE movil de que has entrado a este grupo.
 *
 * Sin cuentas de usuario, un grupo desaparecia al cerrar la pestana: tenias el
 * enlace o no lo tenias. Con esto, la portada puede ensenarte tus grupos al
 * volver. El enlace sigue siendo la llave —esto no da acceso a nada— pero deja
 * de hacer falta buscarlo en WhatsApp cada vez.
 */
function recordarGrupo() {
  try {
    const lista = JSON.parse(localStorage.getItem('ct_grupos') || '[]');
    const resto = lista.filter(g => g && g.id !== groupId);
    resto.unshift({
      id: groupId,
      name: datos.group.name,
      // Con quien es y de cuando es: lo que sirve para reconocerlo en la
      // portada. El total se guardaba y no se usa: alli un numero suelto no
      // dice si es lo gastado, lo que debes o lo que te deben.
      gente: (datos.group.members || []).length,
      creado: datos.group.createdAt || null,
      at: new Date().toISOString()
    });
    // Un tope para que no crezca sin fin en un movil que se usa mucho.
    localStorage.setItem('ct_grupos', JSON.stringify(resto.slice(0, 20)));
  } catch (_) {}
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
  pintarStats();

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
    // Cogido por OTRO móvil: se ve, pero no se puede tocar. Es lo que impide
    // que alguien se haga pasar por otro y se quede con sus gastos.
    const deOtro = m.taken && !m.mine;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'who-pill' + (m.name === yo ? ' active' : '') + (deOtro ? ' taken' : '');
    b.disabled = deOtro;
    b.textContent = m.name;
    if (deOtro) b.title = 'Ya lo está usando otra persona';

    b.addEventListener('click', () => elegirse(m));
    cont.appendChild(b);
  });

  // Elegido ya quién eres, el selector estorba: se encoge a una línea.
  bloque.classList.toggle('picked', !!yo);
  document.getElementById('whoLabel').textContent = yo ? 'ERES' : '¿QUIÉN ERES?';

  // Grupo completo: todos los nombres cogidos. Se dice, para que quien llegue
  // tarde entienda por qué no puede entrar en vez de pensar que va roto.
  if (!yo && datos.completo) {
    document.getElementById('whoLabel').textContent = 'GRUPO COMPLETO';
  }
}

/** Coge (o suelta) una identidad del grupo para este móvil. */
async function elegirse(m) {
  const testigo = miTestigo();
  if (!testigo) return toast('Tu navegador no permite guardar la sesión');

  // Volver a tocar tu propio nombre lo suelta: útil si el móvil cambia de
  // manos a mitad del viaje.
  if (m.name === yo) {
    if (!confirm('¿Dejar de ser ' + m.name + ' en este grupo?')) return;
    try {
      await fetch('/api/groups/' + groupId + '/release-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: m.id, token: testigo })
      });
    } catch (_) {}
    guardarYo('');
    return cargar();
  }

  try {
    const r = await fetch('/api/groups/' + groupId + '/claim-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: m.id, token: testigo })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return toast(err.error || 'No se ha podido elegir ese nombre');
    }
    guardarYo(m.name);
    await cargar();
  } catch (_) {
    toast('Sin conexión. Inténtalo de nuevo.');
  }
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
  // El aviso ya no va apretado a la derecha del titulo: tiene su propia
  // franja debajo, con la cifra en grande y el motivo debajo en una linea
  // entera. Cuando no hay nada fuera del cuadre, desaparece.
  const n = datos.ticketsAbiertos || 0;
  nota.classList.toggle('hidden', !n);
  if (n) {
    document.getElementById('settleNoteAmount').textContent =
      eur(datos.pendienteDeCerrar || 0);
    document.getElementById('settleNoteWhy').textContent = n === 1
      ? 'todav\u00eda fuera del reparto — queda 1 ticket sin cerrar'
      : 'todav\u00eda fuera del reparto — quedan ' + n + ' tickets sin cerrar';
  }

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
        etiquetaDias() +
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

/**
 * Cuanto lleva la deuda parada, en formato de etiqueta.
 *
 * Se cuenta desde el ultimo movimiento del grupo: el ultimo gasto apuntado,
 * el ultimo ticket cerrado o el ultimo pago hecho. Mientras siguen entrando
 * gastos la deuda todavia esta cambiando y no tiene sentido reclamar nada;
 * en cuanto el grupo se queda quieto, los dias empiezan a contar.
 *
 * La escala, de menos a mas:
 *
 *     0 dias   nada          algo se ha movido hoy
 *     1-6      gris          normal, nadie se alarma
 *     7-13     naranja       ya lleva una semana
 *     14-29    rojo suave    dos semanas
 *     30+      rojo macizo   un mes
 *
 * El color sube, pero sin insultar a nadie: es una cuenta entre amigos, no
 * una agencia de cobros. Y antes empezaba a los dos dias, con lo que en la
 * practica casi nunca se llegaba a ver.
 */
function etiquetaDias() {
  const d = +datos.diasQuieto || 0;
  if (d < 1) return '';
  const nivel = d >= 30 ? 'd3' : d >= 14 ? 'd2' : d >= 7 ? 'd1' : 'd0';
  return '<span class="tr-days ' + nivel + '">' + d +
    (d === 1 ? ' día' : ' días') + '</span>';
}

/**
 * Resumen del viaje: lo que la gente quiere contar despues.
 *
 * Todas las filas se calculan con lo que ya hay —tickets, gastos y pagos— y
 * ninguna se ensena si no tiene con que: un grupo de un solo apunte no tiene
 * "quien paga mas veces", y sacar una fila vacia solo hace ruido.
 */
function pintarStats() {
  const cont = document.getElementById('statsBlock');
  if (!cont) return;
  cont.innerHTML = '';

  pintarFold('foldStats', 'stats', datos.stats.apuntes || 0, datos.stats.total || 0, 'apunte');

  if (!datos.stats.apuntes) {
    cont.innerHTML = desplegado.stats
      ? '<div class="empty-line">Cuando haya gastos, aqu\u00ed saldr\u00e1 el resumen</div>'
      : '';
    return;
  }
  if (!desplegado.stats) return;

  const gente = datos.group.members.length;
  const cerrados = datos.tickets.filter(t => t.status === 'closed');

  // --- Todo lo que se ha pagado, venga de un ticket o de un gasto suelto ---
  const apuntes = []
    .concat(cerrados.map(t => ({
      nombre: t.restaurant || 'Ticket', importe: +t.total || 0,
      quien: t.payerName, cuando: t.receiptDate || t.closedAt || t.createdAt
    })))
    .concat(datos.expenses.map(e => ({
      nombre: e.description, importe: +e.amount || 0,
      quien: e.paidBy, cuando: e.createdAt
    })));

  // Cuanto ha puesto cada uno y cuantas veces ha sacado la cartera.
  const dinero = {}, veces = {};
  datos.group.members.forEach(m => { dinero[m.name] = 0; veces[m.name] = 0; });
  apuntes.forEach(a => {
    if (!(a.quien in dinero)) { dinero[a.quien] = 0; veces[a.quien] = 0; }
    dinero[a.quien] += a.importe;
    veces[a.quien] += 1;
  });

  const masPor = obj => Object.keys(obj).sort((a, b) => obj[b] - obj[a])[0];
  const menosPor = obj => Object.keys(obj).sort((a, b) => obj[a] - obj[b])[0];

  // El gasto mas caro, mirando tickets y sueltos por igual.
  const caro = apuntes.slice().sort((a, b) => b.importe - a.importe)[0];

  // El dia en que mas se dejo el grupo.
  const porDia = {};
  apuntes.forEach(a => {
    const d = new Date(a.cuando);
    if (isNaN(d)) return;
    const k = d.toISOString().slice(0, 10);
    porDia[k] = (porDia[k] || 0) + a.importe;
  });
  const diaCaro = masPor(porDia);

  // Quien ya ha saldado deudas: cuantas veces ha pagado a alguien.
  const salda = {};
  datos.payments.forEach(p => { salda[p.from] = (salda[p.from] || 0) + 1; });
  const cumplidor = masPor(salda);

  // Quien debe mas ahora mismo.
  const debe = {};
  datos.transfers.forEach(t => { debe[t.de] = (debe[t.de] || 0) + t.importe; });
  const elQueMasDebe = masPor(debe);

  const filas = [];
  const fila = (k, v) => { if (v) filas.push([k, v]); };

  fila('Gasto total', eur(datos.stats.total));
  if (apuntes.length > 1) {
    fila('Media por apunte', eur(datos.stats.total / apuntes.length));
  }
  if (caro) fila('El gasto m\u00e1s caro', esc(caro.nombre) + ' \u00b7 ' + eur(caro.importe));
  if (diaCaro && Object.keys(porDia).length > 1) {
    const d = new Date(diaCaro + 'T12:00:00');
    fila('El d\u00eda m\u00e1s caro',
      d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) +
      ' \u00b7 ' + eur(porDia[diaCaro]));
  }

  const banco = masPor(dinero);
  if (banco && dinero[banco] > 0) {
    fila('El banco del grupo', esc(banco) + ' \u00b7 ' + eur(dinero[banco]) + ' adelantados');
  }
  const tacano = menosPor(dinero);
  if (tacano && gente > 1 && tacano !== banco) {
    fila('Quien menos ha puesto', esc(tacano) + ' \u00b7 ' + eur(dinero[tacano]));
  }

  const masVeces = masPor(veces);
  if (masVeces && veces[masVeces] > 1) {
    fila('Quien m\u00e1s veces paga',
      esc(masVeces) + ' \u00b7 ' + veces[masVeces] + ' veces');
  }
  if (cumplidor) {
    fila('El m\u00e1s cumplidor',
      esc(cumplidor) + ' \u00b7 ' + salda[cumplidor] +
      (salda[cumplidor] === 1 ? ' deuda saldada' : ' deudas saldadas'));
  }
  if (elQueMasDebe) {
    fila('Quien m\u00e1s debe ahora',
      esc(elQueMasDebe) + ' \u00b7 ' + eur(debe[elQueMasDebe]));
  }

  fila('En el reparto', datos.stats.apuntes + ' (' + cerrados.length +
    ' cerrados, ' + datos.expenses.length + ' sueltos)');
  fila('Sin cerrar todav\u00eda', datos.ticketsAbiertos
    ? datos.ticketsAbiertos + ' \u00b7 ' + eur(datos.pendienteDeCerrar || 0) + ' fuera'
    : 'ninguno');
  fila('Pagos ya hechos',
    datos.payments.length + ' de ' + (datos.payments.length + datos.transfers.length));

  filas.forEach(([k, v]) => {
    const r = document.createElement('div');
    r.className = 'stat-row';
    r.innerHTML = '<span class="stat-k">' + k + '</span><span class="stat-v">' + v + '</span>';
    cont.appendChild(r);
  });
}

// --- El easter egg: plantilla de los recordatorios ------------------------

const PLANTILLA_POR_DEFECTO =
  '{nombre}, te toca pasarle {importe} a {a} de «{grupo}» 💸';

/** Rellena la plantilla con los datos de una transferencia concreta. */
function aplicarPlantilla(plantilla, t) {
  return String(plantilla || PLANTILLA_POR_DEFECTO)
    .split('{nombre}').join(t.de)
    .split('{importe}').join(eur(t.importe))
    .split('{a}').join(t.a)
    .split('{grupo}').join(datos.group.name);
}

let toquesEgg = 0, tiempoEgg = 0;

function tocarTituloReparto() {
  const ahora = Date.now();
  // Los toques tienen que ser seguidos: si no, cualquiera lo abriria sin
  // querer al desplazarse por la pantalla.
  toquesEgg = (ahora - tiempoEgg < 900) ? toquesEgg + 1 : 1;
  tiempoEgg = ahora;
  if (toquesEgg < 3) return;
  toquesEgg = 0;

  const titulo = document.getElementById('repartoTitulo');
  titulo.classList.remove('egg-hit');
  void titulo.offsetWidth;          // reinicia la animacion
  titulo.classList.add('egg-hit');

  const panel = document.getElementById('tplPanel');
  const abierto = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden', abierto);
  if (!abierto) {
    document.getElementById('tplText').value = datos.plantilla || PLANTILLA_POR_DEFECTO;
    refrescarPreview();
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  fitTicket();
}

function refrescarPreview() {
  const txt = document.getElementById('tplText').value;
  const ejemplo = datos.transfers[0] ||
    { de: datos.group.members[0].name, a: datos.group.members[1].name, importe: 12.5 };
  document.getElementById('tplPreview').textContent = aplicarPlantilla(txt, ejemplo);
}

async function guardarPlantilla() {
  const txt = document.getElementById('tplText').value.trim();
  const btn = document.getElementById('tplSave');
  btn.disabled = true;
  try {
    const r = await fetch('/api/groups/' + groupId + '/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: txt || null })
    });
    if (!r.ok) throw new Error('No se ha podido guardar');
    document.getElementById('tplPanel').classList.add('hidden');
    toast('Mensaje personalizado guardado');
    await cargar();
  } catch (e) {
    toast(e instanceof TypeError ? 'Sin conexión' : e.message);
  } finally {
    btn.disabled = false;
  }
}

/** Mensaje ya escrito para WhatsApp. La app no cobra: solo recuerda. */
function recordar(t) {
  // Si el grupo tiene mensaje propio se usa ese. El enlace va en su linea,
  // debajo, para que el dedo apunte a el.
  const cuerpo = aplicarPlantilla(datos.plantilla, t);
  const texto = cuerpo + '\n\uD83D\uDC47\n' + location.origin + '/g/' + groupId;
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

// Que listas estan desplegadas. Abiertas de entrada: lo normal es querer ver
// lo que hay. Se pueden compactar porque en un piso compartido, a los dos
// meses, la lista se hace interminable.
const desplegado = { gastos: true, cerrados: true, abiertos: true, stats: true };

/**
 * Boton de mostrar mas / mostrar menos.
 * Aparece siempre que haya algo que esconder, aunque sea un solo elemento:
 * el usuario espera poder plegar la lista, no que el boton aparezca solo a
 * partir de cierto numero.
 */
function pintarFold(btnId, clave, total, importe, unidad) {
  unidad = unidad || 'apunte';
  const b = document.getElementById(btnId);
  if (!b) return;

  // La cabecera entera es el interruptor. No lleva flecha ni "mostrar mas":
  // una fila con un total delante es algo que se toca, y basta con que se
  // hunda al pulsarla para que se note que responde.
  b.classList.toggle('abierta', !!desplegado[clave]);
  b.onclick = () => { desplegado[clave] = !desplegado[clave]; pintar(); };

  // Cerrada o abierta, la cabecera dice siempre lo mismo: cuanto suma y
  // cuantos son. Son las dos preguntas que se hacen de un vistazo, y "79,00
  // EUR" a secas no distingue un ticket de doce.
  const suma = b.querySelector('.sh-sum');
  const cuenta = b.querySelector('.sh-count');
  const n = +total || 0;

  if (suma) suma.textContent = (importe === undefined || importe === null) ? '' : eur(importe);
  // Cada seccion cuenta lo suyo: gastos, tickets o apuntes. "1 apunte" en la
  // lista de tickets obliga a traducir mentalmente algo que ya se sabia.
  if (cuenta) cuenta.textContent = n ? (n + ' ' + (n === 1 ? unidad : unidad + 's')) : 'vac\u00edo';
  b.classList.toggle('sin-nada', !n);

  // La lista se ensena como cuerpo de la seccion, no como filas sueltas
  // detras de ella.
  const cuerpo = b.nextElementSibling;
  if (cuerpo && cuerpo.classList.contains('sec-body')) {
    cuerpo.classList.toggle('abierto', !!desplegado[clave]);
  }
}

/**
 * En que punto esta un ticket sin cerrar.
 *
 * Saber que YA ha votado todo el mundo es lo que dice "ve y cierralo". Y si
 * han votado todos pero no cuadra, hay que decirlo igual de claro: es el
 * momento en que alguien tiene que revisar, no cuando ya se ha cerrado mal.
 */
function estadoTicket(t) {
  const marcado = Object.values(t.reparto || {}).reduce((a, b) => a + (+b || 0), 0);
  const falta = Math.round(((+t.total || 0) - marcado) * 100) / 100;
  const cuadra = Math.abs(falta) <= Settle.TOL;
  const votantes = Object.keys(t.reparto || {}).length;
  const esperados = t.expectedParticipants || 0;
  const todos = esperados > 0 && votantes >= esperados;

  const chip = (tono, txt) => '<span class="item-state ' + tono + '">' + esc(txt) + '</span>';

  // Cuantos han marcado va SIEMPRE, y se pone en verde cuando ya estan todos.
  let chips = !votantes
    ? chip('warn', 'sin marcar')
    : chip(todos ? 'ok' : 'warn',
        esperados ? votantes + ' de ' + esperados + ' han marcado'
                  : votantes + ' marcando');

  // Y si han marcado todos pero las cuentas no salen, se dice aparte: es un
  // problema distinto de "falta gente", y hay que revisarlo ANTES de cerrar,
  // no descubrirlo despues.
  if (todos && !cuadra) {
    chips += chip('bad', falta > 0
      ? 'no cuadra \u00b7 faltan ' + eur(falta)
      : 'no cuadra \u00b7 sobran ' + eur(Math.abs(falta)));
  }

  return { clase: todos && cuadra ? 'listo' : (todos ? 'descuadra' : ''), chips };
}

/** Una fila de ticket, clicable para entrar a su reparto. */
function filaTicket(t) {
  const abierto = t.status !== 'closed';
  const fila = document.createElement('a');
  const est = abierto ? estadoTicket(t) : null;
  fila.className = 'item-row' + (abierto ? ' is-open' : '') + (est && est.clase ? ' ' + est.clase : '');
  fila.href = '/summary.html?id=' + encodeURIComponent(t.id);
  const d = new Date(t.receiptDate || t.createdAt);
  const fecha = isNaN(d) ? '' : fmtFecha(d);
  fila.innerHTML =
    '<div class="item-main">' +
      '<span class="item-name">' + esc(t.restaurant || 'Ticket') + '</span>' +
      '<span class="item-amount">' + eur(t.total) + '</span>' +
    '</div>' +
    '<div class="item-sub">' +
      '<span class="is-who">Pagador: ' + esc(t.payerName || '\u2014') + '</span>' +
      '<span class="is-meta">' + fecha + '</span>' +
    '</div>' +
    (est ? '<div class="item-tags">' + est.chips + '</div>' : '');
  return fila;
}

function pintarTickets() {
  const cerrados = datos.tickets.filter(t => t.status === 'closed');
  const abiertos = datos.tickets.filter(t => t.status !== 'closed');

  // --- Historial de los que siguen a medias ---
  const contA = document.getElementById('openList');
  contA.innerHTML = '';
  if (!abiertos.length) {
    contA.innerHTML = '<div class="empty-line">Ninguno a medias — todo cerrado</div>';
  } else if (desplegado.abiertos) {
    abiertos.forEach(t => contA.appendChild(filaTicket(t)));
  }
  pintarFold('foldOpen', 'abiertos', abiertos.length,
    abiertos.reduce((a, t) => a + (+t.total || 0), 0), 'ticket');


  // --- Historial de los cerrados ---
  const cont = document.getElementById('closedList');
  cont.innerHTML = '';
  if (!cerrados.length) {
    cont.innerHTML = '<div class="empty-line">Aún no hay ningún ticket cerrado</div>';
  } else if (desplegado.cerrados) {
    cerrados.forEach(t => cont.appendChild(filaTicket(t)));
  }
  pintarFold('foldClosed', 'cerrados', cerrados.length,
    cerrados.reduce((a, t) => a + (+t.total || 0), 0), 'ticket');
}

// ---------------------------------------------------------------- gastos sueltos

function pintarGastos() {
  const cont = document.getElementById('expensesList');
  cont.innerHTML = '';

  if (!datos.expenses.length) {
    cont.innerHTML = '<div class="empty-line">El taxi, las entradas, la gasolina…</div>';
    pintarFold('foldExpenses', 'gastos', 0, 0, 'gasto');
    return;
  }

  const todos = datos.group.members.length;

  if (desplegado.gastos) {
    datos.expenses.forEach(e => {
      const entre = (e.splitBetween || []);
      // Con quien se comparte, POR NOMBRE. "entre 3" obliga a ir a mirar
      // quienes son; los nombres se leen de un vistazo.
      const conQuien = entre.length >= todos
        ? 'entre todos'
        : 'entre ' + entre.map(esc).join(', ');

      const fila = document.createElement('div');
      fila.className = 'item-row';
      fila.innerHTML =
        '<div class="item-main">' +
          '<span class="item-name">' + esc(e.description) + '</span>' +
          '<span class="item-amount">' + eur(e.amount) + '</span>' +
        '</div>' +
        '<div class="item-sub">' +
          '<span class="is-who">pag\u00f3 ' + esc(e.paidBy) + '</span>' +
          '<span class="is-meta">' + conQuien + '</span>' +
          '<button class="item-del" type="button" title="Borrar">&times;</button>' +
        '</div>';
      fila.querySelector('.item-del').addEventListener('click', () => borrarGasto(e));
      cont.appendChild(fila);
    });
  }

  pintarFold('foldExpenses', 'gastos', datos.expenses.length,
    datos.expenses.reduce((a, e) => a + (+e.amount || 0), 0), 'gasto');
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

/**
 * Mensaje para pegar en el grupo de WhatsApp.
 *
 * Un enlace pelado no invita a nadie a tocarlo. Este dice de que va, cuanto
 * lleva el grupo y que hay que hacer, y cambia segun el momento: no es lo
 * mismo estrenar el grupo que recordar que quedan pagos por hacer.
 */
function textoParaCompartir() {
  const nombre = datos.group.name;
  const gente = datos.group.members.length;
  const total = datos.stats.total;

  // El emoji de grupo y la palabra "Grupo" van delante para que, de un
  // vistazo en el chat, se sepa que el enlace es un grupo y no una cuenta
  // suelta. Es lo unico que se lee antes de decidir si tocarlo.
  const cabecera = '\uD83D\uDC65 *Grupo: ' + nombre + '*';

  if (!datos.stats.apuntes) {
    return cabecera + '\n' +
      'Únete y apunta lo que vayas pagando — lo repartimos al final entre los ' + gente + '.\n' +
      '\uD83D\uDC47';
  }
  if (datos.settled) {
    return cabecera + '\n' +
      'Todo saldado \u2705  ' + eur(total) + ' en ' + datos.stats.apuntes + ' gastos. Nadie debe nada.\n' +
      '\uD83D\uDC47';
  }
  if (datos.transfers.length) {
    const pagos = datos.transfers.length;
    return cabecera + '\n' +
      'Llevamos ' + eur(total) + ' en ' + datos.stats.apuntes + ' gastos.\n' +
      'Quedan ' + pagos + (pagos === 1 ? ' pago' : ' pagos') + ' por hacer — mira cuánto te toca.\n' +
      '\uD83D\uDC47';
  }
  return cabecera + '\n' +
    eur(total) + ' en ' + datos.stats.apuntes + ' gastos entre los ' + gente + '.\n' +
    '\uD83D\uDC47';
}

function compartirGrupo() {
  const url = location.origin + '/g/' + groupId;
  const texto = textoParaCompartir();
  if (navigator.share) {
    navigator.share({ title: datos.group.name, text: texto, url }).catch(() => {});
  } else {
    // Sin compartir nativo se copia el mensaje entero, no solo el enlace.
    navigator.clipboard.writeText(texto + '\n' + url)
      .then(() => toast('¡Mensaje copiado!'))
      .catch(() => toast(url));
  }
}

// ---------------------------------------------------------------- arranque

// --- El reparto se mantiene al dia solo ----------------------------------
//
// El latido pide UN documento —no el resumen entero— y solo si el contador ha
// cambiado se recarga todo. Con un viaje de treinta tickets la diferencia es
// entre una lectura y treinta cada pocos segundos.
let ultimaVersion = -1;
let latido = null;

async function comprobarNovedades() {
  if (document.hidden) return;          // en segundo plano no se gasta cuota
  try {
    const r = await fetch('/api/groups/' + groupId + '/pulse');
    if (!r.ok) return;
    const { v } = await r.json();
    if (ultimaVersion === -1) { ultimaVersion = v; return; }
    if (v !== ultimaVersion) {
      ultimaVersion = v;
      // No se recarga mientras alguien esta escribiendo un gasto: le borraria
      // lo que lleva puesto.
      if (document.getElementById('expenseForm').classList.contains('hidden') &&
          document.getElementById('tplPanel').classList.contains('hidden')) {
        await cargar();
      }
    }
  } catch (_) { /* sin conexion: se reintenta en el siguiente latido */ }
}

function arrancarLatido() {
  if (latido) return;
  latido = setInterval(comprobarNovedades, 6000);
  // Al volver de otra aplicacion hay que refrescar ya: mientras estabas fuera
  // no se ha comprobado nada.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) comprobarNovedades();
  });
}

document.getElementById('repartoTitulo').addEventListener('click', tocarTituloReparto);
document.getElementById('tplText').addEventListener('input', refrescarPreview);
document.getElementById('tplSave').addEventListener('click', guardarPlantilla);
document.getElementById('tplReset').addEventListener('click', () => {
  document.getElementById('tplText').value = PLANTILLA_POR_DEFECTO;
  refrescarPreview();
});

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

cargar().then(arrancarLatido);
