// comparTICKET — Claim page (per-unit picking)
// Each item exposes one pill per unit. Tapping a pill toggles whether
// the current user consumed that specific unit. If multiple users tap the
// same unit, it becomes "shared" and the price is split among them.
const params = new URLSearchParams(window.location.search);
const ticketId = params.get('id');
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

let ticketData = null;
let claimsData = [];
// myUnits: { [itemId]: Set<unitIdx> }
const myUnits = {};

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

  renderItems();
  update();
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

// If user types a name that matches an existing claim, prefill their picks
function prefillMineFromName() {
  const mine = myNameNormalized();
  if (!mine) return false;
  const prev = claimsData.find(c => (c.personName || '').trim().toLowerCase() === mine);
  if (!prev) return false;
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
      <div class="ci-price">${item.unitPrice.toFixed(2)}€ ${esc(t.perUnit)}</div>
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
  const itemId = +pill.dataset.itemId;
  const u = +pill.dataset.unit;
  if (!myUnits[itemId]) myUnits[itemId] = new Set();
  if (myUnits[itemId].has(u)) myUnits[itemId].delete(u);
  else myUnits[itemId].add(u);
  if (myUnits[itemId].size === 0) delete myUnits[itemId];

  // Refresh this row
  const row = pill.closest('.claim-row-v2');
  const item = ticketData.items.find(i => String(i.id) === String(itemId));
  if (row && item) refreshPills(row, item);
  update();
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
  document.getElementById('yourTotal').textContent = `${tot.toFixed(2)}€`;

  const name = document.getElementById('nameInput').value.trim();
  const anyPicked = Object.values(myUnits).some(s => s && s.size > 0);
  document.getElementById('confirmBtn').disabled = !name || !anyPicked;
}

document.getElementById('nameInput').addEventListener('input', () => {
  const prefilled = prefillMineFromName();
  // Re-render to reflect "mine vs theirs" reclassification
  renderItems();
  update();
});

document.getElementById('confirmBtn').addEventListener('click', async () => {
  const name = document.getElementById('nameInput').value.trim();
  const itemUnitsPayload = {};
  Object.keys(myUnits).forEach(id => {
    const arr = [...myUnits[id]].sort((a, b) => a - b);
    if (arr.length > 0) itemUnitsPayload[id] = arr;
  });
  if (!name || Object.keys(itemUnitsPayload).length === 0) return;

  const btn = document.getElementById('confirmBtn');
  btn.disabled = true;

  try {
    await fetch(`/api/tickets/${ticketId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName: name, itemUnits: itemUnitsPayload })
    });
    window.location.href = `/summary.html?id=${ticketId}`;
  } catch (err) {
    btn.disabled = false;
  }
});

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

loadTicket();
