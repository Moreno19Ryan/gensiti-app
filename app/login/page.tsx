'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { signIn, authFetch, getUserProfile } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { PPG_LOGO_LOGIN_BASE64 } from '@/lib/logo'
import PasswordInput from '@/components/PasswordInput'

export default function LoginPage() {
  // Login memakai NAMA PENGGUNA (bukan email) -- keputusan produk karena banyak Generus
  // di bawah umur belum punya email sendiri. Nama diketik apa adanya lalu di-uppercase
  // otomatis (konsisten dgn login_username yg tersimpan selalu UPPERCASE), dikirim ke
  // /api/resolve-login untuk diterjemahkan jadi email asli, baru email itu dipakai
  // signInWithPassword ke Supabase Auth seperti biasa. Email TETAP wajib diisi saat
  // pembuatan akun (lihat form Tambah Pengguna) -- fungsinya murni utk notifikasi &
  // sebagai identitas asli di Supabase Auth, bukan lagi utk login sehari-hari.
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [googleLoading, setGoogleLoading] = useState(false)

  // Jika user tiba di halaman login tapi masih punya session aktif (artinya menekan back
  // button dari dalam app), auto-logout -- KECUALI kalau kedatangannya karena baru saja
  // selesai proses "Masuk dengan Google" (marker ?google=1 dari handleGoogleLogin di bawah),
  // yang punya sesi aktif SECARA SENGAJA dan harus ditangani beda sama sekali.
  useEffect(() => {
    const checkSessionOnArrival = async () => {
      const params = new URLSearchParams(window.location.search)
      const isGoogleReturn = params.get('google') === '1'
      const oauthError = params.get('error')
      const oauthErrorDesc = params.get('error_description')

      if (isGoogleReturn || oauthError) {
        // Bersihkan marker dari URL SEGERA -- HANYA key yg kita kenal sendiri, bukan
        // pathname polos (jaga-jaga kalau ada query param lain yg belum sempat diproses).
        params.delete('google')
        params.delete('error')
        params.delete('error_description')
        const qs = params.toString()
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))

        if (oauthError) {
          setError('Gagal masuk lewat Google (' + (oauthErrorDesc || oauthError) + '). Silakan coba lagi atau masuk dengan nama pengguna & password.')
          return
        }

        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.user) {
          setError('Gagal masuk lewat Google. Silakan coba lagi.')
          return
        }

        // Guard krusial: signInWithOAuth Supabase akan membuat akun BARU otomatis kalau
        // email Google ini belum pernah terhubung ke akun manapun -- GENSITI TIDAK
        // mengizinkan self-signup, semua akun wajib dibuat admin lewat /api/users. Kalau
        // tidak ada profil users yg cocok, ATAU akunnya nonaktif (konsisten dgn syarat
        // is_active=true di /api/resolve-login utk login nama+password), tolak & paksa
        // logout SEKARANG -- pesan generik sengaja (sama filosofi anti-enumerasi seperti
        // resolve-login), tidak membedakan "belum pernah link" vs "nonaktif".
        const profile = await getUserProfile(session.user.id)
        if (!profile || profile.is_active !== true) {
          await supabase.auth.signOut()
          setError('Akun ini tidak dapat masuk lewat Google. Masuk dengan nama pengguna & password, atau hubungkan akun Google Anda dulu lewat halaman Profil.')
          return
        }

        // Profil valid & aktif -- lanjutkan persis seperti login nama+password berhasil
        // (klaim sesi tunggal, non-fatal kalau gagal, lihat komentar sama di handleLogin).
        try {
          const claimRes = await authFetch('/api/session/claim', { method: 'POST' })
          const claimJson = await claimRes.json()
          if (claimJson.sessionToken) {
            localStorage.setItem('gensiti_session_token', claimJson.sessionToken)
          }
        } catch {
          // non-fatal
        }
        window.location.href = '/dashboard'
        return
      }

      // --- Perilaku lama, TIDAK diubah ---
      // Prioritaskan pesan "sesi digantikan" (single-session login) kalau ada -- ditandai
      // oleh lib/user-context.tsx SAAT mendeteksi token lokal tidak cocok lagi dgn token di
      // database (artinya akun ini baru saja login di browser/perangkat lain). Konsumsi flag
      // ini sekali pakai (hapus setelah dibaca) supaya tidak muncul berulang di reload berikutnya.
      const superseded = localStorage.getItem('gensiti_session_superseded')
      if (superseded) {
        localStorage.removeItem('gensiti_session_superseded')
        setInfo('Akun ini baru saja login di perangkat/browser lain, jadi sesi di sini dikeluarkan otomatis. Masuk lagi kalau ini bukan Anda.')
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        await supabase.auth.signOut()
        setInfo('Anda telah keluar dari aplikasi.')
      }
    }
    checkSessionOnArrival()
  }, [])

  const handleGoogleLogin = async () => {
    setGoogleLoading(true)
    setError('')
    setInfo('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/login?google=1' },
    })
    if (error) {
      setError(error.message)
      setGoogleLoading(false)
    }
    // Kalau sukses, browser langsung redirect ke Google -- setGoogleLoading(false) tidak
    // akan sempat kepanggil krn halaman sudah navigasi keluar (sama pola dgn
    // handleLinkGoogle di app/(dashboard)/profil/page.tsx).
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setInfo('')

    // Normalisasi spasi SEBELUM dikirim -- trim ujung + collapse spasi ganda jadi satu
    // spasi, supaya "  MORENO   RYANDIKA  " tetap cocok dengan login_username tersimpan
    // ("MORENO RYANDIKA"). Endpoint /api/resolve-login melakukan normalisasi yang SAMA
    // PERSIS sebagai jaring pengaman kedua (jangan diubah salah satu tanpa yang lain).
    const normalizedUsername = username.trim().replace(/\s+/g, ' ').toUpperCase()

    // Validasi manual pengganti atribut HTML `required` -- PasswordInput tidak memasang
    // `required` pada <input> internalnya (komponen tidak menerima prop itu), jadi
    // browser tidak otomatis mencegah submit kosong seperti pada <input required> biasa.
    if (!normalizedUsername || !password) {
      setError('Nama pengguna dan password wajib diisi')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/resolve-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: normalizedUsername }),
      })
      const resolved = await res.json()
      if (!res.ok || !resolved.email) {
        setError('Nama pengguna atau password salah')
        setLoading(false)
        return
      }

      await signIn(resolved.email, password)

      // Klaim sesi tunggal: generate token sesi baru & simpan ke localStorage browser
      // ini. Ini akan MENGGANTIKAN status "aktif" milik sesi manapun yang sedang login
      // dgn akun yang sama di browser/perangkat lain -- lihat lib/user-context.tsx untuk
      // sisi deteksinya. Kalau klaim gagal karena alasan apapun (mis. jaringan), login
      // tetap dilanjutkan (non-fatal) -- lebih baik user tetap bisa masuk daripada
      // terhalang oleh fitur pelengkap ini. Pakai authFetch supaya Bearer token diambil
      // langsung dari sesi Supabase yang baru saja tersimpan (bukan dari objek respons
      // signIn), konsisten dengan cara semua API route internal lain dipanggil.
      try {
        const claimRes = await authFetch('/api/session/claim', { method: 'POST' })
        const claimJson = await claimRes.json()
        if (claimJson.sessionToken) {
          localStorage.setItem('gensiti_session_token', claimJson.sessionToken)
        }
      } catch {
        // non-fatal, lihat komentar di atas
      }

      window.location.href = '/dashboard'
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login gagal'
      if (message.includes('Invalid login credentials')) {
        setError('Nama pengguna atau password salah')
      } else if (message.includes('Email not confirmed')) {
        setError('Akun belum dikonfirmasi')
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {/* Logo PPG (organisasi induk) ditampilkan LEBIH BESAR dan DI ATAS logo GENSITI,
              sesuai keputusan desain: PPG adalah identitas resmi organisasi, sementara
              GENSITI adalah nama aplikasi/sistemnya. Logo PPG dipakai transparan (tanpa
              kotak putih) supaya menyatu dengan latar gradient biru halaman login. */}
          <img
            src={PPG_LOGO_LOGIN_BASE64}
            alt="PPG"
            className="mx-auto mb-4 h-28 w-auto object-contain drop-shadow-lg"
          />
          <div className="inline-flex items-center justify-center w-12 h-12 bg-white rounded-xl shadow-lg mb-3 p-1.5">
            <img src="/icons/icon-512.png" alt="GENSITI" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">GENSITI</h1>
          <p className="text-blue-200 mt-1 text-sm">Smart Organization Management System</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <p className="text-slate-500 text-sm mb-1">Assalamualaikum Generus 👋</p>
          <h2 className="text-xl font-bold text-slate-800 mb-6">Masuk ke Akun Anda</h2>

          {info && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              {info}
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Nama Pengguna</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toUpperCase())}
                required
                autoCapitalize="characters"
                placeholder="NAMA LENGKAP ATAU NAMA PANGGILAN"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition uppercase"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-slate-700">Password</label>
                <Link href="/lupa-password" className="text-xs text-blue-600 hover:underline font-medium">
                  Lupa password?
                </Link>
              </div>
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full pl-4 pr-11 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Masuk...
                </>
              ) : (
                'Masuk'
              )}
            </button>
          </form>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400">atau</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="w-full py-3 px-4 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 text-slate-700 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2.5"
          >
            {googleLoading ? (
              <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.48a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3a7.14 7.14 0 0 1-10.6-3.76H1.5v3.09A12 12 0 0 0 12 24Z" />
                <path fill="#FBBC05" d="M5.47 14.33a7.2 7.2 0 0 1 0-4.66V6.58H1.5a12 12 0 0 0 0 10.84l3.97-3.09Z" />
                <path fill="#EA4335" d="M12 4.75c1.76 0 3.35.6 4.6 1.8l3.45-3.45C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.5 6.58l3.97 3.09A7.15 7.15 0 0 1 12 4.75Z" />
              </svg>
            )}
            {googleLoading ? 'Mengarahkan...' : 'Masuk dengan Google'}
          </button>

          <p className="text-center text-slate-400 text-xs mt-4">
            Hanya untuk akun yang sudah menghubungkan Google lewat halaman Profil.
          </p>
        </div>

        <p className="text-center text-blue-300 text-xs mt-6">
          &copy; {new Date().getFullYear()} GENSITI. Semua hak dilindungi.
        </p>
      </div>
    </div>
  )
}
