'use client'

import { useState, useEffect } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
export default function ProfilPage() {
  const { user, refresh } = useUser()
  const [tab, setTab] = useState<'profil' | 'password'>('profil')
  const [form, setForm] = useState({
    nama_lengkap: '',
    no_hp: '',
  })
  const [pwForm, setPwForm] = useState({ current: '', baru: '', konfirmasi: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [anggotaData, setAnggotaData] = useState<{
    nomor_anggota: string | null
    tanggal_lahir: string | null
    jenis_kelamin: string | null
    alamat: string | null
    status: string | null
  } | null>(null)

  useEffect(() => {
    if (!user) return
    setForm({ nama_lengkap: user.nama_lengkap || '', no_hp: user.no_hp || '' })

    // Load data anggota terkait
    supabase
      .from('anggota')
      .select('nomor_anggota, tanggal_lahir, jenis_kelamin, alamat, status')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => setAnggotaData(data))
  }, [user])

  const saveProfile = async () => {
    if (!user) return
    setSaving(true)
    setMsg(null)
    const { error } = await supabase.from('users').update({
      nama_lengkap: form.nama_lengkap,
      no_hp: form.no_hp,
    }).eq('id', user.id)

    if (error) {
      setMsg({ type: 'err', text: error.message })
    } else {
      await refresh()
      setMsg({ type: 'ok', text: 'Profil berhasil diperbarui!' })
    }
    setSaving(false)
  }

  const savePassword = async () => {
    if (pwForm.baru !== pwForm.konfirmasi) {
      setMsg({ type: 'err', text: 'Password baru dan konfirmasi tidak cocok' })
      return
    }
    if (pwForm.baru.length < 6) {
      setMsg({ type: 'err', text: 'Password minimal 6 karakter' })
      return
    }
    setSaving(true)
    setMsg(null)

    const { error } = await supabase.auth.updateUser({ password: pwForm.baru })
    if (error) {
      setMsg({ type: 'err', text: error.message })
    } else {
      setMsg({ type: 'ok', text: 'Password berhasil diubah!' })
      setPwForm({ current: '', baru: '', konfirmasi: '' })
    }
    setSaving(false)
  }

  const formatDate = (d: string | null) => {
    if (!d) return '-'
    return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  }

  if (!user) return null

  return (
    <div className="max-w-2xl space-y-6">
      {/* Avatar + Info */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center text-white text-2xl font-black shrink-0">
            {user.nama_lengkap?.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">{user.nama_lengkap}</h2>
            <p className="text-slate-500 text-sm">{user.email}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                {user.role?.nama_role}
              </span>
              {user.desa && (
                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-xs">
                  {user.desa.nama_desa}
                </span>
              )}
              {user.kelompok && (
                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-xs">
                  {user.kelompok.nama_kelompok}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Data anggota */}
        {anggotaData && (
          <div className="mt-5 pt-5 border-t border-slate-100 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-400">No. Anggota</p>
              <p className="font-mono text-sm font-semibold text-slate-700">{anggotaData.nomor_anggota || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Status Anggota</p>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${anggotaData.status === 'aktif' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {anggotaData.status || '-'}
              </span>
            </div>
            <div>
              <p className="text-xs text-slate-400">Tanggal Lahir</p>
              <p className="text-sm text-slate-700">{formatDate(anggotaData.tanggal_lahir)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Jenis Kelamin</p>
              <p className="text-sm text-slate-700 capitalize">{anggotaData.jenis_kelamin || '-'}</p>
            </div>
            {anggotaData.alamat && (
              <div className="col-span-2">
                <p className="text-xs text-slate-400">Alamat</p>
                <p className="text-sm text-slate-700">{anggotaData.alamat}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs Edit */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex border-b border-slate-100">
          {(['profil', 'password'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setMsg(null) }}
              className={`flex-1 py-3 text-sm font-medium transition ${tab === t ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
              {t === 'profil' ? '👤 Edit Profil' : '🔐 Ganti Password'}
            </button>
          ))}
        </div>

        <div className="p-6">
          {msg && (
            <div className={`mb-4 p-3 rounded-xl text-sm ${msg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
              {msg.text}
            </div>
          )}

          {tab === 'profil' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nama Lengkap</label>
                <input value={form.nama_lengkap} onChange={e => setForm(f => ({ ...f, nama_lengkap: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">No. HP</label>
                <input value={form.no_hp} onChange={e => setForm(f => ({ ...f, no_hp: e.target.value }))}
                  placeholder="08xx-xxxx-xxxx"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input value={user.email} disabled
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-sm text-slate-400 cursor-not-allowed" />
                <p className="text-xs text-slate-400 mt-1">Email tidak dapat diubah</p>
              </div>
              <button onClick={saveProfile} disabled={saving}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
                {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Menyimpan...</> : 'Simpan Perubahan'}
              </button>
            </div>
          )}

          {tab === 'password' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Password Baru</label>
                <input type="password" value={pwForm.baru} onChange={e => setPwForm(f => ({ ...f, baru: e.target.value }))}
                  placeholder="Min. 6 karakter"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Konfirmasi Password Baru</label>
                <input type="password" value={pwForm.konfirmasi} onChange={e => setPwForm(f => ({ ...f, konfirmasi: e.target.value }))}
                  placeholder="Ulangi password baru"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <button onClick={savePassword} disabled={saving}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
                {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Memproses...</> : 'Ubah Password'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
