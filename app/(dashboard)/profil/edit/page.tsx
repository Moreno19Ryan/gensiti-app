'use client'

import { useState, useEffect } from 'react'
import { useUser } from '@/lib/user-context'
import { authFetch } from '@/lib/auth'
import ProfilHeader from '@/components/ProfilHeader'

// Sub-halaman "Edit Profil" -- dipecah dari tab "Akun" lama di app/(dashboard)/profil/
// page.tsx (lihat riwayat di sana) supaya navigasinya ikut pola Settings mobile ala
// mockup Claude Design (list + sub-halaman), bukan tab tunggal lagi.
export default function EditProfilPage() {
  const { user, refresh } = useUser()
  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'

  const [form, setForm] = useState({ nama_lengkap: '', no_hp: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({ nama_lengkap: user.nama_lengkap || '', no_hp: user.no_hp || '' })
  }, [user])

  const saveAkun = async () => {
    if (!user) return
    setSaving(true)
    setMsg(null)
    try {
      const body: Record<string, unknown> = { id: user.id, no_hp: form.no_hp }
      if (!isSuperAdmin) body.nama_lengkap = form.nama_lengkap
      const res = await authFetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.error) {
        setMsg({ type: 'err', text: json.error })
      } else {
        await refresh()
        setMsg({ type: 'ok', text: 'Profil berhasil diperbarui!' })
      }
    } catch (e) {
      setMsg({ type: 'err', text: String(e) })
    } finally {
      setSaving(false)
    }
  }

  if (!user) return null

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <ProfilHeader title="Edit Profil" backHref="/profil" />

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6 space-y-4">
        {msg && (
          <div className={`p-3 rounded-xl text-sm ${msg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {msg.text}
          </div>
        )}

        {/* Nama hanya bisa diubah oleh non-super admin */}
        {!isSuperAdmin && (
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Nama Lengkap</label>
            <input value={form.nama_lengkap} onChange={e => setForm(f => ({ ...f, nama_lengkap: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Nama Pengguna (untuk login)</label>
          <input value={user.login_username || '-'} disabled
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/50 text-sm text-slate-400 cursor-not-allowed" />
          <p className="text-xs text-slate-400 mt-1">Dipakai untuk masuk ke aplikasi, bukan email</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">No. HP</label>
          <input value={form.no_hp} onChange={e => setForm(f => ({ ...f, no_hp: e.target.value }))}
            placeholder="08xx-xxxx-xxxx"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Email</label>
          <input value={user.email} disabled
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/50 text-sm text-slate-400 cursor-not-allowed" />
          <p className="text-xs text-slate-400 mt-1">Untuk notifikasi sistem, tidak dapat diubah</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Bergabung Sejak</label>
          <input
            value={user.created_at ? new Date(user.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'}
            disabled
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/50 text-sm text-slate-400 cursor-not-allowed" />
        </div>
        <button onClick={saveAkun} disabled={saving}
          className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
          {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
        </button>
      </div>
    </div>
  )
}
