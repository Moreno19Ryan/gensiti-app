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
let rememberMe = true
export function setRememberMe(value: boolean) {
  rememberMe = value
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
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storage: dualStorage },
})
