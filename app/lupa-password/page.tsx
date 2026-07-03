'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// Halaman publik (belum login) untuk mengajukan permintaan reset password. Sesuai desain
// RLS reset_password_requests: siapapun boleh INSERT (reset_request_insert, roles: public),
// tapi hanya Super Admin yang boleh melihat & memproses (reset_request_superadmin).
// Alur: user isi nama + email -> masuk sebagai baris 'pending' -> Super Admin proses manual
// lewat halaman /reset-password-requests (set password baru untuk akun tsb).
export default function LupaPasswordPage() {
  const [nama, setNama] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!nama.trim() || !email.trim()) { setError('Nama dan email wajib diisi'); return }
    setLoading(true)
    try {
      const { error: insertError } = await supabase
        .from('reset_password_requests')
        .insert({ nama: nama.trim(), email: email.trim().toLowerCase(), status: 'pending' })
      if (insertError) throw insertError
      setDone(true)
    } catch {
      // Pesan generik -- tidak membocorkan detail teknis/apakah email terdaftar (mencegah
      // enumerasi akun), cukup arahkan user untuk mencoba lagi atau hubungi pengurus.
      setError('Gagal mengirim permintaan. Silakan coba lagi atau hubungi pengurus/Super Admin secara langsung.')
    } finally {
      setLoading(false)
    }
  }

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
              <h2 className="text-lg font-bold text-slate-800 mb-2">Permintaan Terkirim</h2>
              <p className="text-slate-500 text-sm mb-6">
                Permintaan reset password kamu sudah diteruskan ke Super Admin. Password baru akan
                diinformasikan langsung setelah diproses.
              </p>
              <Link href="/login" className="inline-block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors">
                Kembali ke Halaman Masuk
              </Link>
            </div>
          ) : (
            <>
              <p className="text-slate-500 text-sm mb-1">Lupa password?</p>
              <h2 className="text-xl font-bold text-slate-800 mb-1">Ajukan Reset Password</h2>
              <p className="text-slate-400 text-xs mb-6">
                Isi data di bawah, permintaan kamu akan diproses oleh Super Admin.
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Nama Lengkap</label>
                  <input
                    type="text"
                    value={nama}
                    onChange={(e) => setNama(e.target.value)}
                    required
                    placeholder="Nama sesuai akun GENSITI"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Email Akun</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="nama@email.com"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
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
                    'Kirim Permintaan'
                  )}
                </button>
              </form>

              <Link href="/login" className="block text-center text-sm text-blue-600 hover:underline font-medium mt-5">
                ← Kembali ke Halaman Masuk
              </Link>
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
