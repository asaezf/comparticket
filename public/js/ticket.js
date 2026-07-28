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

  if (ticketData.status === 'shared' || ticketData.status === 'closed') {
    showShare();
  }
}

function renderItems() {
  const list = document.getElementById('itemsList');
  list.innerHTML = '';
  ticketData.items.forEach((item, idx) => {
    const lineTotal = (item.quantity * item.unitPrice).toFixed(2);
    const row = document.createElement('div');
    row.className = 'edit-row';
    row.style.animationDelay = `${0.12 + idx * 0.08}s`;
    row.innerHTML = `
      <textarea class="e-name" rows="1" placeholder="${t.itemName || 'Ítem'}" data-i="${idx}" data-f="name">${esc(item.name)}</textarea>
      <input class="e-qty"  type="number" value="${item.quantity}" min="1" data-i="${idx}" data-f="quantity">
      <input class="e-price" type="number" value="${item.unitPrice.toFixed(2)}" step="0.01" min="0" data-i="${idx}" data-f="unitPrice">
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

document.getElementById('shareBtn').addEventListener('click', async () => {
  // Validate participants count
  const pInput = document.getElementById('participantsInput');
  const pVal = pInput ? parseInt(pInput.value, 10) : NaN;
  if (!Number.isFinite(pVal) || pVal < 1) {
    toast(t.needParticipants);
    if (pInput) {
      pInput.focus();
      pInput.animate([
        { transform: 'translateX(0)' },
        { transform: 'translateX(-5px)' },
        { transform: 'translateX(5px)' },
        { transform: 'translateX(0)' }
      ], { duration: 260 });
    }
    return;
  }

  // Segundo cinturón: la pantalla ya bloquea el botón, pero si el descuadre
  // llegara hasta aquí el servidor lo rechaza igualmente.
  const check = Money.reconcileTicket(ticketData.items, ticketData.total);
  if (!check.balanced) {
    toast(check.delta > 0 ? t.mismatchFalta : t.mismatchSobra);
    document.getElementById('mismatch').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const itemsRes = await fetch(`/api/tickets/${ticketId}/items`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: ticketData.items, total: ticketData.total })
  });
  if (!itemsRes.ok) {
    const err = await itemsRes.json().catch(() => ({}));
    return toast(err.error || t.itemsLocked);
  }
  // Save payer
  const payerInput = document.getElementById('payerInput');
  const payerName = payerInput ? payerInput.value.trim() : '';
  await fetch(`/api/tickets/${ticketId}/payer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payerName })
  });
  // Save participants
  await fetch(`/api/tickets/${ticketId}/participants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedParticipants: pVal })
  });
  const shareRes = await fetch(`/api/tickets/${ticketId}/share`, { method: 'POST' });
  if (!shareRes.ok) {
    const err = await shareRes.json().catch(() => ({}));
    if (err.reconciliation) {
      ticketData.total = err.reconciliation.total;
      updateTotal();
      document.getElementById('mismatch').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return toast(err.error || 'No se ha podido compartir');
  }
  ticketData.status = 'shared';
  ticketData.payerName = payerName;
  ticketData.expectedParticipants = pVal;
  showShare();
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
    if (navigator.share) {
      navigator.share({ title: 'comparTICKET', text: t.shareHint, url }).catch(() => {});
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(url).then(() => toast(t.copied));
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
