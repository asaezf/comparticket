// comparTICKET — Ticket review & edit
const params = new URLSearchParams(window.location.search);
const ticketId = params.get('id');
if (!ticketId) window.location.href = '/';

// i18n labels
document.getElementById('barTitle').textContent    = t.editTitle;
document.getElementById('addBtn').textContent      = t.addItem;
document.getElementById('lblTotal').textContent    = t.total;
document.getElementById('shareBtn').textContent    = t.shareBtn;
document.getElementById('shareTitle').textContent  = t.shareTitle;
document.getElementById('shareHint').textContent   = t.shareHint;
document.getElementById('summaryLink').textContent = t.viewSummary;
document.getElementById('lblItem').textContent     = t.colItem;
document.getElementById('lblQty').textContent      = t.colQty;
document.getElementById('lblUnit').textContent     = t.colUnit;
document.getElementById('lblTotal2').textContent   = t.colTotal;
document.getElementById('copyText').textContent    = t.copyLink;
document.getElementById('nativeText').textContent  = t.share;
document.getElementById('payerLabel').textContent  = t.payerLabel;
document.getElementById('participantsLabel').textContent = t.participants;

let ticketData = null;

async function loadTicket() {
  const res = await fetch(`/api/tickets/${ticketId}`);
  if (!res.ok) return window.location.href = '/';
  ticketData = await res.json();

  const d = new Date(ticketData.receiptDate || ticketData.createdAt);
  document.getElementById('ticketTitle').textContent =
    (ticketData.restaurant || t.restaurant).toUpperCase();
  document.getElementById('ticketDate').textContent =
    d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
      day: '2-digit', month: 'short', year: 'numeric'
    }).toUpperCase() + '  ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
      <span class="e-total">${lineTotal}€</span>
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
    if (totalSpan) totalSpan.textContent = `${ticketData.items[i].totalPrice.toFixed(2)}€`;
  }
  updateTotal();
}

function onDel(e) {
  ticketData.items.splice(+e.target.dataset.i, 1);
  renderItems();
  updateTotal();
}

function updateTotal() {
  const tot = ticketData.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  ticketData.total = tot;
  document.getElementById('totalVal').textContent = `${tot.toFixed(2)}€`;
}

document.getElementById('addBtn').addEventListener('click', () => {
  const newId = Math.max(0, ...ticketData.items.map(i => i.id)) + 1;
  ticketData.items.push({ id: newId, name: '', quantity: 1, unitPrice: 0, totalPrice: 0 });
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

  await fetch(`/api/tickets/${ticketId}/items`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: ticketData.items, total: ticketData.total })
  });
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
  await fetch(`/api/tickets/${ticketId}/share`, { method: 'POST' });
  ticketData.status = 'shared';
  ticketData.payerName = payerName;
  ticketData.expectedParticipants = pVal;
  showShare();
});

function showShare() {
  document.getElementById('footer').classList.add('hidden');
  document.getElementById('shareSection').classList.remove('hidden');
  const url = `${location.origin}/claim.html?id=${ticketId}`;
  document.getElementById('shareUrl').textContent = url;
  document.getElementById('summaryLink').href = `/summary.html?id=${ticketId}`;
  document.getElementById('claimMineLink').href = `/claim.html?id=${ticketId}`;
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
