'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import PasswordInput from '@/components/PasswordInput'

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

  const inputClass = 'w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition'

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-lg mb-4 p-2">
            <img src="/icons/icon-512.png" alt="GENSITI" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">GENSITI</h1>
          <p className="text-blue-200 mt-1 text-sm">Smart Organization Management System</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {done ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4">✓</div>
              <h2 className="text-lg font-bold text-slate-800 mb-2">Password Berhasil Diubah</h2>
              <p className="text-slate-500 text-sm mb-6">
                Password akun kamu sudah diperbarui. Silakan masuk lagi dengan password baru.
              </p>
              <Link href="/login" className="inline-block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors">
                Kembali ke Halaman Masuk
              </Link>
            </div>
          ) : step === 1 ? (
            <>
              <p className="text-slate-500 text-sm mb-1">Lupa password?</p>
              <h2 className="text-xl font-bold text-slate-800 mb-1">Reset Password</h2>
              <p className="text-slate-400 text-xs mb-6">
                Masukkan nama pengguna kamu, kode verifikasi akan dikirim ke email yang terhubung dengan akun tersebut.
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleRequestSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Nama Pengguna</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    placeholder="Nama lengkap atau nama panggilan"
                    className={inputClass}
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
                      Mengirim...
                    </>
                  ) : (
                    'Kirim Kode Verifikasi'
                  )}
                </button>
              </form>

              <Link href="/login" className="block text-center text-sm text-blue-600 hover:underline font-medium mt-5">
                ← Kembali ke Halaman Masuk
              </Link>
            </>
          ) : (
            <>
              <p className="text-slate-500 text-sm mb-1">Langkah 2 dari 2</p>
              <h2 className="text-xl font-bold text-slate-800 mb-1">Masukkan Kode & Password Baru</h2>
              <p className="text-slate-400 text-xs mb-6">
                {info || 'Kode verifikasi sudah dikirim ke email yang terhubung dengan akun kamu (kalau nama pengguna terdaftar).'}
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleConfirmSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Kode OTP</label>
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
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Password Baru</label>
                  <PasswordInput
                    value={newPassword}
                    onChange={setNewPassword}
                    placeholder="Minimal 6 karakter"
                    autoComplete="new-password"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Konfirmasi Password Baru</label>
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
                  className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 mt-2"
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
                className="block w-full text-center text-sm text-blue-600 hover:underline font-medium mt-5 disabled:text-slate-400 disabled:no-underline"
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
        </div>

        <p className="text-center text-blue-300 text-xs mt-6">
          &copy; {new Date().getFullYear()} GENSITI. Semua hak dilindungi.
        </p>
      </div>
    </div>
  )
}
