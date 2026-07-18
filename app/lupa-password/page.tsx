'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import PasswordInput from '@/components/PasswordInput'
import { PPG_LOGO_LOGIN_BASE64 } from '@/lib/logo'

const RESEND_COOLDOWN_SECONDS = 60

// Halaman publik (belum login) untuk reset password self-service via OTP email -- TIDAK ada
// keterlibatan admin sama sekali (beda dari versi lama yang masuk antrian Super Admin dan
// admin mengetik password baru manual). 2 langkah di satu halaman, tanpa route terpisah:
//   1. Isi nama pengguna -> POST /api/password-reset/request -> kode OTP dikirim ke email
//      yang terdaftar di akun tsb (email tidak pernah ditampilkan/diminta di form ini, sesuai
//      alur login yang juga berbasis nama pengguna, bukan email).
//   2. Isi kode OTP + password baru -> POST /api/password-reset/confirm -> password langsung
//      aktif, tidak perlu approval siapapun.
// Kedua endpoint SELALU merespons pesan generik yang sama utk kasus valid/tidak (anti-enumerasi
// akun) -- lihat komentar di masing-masing route.
export default function LupaPasswordPage() {
  const [step, setStep] = useState<1 | 2>(1)
  const [username, setUsername] = useState('')
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [done, setDone] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    }
  }, [])

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_SECONDS)
    if (cooldownRef.current) clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  const requestOtp = async (usernameToSend: string) => {
    const res = await fetch('/api/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameToSend }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Gagal mengirim kode verifikasi')
    return json.message as string
  }

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username.trim()) { setError('Nama pengguna wajib diisi'); return }
    setLoading(true)
    try {
      const message = await requestOtp(username)
      setInfo(message)
      setStep(2)
      startCooldown()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim kode verifikasi')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (cooldown > 0 || loading) return
    setError('')
    setLoading(true)
    try {
      const message = await requestOtp(username)
      setInfo(message)
      startCooldown()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim ulang kode')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!otp.trim()) { setError('Kode OTP wajib diisi'); return }
    if (newPassword.length < 6) { setError('Password baru minimal 6 karakter'); return }
    if (newPassword !== confirmPassword) { setError('Konfirmasi password tidak cocok'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, otp: otp.trim(), newPassword }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal mengubah password')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah password')
    } finally {
      setLoading(false)
    }
  }

  // Token style disamakan persis dgn app/login/page.tsx supaya kedua halaman auth terasa
  // satu keluarga (rounded-[14px], border tipis #E7EBF2, focus ring biru).
  const inputClass = 'w-full px-4 py-3 rounded-[14px] border-[1.5px] border-[#E7EBF2] bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition'

  return (
    <div className="min-h-screen flex font-[system-ui] animate-page-in" style={{ background: '#F5F7FA' }}>
      {/* Panel brand -- sama strukturnya dgn app/login/page.tsx (desktop saja, >= lg). */}
      <div
        className="hidden lg:flex flex-1 min-w-0 flex-col justify-between p-14 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(155deg,#0381FE 0%,#0753A8 60%,#0A3E7D 100%)' }}
      >
        <div className="absolute w-[520px] h-[520px] rounded-full bg-white/[0.06] -top-40 -right-40" />
        <div className="absolute w-80 h-80 rounded-full bg-white/5 -bottom-24 -left-16" />

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
            Reset password dengan aman
          </h1>
          <p className="text-[15px] leading-relaxed text-white/80 max-w-sm">
            Kode verifikasi dikirim ke email yang terhubung dengan akun kamu -- tidak perlu menunggu approval siapapun.
          </p>
        </div>

        <div className="relative flex items-center gap-2 text-white/70 text-[13px]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <rect x="4" y="10" width="16" height="10" rx="2.2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          Kode berlaku 10 menit, hanya sekali pakai.
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

          {done ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4">✓</div>
              <h2 className="text-lg font-bold text-slate-800 mb-2">Password Berhasil Diubah</h2>
              <p className="text-slate-500 text-sm mb-6">
                Password akun kamu sudah diperbarui. Silakan masuk lagi dengan password baru.
              </p>
              <Link href="/login" className="inline-block w-full py-3.5 px-4 text-white font-bold rounded-[14px] transition-colors text-center"
                style={{ background: '#0381FE', boxShadow: '0 8px 20px rgba(3,129,254,0.28)' }}>
                Kembali ke Halaman Masuk
              </Link>
            </div>
          ) : step === 1 ? (
            <>
              <p className="text-slate-500 text-sm mb-1">Lupa password?</p>
              <h2 className="text-[26px] font-extrabold text-slate-900 mb-2 tracking-tight">Reset Password</h2>
              <p className="text-slate-400 text-sm mb-8">
                Masukkan nama pengguna kamu, kode verifikasi akan dikirim ke email yang terhubung dengan akun tersebut.
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleRequestSubmit} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Nama Pengguna</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toUpperCase())}
                    required
                    autoCapitalize="characters"
                    placeholder="Nama lengkap atau nama panggilan"
                    className={`${inputClass} uppercase`}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-4 text-white font-bold rounded-[14px] transition-colors flex items-center justify-center gap-2 mt-2 disabled:opacity-60"
                  style={{ background: '#0381FE', boxShadow: '0 8px 20px rgba(3,129,254,0.28)' }}
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Mengirim...
                    </>
                  ) : (
                    'Kirim Kode Verifikasi'
                  )}
                </button>
              </form>

              <Link href="/login" className="block text-center text-sm text-[#0381FE] hover:underline font-semibold mt-5">
                ← Kembali ke Halaman Masuk
              </Link>
            </>
          ) : (
            <>
              <p className="text-slate-500 text-sm mb-1">Langkah 2 dari 2</p>
              <h2 className="text-[26px] font-extrabold text-slate-900 mb-2 tracking-tight">Masukkan Kode & Password Baru</h2>
              <p className="text-slate-400 text-sm mb-8">
                {info || 'Kode verifikasi sudah dikirim ke email yang terhubung dengan akun kamu (kalau nama pengguna terdaftar).'}
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleConfirmSubmit} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Kode OTP</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    placeholder="6 digit kode"
                    className={`${inputClass} tracking-[0.3em] font-mono text-center`}
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Password Baru</label>
                  <PasswordInput
                    value={newPassword}
                    onChange={setNewPassword}
                    placeholder="Minimal 6 karakter"
                    autoComplete="new-password"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Konfirmasi Password Baru</label>
                  <PasswordInput
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder="Ulangi password baru"
                    autoComplete="new-password"
                    className={inputClass}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-4 text-white font-bold rounded-[14px] transition-colors flex items-center justify-center gap-2 mt-2 disabled:opacity-60"
                  style={{ background: '#0381FE', boxShadow: '0 8px 20px rgba(3,129,254,0.28)' }}
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Memproses...
                    </>
                  ) : (
                    'Ubah Password'
                  )}
                </button>
              </form>

              <button
                type="button"
                onClick={handleResend}
                disabled={cooldown > 0 || loading}
                className="block w-full text-center text-sm text-[#0381FE] hover:underline font-semibold mt-5 disabled:text-slate-400 disabled:no-underline"
              >
                {cooldown > 0 ? `Kirim ulang kode (${cooldown}s)` : 'Kirim ulang kode'}
              </button>

              <button
                type="button"
                onClick={() => { setStep(1); setError(''); setOtp(''); setNewPassword(''); setConfirmPassword('') }}
                className="block w-full text-center text-sm text-slate-400 hover:underline font-medium mt-2"
              >
                ← Ganti nama pengguna
              </button>
            </>
          )}

          <p className="text-center text-slate-400 text-[12.5px] mt-8">
            GENSITI &middot; Sistem Manajemen Organisasi
          </p>
        </div>
      </div>
    </div>
  )
}
