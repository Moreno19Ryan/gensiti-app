'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Keuangan } from '@/lib/types'
import Modal from '@/components/Modal'
import { logAudit } from '@/lib/audit'

interface DesaOpt { id: string; nama_desa: string }
interface KelompokOpt { id: string; nama_kelompok: string; desa_id: string }

const emptyForm = {
  jenis: 'pemasukan',
  kategori: '',
  jumlah: '',
  deskripsi: '',
  tanggal: new Date().toISOString().slice(0, 10),
  tingkatan: '',
  desa_id: '',
  kelompok_id: '',
}

export default function KeuanganPage() {
  const { user } = useUser()

  // Super Admin tidak punya akses ke keuangan
  const tingkatan = user?.role?.tingkatan
  const hasAccess = tingkatan && ['daerah', 'desa', 'kelompok'].includes(tingkatan)

  const [data, setData] = useState<Keuangan[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pemasukan' | 'pengeluaran'>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'tanggal_desc' | 'tanggal_asc' | 'jumlah_desc' | 'jumlah_asc'>('tanggal_desc')
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Keuangan | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [desaList, setDesaList] = useState<DesaOpt[]>([])
  const [kelompokList, setKelompokList] = useState<KelompokOpt[]>([])

  const loadData = useCallback(async () => {
    if (!hasAccess) return
    setLoading(true)
    let query = supabase.from('keuangan').select('*')
    const t = user?.role?.tingkatan
    if (t === 'kelompok') {
      if (user?.kelompok_id) query = query.eq('kelompok_id', user.kelompok_id)
    } else if (t === 'desa') {
      if (user?.desa_id) query = query.eq('desa_id', user.desa_id)
    }
    // daerah: lihat semua
    const { data: rows } = await query
    setData(rows || [])
    setLoading(false)
  }, [user, hasAccess])

  useEffect(() => {
    if (user) {
      loadData()
      Promise.all([
        supabase.from('desa').select('id, nama_desa').eq('is_active', true).order('nama_desa'),
        supabase.from('kelompok').select('id, nama_kelompok, desa_id').eq('is_active', true).order('nama_kelompok'),
      ]).then(([{ data: d }, { data: k }]) => {
        setDesaList(d || [])
        setKelompokList(k || [])
      })
    }
  }, [user, loadData])

  const openAdd = () => {
    setEditTarget(null)
    setForm({ ...emptyForm, desa_id: user?.desa_id || '', kelompok_id: user?.kelompok_id || '' })
    setModalOpen(true)
  }

  const openEdit = (k: Keuangan) => {
    setEditTarget(k)
    setForm({
      jenis: k.jenis,
      kategori: k.kategori || '',
      jumlah: String(k.jumlah),
      deskripsi: k.deskripsi || '',
      tanggal: k.tanggal,
      tingkatan: k.tingkatan || '',
      desa_id: k.desa_id || '',
      kelompok_id: k.kelompok_id || '',
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.jumlah || !form.tanggal || !form.kategori || !form.deskripsi || !form.desa_id) return
    setSaving(true)
    try {
      const payload = {
        jenis: form.jenis as 'pemasukan' | 'pengeluaran',
        kategori: form.kategori || null,
        jumlah: parseFloat(form.jumlah.replace(/\./g, '').replace(',', '.')),
        deskripsi: form.deskripsi || null,
        tanggal: form.tanggal,
        tingkatan: form.tingkatan || null,
        desa_id: form.desa_id || null,
        kelompok_id: form.kelompok_id || null,
        dibuat_oleh: user?.id,
      }
      if (editTarget) {
        await supabase.from('keuangan').update(payload).eq('id', editTarget.id)
        if (user) await logAudit(user, 'UPDATE', 'Keuangan', `${form.jenis} - ${form.kategori}`, payload, editTarget.id)
      } else {
        const { data: ins } = await supabase.from('keuangan').insert(payload).select('id').single()
        if (user) await logAudit(user, 'CREATE', 'Keuangan', `${form.jenis} - ${form.kategori} - Rp${form.jumlah}`, payload, ins?.id)
      }
      setModalOpen(false)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string, desc?: string) => {
    if (!confirm('Hapus transaksi ini?')) return
    await supabase.from('keuangan').delete().eq('id', id)
    if (user) await logAudit(user, 'DELETE', 'Keuangan', desc || id, {}, id)
    loadData()
  }

  const set = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }))
  const fmt = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

  const total = {
    pemasukan: data.filter(k => k.jenis === 'pemasukan').reduce((s, k) => s + Number(k.jumlah), 0),
    pengeluaran: data.filter(k => k.jenis === 'pengeluaran').reduce((s, k) => s + Number(k.jumlah), 0),
  }
  const saldo = total.pemasukan - total.pengeluaran

  const filtered = data
    .filter(k => filter === 'all' || k.jenis === filter)
    .filter(k => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        k.kategori?.toLowerCase().includes(q) ||
        k.deskripsi?.toLowerCase().includes(q) ||
        (k as any).nomor_transaksi?.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      if (sortBy === 'tanggal_desc') return new Date(b.tanggal).getTime() - new Date(a.tanggal).getTime()
      if (sortBy === 'tanggal_asc') return new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime()
      if (sortBy === 'jumlah_desc') return Number(b.jumlah) - Number(a.jumlah)
      if (sortBy === 'jumlah_asc') return Number(a.jumlah) - Number(b.jumlah)
      return 0
    })

  const kategoriOptions = form.jenis === 'pemasukan'
    ? ['Iuran', 'Donasi', 'Bantuan', 'Lainnya']
    : ['Operasional', 'Konsumsi', 'Transport', 'Perlengkapan', 'Lainnya']

  // Blokir akses Super Admin
  if (!hasAccess) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🔒</div>
        <p className="font-semibold text-slate-600">Akses Dibatasi</p>
        <p className="text-sm mt-1">Menu Keuangan hanya tersedia untuk role Daerah, Desa, dan Kelompok.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-800">Keuangan</h2>
        <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
          + Tambah Transaksi
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <p className="text-slate-500 text-sm">Pemasukan</p>
          <p className="text-xl font-bold text-emerald-600 mt-1">{fmt(total.pemasukan)}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <p className="text-slate-500 text-sm">Pengeluaran</p>
          <p className="text-xl font-bold text-red-500 mt-1">{fmt(total.pengeluaran)}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <p className="text-slate-500 text-sm">Saldo</p>
          <p className={`text-xl font-bold mt-1 ${saldo >= 0 ? 'text-blue-600' : 'text-red-500'}`}>{fmt(saldo)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Cari kategori, deskripsi, no. transaksi..."
          className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="tanggal_desc">Terbaru</option>
          <option value="tanggal_asc">Terlama</option>
          <option value="jumlah_desc">Jumlah Terbesar</option>
          <option value="jumlah_asc">Jumlah Terkecil</option>
        </select>
        {(['all', 'pemasukan', 'pengeluaran'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition capitalize ${filter === f ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}>
            {f === 'all' ? 'Semua' : f}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <div className="text-4xl mb-2">💰</div>
            <p>Belum ada transaksi</p>
            <button onClick={openAdd} className="mt-3 text-blue-600 text-sm font-medium hover:underline">+ Tambah sekarang</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium">No. Transaksi</th>
                  <th className="px-4 py-3 font-medium">Tanggal</th>
                  <th className="px-4 py-3 font-medium">Jenis</th>
                  <th className="px-4 py-3 font-medium">Kategori</th>
                  <th className="px-4 py-3 font-medium">Deskripsi</th>
                  <th className="px-4 py-3 font-medium text-right">Jumlah</th>
                  <th className="px-4 py-3 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(k => (
                  <tr key={k.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-slate-400">{(k as any).nomor_transaksi || '-'}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(k.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${k.jenis === 'pemasukan' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {k.jenis}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{k.kategori || '-'}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{k.deskripsi || '-'}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${k.jenis === 'pemasukan' ? 'text-emerald-600' : 'text-red-500'}`}>
                      {k.jenis === 'pengeluaran' ? '-' : '+'}{fmt(Number(k.jumlah))}
                    </td>
                    <td className="px-4 py-3 flex gap-3">
                      <button onClick={() => openEdit(k)} className="text-blue-600 hover:text-blue-800 font-medium text-xs">Edit</button>
                      <button onClick={() => handleDelete(k.id, `${k.jenis} - ${k.kategori}`)} className="text-red-400 hover:text-red-600 font-medium text-xs">Hapus</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? 'Edit Transaksi' : 'Tambah Transaksi'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Jenis *</label>
              <select value={form.jenis} onChange={e => { set('jenis', e.target.value); set('kategori', '') }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="pemasukan">Pemasukan</option>
                <option value="pengeluaran">Pengeluaran</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Kategori</label>
              <select value={form.kategori} onChange={e => set('kategori', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">-- Pilih --</option>
                {kategoriOptions.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Jumlah (Rp) *</label>
              <input type="number" value={form.jumlah} onChange={e => set('jumlah', e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal *</label>
              <input type="date" value={form.tanggal} onChange={e => set('tanggal', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Deskripsi *</label>
            <textarea value={form.deskripsi} onChange={e => set('deskripsi', e.target.value)} rows={2}
              placeholder="Keterangan transaksi..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Desa *</label>
            <select value={form.desa_id} onChange={e => set('desa_id', e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">-- Pilih Desa --</option>
              {desaList.map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
            </select>
          </div>


          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button onClick={() => setModalOpen(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
              Batal
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
