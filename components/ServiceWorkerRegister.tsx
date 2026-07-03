'use client'

import { useEffect } from 'react'

// Mendaftarkan service worker (public/sw.js) sekali saat aplikasi pertama kali dimuat
// di browser. Dipisah jadi komponen client tersendiri (bukan langsung di root layout)
// supaya root layout tetap bisa Server Component sebisa mungkin.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    // Daftarkan setelah window load supaya tidak bersaing dengan resource kritikal
    // saat first paint.
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[GENSITI] Registrasi service worker gagal:', err)
      })
    }

    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register)
      return () => window.removeEventListener('load', register)
    }
  }, [])

  return null
}
