'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { signIn, authFetch, getUserProfile } from '@/lib/auth'
import { supabase, setRememberMe } from '@/lib/supabase'
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
  // Default true (perilaku lama, sama utk semua orang sebelum fitur ini ada) -- lihat
  // lib/supabase.ts utk cara flag ini sebenarnya memengaruhi tempat sesi disimpan.
  const [ingatSaya, setIngatSaya] = useState(true)
  const [stats, setStats] = useState<{ total_generus_aktif: number; total_kelompok: number; total_desa: number } | null>(null)

  // Statistik agregat publik (RPC get_landing_stats, anon-safe -- lihat komentar di
  // migration-nya: cuma 3 angka total, tanpa parameter scope, tanpa data individu/PII sama
  // sekali) utk panel kiri. Gagal diam-diam (mis. RPC belum ter-deploy) -- halaman login
  // tetap harus bisa dipakai tanpa statistik ini, jadi tidak ditampilkan error apapun kalau
  // gagal, cukup biarkan stats null (panel kiri render tanpa baris statistik).
  useEffect(() => {
    supabase.rpc('get_landing_stats').then(({ data }) => {
      if (data?.[0]) setStats(data[0])
    })
  }, [])

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
    // Login Google selalu "diingat" (localStorage) -- tidak ada checkbox "Ingat saya" utk
    // jalur ini, dan reset eksplisit di sini mencegah nilai ingatSaya=false yg sempat
    // ditinggal percobaan nama+password sebelumnya (di halaman yg sama) ikut memengaruhi.
    setRememberMe(true)
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

      // WAJIB diset SEBELUM signIn -- storage adapter kustom di lib/supabase.ts membaca
      // flag ini synchronous setiap kali GoTrueClient menulis sesi, jadi urutannya penting.
      setRememberMe(ingatSaya)
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
    <div className="min-h-screen flex font-[system-ui]" style={{ background: '#F5F7FA' }}>
      {/* Panel brand -- desktop saja (>= lg). Di mobile diganti header ringkas di bawah,
          murni via breakpoint Tailwind (bukan JS+resize listener spt draft awal di Claude
          Design) supaya tidak ada risiko hydration mismatch SSR/CSR di Next.js. */}
      <div
        className="hidden lg:flex flex-1 min-w-0 flex-col justify-between p-14 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(155deg,#0381FE 0%,#0753A8 60%,#0A3E7D 100%)' }}
      >
        <div className="absolute w-[520px] h-[520px] rounded-full bg-white/[0.06] -top-40 -right-40" />
        <div className="absolute w-80 h-80 rounded-full bg-white/5 -bottom-24 -left-16" />

        {/* Logo PPG (organisasi induk) tetap LEBIH BESAR & mendahului mark GENSITI, sesuai
            keputusan desain yang sama seperti sebelumnya -- PPG identitas resmi organisasi,
            GENSITI nama aplikasi/sistemnya. */}
        <div className="relative flex items-center gap-3.5">
          <img src={PPG_LOGO_LOGIN_BASE64} alt="PPG" className="h-14 w-auto object-contain drop-shadow-lg" />
          <div className="w-px h-9 bg-white/25" />
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center p-1.5 shrink-0">
              <img src="/icons/icon-512.png" alt="GENSITI" className="w-full h-full object-contain" />
            </div>
            <span className="font-bold text-lg tracking-wide">GENSITI</span>
          </div>
        </div>

        <div className="relative">
          <h1 className="text-[34px] font-extrabold leading-tight mb-4 max-w-md text-balance">
            Satu platform untuk seluruh organisasi Anda
          </h1>
          <p className="text-[15px] leading-relaxed text-white/80 max-w-sm">
            Kelola anggota, kegiatan, presensi, keuangan, dan pengumuman dalam satu tempat &mdash; rapi dari Kelompok hingga Daerah.
          </p>
        </div>

        {/* Angka live dari RPC get_landing_stats (anon-safe, cuma 3 total agregat -- lihat
            migration add_public_landing_stats_rpc). Render kosong (bukan '0') selama belum
            termuat, supaya tidak sempat menampilkan angka salah sebelum data asli datang. */}
        <div className="relative flex gap-7">
          {[
            { value: stats?.total_generus_aktif, label: 'Generus aktif' },
            { value: stats?.total_kelompok, label: 'Kelompok' },
            { value: stats?.total_desa, label: 'Desa' },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-[22px] font-extrabold tabular-nums">{s.value ?? ' '}</div>
              <div className="text-[13px] text-white/70">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Panel form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[380px]">
          {/* Header ringkas -- mobile saja (< lg) */}
          <div className="flex lg:hidden items-center gap-2.5 mb-8">
            <img src={PPG_LOGO_LOGIN_BASE64} alt="PPG" className="h-10 w-auto object-contain" />
            <div className="w-px h-7 bg-slate-200" />
            <div className="w-8 h-8 rounded-lg bg-[#0381FE] flex items-center justify-center p-1.5 shrink-0">
              <img src="/icons/icon-512.png" alt="GENSITI" className="w-full h-full object-contain" />
            </div>
            <span className="font-bold text-[17px] text-slate-800">GENSITI</span>
          </div>

          <p className="text-slate-500 text-sm mb-1">Assalamualaikum,</p>
          <h2 className="text-[26px] font-extrabold text-slate-900 mb-2 tracking-tight">Masuk ke akun Anda</h2>
          <p className="text-slate-400 text-sm mb-8">Gunakan nama pengguna terdaftar untuk melanjutkan.</p>

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
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Nama Pengguna</label>
              <div className="relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21a8 8 0 1 0-16 0" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toUpperCase())}
                  required
                  autoCapitalize="characters"
                  placeholder="cth. MORENO RYANDIKA"
                  className="w-full pl-11 pr-4 py-3 rounded-[14px] border-[1.5px] border-[#E7EBF2] bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition uppercase"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[13px] font-semibold text-slate-700">Password</label>
                <Link href="/lupa-password" className="text-xs text-[#0381FE] hover:underline font-semibold">
                  Lupa password?
                </Link>
              </div>
              <div className="relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="10" width="16" height="10" rx="2.2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  placeholder="Masukkan password"
                  autoComplete="current-password"
                  className="w-full pl-11 pr-11 py-3 rounded-[14px] border-[1.5px] border-[#E7EBF2] bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-[13.5px] text-slate-700 cursor-pointer select-none -mt-0.5">
              <input
                type="checkbox"
                checked={ingatSaya}
                onChange={(e) => setIngatSaya(e.target.checked)}
                className="w-4 h-4 accent-[#0381FE]"
              />
              Ingat saya di perangkat ini
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 rounded-[14px] text-white font-bold transition-colors flex items-center justify-center gap-2 mt-2 disabled:opacity-60"
              style={{ background: '#0381FE', boxShadow: '0 8px 20px rgba(3,129,254,0.28)' }}
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
            className="w-full py-3.5 px-4 bg-white border-[1.5px] border-[#E7EBF2] hover:bg-slate-50 disabled:opacity-60 text-slate-700 font-semibold rounded-[14px] transition-colors flex items-center justify-center gap-2.5"
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

          <p className="text-center text-slate-400 text-[12.5px] mt-8">
            GENSITI &middot; Sistem Manajemen Organisasi
          </p>
        </div>
      </div>
    </div>
  )
}
