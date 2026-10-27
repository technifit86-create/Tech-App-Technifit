/**
 * Service Worker — JHT Tech App
 * Stratégie : Cache-First pour les assets statiques, Background Sync pour les données
 */

const CACHE_NAME = 'jht-tech-v1';
const SYNC_TAG = 'jht-sync-interventions';

// Fichiers à mettre en cache lors de l'installation
const STATIC_ASSETS = [
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/sync.js',
  './manifest.json'
];

// ─── Installation ────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installation en cours…');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Mise en cache des assets statiques');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      // Force l'activation immédiate sans attendre la fermeture des autres onglets
      return self.skipWaiting();
    })
  );
});

// ─── Activation ──────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation…');
  event.waitUntil(
    // Supprimer les anciens caches
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Suppression ancien cache :', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Prendre le contrôle de tous les clients immédiatement
      return self.clients.claim();
    })
  );
});

// ─── Fetch — Stratégie Cache-First ───────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Ne pas intercepter les requêtes non-GET ou vers des API externes
  if (request.method !== 'GET') return;
  if (request.url.includes('script.google.com')) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Asset en cache : répondre immédiatement
        // Mettre à jour le cache en arrière-plan (stale-while-revalidate)
        fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, networkResponse.clone());
            });
          }
        }).catch(() => { /* Pas de réseau, pas grave */ });
        return cachedResponse;
      }

      // Pas en cache : tenter le réseau
      return fetch(request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }
        // Mettre en cache pour la prochaine fois
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, networkResponse.clone());
        });
        return networkResponse;
      }).catch(() => {
        // Fallback offline pour les pages HTML
        if (request.headers.get('accept').includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ─── Background Sync ─────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  console.log('[SW] Background Sync déclenché :', event.tag);
  if (event.tag === SYNC_TAG) {
    event.waitUntil(syncPendingInterventions());
  }
});

/**
 * Synchronise les interventions en attente avec Google Sheets.
 * Cette fonction communique avec la page via postMessage pour
 * déclencher la logique de sync définie dans sync.js.
 */
async function syncPendingInterventions() {
  const allClients = await self.clients.matchAll({ type: 'window' });
  if (allClients.length > 0) {
    // Un onglet est ouvert : déléguer la sync à l'app
    allClients[0].postMessage({ type: 'TRIGGER_SYNC' });
  }
  // Si aucun client n'est ouvert, la sync sera faite au prochain lancement
}

// ─── Messages depuis l'app ────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'REQUEST_SYNC') {
    self.registration.sync.register(SYNC_TAG).catch((err) => {
      console.warn('[SW] Background sync non disponible :', err);
    });
  }
});
