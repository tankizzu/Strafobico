/*
 * Service worker di Strafobico: rende l'app installabile e utilizzabile offline.
 * - i file dell'app vengono salvati alla prima apertura e aggiornati in sottofondo
 * - le librerie esterne (lettore di testo, lettore PDF, font) restano in memoria dopo il primo uso
 * - le chiamate alle API di Google non passano mai dalla memoria
 * Quando pubblichi una nuova versione, cambia VERSIONE: gli utenti la ricevono alla riapertura.
 */
const VERSIONE = 'strafobico-v2';
const APP = ['./', 'index.html', 'privacy.html', 'manifest.webmanifest', 'js/config.js', 'js/core.js', 'js/google.js',
  'icons/logo.webp', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
const ESTERNI = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|api\.fontshare\.com|cdn\.fontshare\.com|fonts\.gstatic\.com)\//;
const MAI = /^https:\/\/([a-z]+\.)?(googleapis\.com|google\.com|gstatic\.com\/_\/)/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== VERSIONE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  if (MAI.test(url) && !ESTERNI.test(url)) return; // Google: sempre dalla rete
  if (ESTERNI.test(url)) {
    // librerie esterne: dalla memoria se ci sono, altrimenti dalla rete (e le salvo)
    e.respondWith(caches.open(VERSIONE + '-esterni').then(async c => {
      const m = await c.match(req); if (m) return m;
      const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r;
    }));
    return;
  }
  if (new URL(url).origin !== location.origin) return;
  // file dell'app: subito dalla memoria, intanto controllo se c'è una versione nuova
  e.respondWith(caches.open(VERSIONE).then(async c => {
    const m = await c.match(req, { ignoreSearch: req.mode === 'navigate' });
    const rete = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
    if (m) { e.waitUntil(rete); return m; }
    const r = await rete;
    if (r) return r;
    if (req.mode === 'navigate') return c.match('index.html');
    return new Response('', { status: 504 });
  }));
});
