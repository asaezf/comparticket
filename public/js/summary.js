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
  document.getElementById('ticketTitle').textContent =
    (ticketData.restaurant || t.restaurant).toUpperCase();
  document.getElementById('ticketDate').textContent =
    d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
      day: '2-digit', month: 'short', year: 'numeric'
    }).toUpperCase() + '  ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  document.getElementById('ticketTotal').textContent = `${ticketData.total.toFixed(2)}€`;

  // Per person average
  const pp = claimsData.length > 0
    ? ticketData.total / claimsData.length
    : ticketData.total;
  document.getElementById('perPerson').textContent = `${pp.toFixed(2)}€`;

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
          ? `<div class="pi-detail">${unitPrice.toFixed(2)}€ ${esc(t.perUnit)}</div>`
          : '';
        lines.push(`<div class="person-item">
          <div class="pi-main">
            <span class="pi-name">· ${esc(it.name)}${unitsPart}</span>
            <span class="pi-amt">${it.soloAmt.toFixed(2)}€</span>
          </div>
          ${detail}
        </div>`);
      }
      // One line per shared unit (each can have different sharers)
      it.shared.forEach(sh => {
        const sharedPart = sh.sharedWith.length > 0
          ? ` · ${esc(t.sharedWith)} ${sh.sharedWith.map(esc).join(', ')}`
          : '';
        lines.push(`<div class="person-item">
          <div class="pi-main">
            <span class="pi-name">· ${esc(it.name)}</span>
            <span class="pi-amt">${sh.amt.toFixed(2)}€</span>
          </div>
          <div class="pi-detail">${unitPrice.toFixed(2)}€ ${esc(t.perUnit)} · (1/${sh.divider})${sharedPart}</div>
        </div>`);
      });
    });

    row.innerHTML = `
      <div class="person-head">
        <div class="person-name">${esc(p.name)}${p.isPayer ? `<span class="person-tag">${t.payer}</span>` : ''}</div>
        <span class="person-amount">${p.total.toFixed(2)}€</span>
      </div>
      <div class="person-items">${lines.join('')}</div>
    `;
    list.appendChild(row);
  });
}

function renderProgress() {
  const el = document.getElementById('participantsProgress');
  const closeBtn = document.getElementById('closeBtn');
  const bottomArea = document.getElementById('bottomArea');
  const creator = isCreator();

  // Only the creator sees the close button — guests see the progress only
  if (bottomArea) bottomArea.classList.toggle('hidden', !creator || (ticketData && ticketData.status === 'closed'));

  if (!el) return;
  const expected = ticketData && ticketData.expectedParticipants;
  if (!expected) {
    el.classList.add('hidden');
    if (closeBtn) closeBtn.disabled = false;
    return;
  }
  el.classList.remove('hidden');
  const count = claimsData.length;
  const complete = count >= expected;
  el.classList.toggle('complete', complete);
  const label = complete
    ? t.allReady
    : `${t.waitingFor} ${Math.max(0, expected - count)}`;
  el.innerHTML = `
    <span class="pp-label">${esc(t.participantsShort)}</span>
    <span class="pp-count">${count} ${esc(t.ofN)} ${expected}</span>
    <span class="pp-state">${esc(label)}</span>
  `;
  if (closeBtn) {
    closeBtn.disabled = !complete || ticketData.status === 'closed';
    closeBtn.title = complete ? '' : t.waitingParticipants;
  }
}

function showClosed() {
  document.getElementById('bottomArea').classList.add('hidden');
  document.getElementById('closedArea').classList.remove('hidden');
  document.getElementById('actionBtns').classList.add('hidden');
}

// Refresh data
document.getElementById('refreshBtn').addEventListener('click', loadData);

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
document.getElementById('downloadBtn').addEventListener('click', () => {
  generateImage();
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
  const res = await fetch(`/api/tickets/${ticketId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creatorKey: getCreatorKey() })
  });
  if (!res.ok) {
    toast(t.onlyCreatorCanClose || 'Only the ticket creator can close it');
    return;
  }
  ticketData.status = 'closed';
  showClosed();
  showConfetti();
  generateImage();
  toast(t.closedMsg);
});

// Share top button (share claim link)
document.getElementById('shareTopBtn').addEventListener('click', () => {
  const url = `${location.origin}/claim.html?id=${ticketId}`;
  if (navigator.share) {
    navigator.share({ title: 'comparTICKET', url });
  } else {
    navigator.clipboard.writeText(url).then(() => toast(t.copied));
  }
});

// Share image
document.getElementById('shareImgBtn').addEventListener('click', async () => {
  generateImage();
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
function generateImage() {
  const wrap = document.getElementById('shareImgWrap');
  wrap.classList.remove('hidden');
  const canvas = document.getElementById('shareCanvas');
  const ctx = canvas.getContext('2d');
  const W = 600, P = 44, LH = 20;
  const RED = '#DC2626';
  const BLACK = '#18181B';
  const GRAY = '#71717A';
  const GRAY_LIGHT = '#A1A1AA';

  const ordered = buildPeopleBreakdown();

  // ---- Compute canvas height ----
  // Each solo>1 or each shared entry adds one extra "detail" sub-line (LH - 4)
  const DETAIL_H = 14;
  let H = 50 + 20 + 24 + 28 + 28 + 28;
  ordered.forEach(p => {
    let lineCount = 0;
    let detailCount = 0;
    p.items.forEach(it => {
      if (it.solo > 0) {
        lineCount += 1;
        if (it.solo > 1) detailCount += 1;
      }
      if (it.shared) {
        lineCount += it.shared.length;
        detailCount += it.shared.length;
      }
    });
    H += 32 + Math.max(1, lineCount) * LH + detailCount * DETAIL_H + 16;
  });
  H += 70; // footer padding + easter egg

  canvas.width = W;
  canvas.height = H;

  // Paper background
  ctx.fillStyle = '#FFFEF8';
  ctx.fillRect(0, 0, W, H);

  let y = 50;

  // ---- Header (restaurant + date) ----
  ctx.fillStyle = BLACK;
  ctx.font = '700 13px "Space Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText((ticketData.restaurant || t.restaurant).toUpperCase(), W / 2, y);
  y += 20;

  const d = new Date(ticketData.receiptDate || ticketData.createdAt);
  ctx.font = '400 10px "Space Mono", monospace';
  ctx.fillStyle = GRAY;
  ctx.fillText(
    d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() +
    '   ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    W / 2, y
  );
  y += 24;

  drawDash(ctx, P, y, W - P, y); y += 28;

  // ---- Total ----
  ctx.textAlign = 'left';
  ctx.font = '400 12px "Space Mono", monospace';
  ctx.fillStyle = '#52525B';
  ctx.fillText(t.total, P, y);
  ctx.textAlign = 'right';
  ctx.font = '700 20px "Space Mono", monospace';
  ctx.fillStyle = BLACK;
  ctx.fillText(`${ticketData.total.toFixed(2)}€`, W - P, y);
  y += 28;

  drawDash(ctx, P, y, W - P, y); y += 28;

  // ---- People ----
  ordered.forEach(p => {
    const color = p.isPayer ? RED : BLACK;

    // Name (no avatar)
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.font = '700 14px "Space Mono", monospace';
    ctx.fillText(p.name, P, y + 2);

    // PAGADOR pill
    if (p.isPayer) {
      const nameWidth = ctx.measureText(p.name).width;
      const pillText = t.payer;
      ctx.font = '800 9px "Space Mono", monospace';
      const pillW = ctx.measureText(pillText).width + 14;
      const pillH = 14;
      const pillX = P + nameWidth + 8;
      const pillY = y - 8;
      // rounded rectangle
      roundRect(ctx, pillX, pillY, pillW, pillH, 4);
      ctx.fillStyle = RED;
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.fillText(pillText, pillX + pillW / 2, pillY + 10);
    }

    // Total amount on right
    ctx.textAlign = 'right';
    ctx.font = '700 15px "Space Mono", monospace';
    ctx.fillStyle = color;
    ctx.fillText(`${p.total.toFixed(2)}€`, W - P, y + 2);

    y += 22;

    // Items — look up original item for per-unit price
    const itemMap = {};
    ticketData.items.forEach(i => { itemMap[i.id] = i; });

    ctx.font = '400 10px "Space Mono", monospace';
    p.items.forEach(item => {
      const info = itemMap[item.id];
      const unitPrice = info ? info.unitPrice : 0;
      // Solo line (whole units)
      if (item.solo > 0) {
        ctx.fillStyle = GRAY;
        ctx.textAlign = 'left';
        const unitsPart = item.solo > 1 ? ` ×${item.solo}` : '';
        ctx.fillText('· ' + item.name + unitsPart, P + 12, y);
        ctx.textAlign = 'right';
        ctx.fillText(`${item.soloAmt.toFixed(2)}€`, W - P, y);
        y += LH;
        if (item.solo > 1) {
          ctx.textAlign = 'left';
          ctx.fillStyle = GRAY_LIGHT;
          ctx.font = 'italic 400 9px "Space Mono", monospace';
          ctx.fillText(`    ${unitPrice.toFixed(2)}€ ${t.perUnit}`, P + 12, y);
          ctx.font = '400 10px "Space Mono", monospace';
          y += DETAIL_H;
        }
      }
      // One line per shared unit
      (item.shared || []).forEach(sh => {
        ctx.fillStyle = GRAY;
        ctx.textAlign = 'left';
        ctx.fillText(`· ${item.name}`, P + 12, y);
        ctx.textAlign = 'right';
        ctx.fillText(`${sh.amt.toFixed(2)}€`, W - P, y);
        y += LH;
        // Sub-detail
        ctx.textAlign = 'left';
        ctx.fillStyle = GRAY_LIGHT;
        ctx.font = 'italic 400 9px "Space Mono", monospace';
        const shared = sh.sharedWith.length > 0
          ? ` · ${t.sharedWith} ${sh.sharedWith.join(', ')}`
          : '';
        ctx.fillText(`    ${unitPrice.toFixed(2)}€ ${t.perUnit} · (1/${sh.divider})${shared}`, P + 12, y);
        ctx.font = '400 10px "Space Mono", monospace';
        y += DETAIL_H;
      });
    });

    // Separator between people
    ctx.strokeStyle = '#E4E4E7';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(P, y + 2);
    ctx.lineTo(W - P, y + 2);
    ctx.stroke();
    y += 16;
  });

  // ---- Footer ----
  y += 10;
  ctx.textAlign = 'center';
  ctx.font = '400 9px "Space Mono", monospace';
  ctx.fillStyle = '#D4D4D8';
  ctx.fillText('comparticket.app', W / 2, y);
  y += 11;
  ctx.font = 'italic 400 7px "Space Mono", monospace';
  ctx.fillStyle = '#E4E4E7';
  ctx.fillText('por alvaro saez ;)', W / 2, y);

  // Side notches
  ctx.fillStyle = '#ECEAE4';
  [H * 0.3, H * 0.65].forEach(ny => {
    ctx.beginPath(); ctx.arc(0, ny, 14, -Math.PI / 2, Math.PI / 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W, ny, 14, Math.PI / 2, -Math.PI / 2); ctx.fill();
  });

  // Zigzag bottom
  const zz = 10;
  ctx.fillStyle = '#ECEAE4';
  for (let x = 0; x < W; x += zz * 2) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + zz, H - zz);
    ctx.lineTo(x + zz * 2, H);
    ctx.closePath();
    ctx.fill();
  }
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
