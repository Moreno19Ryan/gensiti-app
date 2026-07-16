'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { signIn, authFetch } from '@/lib/auth'
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

  // Jika user tiba di halaman login tapi masih punya session aktif
  // (artinya menekan back button dari dalam app), auto-logout
  useEffect(() => {
    const checkAndLogout = async () => {
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
    checkAndLogout()
  }, [])

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
        </div>

        <p className="text-center text-blue-300 text-xs mt-6">
          &copy; {new Date().getFullYear()} GENSITI. Semua hak dilindungi.
        </p>
      </div>
    </div>
  )
}
