# Jurnal cabluri · Rotter

Aplicație web pentru verificarea cablurilor pe șantier, gândită pentru **iPad Air 11" în landscape**.
Pentru fiecare cablu din jurnal: **✓ Conform**, **✕ Neconform**, **✎ Observații**.
Tot ce se bifează ajunge într-un **Google Sheet** (un tab per proiect + tab „Log” cu istoricul complet).

```
iPad (GitHub Pages)  ──►  Google Apps Script  ──►  Google Sheet
   salvează local întâi, trimite când are semnal
```

- Funcționează și **fără semnal**: bifările rămân pe iPad și se trimit automat când revine internetul (indicator sus-dreapta).
- Repo-ul conține **doar codul**, fără date de client. Lista de cabluri stă în Sheet-ul privat Rotter.
- Filtrare pe **Funcție** sau pe **Încăpere** (comutator în stânga). Pe o încăpere apar toate circuitele ei, grupate pe funcții.
- Export: meniul `⋯` → **Export CSV** sau **Raport (Print / PDF)**.

## Fișiere
| Fișier | Rol |
|---|---|
| `index.html`, `styles.css`, `app.js` | aplicația |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | funcționare offline + icon pe ecranul iPad-ului |
| `apps-script/Code.gs` | backend-ul (se copiază în Google Sheet) |
| `_date-private/` | CSV-ul cu cablurile, de importat în Sheet. **Nu se urcă pe GitHub** (e în `.gitignore`) |

---

## Instalare (o singură dată, ~15 minute)

### 1. Google Sheet
1. Creează un Google Sheet nou în contul Rotter: **„Rotter – Jurnale cabluri”**.
2. Redenumește primul tab în **`penthouse-negru`** (exact așa).
3. `File → Import → Upload` → alege `_date-private/penthouse-negru.csv` → **Replace current sheet**, separator: comma, **debifează „Convert text to numbers, dates…”**.

### 2. Apps Script
1. În Sheet: `Extensions → Apps Script`.
2. Șterge tot din `Code.gs` și lipește conținutul din `apps-script/Code.gs`.
3. Schimbă linia `const KEY = '...'` cu o cheie a ta (ex. `rotter-7Hq2-penthouse-91xL`). Salvează.
4. Reîncarcă Sheet-ul → apare meniul **Rotter → Formatează tab-ul curent** (culori pentru Conform/Neconform).

### 3. Publicare backend
1. În Apps Script: `Deploy → New deployment` → tip **Web app**.
2. *Execute as*: **Me** · *Who has access*: **Anyone**.
3. `Deploy` → autorizează contul → copiază **Web app URL** (se termină în `/exec`).
> Fără cheie corectă, URL-ul nu întoarce nimic. La modificări în `Code.gs`: `Deploy → Manage deployments → Edit → Version: New version` (URL-ul rămâne același).

### 4. GitHub Pages
1. Pe GitHub, în organizația `rotter-ro`: **New repository** → `jurnal-cabluri` → **Public** (Pages gratuit cere repo public; codul nu conține date).
2. Urcă fișierele din acest folder (fără `_date-private/`): `Add file → Upload files`.
3. `Settings → Pages → Source: Deploy from a branch → main / (root)` → Save.
4. După ~1 minut aplicația e la: **https://rotter-ro.github.io/jurnal-cabluri/**

### 5. Pe iPad
1. Deschide adresa în **Safari** → completează: URL-ul `/exec`, cheia, proiect `penthouse-negru`, numele celui care verifică.
2. `Share → Add to Home Screen` → se deschide ca aplicație, pe tot ecranul, și merge offline.
3. Pentru alt iPad: în ecranul de conectare, **„Link de configurare”** → trimite link-ul; se completează singur.

---

## Proiect nou
1. Tab nou în același Sheet, cu numele proiectului (ex. `casa-pamfile`), cu aceleași coloane (header-ul din CSV).
   Coloana **Încăpere**: una sau mai multe, separate prin virgulă (ex. `Hol, Living`). Fără ea, aplicația ascunde filtrul pe încăpere.
2. Opțional: adaugă titlul în `PROJECTS` din `Code.gs` + New version.
3. Pe iPad: `⋯ → Setări conexiune` → schimbă „Proiect”.

## Statusuri
| Buton | În Sheet | Când |
|---|---|---|
| ✓ Conform | `Conform` | cablul există, e etichetat și are continuitate |
| ✕ Neconform | `Neconform` | lipsă / întrerupt / greșit — se deschide automat câmpul de observații |
| ✎ Observații | coloana `Observații` | orice notă, pe orice cablu (are butoane rapide: „Cablu lipsă”, „Etichetă lipsă” etc.) |

Apasă din nou pe un status activ ca să-l ștergi (cu „Anulează” 5 secunde).
