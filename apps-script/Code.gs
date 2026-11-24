/**
 * Jurnal cabluri · Rotter — backend Google Sheets
 *
 * Fiecare proiect = un tab în acest Sheet (ex. „penthouse-negru”).
 * Coloane: ID | Nr | Cablu | Categorie | De la | Către | Tip cablu | Nr. fire | Secțiune |
 *          Fire folosite | Subzonă | Protecție | Descriere | Status | Observații | Actualizat la | Actualizat de
 * Tab-ul „Log” păstrează istoricul fiecărei modificări (cine, când, ce).
 *
 * Instalare: vezi README.md, pașii 2–4.
 */

// 1) Schimbă cheia cu una a ta (orice text lung). Aceeași cheie o pui în aplicație.
const KEY = 'SCHIMBA-MA-cu-o-cheie-lunga';

// 2) Titlul afișat în aplicație pentru fiecare proiect (opțional).
const PROJECTS = {
  'penthouse-negru': { title: 'Penthouse „NEGRU”', subtitle: 'Jurnal cabluri V0.2 · 31.07.2026' },
};

const COLS = ['ID', 'Nr', 'Cablu', 'Categorie', 'De la', 'Către', 'Tip cablu', 'Nr. fire', 'Secțiune', 'Încăpere',
  'Fire folosite', 'Subzonă', 'Protecție', 'Descriere', 'Status', 'Observații', 'Actualizat la', 'Actualizat de'];
const LOG_TAB = 'Log';

function doGet(e) {
  try {
    const p = e.parameter || {};
    auth_(p.key);
    if ((p.action || 'list') !== 'list') throw new Error('acțiune necunoscută');
    const sh = sheet_(p.p);
    const values = sh.getDataRange().getDisplayValues();
    const head = values.shift();
    const items = values.filter(r => r[0]).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
    const info = PROJECTS[p.p] || {};
    return json_({ ok: true, title: info.title || p.p, subtitle: info.subtitle || '', items });
  } catch (err) { return json_({ ok: false, error: String(err.message || err) }); }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse(e.postData.contents);
    auth_(body.key);
    if (body.action !== 'save') throw new Error('acțiune necunoscută');
    lock.waitLock(20000);
    const sh = sheet_(body.p);
    const data = sh.getDataRange().getValues();
    const head = data[0];
    const c = name => { const i = head.indexOf(name); if (i < 0) throw new Error('lipsește coloana ' + name); return i; };
    const cId = c('ID'), cSt = c('Status'), cOb = c('Observații'), cAt = c('Actualizat la'), cBy = c('Actualizat de');
    const rowOf = {}; data.forEach((r, i) => { if (i) rowOf[String(r[cId])] = i; });
    const log = logSheet_();
    const saved = [], skipped = [];
    (body.changes || []).forEach(ch => {
      const i = rowOf[String(ch.id)];
      if (i === undefined) { skipped.push(ch.id); return; }
      const at = ch.at ? new Date(ch.at) : new Date();
      const prevAt = data[i][cAt] ? new Date(data[i][cAt]) : null;
      if (prevAt && !isNaN(prevAt) && prevAt > at) { skipped.push(ch.id); return; } // există deja o modificare mai nouă
      const row = i + 1;
      sh.getRange(row, cSt + 1).setValue(ch.status || '');
      sh.getRange(row, cOb + 1).setValue(ch.note || '');
      sh.getRange(row, cAt + 1).setValue(at);
      sh.getRange(row, cBy + 1).setValue(ch.by || '');
      log.appendRow([new Date(), body.p, ch.id, ch.status || '(neverificat)', ch.note || '', ch.by || '', at]);
      saved.push(ch.id);
    });
    return json_({ ok: true, saved, skipped });
  } catch (err) { return json_({ ok: false, error: String(err.message || err) }); }
  finally { try { lock.releaseLock(); } catch (_) {} }
}

/* ---------- utilitare ---------- */
function auth_(k) { if (!k || k !== KEY) throw new Error('cheie de acces greșită'); }
function sheet_(name) {
  if (!name) throw new Error('lipsește proiectul');
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('nu există tab-ul „' + name + '” în Sheet');
  return sh;
}
function logSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(LOG_TAB);
    sh.appendRow(['Primit la', 'Proiect', 'ID', 'Status', 'Observații', 'Verificat de', 'Momentul pe iPad']);
    sh.setFrozenRows(1); sh.getRange('1:1').setFontWeight('bold');
  }
  return sh;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- meniu în Sheet: formatare tab proiect ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Rotter')
    .addItem('Formatează tab-ul curent (jurnal cabluri)', 'formateazaTab')
    .addToUi();
}
function formateazaTab() {
  const sh = SpreadsheetApp.getActiveSheet();
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const n = Math.max(sh.getLastRow() - 1, 1);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#0f1720').setFontColor('#ffffff');
  const st = head.indexOf('Status') + 1;
  if (st > 0) {
    const r = sh.getRange(2, st, n, 1);
    r.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Conform', 'Neconform'], true).setAllowInvalid(true).build());
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Conform').setBackground('#e6f6ee').setFontColor('#14915a').setRanges([r]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Neconform').setBackground('#fdecea').setFontColor('#d43b2f').setRanges([r]).build(),
    ]);
  }
  const at = head.indexOf('Actualizat la') + 1;
  if (at > 0) sh.getRange(2, at, n, 1).setNumberFormat('dd.mm.yyyy hh:mm');
  sh.autoResizeColumns(1, head.length);
}
