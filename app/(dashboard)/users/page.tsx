'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Modal from '@/components/Modal'

interface UserRow {
  id: string
  email: string
  nama_lengkap: string
  no_hp: string | null
  is_active: boolean
  created_at: string
  roles: { id: string; nama_role: string; tingkatan: string } | null
  desa: { id: string; nama_desa: string } | null
  kelompok: { id: string; nama_kelompok: string } | null
}

interface RoleOpt { id: string; nama_role: string; tingkatan: string }
interface DesaOpt { id: string; nama_desa: string }
interface KelompokOpt { id: string; nama_kelompok: string; desa_id: string }

const emptyForm = {
  email: '',
  password: '',
  nama_lengkap: '',
  no_hp: '',
  role_id: '',
  desa_id: '',
  kelompok_id: '',
  is_active: true,
}

export default function UsersPage() {
  const { user } = useUser()
  const router = useRouter()
  const [data, setData] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<UserRow | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [roleList, setRoleList] = useState<RoleOpt[]>([])
  const [desaList, setDesaList] = useState<DesaOpt[]>([])
  const [kelompokList, setKelompokList] = useState<KelompokOpt[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: rows } = await supabase
      .from('users')
      .select('id, email, nama_lengkap, no_hp, is_active, created_at, roles:role_id(id, nama_role, tingkatan), desa:desa_id(id, nama_desa), kelompok:kelompok_id(id, nama_kelompok)')
      .order('nama_lengkap')
    setData((rows as unknown as UserRow[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!user) return
    if (user.role?.tingkatan !== 'super_admin') { router.replace('/dashboard'); return }
    loadData()
    Promise.all([
      supabase.from('roles').select('id, nama_role, tingkatan').order('nama_role'),
      supabase.from('desa').select('id, nama_desa').eq('is_active', true).order('nama_desa'),
      supabase.from('kelompok').select('id, nama_kelompok, desa_id').eq('is_active', true).order('nama_kelompok'),
    ]).then(([{ data: r }, { data: d }, { data: k }]) => {
      setRoleList((r as unknown as RoleOpt[]) || [])
      setDesaList(d || [])
      setKelompokList((k as unknown as KelompokOpt[]) || [])
    })
  }, [user, router, loadData])

  const openAdd = () => {
    setEditTarget(null)
    setForm(emptyForm)
    setError('')
    setModalOpen(true)
  }

  const openEdit = (u: UserRow) => {
    setEditTarget(u)
    setForm({
      email: u.email,
      password: '',
      nama_lengkap: u.nama_lengkap,
      no_hp: u.no_hp || '',
      role_id: u.roles?.id || '',
      desa_id: u.desa?.id || '',
      kelompok_id: u.kelompok?.id || '',
      is_active: u.is_active,
    })
    setError('')
    setModalOpen(true)
  }

  const handleSave = async () => {
    setError('')
    if (!form.nama_lengkap || (!editTarget && (!form.email || !form.password))) {
      setError('Email, password, dan nama wajib diisi untuk pengguna baru')
      return
    }
    setSaving(true)
    try {
      if (editTarget) {
        const res = await fetch('/api/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editTarget.id,
            nama_lengkap: form.nama_lengkap,
            no_hp: form.no_hp,
            role_id: form.role_id,
            desa_id: form.desa_id,
            kelompok_id: form.kelompok_id,
            is_active: form.is_active,
            password: form.password || undefined,
          }),
        })
        const json = await res.json()
        if (json.error) { setError(json.error); return }
      } else {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: form.email,
            password: form.password,
            nama_lengkap: form.nama_lengkap,
            no_hp: form.no_hp,
            role_id: form.role_id,
            desa_id: form.desa_id,
            kelompok_id: form.kelompok_id,
          }),
        })
        const json = await res.json()
        if (json.error) { setError(json.error); return }
      }
      setModalOpen(false)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (u: UserRow) => {
    await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, nama_lengkap: u.nama_lengkap, is_active: !u.is_active }),
    })
    loadData()
  }

  const set = (key: string, val: string | boolean) => setForm(f => ({ ...f, [key]: val }))
  const filtered = data.filter(u =>
    u.nama_lengkap?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  )

  const tingkatanColor: Record<string, string> = {
    super_admin: 'bg-red-100 text-red-700',
    daerah: 'bg-purple-100 text-purple-700',
    desa: 'bg-blue-100 text-blue-700',
    kelompok: 'bg-green-100 text-green-700',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Pengguna</h2>
          <p className="text-slate-400 text-sm">{data.length} pengguna terdaftar</p>
        </div>
        <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
          + Tambah Pengguna
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="p-4 border-b border-slate-100">
          <input type="text" placeholder="Cari nama atau email..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium">Nama</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Desa</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-medium text-slate-800">{u.nama_lengkap}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tingkatanColor[u.roles?.tingkatan || ''] || 'bg-slate-100 text-slate-500'}`}>
                        {u.roles?.nama_role || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-sm">{u.desa?.nama_desa || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {u.is_active ? 'Aktif' : 'Non-aktif'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button onClick={() => openEdit(u)} className="text-blue-600 hover:text-blue-800 font-medium text-xs">Edit</button>
                        <button onClick={() => toggleActive(u)} className={`text-xs font-medium ${u.is_active ? 'text-slate-400 hover:text-slate-600' : 'text-green-600 hover:text-green-800'}`}>
                          {u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? 'Edit Pengguna' : 'Tambah Pengguna'} size="lg">
        <div className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nama Lengkap *</label>
              <input value={form.nama_lengkap} onChange={e => set('nama_lengkap', e.target.value)}
                placeholder="Nama lengkap"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">No. HP</label>
              <input value={form.no_hp} onChange={e => set('no_hp', e.target.value)}
                placeholder="08xx-xxxx-xxxx"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email {!editTarget && '*'}</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                disabled={!!editTarget}
                placeholder="email@domain.com"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Password {editTarget ? '(kosongkan jika tidak diubah)' : '*'}
              </label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)}
                placeholder={editTarget ? 'Password baru (opsional)' : 'Min. 6 karakter'}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
            <select value={form.role_id} onChange={e => set('role_id', e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">-- Pilih Role --</option>
              {roleList.map(r => <option key={r.id} value={r.id}>{r.nama_role}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Desa</label>
              <select value={form.desa_id} onChange={e => { set('desa_id', e.target.value); set('kelompok_id', '') }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">-- Tidak ada --</option>
                {desaList.map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Kelompok</label>
              <select value={form.kelompok_id} onChange={e => set('kelompok_id', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">-- Tidak ada --</option>
                {kelompokList.filter(k => !form.desa_id || k.desa_id === form.desa_id).map(k => (
                  <option key={k.id} value={k.id}>{k.nama_kelompok}</option>
                ))}
              </select>
            </div>
          </div>

          {editTarget && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)}
                className="w-4 h-4 rounded accent-blue-600" />
              <span className="text-sm text-slate-600">Akun aktif</span>
            </label>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
              Batal
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
              {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Menyimpan...</> : 'Simpan'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
