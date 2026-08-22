// comparTICKET — historial completo de un grupo
//
// Un viaje son veinte apuntes y caben en la pantalla del grupo. Un piso
// compartido, a los seis meses, son doscientos: ahí el acordeón se vuelve una
// lista infinita que hay que recorrer entera para llegar a la sección
// siguiente. Esta pantalla existe para eso.
//
// Se llega tocando cualquier gasto o ticket del grupo. Y desde aquí, tocando
// uno, se va a donde se iba antes: al reparto del ticket o a marcarlo.

const params = new URLSearchParams(location.search);
const groupId = params.get('grupo') || (location.pathname.match(/^\/g\/([^/?#]+)\/todo/) || [])[1];
if (!groupId) location.href = '/';

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

let datos = null;
let apuntes = [];               // todo junto, gastos y tickets
let orden = 'fecha';
let descendente = true;         // lo más reciente primero
let personaFiltrada = '';
let busqueda = '';

// ---------------------------------------------------------------- carga

async function cargar() {
  let res;
  try {
    res = await fetch('/api/groups/' + groupId + '/summary');
  } catch (_) {
    return toast('Sin conexión. Inténtalo de nuevo.');
  }
  if (!res.ok) return location.href = '/';
  datos = await res.json();

  document.getElementById('barTitle').textContent = datos.group.name;
  document.getElementById('grupoNombre').textContent = (datos.group.name || '').toUpperCase();
  document.getElementById('volverBtn').onclick = () => location.href = '/g/' + encodeURIComponent(groupId);

  construirApuntes();
  pintarFiltroGente();
  pintar();
}

/**
 * Gastos y tickets, en una sola lista.
 *
 * En la pantalla del grupo van separados porque allí cada sección responde a
 * una pregunta distinta ("¿qué falta por cerrar?"). Aquí la pregunta es otra
 * —"¿dónde está aquel gasto?"— y para buscar da igual de dónde salió cada
 * uno: lo que importa es el sitio, la fecha, quién pagó y cuánto fue.
 */
function construirApuntes() {
  apuntes = []
    .concat(datos.tickets.map(t => ({
      tipo: t.status === 'closed' ? 'cerrado' : 'abierto',
      id: t.id,
      nombre: t.restaurant || 'Ticket',
      importe: +t.total || 0,
      pagador: t.payerName || '',
      cuando: t.receiptDate || t.closedAt || t.createdAt,
      // Un ticket lleva a su reparto; si sigue abierto, a marcarlo.
      destino: t.status === 'closed'
        ? '/summary.html?id=' + encodeURIComponent(t.id)
        : '/claim.html?id=' + encodeURIComponent(t.id)
    })))
    .concat(datos.expenses.map(e => ({
      tipo: 'suelto',
      id: e.id,
      nombre: e.description || 'Gasto',
      importe: +e.amount || 0,
      pagador: e.paidBy || '',
      entre: e.splitBetween || [],
      cuando: e.createdAt,
      destino: null            // un gasto suelto no tiene pantalla propia
    })));
}

// ---------------------------------------------------------------- filtros

function pintarFiltroGente() {
  const cont = document.getElementById('filtroGente');
  cont.innerHTML = '';

  const todos = document.createElement('button');
  todos.type = 'button';
  todos.className = 'who-pill small' + (personaFiltrada ? '' : ' active');
  todos.textContent = 'Todos';
  todos.onclick = () => { personaFiltrada = ''; pintarFiltroGente(); pintar(); };
  cont.appendChild(todos);

  (datos.group.members || []).forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'who-pill small' + (personaFiltrada === m.name ? ' active' : '');
    b.textContent = m.name;
    // Tocar el mismo lo quita: se filtra y se desfiltra con el mismo dedo.
    b.onclick = () => {
      personaFiltrada = (personaFiltrada === m.name) ? '' : m.name;
      pintarFiltroGente();
      pintar();
    };
    cont.appendChild(b);
  });
}

/**
 * Lo que pasa el filtro.
 *
 * El buscador mira el nombre, quién pagó y el importe escrito tal cual, así
 * que "47" encuentra los 47,00 € sin que haya que escribir la coma ni el
 * símbolo. Sin tildes ni mayúsculas: buscar "belem" tiene que encontrar
 * "TORRE DE BELÉM".
 */
function sinTildes(s) {
  // El rango es el bloque de tildes y dieresis que NFD deja sueltas.
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function filtrados() {
  const q = sinTildes(busqueda).trim();
  return apuntes.filter(a => {
    if (personaFiltrada && a.pagador !== personaFiltrada) return false;
    if (!q) return true;
    const importe = String(a.importe.toFixed(2)).replace('.', ',');
    return sinTildes(a.nombre).includes(q) ||
           sinTildes(a.pagador).includes(q) ||
           importe.includes(q) ||
           importe.replace(',', '.').includes(q);
  });
}

function ordenados(lista) {
  const copia = lista.slice();
  copia.sort((a, b) => {
    let d = 0;
    if (orden === 'importe') d = a.importe - b.importe;
    else if (orden === 'pagador') d = String(a.pagador).localeCompare(String(b.pagador), 'es');
    else {
      const fa = new Date(a.cuando).getTime() || 0;
      const fb = new Date(b.cuando).getTime() || 0;
      d = fa - fb;
    }
    // Empate: por nombre, para que el orden no baile entre repintados.
    if (d === 0) d = String(a.nombre).localeCompare(String(b.nombre), 'es');
    return descendente ? -d : d;
  });
  return copia;
}

// ---------------------------------------------------------------- pintado

function pintar() {
  const cont = document.getElementById('listaTodo');
  const vacio = document.getElementById('sinResultados');
  cont.innerHTML = '';

  const lista = ordenados(filtrados());

  // Cabecera: cuántos y cuánto suman, siempre sobre lo que se está viendo.
  const suma = lista.reduce((s, a) => s + a.importe, 0);
  document.getElementById('grupoResumen').textContent =
    lista.length + (lista.length === 1 ? ' APUNTE · ' : ' APUNTES · ') + eur(suma);

  document.querySelectorAll('.orden-btn').forEach(b => {
    const activo = b.dataset.orden === orden;
    b.classList.toggle('activo', activo);
    b.classList.toggle('desc', activo && descendente);
    b.classList.toggle('asc', activo && !descendente);
  });

  if (!lista.length) {
    vacio.classList.remove('hidden');
    vacio.textContent = apuntes.length
      ? 'Nada que coincida con la búsqueda'
      : 'Este grupo todavía no tiene gastos';
    return;
  }
  vacio.classList.add('hidden');

  // Agrupado por meses. En un piso compartido es la única forma de recorrer
  // seis meses de gastos sin perderse; en un viaje de tres días sale un solo
  // grupo y no estorba.
  let ultimoGrupo = null;
  lista.forEach(a => {
    const cabecera = orden === 'fecha' ? etiquetaMes(a.cuando)
                   : orden === 'pagador' ? (a.pagador || 'sin pagador')
                   : tramoImporte(a.importe);
    if (cabecera !== ultimoGrupo) {
      ultimoGrupo = cabecera;
      const h = document.createElement('div');
      h.className = 'hist-grupo';
      h.textContent = cabecera;
      cont.appendChild(h);
    }
    cont.appendChild(filaApunte(a));
  });
}

function etiquetaMes(cuando) {
  const d = new Date(cuando);
  if (isNaN(d)) return 'sin fecha';
  return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();
}

/** Tramos redondos, para que ordenando por importe no salga un grupo por fila. */
function tramoImporte(n) {
  if (n < 10) return 'MENOS DE 10';
  if (n < 25) return 'DE 10 A 25';
  if (n < 50) return 'DE 25 A 50';
  if (n < 100) return 'DE 50 A 100';
  return 'MÁS DE 100';
}

function filaApunte(a) {
  // Un ticket lleva a su pantalla. Un gasto suelto no tiene ninguna, así que
  // se queda como fila: fingir que se puede entrar y no llevar a ningún sitio
  // es peor que no ofrecerlo.
  const el = document.createElement(a.destino ? 'a' : 'div');
  el.className = 'hist-row hist-' + a.tipo;
  if (a.destino) el.href = a.destino;

  const d = new Date(a.cuando);
  const fecha = isNaN(d) ? '' : d.toLocaleDateString('es-ES',
    { day: '2-digit', month: 'short' }).toUpperCase() + ' ' +
    d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  const etiqueta = a.tipo === 'suelto' ? 'gasto suelto'
                 : a.tipo === 'abierto' ? 'sin cerrar' : 'cerrado';

  el.innerHTML =
    '<div class="hist-main">' +
      '<span class="hist-name">' + esc(a.nombre) + '</span>' +
      '<span class="hist-amount">' + eur(a.importe) + '</span>' +
    '</div>' +
    '<div class="hist-sub">' +
      '<span class="hist-who">' + (a.pagador ? 'Pagador: ' + esc(a.pagador) : '—') + '</span>' +
      '<span class="hist-date">' + fecha + '</span>' +
    '</div>' +
    '<span class="hist-tag ' + a.tipo + '">' + etiqueta + '</span>';

  return el;
}

// ---------------------------------------------------------------- eventos

document.getElementById('buscador').addEventListener('input', (e) => {
  busqueda = e.target.value;
  document.getElementById('buscaX').classList.toggle('hidden', !busqueda);
  pintar();
  fitTicket();
});

document.getElementById('buscaX').addEventListener('click', () => {
  busqueda = '';
  document.getElementById('buscador').value = '';
  document.getElementById('buscaX').classList.add('hidden');
  pintar();
  fitTicket();
});

document.getElementById('ordenRow').addEventListener('click', (e) => {
  const b = e.target.closest('.orden-btn');
  if (!b) return;
  // El mismo dos veces le da la vuelta al orden.
  if (orden === b.dataset.orden) descendente = !descendente;
  else { orden = b.dataset.orden; descendente = (orden !== 'pagador'); }
  pintar();
  fitTicket();
});

cargar().then(() => fitTicket());
