// Service Worker GENSITI -- caching ringan untuk asset statis saja.
//
// PENTING: GENSITI adalah aplikasi realtime (presence online, data organisasi yang sering
// berubah dari banyak pengguna sekaligus). Karena itu strategi di sini SENGAJA konservatif:
// - Asset statis (JS/CSS/gambar/font/ikon Next.js) -> cache-first, supaya load berikutnya
//   lebih cepat dan shell aplikasi tetap bisa terbuka saat koneksi lemah/putus sesaat.
// - Semua request lain (halaman HTML, API, Supabase) -> selalu ambil dari network, TIDAK
//   di-cache. Data organisasi (kegiatan, keuangan, presensi, dll) harus selalu yang terbaru;
//   caching data akan menyebabkan user melihat data basi tanpa sadar, yang berbahaya untuk
//   sistem manajemen organisasi.
// Versi cache di-bump (v1 -> v2) bersamaan dengan rename RYZA -> GENSITI supaya browser
// membuang cache lama dan tidak ada aset basi tersangkut dari nama aplikasi sebelumnya.
const CACHE_NAME = 'gensiti-static-v2'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

// Hanya asset statis Next.js yang di-cache: /_next/static/, /icons/, favicon, dan file
// gambar/font umum. Path lain (halaman, API route, Supabase REST) dilewati apa adanya.
function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/favicon.ico' ||
    /\.(png|jpg|jpeg|svg|webp|gif|woff2?|ttf)$/i.test(url.pathname)
  )
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Hanya tangani request GET ke origin sendiri -- request ke Supabase (domain lain) atau
  // method selain GET (POST/PATCH/DELETE) dibiarkan lewat tanpa campur tangan service worker.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return
  }

  if (!isStaticAsset(url)) {
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      })
    })
  )
})
