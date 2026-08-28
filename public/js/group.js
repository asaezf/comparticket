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
  pintarAvisoTickets();
  pintarBloqueo();
  pintarAvisos();

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
  // Abierto se llama "REPARTO ACTUAL": es una foto de como van las cuentas
  // ahora mismo, no la cifra definitiva.
  const tituloReparto = document.getElementById('repartoTitulo');
  if (tituloReparto) {
    tituloReparto.textContent = datos.bloqueado ? 'REPARTO' : 'REPARTO ACTUAL';
  }

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

  // Con el reparto abierto, la tarjeta solo dice quien le debe cuanto a quien,
  // y se actualiza sola con cada gasto. Ni recordatorios, ni colores, ni
  // reloj: todavia no hay ninguna deuda que reclamar, porque la cifra puede
  // cambiar en el proximo gasto. Todo eso llega al bloquear.
  const bloqueado = !!(datos && datos.bloqueado);
  const nivel = bloqueado ? nivelDeDeuda(segundosDeDeuda()) : '';

  datos.transfers.forEach(t => {
    const fila = document.createElement('div');
    fila.className = 'tr-row' +
      (t.de === yo || t.a === yo ? ' is-mine' : '') +
      (nivel ? ' ' + nivel : '');
    fila.innerHTML =
      '<div class="tr-main">' +
        '<span class="tr-from">' + esc(t.de) + '</span>' +
        '<span class="tr-arrow">→</span>' +
        '<span class="tr-to">' + esc(t.a) + '</span>' +
        (bloqueado ? relojDeuda() : '') +
        '<span class="tr-amount">' + eur(t.importe) + '</span>' +
      '</div>' +
      (bloqueado
        ? '<div class="tr-actions">' +
            '<button class="tr-btn tr-remind" type="button">Recordar</button>' +
            '<button class="tr-btn tr-paid" type="button">Ya pagado</button>' +
          '</div>'
        : '');

    if (bloqueado) {
      fila.querySelector('.tr-remind').addEventListener('click', () => recordar(t));
      fila.querySelector('.tr-paid').addEventListener('click', () => marcarPagado(t));
    }
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
 * Cuanto tiempo lleva viva la deuda, y de que color va el canto.
 *
 * Se cuenta desde que se BLOQUEO el reparto, no desde el ultimo gasto.
 * Mientras el reparto esta abierto las cifras todavia se mueven y no hay
 * ninguna deuda que reclamar; en el momento en que se bloquea, lo que debe
 * cada uno queda fijado y ahi empieza a correr el reloj.
 *
 * La escala del canto, de menos a mas:
 *
 *     menos de 1 h   sin color    acaba de bloquearse
 *     1 h            amarillo
 *     1 dia          naranja
 *     2 dias         rojo
 *     3 dias         rojo intenso
 *     5 dias         violeta
 *     7 dias o mas   negro
 *
 * Sube, pero sin insultar a nadie: es una cuenta entre amigos, no una
 * agencia de cobros.
 */
const ESCALA_DEUDA = [
  { desde: 7 * 24 * 3600, nivel: 'e6' },
  { desde: 5 * 24 * 3600, nivel: 'e5' },
  { desde: 3 * 24 * 3600, nivel: 'e4' },
  { desde: 2 * 24 * 3600, nivel: 'e3' },
  { desde: 1 * 24 * 3600, nivel: 'e2' },
  { desde: 3600,          nivel: 'e1' }
];

/** Segundos que lleva bloqueado el reparto. 0 si no lo esta. */
function segundosDeDeuda() {
  if (!datos || !datos.bloqueadoDesde) return 0;
  const t = new Date(datos.bloqueadoDesde).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

function nivelDeDeuda(seg) {
  for (const p of ESCALA_DEUDA) if (seg >= p.desde) return p.nivel;
  return '';
}

/** "45 min", "3 h", "2 días", "3 sem". Corto, que va dentro de la tarjeta. */
function tiempoCorto(seg) {
  if (seg < 60) return 'ahora';
  const min = Math.floor(seg / 60);
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' h';
  const d = Math.floor(h / 24);
  if (d < 14) return d + (d === 1 ? ' día' : ' días');
  const sem = Math.floor(d / 7);
  return sem + ' sem';
}

/**
 * El relojito de una tarjeta de reparto.
 *
 * Va entre el nombre de quien cobra y el importe, en gris flojo: es un dato
 * de apoyo, no la informacion principal. Y no cambia el alto de la tarjeta.
 */
function relojDeuda() {
  const seg = segundosDeDeuda();
  if (!seg) return '';
  return '<span class="tr-clock" title="Tiempo desde que se bloqueó el reparto">' +
    '<span class="tr-clock-ico">\u25f7</span>' + tiempoCorto(seg) + '</span>';
}


/**
 * Resumen del viaje: lo que la gente quiere contar despues.
 *
 * Todo se calcula con lo que ya hay —miembros, tickets, gastos y pagos— y
 * ninguna linea se ensena si no tiene con que: un grupo de un solo apunte no
 * tiene "quien paga mas veces", y una fila vacia solo hace ruido.
 */
function pintarStats() {
  const cont = document.getElementById('statsBlock');
  if (!cont) return;
  cont.innerHTML = '';

  const gente = (datos.group.members || []).length;

  // Cerrado, la cabecera dice el total y CUANTA GENTE hay. Antes decia
  // "2 apuntes", que no significa nada para quien mira el grupo por encima.
  pintarFold('foldStats', 'stats', gente, datos.stats.total || 0, 'miembro');

  if (!datos.stats.apuntes) {
    cont.innerHTML = desplegado.stats
      ? '<div class="empty-line">Cuando haya gastos, aqu\u00ed saldr\u00e1 el resumen</div>'
      : '';
    return;
  }
  if (!desplegado.stats) return;

  const cerrados = datos.tickets.filter(t => t.status === 'closed');

  // --- Todo lo pagado, venga de un ticket o de un gasto suelto ------------
  const apuntes = []
    .concat(datos.tickets.map(t => ({
      nombre: t.restaurant || 'Ticket', importe: +t.total || 0, quien: t.payerName,
      cuando: t.receiptDate || t.createdAt, esTicket: true
    })))
    .concat(datos.expenses.map(e => ({
      nombre: e.description, importe: +e.amount || 0, quien: e.paidBy,
      cuando: e.createdAt, esTicket: false
    })));

  // Cuanto ha puesto cada uno y cuantas veces ha sacado la cartera. Solo
  // cuentan los CERRADOS y los sueltos: lo de un ticket abierto todavia
  // puede cambiar.
  const dinero = {}, veces = {};
  (datos.group.members || []).forEach(m => { dinero[m.name] = 0; veces[m.name] = 0; });
  []
    .concat(cerrados.map(t => ({ quien: t.payerName, importe: +t.total || 0 })))
    .concat(datos.expenses.map(e => ({ quien: e.paidBy, importe: +e.amount || 0 })))
    .forEach(a => {
      if (!(a.quien in dinero)) { dinero[a.quien] = 0; veces[a.quien] = 0; }
      dinero[a.quien] += a.importe;
      veces[a.quien] += 1;
    });

  const mas   = o => Object.keys(o).sort((a, b) => o[b] - o[a])[0];
  const menos = o => Object.keys(o).sort((a, b) => o[a] - o[b])[0];

  // Cuanto tarda cada uno en pagar, de media. Sale de lo que se apunto en el
  // momento de cada pago: despues es imposible de reconstruir.
  const esperas = {};
  datos.payments.forEach(pg => {
    if (typeof pg.esperoDias !== 'number') return;
    (esperas[pg.from] = esperas[pg.from] || []).push(pg.esperoDias);
  });
  const media = {};
  Object.keys(esperas).forEach(k => {
    media[k] = esperas[k].reduce((a, b) => a + b, 0) / esperas[k].length;
  });
  const dias = n => {
    const r = Math.round(n * 10) / 10;
    return r < 1 ? 'el mismo d\u00eda' : (r === 1 ? '1 d\u00eda' : r + ' d\u00edas');
  };

  // Ordenados por fecha, para el primero y el ultimo.
  const porFecha = apuntes.filter(a => a.cuando && !isNaN(new Date(a.cuando)))
    .sort((a, b) => new Date(a.cuando) - new Date(b.cuando));
  const tickets = datos.tickets.filter(t => t.createdAt && !isNaN(new Date(t.receiptDate || t.createdAt)))
    .sort((a, b) => new Date(a.receiptDate || a.createdAt) - new Date(b.receiptDate || b.createdAt));

  const caro = apuntes.slice().sort((a, b) => b.importe - a.importe)[0];
  const debe = {};
  datos.transfers.forEach(t => { debe[t.de] = (debe[t.de] || 0) + t.importe; });

  const fFecha = f => {
    const d = new Date(f);
    return isNaN(d) ? '' : d.toLocaleDateString('es-ES',
      { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const filas = [];
  const fila = (k, v) => { if (v) filas.push([k, v]); };

  // --- El grupo ---
  fila('Miembros', String(gente));
  if (datos.group.createdAt) fila('Creado el', fFecha(datos.group.createdAt));

  // --- El dinero ---
  fila('Gasto total', eur(datos.stats.total));
  if (gente) fila('A partes iguales', eur(datos.stats.total / gente));
  if (caro) fila('El gasto m\u00e1s caro', esc(caro.nombre) + ' \u00b7 ' + eur(caro.importe));

  // --- Los tickets ---
  if (tickets.length) {
    fila('Primer ticket', esc(tickets[0].restaurant || 'Ticket'));
    if (tickets.length > 1) {
      fila('\u00daltimo ticket', esc(tickets[tickets.length - 1].restaurant || 'Ticket'));
    }
  }

  // --- La gente ---
  const banco = mas(dinero);
  if (banco && dinero[banco] > 0) {
    fila('El banco del grupo', esc(banco) + ' \u00b7 ' + eur(dinero[banco]) + ' adelantados');
  }
  const tacano = menos(dinero);
  if (tacano && gente > 1 && tacano !== banco) {
    fila('Qui\u00e9n ha adelantado menos', esc(tacano) + ' \u00b7 ' + eur(dinero[tacano]));
  }

  const masVeces = mas(veces);
  if (masVeces && veces[masVeces] > 0) {
    fila('Qui\u00e9n paga m\u00e1s veces',
      esc(masVeces) + ' \u00b7 ' + veces[masVeces] + (veces[masVeces] === 1 ? ' vez' : ' veces'));
  }
  const menosVeces = menos(veces);
  if (menosVeces && gente > 1 && menosVeces !== masVeces) {
    fila('Qui\u00e9n paga menos veces',
      esc(menosVeces) + ' \u00b7 ' + veces[menosVeces] + (veces[menosVeces] === 1 ? ' vez' : ' veces'));
  }

  const lento = mas(media), rapido = menos(media);
  if (lento) fila('Qui\u00e9n tarda m\u00e1s en pagar', esc(lento) + ' \u00b7 ' + dias(media[lento]));
  if (rapido && rapido !== lento) {
    fila('Qui\u00e9n paga antes', esc(rapido) + ' \u00b7 ' + dias(media[rapido]));
  }

  const elQueMasDebe = mas(debe);
  if (elQueMasDebe) {
    fila('Qui\u00e9n debe m\u00e1s ahora', esc(elQueMasDebe) + ' \u00b7 ' + eur(debe[elQueMasDebe]));
  }

  fila('Pagos ya hechos',
    datos.payments.length + ' de ' + (datos.payments.length + datos.transfers.length));

  filas.forEach(([k, v]) => {
    const r = document.createElement('div');
    r.className = 'stat-row';
    r.innerHTML = '<span class="stat-k">' + k + '</span><span class="stat-v">' + v + '</span>';
    cont.appendChild(r);
  });
}

// =========================================================================
// AVISOS
//
// El grupo ya se refrescaba solo, pero en silencio: las cifras cambiaban
// delante de ti sin decirte por que. Con el diario del servidor se puede
// poner nombre a ese cambio.
//
// Dos reglas que evitan que esto se vuelva ruido:
//
//   1. No te avisas a ti mismo. El evento guarda quien lo provoco, y si eres
//      tu no sale nada: acabas de hacerlo, ya lo sabes.
//   2. La primera vez que abres el grupo no salta nada. Se marcan todos los
//      eventos como vistos sin ensenarlos; si no, al entrar despues de un fin
//      de semana te caerian doce avisos de golpe.
// =========================================================================

const VISTOS_KEY = 'ct_avisos_' + groupId;

function eventosVistos() {
  try { return new Set(JSON.parse(localStorage.getItem(VISTOS_KEY) || '[]')); }
  catch (_) { return new Set(); }
}

function guardarVistos(ids) {
  try {
    // Un tope: esto es una memoria de "ya te lo he contado", no un historial.
    localStorage.setItem(VISTOS_KEY, JSON.stringify(ids.slice(-60)));
  } catch (_) {}
}

let primeraPasadaDeAvisos = true;

/**
 * Texto de cada tipo de aviso.
 *
 * Devuelve null cuando ese evento no te incumbe —un recordatorio entre otras
 * dos personas, por ejemplo— y entonces no se ensena nada.
 */
function textoDelAviso(ev) {
  const d = ev.datos || {};
  const quien = ev.actor || 'Alguien';

  switch (ev.tipo) {
    case 'gasto-nuevo':
      return { icono: '\uD83D\uDCB8', tono: 'normal',
        titulo: quien + ' ha a\u00f1adido un gasto',
        cuerpo: (d.nombre || 'Gasto') + ' \u00b7 ' + eur(d.importe || 0) };

    case 'ticket-nuevo':
      return { icono: '\uD83E\uDDFE', tono: 'normal',
        titulo: 'Ticket nuevo en el grupo',
        cuerpo: (d.nombre || 'Ticket') + ' \u00b7 ' + eur(d.importe || 0),
        ir: d.ticketId ? '/claim.html?id=' + encodeURIComponent(d.ticketId) : null };

    case 'ticket-cerrado':
      return { icono: '\u2705', tono: 'ok',
        titulo: 'Ticket cerrado',
        cuerpo: (d.nombre || 'Ticket') + ' \u00b7 ya cuenta en el reparto',
        ir: d.ticketId ? '/summary.html?id=' + encodeURIComponent(d.ticketId) : null };

    case 'pago-hecho': {
      // Solo interesa a los dos implicados: al resto no le cambia nada.
      const mio = yo && (d.de === yo || d.a === yo);
      if (!mio) return null;
      return { icono: '\uD83E\uDD1D', tono: 'ok',
        titulo: d.a === yo ? d.de + ' te ha pagado' : 'Pago anotado',
        cuerpo: d.de + ' \u2192 ' + d.a + ' \u00b7 ' + eur(d.importe || 0) };
    }

    case 'recordatorio': {
      // Es lo que pediste: solo si el pago te toca a ti.
      if (!yo || (d.de !== yo && d.a !== yo)) return null;
      if (d.de === yo) {
        return { icono: '\u23F0', tono: 'aviso',
          titulo: 'Te recuerdan un pago',
          cuerpo: 'Le debes ' + eur(d.importe || 0) + ' a ' + d.a };
      }
      return { icono: '\u23F0', tono: 'normal',
        titulo: 'Recordatorio enviado',
        cuerpo: 'A ' + d.de + ', que te debe ' + eur(d.importe || 0) };
    }

    case 'reparto-bloqueado':
      return { icono: '\uD83D\uDD12', tono: 'aviso',
        titulo: 'Reparto bloqueado',
        cuerpo: 'Las cifras quedan fijas y ya no entran gastos nuevos' };

    case 'reparto-abierto':
      return { icono: '\uD83D\uDD13', tono: 'normal',
        titulo: 'Reparto desbloqueado',
        cuerpo: 'Vuelven a entrar gastos y las cifras se recalculan' };

    default:
      return null;
  }
}

function pintarAvisos() {
  if (!datos || !Array.isArray(datos.eventos)) return;

  const vistos = eventosVistos();
  const nuevos = datos.eventos.filter(ev => ev && ev.id && !vistos.has(ev.id));
  if (!nuevos.length) return;

  // Todos pasan a vistos, se ensenen o no: uno que no te incumbe tampoco
  // debe volver a evaluarse en el siguiente latido.
  nuevos.forEach(ev => vistos.add(ev.id));
  guardarVistos([...vistos]);

  // Al abrir el grupo no salta nada: solo se toma nota de por donde vas.
  if (primeraPasadaDeAvisos) { primeraPasadaDeAvisos = false; return; }

  // Silenciados desde la portada. Se comprueba DESPUES de marcar los eventos
  // como vistos, a proposito: si no, al quitar el silencio te caerian de
  // golpe todos los de los ultimos dias.
  let callado = false;
  try { callado = localStorage.getItem('ct_avisos_silencio') === '1'; } catch (_) {}
  if (callado) return;

  nuevos.forEach(ev => {
    if (yo && ev.actor === yo) return;      // lo acabas de hacer tu
    const a = textoDelAviso(ev);
    if (!a) return;
    Avisos.mostrar({
      icono: a.icono, titulo: a.titulo, cuerpo: a.cuerpo, tono: a.tono,
      alTocar: a.ir ? () => { location.href = a.ir; } : null
    });
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

/**
 * El boton de bloquear, y la papelera que solo sale bloqueado.
 *
 * Bloquear es lo que convierte "asi van las cuentas" en "esto es lo que hay
 * que pagar". Mientras esta abierto no se puede reclamar nada porque la cifra
 * cambia con cada gasto; al bloquear se congela, deja de entrar nada nuevo, y
 * salen los recordatorios, los colores y el reloj.
 */
function pintarBloqueo() {
  const btn = document.getElementById('lockBtn');
  const papelera = document.getElementById('wipeBtn');
  if (!btn) return;

  const bloqueado = !!datos.bloqueado;
  const hayAlgo = (datos.stats && datos.stats.apuntes) > 0;

  // Sin nada apuntado no hay nada que bloquear.
  btn.classList.toggle('hidden', !hayAlgo);
  btn.classList.toggle('cerrado', bloqueado);
  btn.textContent = bloqueado ? 'Desbloquear el reparto' : 'Bloquear el reparto';
  btn.onclick = () => cambiarBloqueo(!bloqueado);

  if (papelera) {
    papelera.classList.toggle('hidden', !bloqueado || !hayAlgo);
    papelera.onclick = liquidarReparto;
  }

  // Bloqueado no entra nada: los botones de anadir se apagan aqui tambien,
  // aunque el servidor lo rechace igual. Ver un boton que no hace nada es
  // peor que no verlo.
  ['addTicketBtn', 'addExpenseBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    b.disabled = bloqueado;
    b.title = bloqueado ? 'Desbloquea el reparto para añadir gastos' : '';
  });
  const aviso = document.getElementById('lockedHint');
  if (aviso) aviso.classList.toggle('hidden', !bloqueado);
}

async function cambiarBloqueo(quiero) {
  const btn = document.getElementById('lockBtn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/groups/' + groupId + '/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: quiero, actor: yo || null })
    });
    if (!r.ok) throw new Error('No se ha podido cambiar');
    toast(quiero
      ? 'Reparto bloqueado — ya puedes reclamar'
      : 'Reparto desbloqueado — vuelven a entrar gastos');
    await cargar();
  } catch (e) {
    toast(e instanceof TypeError ? 'Sin conexión' : e.message);
  } finally {
    btn.disabled = false;
  }
}

/**
 * Liquidar: deja el grupo a cero para empezar otra vez.
 *
 * Se pregunta dos veces a proposito, y la segunda dice exactamente cuanto se
 * archiva. No borra: lo que habia queda marcado como archivado y deja de
 * contar, asi que un dedo torpe no destruye las cuentas de un viaje entero.
 */
async function liquidarReparto() {
  const cuantos = datos.stats.apuntes || 0;
  const sinPagar = datos.transfers.length;

  if (sinPagar) {
    if (!confirm('Todavía quedan ' + sinPagar +
      (sinPagar === 1 ? ' pago pendiente' : ' pagos pendientes') + '.\n\n' +
      '¿Seguro que quieres liquidar el reparto de todas formas?')) return;
  }
  if (!confirm('Se van a archivar ' + cuantos +
    (cuantos === 1 ? ' apunte' : ' apuntes') + ' y todos los pagos.\n\n' +
    'El grupo empieza de cero y la gente sigue dentro. ¿Continuar?')) return;

  try {
    const r = await fetch('/api/groups/' + groupId + '/reset', { method: 'POST' });
    if (!r.ok) throw new Error('No se ha podido liquidar');
    const { archivados } = await r.json();
    toast('Reparto liquidado — ' + archivados + ' apuntes archivados');
    desplegado.gastos = desplegado.abiertos = desplegado.cerrados = false;
    await cargar();
  } catch (e) {
    toast(e instanceof TypeError ? 'Sin conexión' : e.message);
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

  // Y se deja constancia dentro del grupo. WhatsApp se abre igual aunque esto
  // falle \u2014el recordatorio lo manda la persona, no la aplicaci\u00F3n\u2014 pero si
  // llega, a quien se le reclama le sale el aviso al abrir el grupo en vez de
  // enterarse solo por el chat.
  fetch('/api/groups/' + groupId + '/remind', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ de: t.de, a: t.a, importe: t.importe, actor: yo || null })
  }).catch(() => {});
}

async function marcarPagado(t) {
  if (!confirm(t.de + ' → ' + t.a + ': ' + eur(t.importe) + '\n\n¿Confirmas que este pago ya se ha hecho?')) return;
  try {
    const r = await fetch('/api/groups/' + groupId + '/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: t.de, to: t.a, amount: t.importe, actor: yo || null })
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
// Todo empieza cerrado. Al entrar a un grupo lo que importa son los saldos y
// el reparto, que estan arriba; las listas son para ir a buscarlas, no para
// que te reciban desplegadas con todo lo que hay dentro.
const desplegado = { gastos: false, cerrados: false, abiertos: false, stats: false };

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

  // La cabecera entera es el interruptor: se toca donde se está mirando.
  // Antes no llevaba ni borde ni flecha, solo se hundía al pulsarla — y tras
  // un fin de semana de uso real nadie encontraba que estas secciones se
  // pudieran tocar. Ahora tiene el mismo aspecto de tarjeta que ya usan los
  // botones de añadir, y un chevron que gira.
  const abierta = !!desplegado[clave];
  b.classList.toggle('abierta', abierta);
  b.onclick = () => { desplegado[clave] = !desplegado[clave]; pintar(); };

  // El giro lo pone el estado y no una regla del CSS: es lo mismo que ya se
  // hizo con este chevron la primera vez —getComputedStyle no demostró ser
  // de fiar aquí para comprobar que una rotación por clase se aplicaba de
  // verdad— así que se mantiene el mismo criterio.
  const chev = b.querySelector('.sh-chev');
  if (chev) chev.style.transform = abierta ? 'rotate(180deg)' : 'rotate(0deg)';

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

/**
 * Fecha y hora de un ticket, en el formato del papel: "09 AGO 21:37".
 *
 * La hora importa mas de lo que parece: en un viaje se cena dos veces en el
 * mismo sitio, y con solo el dia los dos tickets se confunden.
 */
/**
 * Fecha y hora de un ticket, para las filas del grupo.
 *
 * Antes tomaba una Date ya construida con `receiptDate || createdAt` y
 * llamaba a toLocaleTimeString sin mirar si esa Date tenía hora de verdad.
 * `receiptDate` es una fecha SIN hora ("2026-08-23"): interpretada como
 * medianoche UTC, en Madrid son las 2 de la madrugada. Cualquier ticket con
 * fecha pero sin hora en el papel —la mayoría— enseñaba esa hora fabricada.
 * Ahora recibe el ticket entero y usa fechaDelTicket() (i18n.js), que nunca
 * inventa una hora que no viene de ningún lado.
 */
function fechaYHora(tk) {
  const { fecha: d, horaTexto, delPapel } = fechaDelTicket(tk);
  if (isNaN(d)) return '';
  if (!horaTexto) return fmtFecha(d);
  return fmtFecha(d) + ' ' + horaTexto + (delPapel ? '' : ' (' + t.horaSubido + ')');
}

/**
 * Los tickets que estan esperando TU marca.
 *
 * Alguien cena, sube la foto y el ticket se queda ahi. Sin esto, los demas
 * no se enteraban: habia que abrir el historial y darse cuenta solo, asi que
 * los tickets se quedaban a medias durante dias y el reparto no cerraba.
 *
 * Solo sale si falta tu marca, y desaparece en cuanto marcas. Si todavia no
 * has dicho quien eres no se ensena: no se sabe de quien falta la marca.
 */
function ticketsQueTeEsperan() {
  if (!yo) return [];
  return datos.tickets.filter(t =>
    t.status !== 'closed' && !(t.reparto && yo in t.reparto));
}

function pintarAvisoTickets() {
  const caja = document.getElementById('pendientesBlock');
  const lista = document.getElementById('pendientesLista');
  if (!caja || !lista) return;

  const pendientes = ticketsQueTeEsperan();
  caja.classList.toggle('hidden', !pendientes.length);
  lista.innerHTML = '';
  if (!pendientes.length) return;

  const tit = document.getElementById('pendTitulo');
  if (tit) {
    tit.textContent = pendientes.length === 1
      ? 'TICKET PENDIENTE DE MARCAR'
      : pendientes.length + ' TICKETS PENDIENTES DE MARCAR';
  }

  pendientes.forEach(t => {
    const a = document.createElement('a');
    a.className = 'pend-row';
    // Va directo a marcar: es lo unico que hay que hacer con el.
    a.href = '/claim.html?id=' + encodeURIComponent(t.id);
    a.innerHTML =
      '<div class="pend-main">' +
        '<span class="pend-name">' + esc(t.restaurant || 'Ticket') + '</span>' +
        '<span class="pend-amount">' + eur(t.total) + '</span>' +
      '</div>' +
      '<div class="pend-sub">' +
        '<span>' + fechaYHora(t) + '</span>' +
        '<span class="pend-ir">marcar lo m\u00edo \u2192</span>' +
      '</div>';
    lista.appendChild(a);
  });
}

/** Una fila de ticket, clicable para entrar a su reparto. */
function filaTicket(t) {
  const abierto = t.status !== 'closed';
  const fila = document.createElement('a');
  const est = abierto ? estadoTicket(t) : null;
  // Si eres tu quien falta por marcar, la fila lo dice: en una lista de seis
  // tickets abiertos, saber cual es el tuyo ahorra abrirlos todos.
  const teEspera = abierto && yo && !(t.reparto && yo in t.reparto);
  fila.className = 'item-row' + (abierto ? ' is-open' : '') +
    (est && est.clase ? ' ' + est.clase : '') + (teEspera ? ' te-espera' : '');
  // Lleva al historial completo, no directo al ticket.
  //
  // Un viaje son veinte apuntes y caben aqui; un piso compartido, a los seis
  // meses, son doscientos. Alli hace falta buscar y filtrar, y desde esa
  // pantalla se entra al ticket igual que se entraba desde aqui. Asi no hace
  // falta un boton de "ver todos" estorbando en cada seccion.
  fila.href = '/historial.html?grupo=' + encodeURIComponent(groupId);
  const fecha = fechaYHora(t);
  fila.innerHTML =
    '<div class="item-main">' +
      '<span class="item-name">' + esc(t.restaurant || 'Ticket') + '</span>' +
      '<span class="item-amount">' + eur(t.total) + '</span>' +
    '</div>' +
    '<div class="item-sub">' +
      '<span class="is-who">Pagador: ' + esc(t.payerName || '\u2014') + '</span>' +
      '<span class="is-meta">' + fecha + '</span>' +
    '</div>' +
    (est || teEspera
      ? '<div class="item-tags">' +
          (teEspera ? '<span class="item-state tuyo">falta tu marca</span>' : '') +
          (est ? est.chips : '') +
        '</div>'
      : '');
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

      // Tocar el gasto lleva al historial completo, igual que un ticket. La
      // cruz de borrar se queda fuera de ese gesto: si no, un dedo mal puesto
      // borraria un gasto en vez de abrir la lista.
      const fila = document.createElement('a');
      fila.className = 'item-row';
      fila.href = '/historial.html?grupo=' + encodeURIComponent(groupId);
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
      fila.querySelector('.item-del').addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        borrarGasto(e);
      });
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

  // Nada viene elegido. Antes se marcaba solo "lo pagas tú, se reparte entre
  // todos" porque es el caso mas comun, pero un gasto que se guarda a nombre
  // de quien no lo pago descuadra el viaje entero, y al venir ya marcado nadie
  // lo revisa. Se toca, y punto.
  pagadorSel = '';
  repartoSel = [];
  pintarPildorasFormulario();
  refrescarGuardar();
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
    p.addEventListener('click', () => {
      // Volver a tocar al mismo lo quita: si te equivocas, se corrige igual
      // que se puso.
      pagadorSel = (pagadorSel === m.name) ? '' : m.name;
      pintarPildorasFormulario();
      refrescarGuardar();
    });
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
      refrescarGuardar();
    });
    cs.appendChild(s);
  });
}

/**
 * El boton de guardar solo se enciende con las cuatro cosas puestas.
 *
 * Quien lo pago y entre quienes se reparte son tan obligatorios como el
 * nombre y el importe: sin ellos el gasto no se puede repartir. Antes venian
 * marcados de serie y se colaban sin que nadie los mirara.
 */
function refrescarGuardar() {
  const btn = document.getElementById('expSave');
  if (!btn) return;
  const desc = (document.getElementById('expDesc').value || '').trim();
  const imp = parseFloat(document.getElementById('expAmount').value);
  const listo = !!desc && Number.isFinite(imp) && imp > 0 &&
                !!pagadorSel && repartoSel.length > 0;
  btn.disabled = !listo;
  btn.classList.toggle('a-falta', !listo);
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
      body: JSON.stringify({ description, amount, paidBy: pagadorSel, splitBetween: repartoSel, actor: yo || null })
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

// El botón de guardar se apaga y se enciende con lo que hay escrito, igual
// que reacciona a las píldoras.
document.getElementById('expDesc').addEventListener('input', refrescarGuardar);
document.getElementById('expAmount').addEventListener('input', refrescarGuardar);
document.getElementById('shareGroupBtn').addEventListener('click', compartirGrupo);
document.getElementById('shareTopBtn').addEventListener('click', compartirGrupo);

// Escanear un ticket que caerá dentro de este grupo. El id viaja para que la
// portada sepa a qué grupo asignarlo al terminar.
document.getElementById('addTicketBtn').addEventListener('click', () => {
  window.location.href = '/?grupo=' + encodeURIComponent(groupId);
});

/**
 * El tutorial se arranca una sola vez, tras la primera carga — no dentro de
 * pintar(), que se repite cada vez que llega una novedad por el latido. Los
 * cuatro objetivos son elementos que siempre están en el documento (aunque
 * a veces ocultos, como el botón de bloquear sin ningún gasto todavía), así
 * que da igual en qué estado esté el grupo la primera vez que se abre.
 */
function iniciarTutorialGrupo() {
  Tour.iniciar('group', [
    {
      selector: '#whoBlock',
      titulo: t.tourGroupWhoTitle,
      cuerpo: t.tourGroupWhoBody
    },
    {
      selector: '.add-row',
      titulo: t.tourGroupAddTitle,
      cuerpo: t.tourGroupAddBody
    },
    {
      selector: '#repartoTitulo',
      titulo: t.tourGroupLockTitle,
      cuerpo: t.tourGroupLockBody
    },
    {
      selector: '#foldExpenses',
      titulo: t.tourGroupHistTitle,
      cuerpo: t.tourGroupHistBody
    }
  ]);
}

cargar().then(() => { arrancarLatido(); iniciarTutorialGrupo(); });
