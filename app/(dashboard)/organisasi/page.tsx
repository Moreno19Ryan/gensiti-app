'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import Modal from '@/components/Modal'
import { Tingkatan } from '@/lib/types'

type Tab = 'desa' | 'kelompok' | 'role'

interface Desa {
  id: string
  nama_desa: string
  created_at: string
}

interface Kelompok {
  id: string
  nama_kelompok: string
  desa_id: string
  created_at: string
  desa?: { nama_desa: string }
}

interface RoleRow {
  id: string
  nama_role: string
  tingkatan: Tingkatan
  deskripsi: string | null
  created_at: string
  _userCount?: number
}

const TINGKATAN_OPTIONS: { value: Tingkatan; label: string }[] = [
  { value: 'daerah', label: 'Daerah' },
  { value: 'desa', label: 'Desa' },
  { value: 'kelompok', label: 'Kelompok' },
  { value: 'ppg', label: 'PPG' },
]

const tingkatanBadgeColor: Record<string, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  daerah: 'bg-blue-100 text-blue-700',
  desa: 'bg-green-100 text-green-700',
  kelompok: 'bg-amber-100 text-amber-700',
  ppg: 'bg-pink-100 text-pink-700',
}

export default function OrganisasiPage() {
  const { user } = useUser()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('desa')

  const [desaList, setDesaList] = useState<Desa[]>([])
  const [kelompokList, setKelompokList] = useState<Kelompok[]>([])
  const [loading, setLoading] = useState(true)

  const [desaModalOpen, setDesaModalOpen] = useState(false)
  const [desaEditTarget, setDesaEditTarget] = useState<Desa | null>(null)
  const [desaForm, setDesaForm] = useState({ nama_desa: '' })
  const [desaError, setDesaError] = useState('')
  const [desaSaving, setDesaSaving] = useState(false)
  const [desaDeleteTarget, setDesaDeleteTarget] = useState<Desa | null>(null)
  const [desaDeleteError, setDesaDeleteError] = useState('')
  const [desaDeleting, setDesaDeleting] = useState(false)

  const [kelompokModalOpen, setKelompokModalOpen] = useState(false)
  const [kelompokEditTarget, setKelompokEditTarget] = useState<Kelompok | null>(null)
  const [kelompokForm, setKelompokForm] = useState({ nama_kelompok: '', desa_id: '' })
  const [kelompokError, setKelompokError] = useState('')
  const [kelompokSaving, setKelompokSaving] = useState(false)
  const [kelompokDeleteTarget, setKelompokDeleteTarget] = useState<Kelompok | null>(null)
  const [kelompokDeleteError, setKelompokDeleteError] = useState('')
  const [kelompokDeleting, setKelompokDeleting] = useState(false)

  useEffect(() => {
    if (user && user.role?.tingkatan !== 'super_admin') {
      router.replace('/dashboard')
    }
  }, [user, router])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: desaData }, { data: kelompokData }] = await Promise.all([
      supabase.from('desa').select('*').order('nama_desa'),
      supabase.from('kelompok').select('*, desa:desa_id(nama_desa)').order('nama_kelompok'),
    ])
    setDesaList(desaData || [])
    setKelompokList(kelompokData || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const openAddDesa = () => {
    setDesaEditTarget(null)
    setDesaError('')
    setDesaForm({ nama_desa: '' })
    setDesaModalOpen(true)
  }

  const openEditDesa = (d: Desa) => {
    setDesaEditTarget(d)
    setDesaError('')
    setDesaForm({ nama_desa: d.nama_desa })
    setDesaModalOpen(true)
  }

  const saveDesa = async () => {
    setDesaError('')
    if (!desaForm.nama_desa.trim()) { setDesaError('Nama desa wajib diisi'); return }
    setDesaSaving(true)
    try {
      const payload = { nama_desa: desaForm.nama_desa.trim() }
      if (desaEditTarget) {
        const { error: err } = await supabase.from('desa').update(payload).eq('id', desaEditTarget.id)
        if (err) { setDesaError(err.message); return }
        if (user) await logAudit(user, 'UPDATE', 'Organisasi & Role - Desa', desaForm.nama_desa, payload, desaEditTarget.id)
      } else {
        const { data: inserted, error: err } = await supabase.from('desa').insert(payload).select('id').single()
        if (err) { setDesaError(err.message); return }
        if (user) await logAudit(user, 'CREATE', 'Organisasi & Role - Desa', desaForm.nama_desa, payload, inserted?.id)
      }
      setDesaModalOpen(false)
      loadData()
    } finally {
      setDesaSaving(false)
    }
  }

  const confirmDeleteDesa = async () => {
    if (!desaDeleteTarget) return
    setDesaDeleteError('')
    setDesaDeleting(true)
    try {
      const { error: err } = await supabase.from('desa').delete().eq('id', desaDeleteTarget.id)
      if (err) { setDesaDeleteError(err.message); return }
      if (user) await logAudit(user, 'DELETE', 'Organisasi & Role - Desa', desaDeleteTarget.nama_desa, {}, desaDeleteTarget.id)
      setDesaDeleteTarget(null)
      loadData()
    } finally {
      setDesaDeleting(false)
    }
  }

  const openAddKelompok = () => {
    setKelompokEditTarget(null)
    setKelompokError('')
    setKelompokForm({ nama_kelompok: '', desa_id: desaList[0]?.id || '' })
    setKelompokModalOpen(true)
  }

  const openEditKelompok = (k: Kelompok) => {
    setKelompokEditTarget(k)
    setKelompokError('')
    setKelompokForm({ nama_kelompok: k.nama_kelompok, desa_id: k.desa_id })
    setKelompokModalOpen(true)
  }

  const saveKelompok = async () => {
    setKelompokError('')
    if (!kelompokForm.nama_kelompok.trim()) { setKelompokError('Nama kelompok wajib diisi'); return }
    if (!kelompokForm.desa_id) { setKelompokError('Desa wajib dipilih'); return }
    setKelompokSaving(true)
    try {
      const payload = { nama_kelompok: kelompokForm.nama_kelompok.trim(), desa_id: kelompokForm.desa_id }
      if (kelompokEditTarget) {
        const { error: err } = await supabase.from('kelompok').update(payload).eq('id', kelompokEditTarget.id)
        if (err) { setKelompokError(err.message); return }
        if (user) await logAudit(user, 'UPDATE', 'Organisasi & Role - Kelompok', kelompokForm.nama_kelompok, payload, kelompokEditTarget.id)
      } else {
        const { data: inserted, error: err } = await supabase.from('kelompok').insert(payload).select('id').single()
        if (err) { setKelompokError(err.message); return }
        if (user) await logAudit(user, 'CREATE', 'Organisasi & Role - Kelompok', kelompokForm.nama_kelompok, payload, inserted?.id)
      }
      setKelompokModalOpen(false)
      loadData()
    } finally {
      setKelompokSaving(false)
    }
  }

  const confirmDeleteKelompok = async () => {
    if (!kelompokDeleteTarget) return
    setKelompokDeleteError('')
    setKelompokDeleting(true)
    try {
      const { error: err } = await supabase.from('kelompok').delete().eq('id', kelompokDeleteTarget.id)
      if (err) { setKelompokDeleteError(err.message); return }
      if (user) await logAudit(user, 'DELETE', 'Organisasi & Role - Kelompok', kelompokDeleteTarget.nama_kelompok, {}, kelompokDeleteTarget.id)
      setKelompokDeleteTarget(null)
      loadData()
    } finally {
      setKelompokDeleting(false)
    }
  }

  if (!user || user.role?.tingkatan !== 'super_admin') return null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Organisasi & Role</h1>
        <p className="text-slate-500 text-sm mt-1">Kelola struktur Desa, Kelompok, dan master data Role</p>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        {([
          { key: 'desa', label: '🏘️ Desa' },
          { key: 'kelompok', label: '👨‍👩‍👧‍👦 Kelompok' },
          { key: 'role', label: '🎭 Role' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* === DESA TAB === */}
      {tab === 'desa' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={openAddDesa} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
              + Tambah Desa
            </button>
          </div>

          {loading ? (
            <div className="bg-white rounded-2xl p-8 text-center">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                    <th className="px-4 py-3 font-medium">Nama Desa</th>
                    <th className="px-4 py-3 font-medium">Jumlah Kelompok</th>
                    <th className="px-4 py-3 font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {desaList.map(d => (
                    <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                      <td className="px-4 py-3 font-medium text-slate-800">{d.nama_desa}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {kelompokList.filter(k => k.desa_id === d.id).length} kelompok
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <button onClick={() => openEditDesa(d)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
                          <button onClick={() => { setDesaDeleteTarget(d); setDesaDeleteError('') }} className="text-red-500 hover:text-red-700 text-xs font-medium">Hapus</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Modal open={desaModalOpen} onClose={() => setDesaModalOpen(false)} title={desaEditTarget ? `Edit Desa: ${desaEditTarget.nama_desa}` : 'Tambah Desa'} size="sm">
            <div className="space-y-4">
              {desaError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{desaError}</div>}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nama Desa *</label>
                <input value={desaForm.nama_desa} onChange={e => setDesaForm({ nama_desa: e.target.value })}
                  placeholder="Nama desa"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex gap-3 pt-2 border-t border-slate-100">
                <button onClick={() => setDesaModalOpen(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
                <button onClick={saveDesa} disabled={desaSaving}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
                  {desaSaving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Simpan'}
                </button>
              </div>
            </div>
          </Modal>

          <Modal open={!!desaDeleteTarget} onClose={() => setDesaDeleteTarget(null)} title="Hapus Desa?" size="sm">
            <div className="space-y-4">
              {desaDeleteError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{desaDeleteError}</div>}
              <p className="text-sm text-slate-600">
                Yakin ingin menghapus desa <strong>{desaDeleteTarget?.nama_desa}</strong>? Aksi ini tidak dapat dibatalkan.
              </p>
              <div className="flex gap-3 pt-2 border-t border-slate-100">
                <button onClick={() => setDesaDeleteTarget(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
                <button onClick={confirmDeleteDesa} disabled={desaDeleting}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:bg-red-300 transition flex items-center justify-center gap-2">
                  {desaDeleting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Ya, Hapus'}
                </button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {/* === KELOMPOK TAB === */}
      {tab === 'kelompok' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={openAddKelompok} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
              + Tambah Kelompok
            </button>
          </div>

          {loading ? (
            <div className="bg-white rounded-2xl p-8 text-center">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                    <th className="px-4 py-3 font-medium">Nama Kelompok</th>
                    <th className="px-4 py-3 font-medium">Desa</th>
                    <th className="px-4 py-3 font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {kelompokList.map(k => (
                    <tr key={k.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                      <td className="px-4 py-3 font-medium text-slate-800">{k.nama_kelompok}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{k.desa?.nama_desa || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <button onClick={() => openEditKelompok(k)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
                          <button onClick={() => { setKelompokDeleteTarget(k); setKelompokDeleteError('') }} className="text-red-500 hover:text-red-700 text-xs font-medium">Hapus</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Modal open={kelompokModalOpen} onClose={() => setKelompokModalOpen(false)} title={kelompokEditTarget ? `Edit Kelompok: ${kelompokEditTarget.nama_kelompok}` : 'Tambah Kelompok'} size="sm">
            <div className="space-y-4">
              {kelompokError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{kelompokError}</div>}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nama Kelompok *</label>
                <input value={kelompokForm.nama_kelompok} onChange={e => setKelompokForm(f => ({ ...f, nama_kelompok: e.target.value }))}
                  placeholder="Nama kelompok"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Desa</label>
                <select value={kelompokForm.desa_id} onChange={e => setKelompokForm(f => ({ ...f, desa_id: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {desaList.map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2 border-t border-slate-100">
                <button onClick={() => setKelompokModalOpen(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
                <button onClick={saveKelompok} disabled={kelompokSaving}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
                  {kelompokSaving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Simpan'}
                </button>
              </div>
            </div>
          </Modal>

          <Modal open={!!kelompokDeleteTarget} onClose={() => setKelompokDeleteTarget(null)} title="Hapus Kelompok?" size="sm">
            <div className="space-y-4">
              {kelompokDeleteError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{kelompokDeleteError}</div>}
              <p className="text-sm text-slate-600">
                Yakin ingin menghapus kelompok <strong>{kelompokDeleteTarget?.nama_kelompok}</strong>? Aksi ini tidak dapat dibatalkan.
              </p>
              <div className="flex gap-3 pt-2 border-t border-slate-100">
                <button onClick={() => setKelompokDeleteTarget(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
                <button onClick={confirmDeleteKelompok} disabled={kelompokDeleting}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:bg-red-300 transition flex items-center justify-center gap-2">
                  {kelompokDeleting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Ya, Hapus'}
                </button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {/* === ROLE TAB === */}
      {tab === 'role' && user && <RoleTab user={user} />}
    </div>
  )
}

// ============================= TAB ROLE =============================

function RoleTab({ user }: { user: NonNullable<ReturnType<typeof useUser>['user']> }) {
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<RoleRow | null>(null)
  const [form, setForm] = useState<{ nama_role: string; tingkatan: Tingkatan; deskripsi: string }>({ nama_role: '', tingkatan: 'kelompok', deskripsi: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const loadRoles = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('roles').select('*').order('tingkatan').order('nama_role')
    const rolesWithCount = await Promise.all(
      (data || []).map(async (r) => {
        const { count } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('role_id', r.id)
        return { ...r, _userCount: count ?? 0 }
      })
    )
    setRoles(rolesWithCount)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadRoles()
  }, [loadRoles])

  const openAdd = () => {
    setEditTarget(null)
    setError('')
    setForm({ nama_role: '', tingkatan: 'kelompok', deskripsi: '' })
    setModalOpen(true)
  }

  const openEdit = (r: RoleRow) => {
    setEditTarget(r)
    setError('')
    setForm({ nama_role: r.nama_role, tingkatan: r.tingkatan, deskripsi: r.deskripsi || '' })
    setModalOpen(true)
  }

  const save = async () => {
    setError('')
    if (!form.nama_role.trim()) { setError('Nama role wajib diisi'); return }

    // Proteksi tambahan di client (selain CHECK constraint & TINGKATAN_OPTIONS yang sudah
    // membatasi pilihan) -- kalau suatu saat ada cara lain nilai 'super_admin' lolos ke form
    // ini, tetap ditolak eksplisit di sini sebelum sempat dikirim ke database.
    if ((form.tingkatan as string) === 'super_admin') {
      setError('Tidak dapat membuat/mengubah role menjadi tingkatan Super Admin -- akun ini bersifat tunggal & mutlak.')
      return
    }

    setSaving(true)
    try {
      const payload = { nama_role: form.nama_role.trim(), tingkatan: form.tingkatan, deskripsi: form.deskripsi.trim() || null }
      if (editTarget) {
        const { error: err } = await supabase.from('roles').update(payload).eq('id', editTarget.id)
        if (err) { setError(err.message); return }
        await logAudit(user, 'UPDATE', 'Organisasi & Role - Role', form.nama_role, payload, editTarget.id)
      } else {
        const { data: inserted, error: err } = await supabase.from('roles').insert(payload).select('id').single()
        if (err) { setError(err.message); return }
        await logAudit(user, 'CREATE', 'Organisasi & Role - Role', form.nama_role, payload, inserted?.id)
      }
      setModalOpen(false)
      loadRoles()
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleteError('')
    if (deleteTarget._userCount && deleteTarget._userCount > 0) {
      setDeleteError(`Tidak dapat menghapus -- masih dipakai oleh ${deleteTarget._userCount} pengguna. Pindahkan pengguna tsb ke role lain terlebih dahulu.`)
      return
    }
    setDeleting(true)
    try {
      const { error: err } = await supabase.from('roles').delete().eq('id', deleteTarget.id)
      if (err) { setDeleteError(err.message); return }
      await logAudit(user, 'DELETE', 'Organisasi & Role - Role', deleteTarget.nama_role, {}, deleteTarget.id)
      setDeleteTarget(null)
      loadRoles()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
          + Tambah Role
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 font-medium">Nama Role</th>
                <th className="px-4 py-3 font-medium">Tingkatan</th>
                <th className="px-4 py-3 font-medium">Deskripsi</th>
                <th className="px-4 py-3 font-medium">Pengguna</th>
                <th className="px-4 py-3 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {roles.map(r => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.nama_role}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tingkatanBadgeColor[r.tingkatan] || 'bg-slate-100 text-slate-500'}`}>
                      {r.tingkatan}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-xs truncate" title={r.deskripsi || ''}>{r.deskripsi || '-'}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{r._userCount ?? '-'} pengguna</td>
                  <td className="px-4 py-3">
                    {r.tingkatan === 'super_admin' ? (
                      <span className="text-xs text-slate-300 italic">Permanen (sistem)</span>
                    ) : (
                      <div className="flex gap-3">
                        <button onClick={() => openEdit(r)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
                        <button onClick={() => { setDeleteTarget(r); setDeleteError('') }} className="text-red-500 hover:text-red-700 text-xs font-medium">Hapus</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Tambah/Edit */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? `Edit Role: ${editTarget.nama_role}` : 'Tambah Role'} size="sm">
        <div className="space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nama Role *</label>
            <input value={form.nama_role} onChange={e => setForm(f => ({ ...f, nama_role: e.target.value }))}
              placeholder="mis. Bendahara"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tingkatan *</label>
            <select value={form.tingkatan} onChange={e => setForm(f => ({ ...f, tingkatan: e.target.value as Tingkatan }))}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TINGKATAN_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">Menentukan jenjang/scope kewenangan pemegang role ini.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Deskripsi</label>
            <textarea value={form.deskripsi} onChange={e => setForm(f => ({ ...f, deskripsi: e.target.value }))}
              rows={2} placeholder="Opsional -- keterangan singkat tugas role ini"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button onClick={() => setModalOpen(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
              {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Simpan'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal Konfirmasi Hapus */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Hapus Role?" size="sm">
        <div className="space-y-4">
          {deleteError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{deleteError}</div>}
          <p className="text-sm text-slate-600">
            Yakin ingin menghapus role <strong>{deleteTarget?.nama_role}</strong>?
            {deleteTarget?._userCount ? ` Role ini masih dipakai oleh ${deleteTarget._userCount} pengguna.` : ' Aksi ini tidak dapat dibatalkan.'}
          </p>
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
            <button onClick={confirmDelete} disabled={deleting || !!(deleteTarget?._userCount)}
              className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:bg-red-300 transition flex items-center justify-center gap-2">
              {deleting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Ya, Hapus'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
