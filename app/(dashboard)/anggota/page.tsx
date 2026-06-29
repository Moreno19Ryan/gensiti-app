'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Anggota } from '@/lib/types'
import Modal from '@/components/Modal'

interface DesaOpt { id: string; nama_desa: string }
interface KelompokOpt { id: string; nama_kelompok: string; desa_id: string }

const emptyForm = {
  nomor_anggota: '',
  nama_lengkap: '',
  tanggal_lahir: '',
  jenis_kelamin: '',
  alamat: '',
  no_hp: '',
  desa_id: '',
  kelompok_id: '',
  status: 'aktif',
}

export default function AnggotaPage() {
  const { user } = useUser()
  const [data, setData] = useState<Anggota[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Anggota | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [desaList, setDesaList] = useState<DesaOpt[]>([])
  const [kelompokList, setKelompokList] = useState<KelompokOpt[]>([])
  const [filteredKelompok, setFilteredKelompok] = useState<KelompokOpt[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('anggota').select('*').order('nama_lengkap')
    const tingkatan = user?.role?.tingkatan
    if (tingkatan !== 'super_admin' && tingkatan !== 'daerah') {
      if (user?.kelompok_id) query = query.eq('kelompok_id', user.kelompok_id)
      else if (user?.desa_id) query = query.eq('desa_id', user.desa_id)
    }
    const { data: rows } = await query
    setData(rows || [])
    setLoading(false)
  }, [user])

  const loadOptions = useCallback(async () => {
    const [{ data: desa }, { data: kelompok }] = await Promise.all([
      supabase.from('desa').select('id, nama_desa').eq('is_active', true).order('nama_desa'),
      supabase.from('kelompok').select('id, nama_kelompok, desa_id').eq('is_active', true).order('nama_kelompok'),
    ])
    setDesaList(desa || [])
    setKelompokList(kelompok || [])
  }, [])

  useEffect(() => {
    if (user) { loadData(); loadOptions() }
  }, [user, loadData, loadOptions])

  useEffect(() => {
    if (form.desa_id) {
      setFilteredKelompok(kelompokList.filter(k => k.desa_id === form.desa_id))
    } else {
      setFilteredKelompok(kelompokList)
    }
  }, [form.desa_id, kelompokList])

  const openAdd = () => {
    setEditTarget(null)
    const prefix = 'ANG'
    const num = String(data.length + 1).padStart(4, '0')
    setForm({ ...emptyForm, nomor_anggota: `${prefix}-${num}`, desa_id: user?.desa_id || '', kelompok_id: user?.kelompok_id || '' })
    setModalOpen(true)
  }

  const openEdit = (a: Anggota) => {
    setEditTarget(a)
    setForm({
      nomor_anggota: a.nomor_anggota,
      nama_lengkap: a.nama_lengkap,
      tanggal_lahir: a.tanggal_lahir || '',
      jenis_kelamin: a.jenis_kelamin || '',
      alamat: a.alamat || '',
      no_hp: a.no_hp || '',
      desa_id: a.desa_id || '',
      kelompok_id: a.kelompok_id || '',
      status: a.status,
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.nama_lengkap || !form.nomor_anggota) return
    setSaving(true)
    try {
      const payload = {
        nomor_anggota: form.nomor_anggota,
        nama_lengkap: form.nama_lengkap,
        tanggal_lahir: form.tanggal_lahir || null,
        jenis_kelamin: form.jenis_kelamin || null,
        alamat: form.alamat || null,
        no_hp: form.no_hp || null,
        desa_id: form.desa_id || null,
        kelompok_id: form.kelompok_id || null,
        status: form.status,
      }
      if (editTarget) {
        await supabase.from('anggota').update(payload).eq('id', editTarget.id)
      } else {
        await supabase.from('anggota').insert(payload)
      }
      setModalOpen(false)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus anggota ini?')) return
    await supabase.from('anggota').delete().eq('id', id)
    loadData()
  }

  const set = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }))

  const filtered = data.filter(a =>
    a.nama_lengkap.toLowerCase().includes(search.toLowerCase()) ||
    a.nomor_anggota.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Data Anggota</h2>
          <p className="text-slate-400 text-sm">{data.length} anggota terdaftar</p>
        </div>
        <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
          + Tambah Anggota
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="p-4 border-b border-slate-100">
          <input
            type="text"
            placeholder="Cari nama atau nomor anggota..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2" />
            Memuat data...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <div className="text-4xl mb-2">👥</div>
            <p className="font-medium">Belum ada data anggota</p>
            <button onClick={openAdd} className="mt-3 text-blue-600 text-sm font-medium hover:underline">+ Tambah sekarang</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium">No. Anggota</th>
                  <th className="px-4 py-3 font-medium">Nama Lengkap</th>
                  <th className="px-4 py-3 font-medium">Jenis Kelamin</th>
                  <th className="px-4 py-3 font-medium">No. HP</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-mono text-slate-500 text-xs">{a.nomor_anggota}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{a.nama_lengkap}</td>
                    <td className="px-4 py-3 text-slate-600 capitalize">{a.jenis_kelamin || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{a.no_hp || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.status === 'aktif' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 flex items-center gap-3">
                      <button onClick={() => openEdit(a)} className="text-blue-600 hover:text-blue-800 font-medium text-xs">Edit</button>
                      <button onClick={() => handleDelete(a.id)} className="text-red-400 hover:text-red-600 font-medium text-xs">Hapus</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Form */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? 'Edit Anggota' : 'Tambah Anggota'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nomor Anggota *</label>
              <input value={form.nomor_anggota} onChange={e => set('nomor_anggota', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="aktif">Aktif</option>
                <option value="non-aktif">Non-aktif</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nama Lengkap *</label>
            <input value={form.nama_lengkap} onChange={e => set('nama_lengkap', e.target.value)}
              placeholder="Nama lengkap anggota"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
            <input value={form.no_hp} onChange={e => set('no_hp', e.target.value)}
              placeholder="08xx-xxxx-xxxx"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Alamat</label>
            <textarea value={form.alamat} onChange={e => set('alamat', e.target.value)}
              rows={2} placeholder="Alamat lengkap"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Desa</label>
              <select value={form.desa_id} onChange={e => { set('desa_id', e.target.value); set('kelompok_id', '') }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">-- Pilih Desa --</option>
                {desaList.map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Kelompok</label>
              <select value={form.kelompok_id} onChange={e => set('kelompok_id', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">-- Pilih Kelompok --</option>
                {filteredKelompok.map(k => <option key={k.id} value={k.id}>{k.nama_kelompok}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={() => setModalOpen(false)}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
              Batal
            </button>
            <button onClick={handleSave} disabled={saving || !form.nama_lengkap}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
              {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Menyimpan...</> : 'Simpan'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
