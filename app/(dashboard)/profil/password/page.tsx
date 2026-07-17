'use client'

import { useState } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import PasswordInput from '@/components/PasswordInput'
import ProfilHeader from '@/components/ProfilHeader'

// Sub-halaman "Ganti Password" -- dipecah dari tab "Password" lama di
// app/(dashboard)/profil/page.tsx, logic verifikasi & validasi TIDAK diubah sama sekali.
export default function GantiPasswordPage() {
  const { user } = useUser()
  const [pwForm, setPwForm] = useState({ lama: '', baru: '', konfirmasi: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const savePassword = async () => {
    if (!user) return
    if (!pwForm.lama) { setMsg({ type: 'err', text: 'Password lama wajib diisi' }); return }
    if (!pwForm.baru) { setMsg({ type: 'err', text: 'Password baru wajib diisi' }); return }
    const pwValid = /^[A-Za-z0-9]{6,}$/.test(pwForm.baru)
    const hasUpper = /[A-Z]/.test(pwForm.baru)
    if (!pwValid) { setMsg({ type: 'err', text: 'Password hanya boleh huruf dan angka, tanpa spasi atau simbol, min. 6 karakter' }); return }
    if (!hasUpper) { setMsg({ type: 'err', text: 'Password wajib mengandung minimal 1 huruf kapital' }); return }
    if (pwForm.baru !== pwForm.konfirmasi) { setMsg({ type: 'err', text: 'Konfirmasi password tidak cocok' }); return }

    setSaving(true)
    setMsg(null)
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: pwForm.lama,
    })
    if (verifyErr) {
      setMsg({ type: 'err', text: 'Password lama salah. Silakan periksa kembali.' })
      setSaving(false)
      return
    }
    const { error } = await supabase.auth.updateUser({ password: pwForm.baru })
    if (error) {
      setMsg({ type: 'err', text: error.message })
    } else {
      setMsg({ type: 'ok', text: 'Password berhasil diubah!' })
      setPwForm({ lama: '', baru: '', konfirmasi: '' })
    }
    setSaving(false)
  }

  if (!user) return null

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <ProfilHeader title="Ganti Password" backHref="/profil" />

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6 space-y-4">
        {msg && (
          <div className={`p-3 rounded-xl text-sm ${msg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {msg.text}
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Password Lama *</label>
          <PasswordInput value={pwForm.lama} onChange={v => setPwForm(f => ({ ...f, lama: v }))}
            placeholder="Masukkan password saat ini" autoComplete="current-password"
            className="w-full pl-3 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Password Baru *</label>
          <PasswordInput value={pwForm.baru} onChange={v => setPwForm(f => ({ ...f, baru: v }))}
            placeholder="Min. 6 karakter, huruf kapital, hanya huruf & angka" autoComplete="new-password"
            className="w-full pl-3 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Konfirmasi Password Baru *</label>
          <PasswordInput value={pwForm.konfirmasi} onChange={v => setPwForm(f => ({ ...f, konfirmasi: v }))}
            placeholder="Ulangi password baru" autoComplete="new-password"
            className="w-full pl-3 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button onClick={savePassword} disabled={saving}
          className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
          {saving ? 'Memverifikasi...' : 'Ubah Password'}
        </button>
      </div>
    </div>
  )
}
