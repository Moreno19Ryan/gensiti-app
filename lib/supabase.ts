import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY wajib diset di environment variables.'
  )
}

// "Ingat saya di perangkat ini" (checkbox di app/login/page.tsx) -- flag module-level ini
// dibaca oleh storage adapter kustom di bawah SETIAP KALI GoTrueClient menulis/membaca sesi,
// bukan sekadar dihapus manual sesudah login (itu tidak akan bertahan lewat reload halaman
// di tab yang sama). true (default) = simpan ke localStorage (bertahan lintas restart
// browser, perilaku lama utk semua orang sebelum fitur ini ada). false = simpan ke
// sessionStorage (native browser primitive -- otomatis hilang saat tab/browser DITUTUP,
// tapi TETAP bertahan lewat reload/navigasi di tab yang sama, sesuai ekspektasi "ingat saya:
// tidak" yang standar, bukan langsung logout begitu reload).
//
// PENTING: preferensi ini sendiri disimpan sbg flag kecil non-sensitif di localStorage
// (`gensiti_remember_me`), TERPISAH dari token sesi -- bukan cuma variabel in-memory.
// Tanpa ini, reload halaman akan mereset `rememberMe` ke default `true`, dan refresh token
// otomatis GoTrueClient (berjalan diam-diam di background tiap sesi mendekati expired) akan
// menulis ulang sesi ke localStorage walau user awalnya memilih "tidak diingat" -- diam-diam
// "meng-upgrade" pilihannya jadi tersimpan permanen begitu dia reload sekali saja. Ditemukan
// & diperbaiki 2026-07-18 saat audit fitur ini.
function getInitialRememberMe(): boolean {
  if (typeof window === 'undefined') return true
  const saved = window.localStorage.getItem('gensiti_remember_me')
  return saved === null ? true : saved === 'true'
}
let rememberMe = getInitialRememberMe()
export function setRememberMe(value: boolean) {
  rememberMe = value
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('gensiti_remember_me', String(value))
  }
}

const dualStorage = {
  getItem: (key: string) => {
    // Baca dari KEDUANYA (bukan cuma yg sesuai rememberMe saat ini) -- supaya sesi yg sudah
    // tersimpan dari pilihan SEBELUMNYA tetap kebaca, apapun nilai rememberMe sekarang.
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key)
  },
  setItem: (key: string, value: string) => {
    if (typeof window === 'undefined') return
    if (rememberMe) {
      window.localStorage.setItem(key, value)
      window.sessionStorage.removeItem(key)
    } else {
      window.sessionStorage.setItem(key, value)
      window.localStorage.removeItem(key)
    }
  },
  removeItem: (key: string) => {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(key)
    window.sessionStorage.removeItem(key)
    // Sesi dihapus (logout) -- reset preferensi ke default supaya sesi anonim berikutnya
    // (mis. akun lain login di perangkat yg sama) tidak mewarisi pilihan "tidak diingat".
    window.localStorage.removeItem('gensiti_remember_me')
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storage: dualStorage },
})
