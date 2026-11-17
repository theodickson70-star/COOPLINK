// CoopLink — service worker (v2.9): app inafunguka hata bila mtandao.
//  - Kurasa (navigation): mtandao kwanza; ukikosekana -> nakala ya mwisho ya app
//  - /assets/* (majina yenye hash): akiba kwanza
//  - API: HAIHIFADHIWI hapa (data ya offline iko kwenye IndexedDB ya app, imefungwa kwa mtumiaji)
const CACHE = 'cooplink-app-v2.9.0';
const SHELL = ['/', '/favicon.svg', '/logo.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/health') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then((c) => c.put('/', copy));
      return res;
    }).catch(() => caches.match('/').then((r) => r || Response.error())));
    return;
  }
  if (url.pathname.startsWith('/assets/') || /\.(svg|png|woff2?|mp3)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
