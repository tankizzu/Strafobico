# Strafobico

**Turni di lavoro, ore, straordinari, ferie e stipendio — in un'app installabile che funziona anche offline e si sincronizza con il proprio account Google.**

App ideata da Stefano Tanca.

- 📅 Inserimento rapido dei turni (anche più giorni insieme), tipi di turno personalizzabili (nome, sigla, icona, colore, orari)
- 🕐 Ore lavorate, straordinario oltre le ore mensili, festività italiane, ore di corso
- 💶 Stipendio stimato (lordo e netto) e confronto con la busta paga vera
- 🏖️ Ferie: giorni o ore, residuo, saldo letto dalla busta paga
- 📷 Importazione dei turni dalla foto della tabella del reparto
- 📄 Lettura e archivio delle buste paga (PDF o foto)
- 📴 Funziona senza connessione: le modifiche partono appena torna la rete
- ☁️ Nel proprio Google: foglio «Turni lavoro» (Tabellone annuale, Turni, Buste paga), calendario «Turni lavoro», archivio delle buste paga su Drive

Tutto gira nel browser: **non c'è nessun server**. I dati di ogni persona stanno sul suo telefono e nel suo account Google.

---

## Contenuto della cartella

| File | A cosa serve |
|---|---|
| `index.html` | L'app (interfaccia) |
| `privacy.html` | Informativa sulla privacy (italiano e inglese), da indicare a Google |
| `js/core.js` | Dati sul dispositivo e tutti i calcoli (ore, straordinari, festivi, paga, ferie) |
| `js/google.js` | Accesso con Google e sincronizzazione con Fogli, Drive e Calendar |
| `js/config.js` | **Da compilare**: il Client ID di Google |
| `sw.js` | Service worker: installazione e funzionamento offline |
| `manifest.webmanifest` | Nome, icone e colori dell'app installata |
| `icons/` | Icone e logo |
| `apps-script/` | La versione precedente (Google Apps Script), solo come riferimento: non serve per l'app |
| `.nojekyll` | Dice a GitHub Pages di pubblicare i file così come sono |

---

## 1. Pubblicare su GitHub Pages

1. Crea un account su [github.com](https://github.com) (se non ce l'hai).
2. **New repository** → nome `strafobico` → *Public* → **Create repository**.
3. Nella pagina del repository: **Add file → Upload files** → trascina **tutto il contenuto** di questa cartella (compresi `js/`, `icons/`, `.nojekyll`) → **Commit changes**.
4. **Settings → Pages** → *Source*: **Deploy from a branch** → *Branch*: `main`, cartella `/ (root)` → **Save**.
5. Dopo un minuto l'app è online su:
   **`https://TUO-NOME-UTENTE.github.io/strafobico/`**

L'app funziona già così, ma i dati restano solo sul dispositivo. Per la sincronizzazione con Google segui il punto 2.

---

## 2. Collegare Google (una volta sola, circa 15 minuti)

Serve un «progetto» gratuito su Google Cloud che dica a Google: *questa app può chiedere agli utenti il permesso di usare il loro Drive e il loro Calendar*.

### 2.1 Progetto e API
1. Vai su [console.cloud.google.com](https://console.cloud.google.com) con il tuo account Google.
2. In alto: **Seleziona progetto → Nuovo progetto** → nome `Strafobico` → **Crea**.
3. Menu ☰ → **API e servizi → Libreria**, cerca e **abilita** una per una:
   - **Google Drive API**
   - **Google Sheets API**
   - **Google Calendar API**
   - *(facoltativa)* **Google Picker API** — solo per «Collega un foglio già esistente»

### 2.2 Schermata di consenso (Google Auth Platform)
1. Menu ☰ → **API e servizi → Schermata consenso OAuth** (oppure **Google Auth Platform**) → **Inizia**.
2. *Informazioni sull'app*: nome **Strafobico**, email di assistenza (la tua).
3. *Pubblico*: **Esterno**.
4. *Dati di contatto*: la tua email → **Crea**.
5. **Branding**:
   - **Link all'informativa sulla privacy**: `https://TUO-NOME-UTENTE.github.io/strafobico/privacy.html`
   - **Home page dell'applicazione**: `https://TUO-NOME-UTENTE.github.io/strafobico/`
   - **Domini autorizzati**: `TUO-NOME-UTENTE.github.io`
   - Logo: `icons/icon-512.png` (facoltativo; se lo carichi, Google chiede la verifica del branding)

   Prima di pubblicare, in `privacy.html` sostituisci le due occorrenze di `INSERISCI_EMAIL_DI_CONTATTO` con l'email a cui vuoi ricevere domande sulla privacy.
6. **Accesso ai dati → Aggiungi o rimuovi ambiti** e aggiungi:
   - `.../auth/drive.file` — solo i file creati dall'app
   - `.../auth/calendar.app.created` — solo i calendari creati dall'app
   - `openid` e `.../auth/userinfo.email`
7. **Pubblico → Pubblica app** (stato *In produzione*).
   Se la lasci *In test* devi aggiungere ogni persona tra gli *utenti di test*, e l'autorizzazione scade ogni 7 giorni.

### 2.3 Client ID
1. Menu ☰ → **API e servizi → Credenziali → Crea credenziali → ID client OAuth**.
2. Tipo di applicazione: **Applicazione web**, nome `Strafobico`.
3. **Origini JavaScript autorizzate → Aggiungi URI**:
   - `https://TUO-NOME-UTENTE.github.io`
   - *(per provarla sul computer)* `http://localhost:8000`
4. **Crea** e copia l'**ID client** (finisce con `.apps.googleusercontent.com`).
5. Su GitHub apri `js/config.js` → ✏️ → incolla l'ID al posto di `INSERISCI_QUI_IL_CLIENT_ID.apps.googleusercontent.com` → **Commit changes**.

### 2.4 (Facoltativo) Collegare il foglio della versione precedente
Serve solo se usavi la versione Apps Script e vuoi ritrovare i turni già inseriti.
1. **Credenziali → Crea credenziali → Chiave API** → *Limita chiave*:
   - *Restrizioni applicazione*: **Referrer HTTP**, valore `https://TUO-NOME-UTENTE.github.io/*`
   - *Restrizioni API*: **Google Picker API**
2. Il **numero del progetto** si trova in ☰ → **Panoramica di Cloud → Dashboard**.
3. In `js/config.js` compila `apiKey` e `appId` (il numero del progetto).
4. Nell'app: in fondo, **☁️ Account Google → Collega un foglio già esistente** → scegli «Turni lavoro».

---

## 3. Installare l'app sul telefono

- **Android (Chrome)**: apri il link → compare «Installa Strafobico» (oppure ⋮ → **Installa app**).
- **iPhone (Safari)**: apri il link → **Condividi** ↑ → **Aggiungi alla schermata Home**.
- **Computer (Chrome/Edge)**: icona di installazione nella barra dell'indirizzo.

Una volta installata si apre come un'app normale, a schermo intero, anche senza connessione.
Tenendo premuta l'icona ci sono due scorciatoie: **Segna ferie** e **Busta paga**.

> **iPhone:** installala nella schermata Home. Safari può cancellare i dati dei siti che non apri per qualche settimana; le app installate nella schermata Home non hanno questo limite. Con l'account Google collegato, comunque, i dati sono anche nel tuo Drive.

---

## 4. Come funziona la sincronizzazione

- Ogni modifica viene salvata **subito sul telefono**. L'app funziona anche in aereo o in metropolitana.
- Con l'account Google collegato, le modifiche partono **appena c'è connessione**. Partono anche alla riapertura dell'app e con **🔄 Sincronizza ora**.
- In alto una riga indica sempre lo stato: «☁️ Sincronizzato», «📴 Offline · 3 modifiche da inviare», «Collegamento scaduto — Sincronizza».
- **Accesso a Google:** per sicurezza Google concede all'app un accesso di un'ora. Quando scade, basta un tocco su **Sincronizza**. I browser non permettono di farlo da soli.
- **Più dispositivi:** telefono e computer con lo stesso account restano allineati. Se lo stesso giorno viene cambiato su due dispositivi, vale l'ultima versione inviata.
- **Modifiche a mano nel foglio:** puoi scrivere o correggere turni anche direttamente nel foglio «Turni <anno>», per esempio «P» per Pomeriggio. Alla sincronizzazione successiva l'app li legge, ricalcola tutto e crea gli eventi in Calendar.
- **Cosa crea l'app nel tuo Google:**
  - Drive › **AppTurni › Strafobico** › foglio **Turni lavoro**:
    - **Tabellone <anno>**: riepilogo in alto e calendario sotto
    - **Turni <anno>**
    - **Buste paga**
    - **Tipi turno**
    - **Impostazioni** (nascosto)
  - Drive › AppTurni › Strafobico › **Buste paga › <anno>**: i PDF delle buste paga.
  - Calendar: calendario **Turni lavoro**.
  - Ogni anno nuovo: nuovi fogli «Turni» e «Tabellone»; quelli dell'anno prima vengono nascosti (i tabelloni restano visibili).

L'app vede **solo** i file e il calendario che ha creato lei: non può leggere il resto del tuo Drive o gli altri calendari.

---

## 5. Pubblicare una nuova versione

1. Modifica i file su GitHub (✏️) oppure ricaricali con *Upload files*.
2. In `sw.js` cambia la riga `const VERSIONE = 'strafobico-v1';` in `strafobico-v2`, poi `v3`, e così via.
3. **Commit changes.** Chi ha l'app la riceve alla riapertura successiva.

---

## 6. Passare dalla versione Apps Script

- I calcoli sono gli stessi. L'app nuova legge anche il foglio della versione precedente: vedi il punto 2.4.
- Il calendario sarà **nuovo**: dopo il passaggio puoi eliminare da Google Calendar il vecchio «Turni lavoro», per non vedere i turni due volte.
- La vecchia app web (script.google.com) si può archiviare: **Distribuisci → Gestisci deployment → Archivia**.

---

## Limiti da sapere

- **Avviso di Google:** finché l'app non è verificata da Google, all'accesso compare «Google non ha verificato questa app» → **Avanzate → Vai a Strafobico**. Il limite è di 100 utenti. Per un uso personale o tra colleghi va bene così; per toglierlo si può chiedere la verifica dalla schermata di consenso.
- **Funzioni che la prima volta richiedono la connessione:** lettura delle foto e delle buste paga, perché devono scaricare i lettori (qualche MB). Dopo il primo uso funzionano anche offline.
- **Eventi aggiunti a mano in Google Calendar:** non vengono importati nell'app. I turni si inseriscono dall'app o dal foglio.

## Privacy

- **Nessun server:** non esiste un server di Strafobico e nessun dato passa da terzi.
- **Foto e buste paga:** vengono lette sul dispositivo.
- **Dove finiscono i dati:** solo sul telefono e nel tuo account Google.
