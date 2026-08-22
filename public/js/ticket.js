// comparTICKET — Ticket review & edit
const params = new URLSearchParams(window.location.search);
const ticketId = params.get('id');
if (!ticketId) window.location.href = '/';

// i18n labels
document.getElementById('barTitle').textContent    = t.editTitle;
document.getElementById('addBtn').textContent      = t.addItem;
document.getElementById('lblTotal').textContent    = t.total;
document.getElementById('lblSum').textContent      = t.sumLines;
document.getElementById('shareBtn').textContent    = t.shareBtn;
document.getElementById('shareTitle').textContent  = t.shareTitle;
document.getElementById('shareHint').textContent   = t.shareHint;
document.getElementById('lblItem').textContent     = t.colItem;
document.getElementById('lblQty').textContent      = t.colQty;
document.getElementById('lblUnit').textContent     = t.colUnit;
document.getElementById('lblTotal2').textContent   = t.colTotal;
document.getElementById('copyText').textContent    = t.copyLink;
document.getElementById('nativeText').textContent  = t.share;
document.getElementById('payerLabel').textContent  = t.payerLabel;
document.getElementById('participantsLabel').textContent = t.participants;
document.getElementById('reviewHelpTitle').textContent = t.reviewHelpTitle;
document.getElementById('reviewHelpBody').textContent = t.reviewHelpBody;

let ticketData = null;
// Contador monótono de ids: solo sube, nunca reutiliza un id liberado.
let nextItemId = 0;

async function loadTicket() {
  const res = await fetch(`/api/tickets/${ticketId}`);
  if (!res.ok) return window.location.href = '/';
  ticketData = await res.json();

  const d = new Date(ticketData.receiptDate || ticketData.createdAt);
  document.getElementById('ticketTitle').textContent =
    (ticketData.restaurant || t.restaurant).toUpperCase();
  // La hora sale de receiptTime (lo que pone el ticket). Antes se derivaba de
  // la fecha, que no lleva hora, así que siempre mostraba 00:00.
  const datePart = d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    day: '2-digit', month: 'short', year: 'numeric'
  }).toUpperCase();
  document.getElementById('ticketDate').textContent =
    ticketData.receiptTime ? `${datePart}  ${ticketData.receiptTime}` : datePart;

  // Arranca el contador de ids por encima del mayor que ya exista.
  nextItemId = ticketData.items.reduce((m, i) => Math.max(m, +i.id || 0), 0);

  // Payer field
  const payerInput = document.getElementById('payerInput');
  if (payerInput) payerInput.value = ticketData.payerName || '';

  // Participants field
  const pInput = document.getElementById('participantsInput');
  if (pInput) pInput.value = ticketData.expectedParticipants || '';

  renderItems();
  updateTotal();
  montarGrupo();

  if (ticketData.status === 'shared' || ticketData.status === 'closed') {
    showShare();
  }
}

// Cuantas personas hay en el grupo, si este ticket pertenece a uno. Es el
// tope de participantes que se puede poner.
let topeParticipantes = 0;
let grupoDelTicket = null;

/**
 * Si el ticket va dentro de un grupo, se ensena de cual y se limita el numero
 * de participantes a la gente que hay en el.
 */
async function montarGrupo() {
  if (!ticketData || !ticketData.groupId) return;
  try {
    const r = await fetch('/api/groups/' + encodeURIComponent(ticketData.groupId));
    if (!r.ok) return;
    grupoDelTicket = await r.json();
  } catch (_) { return; }
  if (!grupoDelTicket || !Array.isArray(grupoDelTicket.members)) return;

  topeParticipantes = grupoDelTicket.members.length;

  const pInput = document.getElementById('participantsInput');
  if (pInput) {
    pInput.max = String(topeParticipantes);
    if (!pInput.value) pInput.value = String(topeParticipantes);
  }

  montarSelectorDePagador();

  // El banner del grupo ya no esta: estas pantallas tienen su propia flecha
  // de volver en la cabecera, y una segunda barra encima del ticket solo
  // tapaba lo que se ha venido a revisar.

}

function renderItems() {
  const list = document.getElementById('itemsList');
  list.innerHTML = '';
  ticketData.items.forEach((item, idx) => {
    // Se fuerza a número antes de pintar. La cantidad va dentro de un atributo
    // HTML: si llegara texto podría romper el atributo y colar un manejador de
    // eventos, y este ticket puede haberlo escrito cualquiera con el enlace.
    const lineTotal = ((+item.quantity || 0) * (+item.unitPrice || 0)).toFixed(2);
    const row = document.createElement('div');
    row.className = 'edit-row';
    row.style.animationDelay = `${0.12 + idx * 0.08}s`;
    row.innerHTML = `
      <textarea class="e-name" rows="1" placeholder="${t.itemName || 'Ítem'}" data-i="${idx}" data-f="name">${esc(item.name)}</textarea>
      <input class="e-qty"  type="number" value="${+item.quantity || 1}" min="1" data-i="${idx}" data-f="quantity">
      <input class="e-price" type="number" value="${(+item.unitPrice || 0).toFixed(2)}" step="0.01" min="0" data-i="${idx}" data-f="unitPrice">
      <span class="e-total">${Money.formatEUR(lineTotal, lang)}</span>
      <button class="e-del" data-i="${idx}" title="Eliminar">&times;</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('textarea.e-name').forEach(ta => {
    autoSize(ta);
    ta.addEventListener('input', e => { autoSize(e.target); onChange(e); });
  });
  list.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', onChange);
    inp.addEventListener('input', onChange);
  });
  list.querySelectorAll('.e-del').forEach(b => b.addEventListener('click', onDel));

  // El ticket acaba de cambiar de alto: hay que remedir para que la animación
  // de impresión no lo recorte. Con la lista larga del Mercadona el tope fijo
  // que había antes se comía el total.
  fitTicket();
}

function autoSize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function onChange(e) {
  const i = +e.target.dataset.i, f = e.target.dataset.f;
  let v = e.target.value;
  if (f === 'quantity')  v = parseInt(v)   || 1;
  if (f === 'unitPrice') v = parseFloat(v) || 0;
  ticketData.items[i][f] = v;
  if (f !== 'name') {
    ticketData.items[i].totalPrice = ticketData.items[i].quantity * ticketData.items[i].unitPrice;
    // Update line total display
    const row = e.target.closest('.edit-row');
    const totalSpan = row && row.querySelector('.e-total');
    if (totalSpan) totalSpan.textContent = Money.formatEUR(ticketData.items[i].totalPrice, lang);
  }
  updateTotal();
}

function onDel(e) {
  ticketData.items.splice(+e.target.dataset.i, 1);
  renderItems();
  updateTotal();
}

// El total del ticket (lo que cobró el establecimiento) y la suma de las
// líneas son dos números distintos. Antes el segundo machacaba al primero, y
// con ello se perdía el servicio, el cubierto o cualquier línea mal leída.
// Ahora se muestran los dos y, si no coinciden, hay que resolverlo.
function updateTotal() {
  const check = Money.reconcileTicket(ticketData.items, ticketData.total);
  document.getElementById('sumVal').textContent = Money.formatEUR(check.sum, lang);
  document.getElementById('totalVal').textContent = Money.formatEUR(check.total, lang);
  renderMismatch(check);
  return check;
}

function renderMismatch(check) {
  const box = document.getElementById('mismatch');
  const shareBtn = document.getElementById('shareBtn');
  box.classList.toggle('hidden', check.balanced);
  shareBtn.disabled = !check.balanced;
  if (check.balanced) return;

  const diff = Math.abs(check.delta);
  document.getElementById('mmAmount').textContent =
    `${check.delta > 0 ? '+' : '−'}${Money.formatEUR(diff, lang)}`;
  document.getElementById('mmText').textContent =
    check.delta > 0 ? t.mismatchFalta : t.mismatchSobra;
  document.getElementById('mmAddBtn').textContent =
    `${t.mmAddLine} (${check.delta > 0 ? '+' : '−'}${Money.formatEUR(diff, lang)})`;
  document.getElementById('mmUseSumBtn').textContent =
    `${t.mmUseSum} (${Money.formatEUR(check.sum, lang)})`;
}

// Salida 1: la diferencia es servicio/cubierto/propina → se añade como una
// línea más, para que se pueda repartir entre la gente como cualquier plato.
document.getElementById('mmAddBtn').addEventListener('click', () => {
  const check = Money.reconcileTicket(ticketData.items, ticketData.total);
  if (check.balanced) return;
  const adj = Money.adjustmentItem(ticketData.items, check.delta,
    check.delta > 0 ? t.adjustmentName : t.discountName);
  ticketData.items.push(adj);
  renderItems();
  updateTotal();
});

// Salida 2: el total del ticket se leyó mal → manda la suma de las líneas.
document.getElementById('mmUseSumBtn').addEventListener('click', () => {
  ticketData.total = Money.itemsSum(ticketData.items);
  updateTotal();
});

document.getElementById('addBtn').addEventListener('click', () => {
  // Los ids nunca se reutilizan: si se borrara la última línea y se añadiera
  // otra, max(ids)+1 devolvería el id recién liberado y las selecciones de la
  // gente acabarían apuntando al plato equivocado.
  nextItemId = Math.max(nextItemId, ...ticketData.items.map(i => +i.id || 0)) + 1;
  ticketData.items.push({ id: nextItemId, name: '', quantity: 1, unitPrice: 0, totalPrice: 0 });
  renderItems();
  const inps = document.querySelectorAll('.e-name');
  if (inps.length) inps[inps.length - 1].focus();
});

/** Señala un campo que hay que rellenar y lleva la vista hasta él. */
function reclamarCampo(input, mensaje) {
  toast(mensaje);
  if (!input) return;
  input.focus();
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  input.animate([
    { transform: 'translateX(0)' }, { transform: 'translateX(-5px)' },
    { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }
  ], { duration: 260 });
}

document.getElementById('shareBtn').addEventListener('click', async () => {
  const btn = document.getElementById('shareBtn');
  if (btn.disabled) return;   // ya se está compartiendo

  // Quién pagó es obligatorio. Sin él nadie sabe a quién devolver el dinero,
  // y además el pagador no se puede marcar en rojo en el reparto.
  const payerInput = document.getElementById('payerInput');
  const payerName = payerInput ? payerInput.value.trim() : '';
  if (!payerName) return reclamarCampo(payerInput, t.needPayer);

  // Cuántos son también: es el divisor de "por persona" y lo que decide
  // cuándo están todos y se puede cerrar la cuenta.
  const pInput = document.getElementById('participantsInput');
  const pVal = pInput ? parseInt(pInput.value, 10) : NaN;
  if (!Number.isFinite(pVal) || pVal < 1) return reclamarCampo(pInput, t.needParticipants);

  // En un grupo no puede haber mas participantes en un ticket que gente en el
  // grupo: si el grupo es de cuatro y el ticket dice cinco, el reparto no
  // cuadra nunca y nadie entiende por que.
  if (topeParticipantes && pVal > topeParticipantes) {
    return reclamarCampo(pInput,
      'El grupo es de ' + topeParticipantes + ' personas, no puede haber más');
  }

  // Segundo cinturón: la pantalla ya bloquea el botón, pero si el descuadre
  // llegara hasta aquí el servidor lo rechaza igualmente.
  const check = Money.reconcileTicket(ticketData.items, ticketData.total);
  if (!check.balanced) {
    toast(check.delta > 0 ? t.mismatchFalta : t.mismatchSobra);
    document.getElementById('mismatch').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Compartir son cuatro peticiones seguidas. Sin aviso ni bloqueo, un toque
  // de más lanzaba dos cadenas a la vez y un fallo de red dejaba la pantalla
  // muerta sin decir nada: era lo que se sentía como "se atasca".
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = t.sharing;

  try {
    const itemsRes = await fetch(`/api/tickets/${ticketId}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: ticketData.items, total: ticketData.total })
    });
    if (!itemsRes.ok) {
      const err = await itemsRes.json().catch(() => ({}));
      throw new Error(err.error || t.itemsLocked);
    }

    // Pagador y participantes son independientes: en paralelo se ahorra un
    // viaje de ida y vuelta, que en móvil se nota.
    await Promise.all([
      fetch(`/api/tickets/${ticketId}/payer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payerName })
      }),
      fetch(`/api/tickets/${ticketId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedParticipants: pVal })
      })
    ]);

    const shareRes = await fetch(`/api/tickets/${ticketId}/share`, { method: 'POST' });
    if (!shareRes.ok) {
      const err = await shareRes.json().catch(() => ({}));
      if (err.reconciliation) {
        ticketData.total = err.reconciliation.total;
        updateTotal();
        document.getElementById('mismatch').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      throw new Error(err.error || t.shareFailed);
    }

    ticketData.status = 'shared';
    ticketData.payerName = payerName;
    ticketData.expectedParticipants = pVal;
    showShare();
  } catch (e) {
    // Un corte de red llega aquí como TypeError('Failed to fetch'), que no le
    // dice nada a nadie. Los mensajes propios sí son útiles y se respetan.
    const esFalloDeRed = e instanceof TypeError;
    toast(esFalloDeRed || !e.message ? t.shareFailed : e.message);
    // Se recupera el botón: el usuario puede volver a intentarlo.
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
});

function showShare() {
  document.getElementById('footer').classList.add('hidden');
  document.getElementById('shareSection').classList.remove('hidden');
  const url = `${location.origin}/t/${ticketId}`;
  document.getElementById('shareUrl').textContent = url;
  document.getElementById('claimMineLink').href = `/t/${ticketId}`;
  document.getElementById('claimMineText').textContent = t.claimMine;

  const nb = document.getElementById('nativeBtn');
  nb.onclick = () => {
    const texto = textoTicketWhatsApp();
    if (navigator.share) {
      navigator.share({ title: 'comparTICKET', text: texto, url }).catch(() => {});
    } else {
      // Se copia el mensaje entero, no solo el enlace pelado.
      navigator.clipboard.writeText(texto + '\n' + url).then(() => toast(t.copied));
    }
  };
}

document.getElementById('copyBtn').addEventListener('click', () => {
  const btn = document.getElementById('copyBtn');
  navigator.clipboard.writeText(document.getElementById('shareUrl').textContent)
    .then(() => {
      const txt = document.getElementById('copyText');
      const original = txt.textContent;
      txt.textContent = t.copied;
      toast(t.copied);
      setTimeout(() => { txt.textContent = original; }, 1600);
    });
});

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

loadTicket();

/**
 * Mensaje para pegar en el chat al compartir un ticket.
 *
 * Si el ticket pertenece a un grupo se dice, porque al pegarlo en el chat del
 * viaje lo primero que hay que saber es de que grupo viene y quien adelanto
 * el dinero. El dedo apunta al enlace, asi que el enlace va debajo y no
 * pegado a su derecha.
 */
function textoTicketWhatsApp() {
  const sitio = (ticketData && ticketData.restaurant) || 'la cuenta';
  const total = ticketData ? Money.formatEUR(ticketData.total, lang) : '';
  const quien = (ticketData && ticketData.payerName) || '';

  if (grupoDelTicket && grupoDelTicket.name) {
    return '\uD83D\uDC65 *' + grupoDelTicket.name + '* — ' + sitio + '\n' +
      (quien ? quien + ' ha pagado ' + total + '.' : total + ' sobre la mesa.') + '\n' +
      'Marca lo que has tomado para saber cuánto le debes.\n' +
      '\uD83D\uDC47';
  }
  return '\uD83E\uDDFE *' + sitio + '* — ' + total + '\n' +
    (quien ? quien + ' ha pagado. ' : '') +
    'Marca lo que has tomado para saber cuánto le debes.\n' +
    '\uD83D\uDC47';
}


/**
 * Quien ha pagado, elegido de la lista del grupo.
 *
 * Es el primer paso despues de escanear, y hasta ahora se escribia a mano
 * incluso dentro de un grupo donde los nombres ya estan decididos. Escribirlos
 * es la puerta por la que "Alvaro", "alvaro" y "Alvarito" acaban siendo tres
 * personas distintas al sumar quince tickets, y el reparto final sale mal sin
 * que nadie llegue a ver por que.
 *
 * El campo de texto no se elimina: se oculta y las pastillas lo rellenan, asi
 * que todo lo que ya dependia de el sigue funcionando igual.
 */
function montarSelectorDePagador() {
  const caja  = document.getElementById('payerPicker');
  const pills = document.getElementById('payerPickerPills');
  const campo = document.querySelector('.payer-field');
  const input = document.getElementById('payerInput');
  if (!caja || !pills || !campo || !input) return;
  if (!grupoDelTicket || !Array.isArray(grupoDelTicket.members) ||
      !grupoDelTicket.members.length) return;

  // La linea de "QUIEN PAGO" se queda donde estaba, con su hueco de puntos:
  // es donde se lee el nombre una vez elegido, igual que cuando se escribia.
  // Lo unico que cambia es que ya no se teclea.
  input.readOnly = true;
  input.placeholder = 'toca un nombre';
  campo.classList.add('con-lista');
  pills.innerHTML = '';

  // Los botones solo estan mientras hacen falta. Con alguien ya elegido
  // sobran, y dejarlos ahi llena la pantalla de nombres que no dicen nada.
  const refrescar = () => {
    const elegido = (input.value || '').trim();
    caja.classList.toggle('hidden', !!elegido);
    pills.querySelectorAll('.who-pill').forEach(b => {
      b.classList.toggle('active', b.dataset.nombre === elegido);
    });
    if (typeof fitTicket === 'function') fitTicket();
  };

  grupoDelTicket.members.forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'who-pill';
    b.dataset.nombre = m.name;
    b.textContent = m.name;
    b.addEventListener('click', () => {
      input.value = m.name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      refrescar();
    });
    pills.appendChild(b);
  });

  // Y para cambiarlo, se toca el nombre: vuelven los botones.
  input.addEventListener('click', () => {
    if (!input.readOnly) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    refrescar();
  });

  // Si este movil ya tiene nombre en el grupo, lo normal es que sea quien
  // acaba de pagar y de escanear: viene puesto, y se cambia con un toque.
  if (!input.value.trim()) {
    let testigo = '';
    try { testigo = localStorage.getItem('ct_tok_' + ticketData.groupId) || ''; } catch (_) {}
    if (testigo) {
      const yo = grupoDelTicket.members.find(m => m.mine);
      if (yo) input.value = yo.name;
    }
  }

  refrescar();
}
