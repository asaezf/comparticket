// comparTICKET — Summary page (online + downloadable ticket share same format)
const params = new URLSearchParams(window.location.search);
const ticketId = params.get('id');
if (!ticketId) window.location.href = '/';

document.getElementById('barTitle').textContent    = t.summaryTitle;
document.getElementById('lblTotal').textContent    = t.total;
document.getElementById('lblPerPerson').textContent = t.perPerson;
document.getElementById('refreshText').textContent = t.refresh;
document.getElementById('downloadText').textContent = t.downloadInvoice;
document.getElementById('closeBtn').textContent    = t.closeBtn;
document.getElementById('shareImgText').textContent = t.shareImage;

let ticketData = null;
let claimsData = [];
// Read creator key stored at ticket creation time (only the device that
// created the ticket has it → only they can close).
function getCreatorKey() {
  try { return localStorage.getItem('ck_' + ticketId); } catch (_) { return null; }
}
function isCreator() { return !!getCreatorKey(); }

async function loadData() {
  const [tRes, cRes] = await Promise.all([
    fetch(`/api/tickets/${ticketId}`),
    fetch(`/api/tickets/${ticketId}/claims`)
  ]);
  if (!tRes.ok) return window.location.href = '/';
  ticketData = await tRes.json();
  claimsData = await cRes.json();

  const d = new Date(ticketData.receiptDate || ticketData.createdAt);
  // Title: restaurant name + address if available
  const titleParts = [(ticketData.restaurant || t.restaurant).toUpperCase()];
  if (ticketData.address) titleParts.push(ticketData.address);
  document.getElementById('ticketTitle').textContent = titleParts.join('\n');
  // Date: use extracted time if available, otherwise omit time
  const datePart = d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    day: '2-digit', month: 'short', year: 'numeric'
  }).toUpperCase();
  const timePart = ticketData.receiptTime || null;
  document.getElementById('ticketDate').textContent =
    timePart ? `${datePart}  ${timePart}` : datePart;

  document.getElementById('ticketTotal').textContent = Money.formatEUR(ticketData.total, lang);

  // Media por persona: se divide entre los participantes esperados, no entre
  // los que han marcado hasta ahora. Con un solo claim, lo segundo mostraba
  // la cuenta entera como si fuera lo que paga cada uno.
  const heads = ticketData.expectedParticipants || claimsData.length || 1;
  document.getElementById('perPerson').textContent =
    Money.formatEUR(ticketData.total / heads, lang);

  renderUnassigned();
  renderPeople();

  if (ticketData.status === 'closed') {
    showClosed();
  }
}

/**
 * Build the "people with breakdown" data structure used by both the
 * online summary and the canvas image. Each person has:
 *   - name, isPayer, total
 *   - items: [{ name, units, amt, sharedWith: [names] }]
 * Payer first, rest ordered by total descending.
 *
 * Per-unit model: for every claimed unit we compute unitPrice / N where N
 * is the number of people who claimed that same unit. Items get collapsed
 * per-person: if a person has two whole units and one half of unit #3, we
 * show "· Cerveza ×2 + ½" + separate rows as needed.
 */
function buildPeopleBreakdown() {
  const itemMap = {};
  ticketData.items.forEach(i => { itemMap[i.id] = i; });

  // Build unit → claimants map: unitClaimants[itemId][unitIdx] = [names]
  const unitClaimants = {};
  claimsData.forEach(c => {
    const units = unitsFromClaim(c);
    Object.keys(units).forEach(id => {
      if (!unitClaimants[id]) unitClaimants[id] = {};
      units[id].forEach(u => {
        if (!unitClaimants[id][u]) unitClaimants[id][u] = [];
        if (!unitClaimants[id][u].includes(c.personName)) unitClaimants[id][u].push(c.personName);
      });
    });
  });

  const people = claimsData.map(claim => {
    const units = unitsFromClaim(claim);
    let total = 0;
    // Collapse each item into { soloUnits, sharedUnits: [{ divider, sharedWith }] }
    const items = Object.keys(units).map(id => {
      const item = itemMap[id];
      if (!item) return null;
      const myUnits = units[id] || [];
      let solo = 0;                // units I consumed alone
      let soloAmt = 0;
      const shared = [];           // one entry per shared unit
      myUnits.forEach(u => {
        const claimants = (unitClaimants[id] && unitClaimants[id][u]) || [claim.personName];
        const divider = Math.max(1, claimants.length);
        const amt = item.unitPrice / divider;
        total += amt;
        if (divider === 1) {
          solo += 1;
          soloAmt += amt;
        } else {
          shared.push({
            divider,
            amt,
            sharedWith: claimants.filter(n => n !== claim.personName)
          });
        }
      });
      return { id, name: item.name, solo, soloAmt, shared };
    }).filter(Boolean);
    return {
      name: claim.personName,
      isPayer: !!claim.isPayer,
      confirmed: claim.confirmed !== false,
      total,
      items
    };
  });

  const payer = people.find(p => p.isPayer);
  const others = people.filter(p => !p.isPayer).sort((a, b) => b.total - a.total);
  return payer ? [payer, ...others] : others;
}

// Normalize a claim to { [itemId]: [unitIdx, ...] }
function unitsFromClaim(claim) {
  const out = {};
  if (claim.itemUnits && typeof claim.itemUnits === 'object') {
    Object.keys(claim.itemUnits).forEach(id => {
      const arr = claim.itemUnits[id];
      if (Array.isArray(arr) && arr.length) out[id] = arr.slice();
    });
    return out;
  }
  // Legacy fallback — assume sequential units
  if (claim.itemCounts) {
    Object.keys(claim.itemCounts).forEach(id => {
      const count = claim.itemCounts[id];
      out[id] = Array.from({ length: count }, (_, u) => u);
    });
  } else if (Array.isArray(claim.itemIds)) {
    claim.itemIds.forEach(id => { out[id] = [0]; });
  }
  return out;
}

function renderPeople() {
  const list = document.getElementById('personList');
  renderProgress();

  if (claimsData.length === 0) {
    list.innerHTML = `<div class="text-center text-gray text-sm" style="padding:18px 0;">${t.noOneYet}</div>`;
    return;
  }

  list.innerHTML = '';
  const ordered = buildPeopleBreakdown();

  ordered.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'person-row' + (p.isPayer ? ' is-payer' : '');
    row.style.animationDelay = `${idx * 0.08}s`;

    const lines = [];
    // Look up original item for unit price details
    const itemMap = {};
    ticketData.items.forEach(i => { itemMap[i.id] = i; });

    p.items.forEach(it => {
      const itemInfo = itemMap[it.id];
      const unitPrice = itemInfo ? itemInfo.unitPrice : 0;
      // Solo units (whole items) line
      if (it.solo > 0) {
        const unitsPart = it.solo > 1 ? ` ×${it.solo}` : '';
        const detail = it.solo > 1
          ? `<div class="pi-detail">${Money.formatEUR(unitPrice, lang)}${esc(t.perUnit)}</div>`
          : '';
        lines.push(`<div class="person-item">
          <div class="pi-main">
            <span class="pi-name">· ${esc(it.name)}${unitsPart}</span>
            <span class="pi-amt">${Money.formatEUR(it.soloAmt, lang)}</span>
          </div>
          ${detail}
        </div>`);
      }
      // One line per shared unit (each can have different sharers)
      it.shared.forEach(sh => {
        const sharedPart = sh.sharedWith.length > 0
          ? ` · ${sh.sharedWith.map(esc).join(', ')}`
          : '';
        lines.push(`<div class="person-item">
          <div class="pi-main">
            <span class="pi-name">· ${esc(it.name)}</span>
            <span class="pi-amt">${Money.formatEUR(sh.amt, lang)}</span>
          </div>
          <div class="pi-detail">${Money.formatEUR(unitPrice, lang)}${esc(t.perUnit)} (1/${sh.divider})${sharedPart}</div>
        </div>`);
      });
    });

    if (!p.confirmed) row.classList.add('is-picking');
    row.innerHTML = `
      <div class="person-head">
        <div class="person-name">${esc(p.name)}${p.isPayer ? `<span class="person-tag">${t.payer}</span>` : ''}${p.confirmed ? '' : `<span class="person-tag picking">${esc(t.stillPicking)}</span>`}</div>
        <span class="person-amount">${Money.formatEUR(p.total, lang)}</span>
      </div>
      <div class="person-items">${lines.join('')}</div>
    `;
    list.appendChild(row);
  });
}

/**
 * El número que faltaba: cuánto del ticket no está pagando nadie.
 * Visible desde el primer claim, no solo al cerrar — al cerrar ya es tarde,
 * la gente se ha ido de la mesa.
 */
function renderUnassigned() {
  const row = document.getElementById('unassignedRow');
  const label = document.getElementById('lblUnassigned');
  const value = document.getElementById('unassignedVal');
  const check = Money.reconcileClaims(ticketData.items, ticketData.total, claimsData);

  row.classList.toggle('is-clear', check.balanced);
  label.textContent = check.balanced ? t.allAssigned : t.unassigned;
  value.textContent = check.balanced ? '0,00€' : Money.formatEUR(check.pending, lang);
  return check;
}

function renderProgress() {
  const el = document.getElementById('participantsProgress');
  const closeBtn = document.getElementById('closeBtn');
  const bottomArea = document.getElementById('bottomArea');
  const creator = isCreator();

  // Only the creator sees the close button — guests see the progress only
  if (bottomArea) bottomArea.classList.toggle('hidden', !creator || (ticketData && ticketData.status === 'closed'));

  // No se cierra una cuenta con dinero sin asignar, hayan participado todos
  // o no: lo que quede suelto se lo come el pagador sin enterarse.
  const money = Money.reconcileClaims(ticketData.items, ticketData.total, claimsData);
  const expected = ticketData && ticketData.expectedParticipants;
  // Solo cuenta quien ha confirmado: alguien a medias puede irse sin terminar.
  const ready = Money.confirmedOnly(claimsData).length;
  const everyone = !expected || ready >= expected;
  const canClose = money.balanced && everyone && ticketData.status !== 'closed';

  if (closeBtn) {
    closeBtn.disabled = !canClose;
    closeBtn.title = !money.balanced
      ? t.cantCloseUnassigned.replace('{x}', money.pending.toFixed(2))
      : (everyone ? '' : t.waitingParticipants);
  }

  if (!el) return;
  if (!expected) { el.classList.add('hidden'); return; }

  el.classList.remove('hidden');
  el.classList.toggle('complete', everyone);
  const picking = claimsData.length - ready;
  const label = everyone
    ? t.allReady
    : (picking > 0 ? `${picking} ${t.stillPicking}` : `${t.waitingFor} ${Math.max(0, expected - ready)}`);
  el.innerHTML = `
    <span class="pp-label">${esc(t.participantsShort)}</span>
    <span class="pp-count">${ready} ${esc(t.ofN)} ${expected}</span>
    <span class="pp-state">${esc(label)}</span>
  `;
}

function showClosed() {
  document.getElementById('bottomArea').classList.add('hidden');
  document.getElementById('closedArea').classList.remove('hidden');
  document.getElementById('actionBtns').classList.add('hidden');
}

// Refresh data
document.getElementById('refreshBtn').addEventListener('click', loadData);

// Actualización automática: quien creó el ticket se queda mirando esta
// pantalla mientras los demás eligen, así que se refresca sola. Consulta el
// contador de versión (una lectura) y solo recarga cuando algo ha cambiado.
let lastVersion = -1;
async function checkForUpdates() {
  if (ticketData && ticketData.status === 'closed') return;
  try {
    const r = await fetch(`/api/tickets/${ticketId}/pulse`);
    if (!r.ok) return;
    const { v } = await r.json();
    if (v === lastVersion) return;
    lastVersion = v;
    await loadData();
  } catch (_) {}
}
setInterval(() => { if (!document.hidden) checkForUpdates(); }, 3000);
// Volver de otra app refresca al instante, sin esperar al siguiente ciclo.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkForUpdates();
});

// Build a sanitised filename using restaurant + receipt date
function buildFilename() {
  const rest = (ticketData && ticketData.restaurant) || 'ticket';
  const d = new Date((ticketData && (ticketData.receiptDate || ticketData.createdAt)) || Date.now());
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const slug = rest.toString().toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'ticket';
  return `comparticket-${slug}-${yyyy}${mm}${dd}.png`;
}

// Download invoice = generate image + download
document.getElementById('downloadBtn').addEventListener('click', async () => {
  // generateImage espera a que la tipografía esté lista, así que hay que
  // esperarla: si no, se descargaba el canvas todavía en blanco.
  await generateImage();
  const canvas = document.getElementById('shareCanvas');
  const link = document.createElement('a');
  link.download = buildFilename();
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// Close bill → confetti + generate image (only when all participants joined)
// Only the creator (device that created the ticket) can close — the server
// validates the creatorKey and returns 403 otherwise.
document.getElementById('closeBtn').addEventListener('click', async () => {
  if (!isCreator()) {
    toast(t.onlyCreatorCanClose || 'Only the ticket creator can close it');
    return;
  }
  const expected = ticketData && ticketData.expectedParticipants;
  if (expected && claimsData.length < expected) {
    toast(t.waitingParticipants);
    return;
  }
  const pre = Money.reconcileClaims(ticketData.items, ticketData.total, claimsData);
  if (!pre.balanced) {
    toast(t.cantCloseUnassigned.replace('{x}', pre.pending.toFixed(2)));
    return;
  }
  const res = await fetch(`/api/tickets/${ticketId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creatorKey: getCreatorKey() })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast(err.error || t.onlyCreatorCanClose || 'Only the ticket creator can close it');
    if (err.code === 'UNBALANCED_CLAIMS') { renderUnassigned(); renderProgress(); }
    return;
  }
  ticketData.status = 'closed';
  showClosed();
  showConfetti();
  await generateImage();
  toast(t.closedMsg);
});

// Share top button (share claim link)
document.getElementById('shareTopBtn').addEventListener('click', () => {
  const url = `${location.origin}/t/${ticketId}`;
  if (navigator.share) {
    navigator.share({ title: 'comparTICKET', url });
  } else {
    navigator.clipboard.writeText(url).then(() => toast(t.copied));
  }
});

// Share image
document.getElementById('shareImgBtn').addEventListener('click', async () => {
  await generateImage();
  const canvas = document.getElementById('shareCanvas');
  canvas.toBlob(async blob => {
    const fname = buildFilename();
    const file = new File([blob], fname, { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ title: 'comparTICKET', files: [file] }); } catch {}
    } else {
      const link = document.createElement('a');
      link.download = fname;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  }, 'image/png');
});

// ===================== CANVAS IMAGE GENERATION =====================
// Mirrors the online summary exactly: black text, payer in red with PAGADOR
// pill, no avatar circles, itemized breakdown, sorted by amount desc.
async function generateImage() {
  const wrap = document.getElementById('shareImgWrap');
  wrap.classList.remove('hidden');
  const canvas = document.getElementById('shareCanvas');

  // Sin esperar a la fuente, en una conexión lenta el canvas dibuja con la
  // tipografía de reserva y la imagen sale con otra cara. En pantalla no se
  // nota porque el texto se repinta solo; en un canvas queda congelado.
  try { await document.fonts.ready; } catch (_) {}

  // 3× en vez de 2×: la imagen acaba en WhatsApp, que la recomprime, así que
  // conviene entregarla con margen de resolución.
  const SCALE = 3;
  const W = 600, P = 44, LH = 20, DETAIL_H = 15;
  const RED = '#DC2626';
  const BLACK = '#18181B';
  const GRAY = '#71717A';
  const GRAY_LIGHT = '#A1A1AA';
  const PAPER = '#FFFEF8';
  const EDGE = '#ECEAE4';

  const ordered = buildPeopleBreakdown();
  const eur = n => Money.formatEUR(n, lang);
  const itemMap = {};
  ticketData.items.forEach(i => { itemMap[i.id] = i; });

  /**
   * Un solo recorrido que sirve para medir y para dibujar.
   *
   * Antes la altura se calculaba aparte, con sus propias constantes, y se
   * desviaba del dibujo real: sobraban unos 60 px y el ticket quedaba
   * descolgado con un hueco muerto debajo. Midiendo con el mismo código que
   * dibuja, la altura es exacta por construcción y no se puede volver a
   * desincronizar.
   */
  function layout(ctx) {
    const on = !!ctx;
    const text = (s, x, yy, align) => { if (on) { ctx.textAlign = align || 'left'; ctx.fillText(s, x, yy); } };
    const font = f => { if (on) ctx.font = f; };
    const fill = c => { if (on) ctx.fillStyle = c; };

    let y = 50;

    // ---- Cabecera ----
    fill(BLACK); font('700 13px "Space Mono", monospace');
    text((ticketData.restaurant || t.restaurant).toUpperCase(), W / 2, y, 'center');
    y += 16;
    if (ticketData.address) {
      font('400 9px "Space Mono", monospace'); fill(GRAY);
      text(ticketData.address, W / 2, y, 'center');
      y += 14;
    }
    const d = new Date(ticketData.receiptDate || ticketData.createdAt);
    font('400 10px "Space Mono", monospace'); fill(GRAY);
    const datePart = d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US',
      { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    text(ticketData.receiptTime ? `${datePart}   ${ticketData.receiptTime}` : datePart, W / 2, y, 'center');
    y += 24;

    if (on) drawDash(ctx, P, y, W - P, y);
    y += 28;

    // ---- Total ----
    font('400 12px "Space Mono", monospace'); fill('#52525B');
    text(t.total, P, y);
    font('700 20px "Space Mono", monospace'); fill(BLACK);
    text(eur(ticketData.total), W - P, y, 'right');
    y += 28;

    if (on) drawDash(ctx, P, y, W - P, y);
    y += 28;

    // ---- Personas ----
    ordered.forEach(p => {
      const color = p.isPayer ? RED : BLACK;

      font('700 14px "Space Mono", monospace'); fill(color);
      text(p.name, P, y + 2);

      if (p.isPayer && on) {
        ctx.font = '700 14px "Space Mono", monospace';
        const nameWidth = ctx.measureText(p.name).width;
        ctx.font = '800 9px "Space Mono", monospace';
        const pillW = ctx.measureText(t.payer).width + 14;
        const pillX = P + nameWidth + 8, pillY = y - 8;
        roundRect(ctx, pillX, pillY, pillW, 14, 4);
        ctx.fillStyle = RED; ctx.fill();
        ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center';
        ctx.fillText(t.payer, pillX + pillW / 2, pillY + 10);
      }

      font('700 15px "Space Mono", monospace'); fill(color);
      text(eur(p.total), W - P, y + 2, 'right');
      y += 22;

      p.items.forEach(item => {
        const info = itemMap[item.id];
        const unitPrice = info ? info.unitPrice : 0;

        if (item.solo > 0) {
          fill(GRAY); font('400 10px "Space Mono", monospace');
          text('· ' + item.name + (item.solo > 1 ? ` ×${item.solo}` : ''), P + 12, y);
          text(eur(item.soloAmt), W - P, y, 'right');
          y += LH;
          if (item.solo > 1) {
            fill(GRAY_LIGHT); font('italic 400 9px "Space Mono", monospace');
            text(`    ${eur(unitPrice)}${t.perUnit}`, P + 12, y);
            y += DETAIL_H;
          }
        }

        (item.shared || []).forEach(sh => {
          fill(GRAY); font('400 10px "Space Mono", monospace');
          text(`· ${item.name}`, P + 12, y);
          text(eur(sh.amt), W - P, y, 'right');
          y += LH;
          fill(GRAY_LIGHT); font('italic 400 9px "Space Mono", monospace');
          const con = sh.sharedWith.length ? ` · ${sh.sharedWith.join(', ')}` : '';
          text(`    ${eur(unitPrice)}${t.perUnit} (1/${sh.divider})${con}`, P + 12, y);
          y += DETAIL_H;
        });
      });

      if (on) {
        ctx.strokeStyle = '#E4E4E7';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(P, y + 2); ctx.lineTo(W - P, y + 2); ctx.stroke();
      }
      y += 18;
    });

    // ---- Pie ----
    // Solo el dominio. El crédito personal se queda en la web: esta imagen la
    // ven desconocidos en un grupo de WhatsApp.
    y += 14;
    font('400 9px "Space Mono", monospace'); fill('#C7C7CC');
    text(location.hostname.replace(/^www\./, ''), W / 2, y, 'center');
    y += 24;   // margen antes del borde dentado

    return y;
  }

  // Paso 1: medir con un contexto de usar y tirar. Paso 2: dibujar.
  const probe = document.createElement('canvas').getContext('2d');
  const H = Math.ceil(layout(probe));

  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  layout(ctx);

  // Muescas laterales: media luna limpia del color del fondo, para que se lean
  // como el troquelado de un ticket y no como una mancha.
  ctx.fillStyle = EDGE;
  [H * 0.32, H * 0.68].forEach(ny => {
    ctx.beginPath(); ctx.arc(0, ny, 11, -Math.PI / 2, Math.PI / 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W, ny, 11, Math.PI / 2, -Math.PI / 2); ctx.fill();
  });

  // Borde dentado inferior, en una sola figura para que no queden costuras.
  const zz = 10;
  ctx.fillStyle = EDGE;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x < W; x += zz * 2) {
    ctx.lineTo(x + zz, H - zz);
    ctx.lineTo(x + zz * 2, H);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawDash(ctx, x1, y1, x2, y2) {
  ctx.strokeStyle = '#D4D4D8';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ===================== CONFETTI =====================
function showConfetti() {
  const c = document.getElementById('confetti');
  c.classList.remove('hidden');
  c.innerHTML = '';
  const cols = ['#2563EB','#16A34A','#DC2626','#9333EA','#EA580C','#FBBF24'];
  for (let i = 0; i < 55; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-bit';
    p.style.left = Math.random() * 100 + '%';
    p.style.background = cols[Math.floor(Math.random() * cols.length)];
    p.style.animationDelay = Math.random() * 1.5 + 's';
    p.style.animationDuration = (2.5 + Math.random() * 2) + 's';
    p.style.width  = (4 + Math.random() * 8) + 'px';
    p.style.height = (4 + Math.random() * 8) + 'px';
    p.style.borderRadius = ['50%', '2px', '0'][Math.floor(Math.random() * 3)];
    c.appendChild(p);
  }
  setTimeout(() => c.classList.add('hidden'), 4500);
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

loadData();
