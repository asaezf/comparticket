// comparTICKET — Upload page (multi-image)
document.getElementById('uploadTitle').textContent = t.uploadTitle;
document.getElementById('uploadSub').textContent = t.uploadHint;
document.getElementById('retakeText').textContent = t.retakeBtn;
document.getElementById('scanText').textContent = t.scanBtn;
document.getElementById('procText').textContent = t.processing;
document.getElementById('tutText1').textContent = t.tut1;
document.getElementById('tutText2').textContent = t.tut2;
document.getElementById('tutText3').textContent = t.tut3;
const addHint = document.getElementById('addHintText');
if (addHint) addHint.textContent = t.addMore;

const cameraBtn = document.getElementById('cameraBtn');
const fileInput = document.getElementById('fileInput');
const uploadArea = document.getElementById('uploadArea');
const previewOverlay = document.getElementById('previewOverlay');
const previewThumbs = document.getElementById('previewThumbs');
const scanBtn = document.getElementById('scanBtn');
const retakeBtn = document.getElementById('retakeBtn');
const proc = document.getElementById('processing');

let files = []; // File[]

cameraBtn.addEventListener('click', () => {
  fileInput.value = '';
  fileInput.click();
});

fileInput.addEventListener('change', e => {
  if (!e.target.files.length) return;
  [...e.target.files].forEach(f => addFile(f));
  renderThumbs();
  fileInput.value = '';
  uploadArea.classList.add('hidden');
  previewOverlay.classList.remove('hidden');
});

function addFile(file) {
  if (files.length >= 6) return;
  files.push(file);
}

function removeFile(idx) {
  files.splice(idx, 1);
  renderThumbs();
  if (files.length === 0) {
    previewOverlay.classList.add('hidden');
    uploadArea.classList.remove('hidden');
  }
}

function renderThumbs() {
  previewThumbs.innerHTML = '';
  files.forEach((file, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.readAsDataURL(file);
    thumb.appendChild(img);

    const rm = document.createElement('button');
    rm.className = 'thumb-rm';
    rm.type = 'button';
    rm.textContent = '×';
    rm.setAttribute('aria-label', 'Quitar');
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(idx);
    });
    thumb.appendChild(rm);
    previewThumbs.appendChild(thumb);
  });

  // Add-another tile (only if under limit)
  if (files.length < 6) {
    const add = document.createElement('button');
    add.className = 'thumb-add';
    add.type = 'button';
    add.textContent = '+';
    add.setAttribute('aria-label', t.addMore);
    add.addEventListener('click', () => fileInput.click());
    previewThumbs.appendChild(add);
  }
}

retakeBtn.addEventListener('click', () => {
  previewOverlay.classList.add('hidden');
  uploadArea.classList.remove('hidden');
  files = [];
  previewThumbs.innerHTML = '';
});

scanBtn.addEventListener('click', async () => {
  if (!files.length) return;
  previewOverlay.classList.add('hidden');
  proc.classList.remove('hidden');

  const fd = new FormData();
  files.forEach(f => fd.append('images', f));

  try {
    const res = await fetch('/api/tickets', { method: 'POST', body: fd });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Server error ${res.status}`);
    }
    const data = await res.json();
    // Persist creator key so only this device can close the bill later
    if (data.id && data.creatorKey) {
      try { localStorage.setItem('ck_' + data.id, data.creatorKey); } catch (_) {}
    }
    if (data.redirect) window.location.href = data.redirect;
  } catch (err) {
    console.error('Upload error:', err);
    proc.classList.add('hidden');
    previewOverlay.classList.remove('hidden');
    // Show error toast
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = lang === 'es'
        ? 'Error al procesar el ticket. Inténtalo de nuevo.'
        : 'Error processing receipt. Please try again.';
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 4000);
    }
  }
});

// Drag & drop
document.body.addEventListener('dragover', e => { e.preventDefault(); });
document.body.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer.files.length) {
    [...e.dataTransfer.files].forEach(f => addFile(f));
    renderThumbs();
    uploadArea.classList.add('hidden');
    previewOverlay.classList.remove('hidden');
  }
});
