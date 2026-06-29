'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import Modal from '@/components/Modal'

interface Member {
  id: string
  email: string
  nama_lengkap: string
  no_hp: string | null
  is_active: boolean
  created_at: string
  desa_id: string | null
  kelompok_id: string | null
  role_id: string | null
  roles: { id: string; nama_role: string; tingkatan: string } | null
  desa: { id: string; nama_desa: string } | null
  kelompok: { id: string; nama_kelompok: string } | null
  anggota: {
    id: string
    nomor_anggota: string
    tanggal_lahir: string | null
    jenis_kelamin: string | null
    alamat: string | null
    status: string
  }[] | null
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
  nomor_anggota: '',
  tanggal_lahir: '',
  jenis_kelamin: '',
  alamat: '',
  status_anggota: 'aktif',
}

const tingkatanColor: Record<string, string> = {
  super_admin: 'bg-red-100 text-red-700',
  daerah: 'bg-purple-100 text-purple-700',
  desa: 'bg-blue-100 text-blue-700',
  kelompok: 'bg-green-100 text-green-700',
}

export default function AnggotaPage() {
  const { user } = useUser()
  const [data, setData] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Member | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [roleList, setRoleList] = useState<RoleOpt[]>([])
  const [desaList, setDesaList] = useState<DesaOpt[]>([])
  const [kelompokList, setKelompokList] = useState<KelompokOpt[]>([])
  const [activeTab, setActiveTab] = useState<'info' | 'akun'>('info')

  const loadData = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('users')
      .select(`
        id, email, nama_lengkap, no_hp, is_active, created_at, desa_id, kelompok_id, role_id,
        roles:role_id(id, nama_role, tingkatan),
        desa:desa_id(id, nama_desa),
        kelompok:kelompok_id(id, nama_kelompok),
        anggota!anggota_user_id_fkey(id, nomor_anggota, tanggal_lahir, jenis_kelamin, alamat, status)
      `)
      .order('nama_lengkap')

    const t = user?.role?.tingkatan
    if (t !== 'super_admin' && t !== 'daerah') {
      if (user?.kelompok_id) query = query.eq('kelompok_id', user.kelompok_id)
      else if (user?.desa_id) query = query.eq('desa_id', user.desa_id)
    }

    const { data: rows } = await query
    setData((rows as unknown as Member[]) || [])
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (!user) return
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
  }, [user, loadData])

  const generateNomorAnggota = () => {
    const num = String(data.length + 1).padStart(4, '0')
    return `ANG-${num}`
  }

  const openAdd = () => {
    setEditTarget(null)
    setActiveTab('info')
    setError('')
    setForm({
      ...emptyForm,
      nomor_anggota: generateNomorAnggota(),
      desa_id: user?.desa_id || '',
      kelompok_id: user?.kelompok_id || '',
    })
    setModalOpen(true)
  }

  const openEdit = (m: Member) => {
    setEditTarget(m)
    setActiveTab('info')
    setError('')
    const a = m.anggota?.[0]
    setForm({
      email: m.email,
      password: '',
      nama_lengkap: m.nama_lengkap,
      no_hp: m.no_hp || '',
      role_id: m.roles?.id || '',
      desa_id: m.desa?.id || '',
      kelompok_id: m.kelompok?.id || '',
      is_active: m.is_active,
      nomor_anggota: a?.nomor_anggota || '',
      tanggal_lahir: a?.tanggal_lahir || '',
      jenis_kelamin: a?.jenis_kelamin || '',
      alamat: a?.alamat || '',
      status_anggota: a?.status || 'aktif',
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    setError('')
    if (!form.nama_lengkap) { setError('Nama lengkap wajib diisi'); return }
    if (!editTarget && (!form.email || !form.password)) { setError('Email dan password wajib untuk anggota baru'); return }

    setSaving(true)
    try {
      let userId = editTarget?.id

      if (!editTarget) {
        // Buat user baru via API
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
        userId = json.userId
      } else {
        // Update user
        await fetch('/api/users', {
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
      }

      // Upsert data anggota
      const anggotaPayload = {
        user_id: userId,
        nomor_anggota: form.nomor_anggota || generateNomorAnggota(),
        nama_lengkap: form.nama_lengkap,
        tanggal_lahir: form.tanggal_lahir || null,
        jenis_kelamin: form.jenis_kelamin || null,
        alamat: form.alamat || null,
        desa_id: form.desa_id || null,
        kelompok_id: form.kelompok_id || null,
        status: form.status_anggota,
      }

      const existingAnggota = editTarget?.anggota?.[0]
      if (existingAnggota) {
        await supabase.from('anggota').update(anggotaPayload).eq('id', existingAnggota.id)
      } else {
        await supabase.from('anggota').insert(anggotaPayload)
      }

      setModalOpen(false)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (m: Member) => {
    await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, nama_lengkap: m.nama_lengkap, is_active: !m.is_active }),
    })
    loadData()
  }

  const set = (key: string, val: string | boolean) => setForm(f => ({ ...f, [key]: val }))

  const filtered = data.filter(m => {
    const matchSearch = m.nama_lengkap?.toLowerCase().includes(search.toLowerCase()) ||
      m.email?.toLowerCase().includes(search.toLowerCase()) ||
      m.anggota?.[0]?.nomor_anggota?.toLowerCase().includes(search.toLowerCase())
    const matchRole = !filterRole || m.roles?.tingkatan === filterRole
    return matchSearch && matchRole
  })

  const canManage = ['super_admin', 'daerah'].includes(user?.role?.tingkatan || '')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Anggota & Pengguna</h2>
          <p className="text-slate-400 text-sm">{data.length} anggota terdaftar</p>
        </div>
        {canManage && (
          <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
            + Tambah Anggota
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex gap-3">
        <input type="text" placeholder="Cari nama, email, atau nomor anggota..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" />
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm">
          <option value="">Semua Role</option>
          <option value="super_admin">Super Admin</option>
          <option value="daerah">Daerah</option>
          <option value="desa">Desa</option>
          <option value="kelompok">Kelompok</option>
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">👥</div>
          <p>Belum ada anggota</p>
          {canManage && <button onClick={openAdd} className="mt-3 text-blue-600 text-sm font-medium hover:underline">+ Tambah sekarang</button>}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium">Anggota</th>
                  <th className="px-4 py-3 font-medium">No. Anggota</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Desa / Kelompok</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  {canManage && <th className="px-4 py-3 font-medium">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => {
                  const a = m.anggota?.[0]
                  return (
                    <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm shrink-0">
                            {m.nama_lengkap?.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-slate-800">{m.nama_lengkap}</div>
                            <div className="text-slate-400 text-xs">{m.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-500 text-xs">{a?.nomor_anggota || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tingkatanColor[m.roles?.tingkatan || ''] || 'bg-slate-100 text-slate-500'}`}>
                          {m.roles?.nama_role || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        <div>{m.desa?.nama_desa || '-'}</div>
                        {m.kelompok && <div className="text-slate-400">{m.kelompok.nama_kelompok}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium w-fit ${m.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {m.is_active ? 'Aktif' : 'Non-aktif'}
                          </span>
                          {a && (
                            <span className={`px-2 py-0.5 rounded-full text-xs w-fit ${a.status === 'aktif' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                              {a.status === 'aktif' ? 'Anggota aktif' : 'Anggota non-aktif'}
                            </span>
                          )}
                        </div>
                      </td>
                      {canManage && (
                        <td className="px-4 py-3">
                          <div className="flex gap-3">
                            <button onClick={() => openEdit(m)} className="text-blue-600 hover:text-blue-800 font-medium text-xs">Edit</button>
                            <button onClick={() => toggleActive(m)} className={`text-xs font-medium ${m.is_active ? 'text-slate-400 hover:text-slate-600' : 'text-green-600 hover:text-green-800'}`}>
                              {m.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? `Edit — ${editTarget.nama_lengkap}` : 'Tambah Anggota'} size="lg">
        <div className="space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

          {/* Tabs */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
            {(['info', 'akun'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition capitalize ${activeTab === tab ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                {tab === 'info' ? '👤 Data Diri' : '🔐 Akun & Akses'}
              </button>
            ))}
          </div>

          {activeTab === 'info' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nama Lengkap *</label>
                  <input value={form.nama_lengkap} onChange={e => set('nama_lengkap', e.target.value)}
                    placeholder="Nama lengkap"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">No. Anggota</label>
                  <input value={form.nomor_anggota} onChange={e => set('nomor_anggota', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal Lahir</label>
                  <input type="date" value={form.tanggal_lahir} onChange={e => set('tanggal_lahir', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Jenis Kelamin</label>
                  <select value={form.jenis_kelamin} onChange={e => set('jenis_kelamin', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">-- Pilih --</option>
                    <option value="laki-laki">Laki-laki</option>
                    <option value="perempuan">Perempuan</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">No. HP</label>
                <input value={form.no_hp} onChange={e => set('no_hp', e.target.value)} placeholder="08xx-xxxx-xxxx"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Alamat</label>
                <textarea value={form.alamat} onChange={e => set('alamat', e.target.value)}
                  rows={2} placeholder="Alamat lengkap"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status Anggota</label>
                <select value={form.status_anggota} onChange={e => set('status_anggota', e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="aktif">Aktif</option>
                  <option value="non-aktif">Non-aktif</option>
                </select>
              </div>
            </div>
          )}

          {activeTab === 'akun' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Email {!editTarget && '*'}</label>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                    disabled={!!editTarget} placeholder="email@domain.com"
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
                <label className="block text-xs font-medium text-slate-600 mb-1">Role / Hak Akses</label>
                <select value={form.role_id} onChange={e => set('role_id', e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">-- Pilih Role --</option>
                  {roleList.map(r => <option key={r.id} value={r.id}>{r.nama_role} ({r.tingkatan})</option>)}
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
                  <span className="text-sm text-slate-600">Akun aktif (bisa login)</span>
                </label>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-2 border-t border-slate-100">
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
