/* Jurnal cabluri · Rotter — verificare cabluri pe șantier (iPad)
 * Date: Google Sheet prin Google Apps Script (vezi apps-script/Code.gs)
 * Offline-first: tot ce bifezi se salvează întâi pe iPad, apoi se trimite în Sheet.
 */
(() => {
'use strict';

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const STATUS = { ok: 'Conform', ko: 'Neconform', '': '' };
const FROM_SHEET = s => {
  const v = String(s || '').trim().toLowerCase();
  if (v === 'conform') return 'ok';
  if (v === 'neconform') return 'ko';
  return '';
};
const QUICK_NOTES = ['Cablu lipsă', 'Cablu întrerupt', 'Etichetă lipsă', 'Etichetă greșită',
  'Fire inversate', 'Secțiune greșită', 'Lungime insuficientă', 'Izolație deteriorată', 'De revenit'];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtTime = iso => {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return String(iso);
  return d.toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

let cfg = LS.get('jc.cfg', null);
let items = [];            // [{id, nr, cablu, cat, from, to, tip, nrfire, sect, fire, subz, prot, desc, status, note, at, by}]
let byId = new Map();
let queue = {};            // id -> change (ultima modificare nesincronizată)
let meta = { title: '', sub: '' };
const ui = { status: 'all', view: 'cat', cat: 'all', room: 'all', q: '', editor: null };
let syncState = 'idle', syncTimer = null, retryTimer = null, inFlight = false;

const kItems = () => `jc.items.${cfg.project}`;
const kQueue = () => `jc.queue.${cfg.project}`;
const kMeta = () => `jc.meta.${cfg.project}`;

/* ---------------- setup ---------------- */
function b64urlEncode(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  return JSON.parse(decodeURIComponent(escape(atob(s))));
}
function readHashConfig() {
  const m = location.hash.match(/cfg=([^&]+)/);
  if (!m) return null;
  try { return b64urlDecode(m[1]); } catch { return null; } finally {
    history.replaceState(null, '', location.pathname + location.search);
  }
}
function showSetup(prefill, canCancel) {
  $('#app').hidden = true; $('#setup').hidden = false;
  const c = prefill || cfg || {};
  $('#cfg-url').value = c.url || ''; $('#cfg-key').value = c.key || '';
  $('#cfg-project').value = c.project || new URLSearchParams(location.search).get('p') || '';
  $('#cfg-name').value = c.name || '';
  $('#cfg-cancel').hidden = !canCancel;
  $('#setup-error').hidden = true;
  updateSetupLink();
}
function updateSetupLink() {
  const c = { url: $('#cfg-url').value.trim(), key: $('#cfg-key').value.trim(), project: $('#cfg-project').value.trim() };
  $('#cfg-link').value = c.url ? `${location.origin}${location.pathname}#cfg=${b64urlEncode(c)}` : '';
}
async function saveSetup() {
  const c = {
    url: $('#cfg-url').value.trim(), key: $('#cfg-key').value.trim(),
    project: $('#cfg-project').value.trim(), name: $('#cfg-name').value.trim(),
  };
  const err = $('#setup-error');
  if (!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(c.url) || !c.key || !c.project) {
    err.textContent = 'Completează adresa, cheia și proiectul.'; err.hidden = false; return;
  }
  const btn = $('#cfg-save'); btn.disabled = true; btn.textContent = 'Se conectează…';
  try {
    const data = await apiList(c);
    cfg = c; LS.set('jc.cfg', cfg);
    queue = LS.get(kQueue(), {});
    applyServer(data);
    startApp();
  } catch (e) {
    err.textContent = 'Nu m-am putut conecta: ' + e.message; err.hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Conectează'; }
}

/* ---------------- API (Google Apps Script) ---------------- */
async function apiList(c = cfg) {
  const u = `${c.url}?action=list&p=${encodeURIComponent(c.project)}&key=${encodeURIComponent(c.key)}&t=${Date.now()}`;
  const r = await fetch(u, { redirect: 'follow', cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'răspuns invalid');
  return j;
}
async function apiSave(changes) {
  const body = JSON.stringify({ action: 'save', p: cfg.project, key: cfg.key, changes });
  // text/plain = cerere „simplă”, fără preflight CORS (Apps Script nu răspunde la OPTIONS)
  const r = await fetch(cfg.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'salvare eșuată');
  return j;
}

/* ---------------- data ---------------- */
function rowToItem(r) {
  return {
    id: r['ID'], nr: r['Nr'], cablu: r['Cablu'], cat: r['Categorie'] || 'Altele',
    from: r['De la'], to: r['Către'], tip: r['Tip cablu'], nrfire: r['Nr. fire'], sect: r['Secțiune'],
    fire: r['Fire folosite'], subz: r['Subzonă'], prot: r['Protecție'], desc: r['Descriere'],
    rooms: String(r['Încăpere'] || '').split(',').map(x => x.trim()).filter(Boolean),
    status: FROM_SHEET(r['Status']), note: r['Observații'] || '', at: r['Actualizat la'] || '', by: r['Actualizat de'] || '',
  };
}
function applyServer(data) {
  meta = { title: data.title || cfg.project, sub: data.subtitle || '' };
  items = data.items.filter(r => r['ID']).map(rowToItem);
  // modificările locale nesincronizate au prioritate
  for (const it of items) { const q = queue[it.id]; if (q) Object.assign(it, { status: FROM_SHEET(q.status), note: q.note, at: q.at, by: q.by }); }
  byId = new Map(items.map(i => [i.id, i]));
  persist();
}
function persist() { LS.set(kItems(), items); LS.set(kQueue(), queue); LS.set(kMeta(), meta); }

function change(id, patch) {
  const it = byId.get(id); if (!it) return;
  const prev = { status: it.status, note: it.note, at: it.at, by: it.by };
  Object.assign(it, patch, { at: new Date().toISOString(), by: cfg.name || '' });
  queue[id] = { id, status: STATUS[it.status], note: it.note, at: it.at, by: it.by };
  persist();
  renderItem(id); renderStats();
  if (syncState !== 'busy') setSync(navigator.onLine ? 'pending' : 'offline');
  scheduleSync(500);
  return prev;
}

/* ---------------- sync ---------------- */
function pendingCount() { return Object.keys(queue).length; }
function setSync(state) {
  syncState = state;
  const el = $('#sync'), n = pendingCount();
  el.className = 'sync ' + ({ ok: 'ok', busy: 'pending busy', pending: 'pending', err: 'err', offline: 'err' }[state] || '');
  $('#sync-label').textContent =
    state === 'busy' ? 'Se salvează…' :
    state === 'offline' ? `Offline · ${n} în așteptare` :
    state === 'err' ? `Nesalvat în Sheet · ${n}` :
    n ? `${n} în așteptare` : 'Salvat în Sheet';
}
function scheduleSync(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(flush, ms); }
async function flush() {
  if (inFlight) { scheduleSync(800); return; }
  const changes = Object.values(queue);
  if (!changes.length) { setSync('ok'); return; }
  if (!navigator.onLine) { setSync('offline'); armRetry(); return; }
  inFlight = true; setSync('busy');
  try {
    await apiSave(changes);
    // scoate din coadă doar ce nu s-a modificat între timp
    for (const c of changes) if (queue[c.id] && queue[c.id].at === c.at) delete queue[c.id];
    persist();
    setSync(pendingCount() ? 'pending' : 'ok');
    if (pendingCount()) scheduleSync(300);
  } catch (e) {
    console.warn('sync', e);
    setSync(navigator.onLine ? 'err' : 'offline'); armRetry();
  } finally { inFlight = false; }
}
function armRetry() { clearTimeout(retryTimer); retryTimer = setTimeout(flush, 20000); }

async function reload(silent) {
  try {
    if (pendingCount()) await flush();
    const data = await apiList();
    applyServer(data); renderAll();
    if (!silent) toast('Lista a fost reîncărcată din Sheet');
  } catch (e) { if (!silent) toast('Nu pot reîncărca: ' + e.message); }
}

/* ---------------- render ---------------- */
const cats = () => [...new Set(items.map(i => i.cat))];
const isGeneral = r => /^(generic|general)/i.test(r);
const rooms = () => [...new Set(items.flatMap(i => i.rooms || []))]
  .sort((a, b) => (isGeneral(a) - isGeneral(b)) || a.localeCompare(b, 'ro'));
const hasRooms = () => items.some(i => i.rooms && i.rooms.length);
const roomOf = it => (it.rooms && it.rooms[0]) || 'Fără încăpere';
function matches(it) {
  if (ui.view === 'cat' && ui.cat !== 'all' && it.cat !== ui.cat) return false;
  if (ui.view === 'room' && ui.room !== 'all' && !(it.rooms || []).includes(ui.room)) return false;
  if (ui.status === 'todo' && it.status) return false;
  if (ui.status === 'ok' && it.status !== 'ok') return false;
  if (ui.status === 'ko' && it.status !== 'ko') return false;
  if (ui.status === 'note' && !it.note.trim()) return false;
  if (ui.q && /^w\d+$/i.test(ui.q)) { // căutare exactă după numele cablului (W12 ≠ W125)
    const q = ui.q.toUpperCase().replace(/^W0*(\d)/, 'W$1'), c = it.cablu.toUpperCase().replace(/^W0*(\d)/, 'W$1');
    return c === q;
  }
  if (ui.q) {
    const hay = norm([it.id, it.desc, it.to, it.from, it.prot, it.cat, it.tip, it.note, ...(it.rooms || [])].join(' '));
    if (!norm(ui.q).split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}
function itemHTML(it) {
  const open = ui.editor === it.id;
  const metaBits = [
    `<span><b>${esc(it.from)}</b> → <b>${esc(it.to)}</b></span>`,
    `<span>${esc(it.tip)} ${esc(it.nrfire)} ${esc(it.sect)}</span>`,
    it.fire ? `<span>Fire: ${esc(it.fire)}</span>` : '',
    it.prot ? `<span>Protecție: <b>${esc(it.prot)}</b></span>` : '',
    it.rooms && it.rooms.length ? `<span class="room">📍 ${esc(it.rooms.join(', '))}</span>` : '',
  ].join('');
  const sub = it.id !== it.cablu ? `<small>${esc(it.cablu)} · seg. ${esc(it.id.split('-')[1])}</small>` : `<small>Nr. ${esc(it.nr)}</small>`;
  return `<article class="item ${it.status}" data-id="${esc(it.id)}">
    <div class="item-row">
      <div class="id">${esc(it.id.split('-')[0])}${sub}</div>
      <div class="body">
        <div class="desc">${esc(it.desc)}</div>
        <div class="meta">${metaBits}</div>
        ${it.note && !open ? `<div class="note-preview">📝 ${esc(it.note)}</div>` : ''}
        ${it.at ? `<div class="when">${it.status ? STATUS[it.status] : 'Actualizat'} · ${fmtTime(it.at)}${it.by ? ' · ' + esc(it.by) : ''}</div>` : ''}
      </div>
      <div class="actions">
        <button class="act ok ${it.status === 'ok' ? 'on' : ''}" data-act="ok" type="button" aria-pressed="${it.status === 'ok'}"><span class="ic">✓</span><span class="lbl">Conform</span></button>
        <button class="act ko ${it.status === 'ko' ? 'on' : ''}" data-act="ko" type="button" aria-pressed="${it.status === 'ko'}"><span class="ic">✕</span><span class="lbl">Neconform</span></button>
        <button class="act note ${it.note ? 'has' : ''}" data-act="note" type="button" aria-label="Observații"><span class="ic">✎</span></button>
      </div>
    </div>
    ${open ? `<div class="editor">
      <div class="quick">${QUICK_NOTES.map(q => `<button type="button" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <textarea placeholder="Observații pentru ${esc(it.id)}…">${esc(it.note)}</textarea>
      <div class="row">
        ${it.note ? '<button class="btn ghost" data-act="note-clear" type="button">Șterge observația</button>' : ''}
        <button class="btn ghost" data-act="note-cancel" type="button">Renunță</button>
        <button class="btn primary" data-act="note-save" type="button">Salvează</button>
      </div></div>` : ''}
  </article>`;
}
function renderList() {
  const list = $('#list');
  const vis = items.filter(matches);
  if (!vis.length) { list.innerHTML = `<div class="empty">Nimic de afișat pentru filtrul ales.</div>`; return; }
  // grupare: „Toate” pe funcție → pe funcție; o încăpere → pe funcție; „Toate” pe încăpere → pe încăpere
  const byRoom = ui.view === 'room' && ui.room === 'all';
  const grouped = byRoom || ui.view === 'room' || ui.cat === 'all';
  let list2 = vis;
  if (byRoom) { const order = rooms(); list2 = [...vis].sort((a, b) => order.indexOf(roomOf(a)) - order.indexOf(roomOf(b))); }
  const pool = ui.view === 'room' && ui.room !== 'all' ? items.filter(i => i.rooms.includes(ui.room)) : items;
  let html = '', last = null;
  for (const it of list2) {
    const g = byRoom ? roomOf(it) : it.cat;
    if (grouped && g !== last) {
      last = g;
      const all = byRoom ? items.filter(i => roomOf(i) === g) : pool.filter(i => i.cat === g);
      html += `<div class="group-h" data-g="${byRoom ? 'room' : 'cat'}"><span>${esc(g)}</span><span>${all.filter(i => i.status).length}/${all.length}</span></div>`;
    }
    html += itemHTML(it);
  }
  list.innerHTML = html;
}
function renderItem(id) {
  document.querySelectorAll(`.item[data-id="${CSS.escape(id)}"]`).forEach(el => { el.outerHTML = itemHTML(byId.get(id)); });
}
function renderStats() {
  const tot = items.length, ok = items.filter(i => i.status === 'ok').length, ko = items.filter(i => i.status === 'ko').length;
  $('#p-total').textContent = tot; $('#p-done').textContent = ok + ko; $('#p-ok').textContent = ok; $('#p-ko').textContent = ko;
  $('#bar-ok').style.width = tot ? (ok / tot * 100) + '%' : 0;
  $('#bar-ko').style.width = tot ? (ko / tot * 100) + '%' : 0;
  const sel = ui.view === 'room' ? ui.room : ui.cat;
  const catBtn = (key, label, arr) => {
    const o = arr.filter(i => i.status === 'ok').length, k = arr.filter(i => i.status === 'ko').length, n = arr.length || 1;
    return `<button class="cat ${sel === key ? 'on' : ''}" data-cat="${esc(key)}" type="button">
      <div class="top"><span>${esc(label)}</span><span>${o + k}/${arr.length}</span></div>
      <div class="mini"><i class="o" style="width:${o / n * 100}%"></i><i class="k" style="width:${k / n * 100}%"></i></div></button>`;
  };
  $('#view-switch').hidden = !hasRooms();
  if (!hasRooms() && ui.view === 'room') ui.view = 'cat';
  document.querySelectorAll('#view-switch [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === ui.view));
  $('#cats').innerHTML = catBtn('all', 'Toate cablurile', items) + (ui.view === 'room'
    ? rooms().map(r => catBtn(r, r, items.filter(i => i.rooms.includes(r))))
    : cats().map(c => catBtn(c, c, items.filter(i => i.cat === c)))).join('');
  // headere de grup
  const pool = ui.view === 'room' && ui.room !== 'all' ? items.filter(i => i.rooms.includes(ui.room)) : items;
  document.querySelectorAll('.group-h').forEach(h => {
    const g = h.firstElementChild.textContent;
    const all = h.dataset.g === 'room' ? items.filter(i => roomOf(i) === g) : pool.filter(i => i.cat === g);
    h.lastElementChild.textContent = `${all.filter(i => i.status).length}/${all.length}`;
  });
}
function renderAll() {
  $('#project-title').textContent = meta.title || cfg.project;
  $('#project-sub').textContent = meta.sub || 'Jurnal cabluri';
  document.title = `${meta.title || cfg.project} · Jurnal cabluri`;
  renderStats(); renderList(); setSync(pendingCount() ? 'pending' : 'ok');
}

/* ---------------- toast / undo ---------------- */
let toastTimer;
function toast(msg, undo) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Anulează</button>' : ''}`;
  t.hidden = false;
  if (undo) t.querySelector('button').onclick = () => { undo(); t.hidden = true; };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), undo ? 5000 : 2500);
}

/* ---------------- export ---------------- */
function exportCSV() {
  const H = ['ID', 'Nr', 'Cablu', 'Categorie', 'De la', 'Către', 'Tip cablu', 'Nr. fire', 'Secțiune', 'Fire folosite', 'Subzonă', 'Protecție', 'Încăpere', 'Descriere', 'Status', 'Observații', 'Actualizat la', 'Actualizat de'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [H.map(q).join(',')].concat(items.map(i =>
    [i.id, i.nr, i.cablu, i.cat, i.from, i.to, i.tip, i.nrfire, i.sect, i.fire, i.subz, i.prot, (i.rooms || []).join(', '), i.desc, STATUS[i.status], i.note, i.at, i.by].map(q).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jurnal-cabluri_${cfg.project}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function printReport() {
  const ok = items.filter(i => i.status === 'ok').length, ko = items.filter(i => i.status === 'ko').length;
  $('#report').innerHTML = `<h1>${esc(meta.title)} — Jurnal cabluri, verificare</h1>
    <p class="sum">${esc(meta.sub)} · Raport generat ${fmtTime(new Date().toISOString())} · ${items.length} cabluri: ${ok} conforme, ${ko} neconforme, ${items.length - ok - ko} neverificate</p>
    <table><thead><tr><th>ID</th><th>Încăpere</th><th>Descriere</th><th>De la → Către</th><th>Cablu</th><th>Protecție</th><th>Status</th><th>Observații</th><th>Verificat</th></tr></thead><tbody>
    ${items.map(i => `<tr><td>${esc(i.id)}</td><td>${esc((i.rooms || []).join(', '))}</td><td>${esc(i.desc)}</td><td>${esc(i.from)} → ${esc(i.to)}</td><td>${esc(i.tip)} ${esc(i.nrfire)} ${esc(i.sect)}</td><td>${esc(i.prot)}</td>
      <td class="s-${i.status}">${STATUS[i.status] || '—'}</td><td>${esc(i.note)}</td><td>${fmtTime(i.at)} ${esc(i.by)}</td></tr>`).join('')}
    </tbody></table>`;
  window.print();
}

/* ---------------- events ---------------- */
function bind() {
  $('#cfg-save').onclick = saveSetup;
  $('#cfg-cancel').onclick = () => { $('#setup').hidden = true; $('#app').hidden = false; };
  ['#cfg-url', '#cfg-key', '#cfg-project'].forEach(s => $(s).addEventListener('input', updateSetupLink));
  $('#cfg-copy').onclick = async () => { try { await navigator.clipboard.writeText($('#cfg-link').value); toast('Link copiat'); } catch { $('#cfg-link').select(); } };

  $('#list').addEventListener('click', e => {
    const art = e.target.closest('.item'); if (!art) return;
    const id = art.dataset.id, it = byId.get(id);
    const quick = e.target.closest('[data-quick]');
    if (quick) {
      const ta = art.querySelector('textarea'), v = ta.value.trim();
      ta.value = v ? `${v}; ${quick.dataset.quick}` : quick.dataset.quick; ta.focus(); return;
    }
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'ok' || act === 'ko') {
      const next = it.status === act ? '' : act;
      const prev = change(id, { status: next });
      if (next === 'ko' && !it.note && ui.editor !== id) { ui.editor = id; renderItem(id); focusEditor(id); }
      if (!next) toast(`${id}: status șters`, () => restore(id, prev));
      else if (navigator.vibrate) navigator.vibrate(10);
    } else if (act === 'note') {
      ui.editor = ui.editor === id ? null : id; renderItem(id); if (ui.editor) focusEditor(id);
    } else if (act === 'note-save') {
      const v = art.querySelector('textarea').value.trim();
      ui.editor = null;
      if (v !== it.note) change(id, { note: v }); else renderItem(id);
    } else if (act === 'note-cancel') {
      ui.editor = null; renderItem(id);
    } else if (act === 'note-clear') {
      ui.editor = null; const prev = change(id, { note: '' }); toast(`${id}: observație ștearsă`, () => restore(id, prev));
    }
  });

  $('#status-filters').addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    ui.status = b.dataset.f; ui.editor = null;
    document.querySelectorAll('#status-filters .chip').forEach(c => c.classList.toggle('on', c === b));
    renderList(); $('#list').scrollTop = 0;
  });
  $('#cats').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    if (ui.view === 'room') ui.room = b.dataset.cat; else ui.cat = b.dataset.cat;
    ui.editor = null; renderStats(); renderList(); $('#list').scrollTop = 0;
  });
  $('#view-switch').addEventListener('click', e => {
    const b = e.target.closest('[data-view]'); if (!b || b.dataset.view === ui.view) return;
    ui.view = b.dataset.view; ui.cat = 'all'; ui.room = 'all'; ui.editor = null;
    renderStats(); renderList(); $('#list').scrollTop = 0;
  });
  let st; $('#search').addEventListener('input', e => { clearTimeout(st); st = setTimeout(() => { ui.q = e.target.value.trim(); renderList(); }, 150); });

  $('#sync').onclick = () => { if (pendingCount()) flush(); else reload(); };
  $('#menu-btn').onclick = e => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; };
  document.addEventListener('click', () => { $('#menu').hidden = true; });
  $('#menu').addEventListener('click', e => {
    const a = e.target.closest('[data-act]')?.dataset.act; $('#menu').hidden = true;
    if (a === 'reload') reload();
    if (a === 'csv') exportCSV();
    if (a === 'print') printReport();
    if (a === 'settings') showSetup(cfg, true);
  });

  window.addEventListener('online', () => flush());
  window.addEventListener('offline', () => setSync('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && cfg && !$('#app').hidden) { if (pendingCount()) flush(); else if (!ui.editor) reload(true); }
  });
}
function restore(id, prev) {
  const it = byId.get(id); if (!it) return;
  Object.assign(it, prev, { at: new Date().toISOString(), by: cfg.name || '' });
  queue[id] = { id, status: STATUS[it.status], note: it.note, at: it.at, by: it.by };
  persist(); renderItem(id); renderStats(); setSync('pending'); scheduleSync(300);
}
function focusEditor(id) {
  requestAnimationFrame(() => {
    const ta = document.querySelector(`.item[data-id="${CSS.escape(id)}"] textarea`);
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.closest('.item').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  });
}

function startApp() {
  $('#setup').hidden = true; $('#app').hidden = false;
  renderAll();
  if (pendingCount()) scheduleSync(500);
}

/* ---------------- boot ---------------- */
async function boot() {
  bind();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  const fromHash = readHashConfig();
  if (fromHash && fromHash.url) { showSetup({ ...(cfg || {}), ...fromHash }, false); return; }
  if (!cfg) { showSetup(null, false); return; }
  queue = LS.get(kQueue(), {});
  const cached = LS.get(kItems(), null);
  if (cached && cached.length) {
    items = cached; byId = new Map(items.map(i => [i.id, i])); meta = LS.get(kMeta(), meta);
    startApp(); reload(true);
  } else {
    try { applyServer(await apiList()); startApp(); }
    catch (e) { showSetup(cfg, false); $('#setup-error').textContent = 'Nu m-am putut conecta: ' + e.message; $('#setup-error').hidden = false; }
  }
}
boot();
})();
