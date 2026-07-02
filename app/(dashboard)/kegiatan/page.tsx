'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Kegiatan } from '@/lib/types'
import { logAudit } from '@/lib/audit'
import { canManageMembers } from '@/lib/roles'
import Modal from '@/components/Modal'
import PresensiPanel from '@/components/PresensiPanel'
import { exportToPDF, exportToExcel } from '@/lib/export'

interface DesaOpt { id: string; nama_desa: string }
interface KelompokOpt { id: string; nama_kelompok: string; desa_id: string }

const statusLabel: Record<string, { label: string; color: string }> = {
  upcoming: { label: 'Akan Datang', color: 'bg-blue-100 text-blue-700' },
  ongoing: { label: 'Berlangsung', color: 'bg-green-100 text-green-700' },
  selesai: { label: 'Selesai', color: 'bg-slate-100 text-slate-500' },
}

// Badge status approval PPG -- hanya relevan utk kegiatan tingkat Daerah.
const approvalLabel: Record<string, { label: string; color: string }> = {
  menunggu_ppg: { label: '⏳ Menunggu Persetujuan PPG', color: 'bg-amber-100 text-amber-700' },
  disetujui: { label: '✓ Disetujui PPG', color: 'bg-green-100 text-green-700' },
  ditolak: { label: '✕ Ditolak PPG', color: 'bg-red-100 text-red-600' },
}

const emptyForm = {
  nama_kegiatan: '',
  deskripsi: '',
  tanggal_mulai: '',
  tanggal_selesai: '',
  lokasi: '',
  tingkatan: '',
  desa_id: '',
  kelompok_id: '',
  status: 'upcoming',
}

export default function KegiatanPage() {
  const { user } = useUser()
  const [data, setData] = useState<Kegiatan[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'terbaru' | 'terlama' | 'nama_asc'>('terbaru')
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Kegiatan | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [desaList, setDesaList] = useState<DesaOpt[]>([])
  const [kelompokList, setKelompokList] = useState<KelompokOpt[]>([])
  const [exporting, setExporting] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('kegiatan').select('*').order('tanggal_mulai', { ascending: false })
    const t = user?.role?.tingkatan
    if (t !== 'super_admin' && t !== 'daerah') {
      if (user?.kelompok_id) query = query.eq('kelompok_id', user.kelompok_id)
      else if (user?.desa_id) query = query.eq('desa_id', user.desa_id)
    }
    const { data: rows } = await query
    setData(rows || [])
    setLoading(false)
  }, [user])

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

  const openEdit = (k: Kegiatan) => {
    setEditTarget(k)
    setForm({
      nama_kegiatan: k.nama_kegiatan,
      deskripsi: k.deskripsi || '',
      tanggal_mulai: k.tanggal_mulai ? k.tanggal_mulai.slice(0, 16) : '',
      tanggal_selesai: k.tanggal_selesai ? k.tanggal_selesai.slice(0, 16) : '',
      lokasi: k.lokasi || '',
      tingkatan: k.tingkatan || '',
      desa_id: k.desa_id || '',
      kelompok_id: k.kelompok_id || '',
      status: k.status,
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.nama_kegiatan || !form.deskripsi || !form.tanggal_mulai || !form.tanggal_selesai || !form.lokasi || !form.desa_id || !form.kelompok_id) return
    setSaving(true)
    try {
      const payload = {
        nama_kegiatan: form.nama_kegiatan,
        deskripsi: form.deskripsi,
        tanggal_mulai: form.tanggal_mulai,
        tanggal_selesai: form.tanggal_selesai,
        lokasi: form.lokasi,
        tingkatan: form.tingkatan || null,
        desa_id: form.desa_id,
        kelompok_id: form.kelompok_id,
        status: form.status,
        dibuat_oleh: user?.id,
      }
      if (editTarget) {
        await supabase.from('kegiatan').update(payload).eq('id', editTarget.id)
        if (user) await logAudit(user, 'UPDATE', 'Kegiatan', form.nama_kegiatan, payload, editTarget.id)
      } else {
        const { data: inserted } = await supabase.from('kegiatan').insert(payload).select('id').single()
        if (user) await logAudit(user, 'CREATE', 'Kegiatan', form.nama_kegiatan, payload, inserted?.id)
      }
      setModalOpen(false)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus kegiatan ini?')) return
    const target = data.find(k => k.id === id)
    await supabase.from('kegiatan').delete().eq('id', id)
    if (user) await logAudit(user, 'DELETE', 'Kegiatan', target?.nama_kegiatan || id, undefined, id)
    loadData()
  }

  // Hanya Ketua/Wakil Ketua (semua jenjang) dan Super Admin yang boleh kelola kegiatan.
  // Ru'yah biasa dan pengurus non-Ketua (Sekretaris, Bendahara, dll) hanya bisa melihat.
  const canManage = canManageMembers(user)

  // Hanya Super Admin dan Daerah yang boleh memilih desa/kelompok manapun saat membuat kegiatan.
  // Pengurus Desa/Kelompok dikunci ke scope-nya sendiri — RLS di database juga sudah menegakkan
  // ini, tapi mengunci di UI mencegah submit gagal dengan error yang membingungkan.
  const tingkatanUser = user?.role?.tingkatan
  const canPickScope = tingkatanUser === 'super_admin' || tingkatanUser === 'daerah'

  const set = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }))
  const fmt = (t: string | null) => t ? new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'
  const filtered = data
    .filter(k => filter === 'all' || k.status === filter)
    .filter(k => {
      if (!search) return true
      const q = search.toLowerCase()
      return k.nama_kegiatan?.toLowerCase().includes(q) || k.lokasi?.toLowerCase().includes(q) || k.deskripsi?.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      if (sortBy === 'terbaru') return new Date(b.tanggal_mulai || '').getTime() - new Date(a.tanggal_mulai || '').getTime()
      if (sortBy === 'terlama') return new Date(a.tanggal_mulai || '').getTime() - new Date(b.tanggal_mulai || '').getTime()
      if (sortBy === 'nama_asc') return a.nama_kegiatan.localeCompare(b.nama_kegiatan)
      return 0
    })

  // Export daftar/riwayat kegiatan -- pakai `filtered` (pencarian + filter status yang
  // sedang aktif), supaya laporan selalu konsisten dengan apa yang sedang dilihat user.
  const exportColumns = [
    { header: 'Kode', key: 'kode', width: 16 },
    { header: 'Nama Kegiatan', key: 'nama', width: 28 },
    { header: 'Tanggal Mulai', key: 'mulai', width: 18 },
    { header: 'Tanggal Selesai', key: 'selesai', width: 18 },
    { header: 'Lokasi', key: 'lokasi', width: 22 },
    { header: 'Jenjang', key: 'jenjang', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
  ]

  const buildExportData = () => filtered.map(k => ({
    kode: k.kode_kegiatan || '-',
    nama: k.nama_kegiatan,
    mulai: k.tanggal_mulai ? new Date(k.tanggal_mulai).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-',
    selesai: k.tanggal_selesai ? new Date(k.tanggal_selesai).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-',
    lokasi: k.lokasi || '-',
    jenjang: k.tingkatan ? k.tingkatan.charAt(0).toUpperCase() + k.tingkatan.slice(1) : '-',
    status: statusLabel[k.status]?.label || k.status,
  }))

  const exportSubtitle = () => {
    const scope = tingkatanUser === 'kelompok' ? user?.kelompok?.nama_kelompok
      : tingkatanUser === 'desa' ? user?.desa?.nama_desa
      : 'Se-Bekasi Timur'
    const statusTxt = filter === 'all' ? 'Semua Status' : statusLabel[filter]?.label || filter
    return `${scope} -- ${statusTxt} -- ${filtered.length} kegiatan`
  }

  const handleExportPDF = async () => {
    if (filtered.length === 0) { alert('Tidak ada data untuk diexport.'); return }
    setExporting(true)
    try {
      exportToPDF({
        title: 'Daftar Kegiatan',
        subtitle: exportSubtitle(),
        columns: exportColumns,
        rows: buildExportData(),
        fileName: `Daftar-Kegiatan-${new Date().toISOString().slice(0, 10)}`,
      })
      if (user) await logAudit(user, 'EXPORT', 'Kegiatan', `PDF -- ${filtered.length} kegiatan`)
    } finally {
      setExporting(false)
    }
  }

  const handleExportExcel = async () => {
    if (filtered.length === 0) { alert('Tidak ada data untuk diexport.'); return }
    setExporting(true)
    try {
      await exportToExcel({
        title: 'Daftar Kegiatan',
        subtitle: exportSubtitle(),
        columns: exportColumns,
        rows: buildExportData(),
        fileName: `Daftar-Kegiatan-${new Date().toISOString().slice(0, 10)}`,
      })
      if (user) await logAudit(user, 'EXPORT', 'Kegiatan', `Excel -- ${filtered.length} kegiatan`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-bold text-slate-800">Kegiatan</h2>
          <p className="text-slate-400 text-sm">{data.length} kegiatan total</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Export daftar kegiatan dibatasi ke yang berwenang mengelola kegiatan (Ketua/Wakil/
              Super Admin), konsisten dengan tombol "+ Tambah Kegiatan" -- ru'yah biasa boleh
              melihat daftar kegiatan tapi tidak perlu bisa export laporan ke PDF/Excel. */}
          {canManage && (
            <>
              <button onClick={handleExportPDF} disabled={exporting}
                className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition disabled:opacity-50 flex items-center gap-1.5">
                📄 PDF
              </button>
              <button onClick={handleExportExcel} disabled={exporting}
                className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition disabled:opacity-50 flex items-center gap-1.5">
                📊 Excel
              </button>
              <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
                + Tambah Kegiatan
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input type="text" placeholder="Cari nama, lokasi, atau deskripsi..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="terbaru">Terbaru</option>
          <option value="terlama">Terlama</option>
          <option value="nama_asc">Nama A–Z</option>
        </select>
        {['all', 'upcoming', 'ongoing', 'selesai'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition ${filter === s ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}>
            {s === 'all' ? 'Semua' : statusLabel[s]?.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">📅</div>
          <p>Belum ada kegiatan</p>
          {canManage && <button onClick={openAdd} className="mt-3 text-blue-600 text-sm font-medium hover:underline">+ Tambah sekarang</button>}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(k => (
            <div key={k.id} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-800">{k.nama_kegiatan}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusLabel[k.status]?.color}`}>{statusLabel[k.status]?.label}</span>
                    {k.kode_kegiatan && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-slate-100 text-slate-500">{k.kode_kegiatan}</span>
                    )}
                    {k.tingkatan === 'daerah' && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${approvalLabel[k.status_approval]?.color}`}>
                        {approvalLabel[k.status_approval]?.label}
                      </span>
                    )}
                  </div>
                  {k.deskripsi && <p className="text-slate-500 text-sm mt-1 line-clamp-2">{k.deskripsi}</p>}
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                    {k.tanggal_mulai && <span>📅 {fmt(k.tanggal_mulai)}{k.tanggal_selesai ? ` – ${fmt(k.tanggal_selesai)}` : ''}</span>}
                    {k.lokasi && <span>📍 {k.lokasi}</span>}
                  </div>
                  {k.tingkatan === 'daerah' && k.status_approval === 'ditolak' && k.catatan_ppg && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">
                      <span className="font-medium">Catatan PPG:</span> {k.catatan_ppg}
                    </div>
                  )}
                </div>
                {canManage && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => openEdit(k)} className="text-blue-600 hover:text-blue-800 font-medium text-xs">Edit</button>
                    <button onClick={() => handleDelete(k.id)} className="text-red-400 hover:text-red-600 font-medium text-xs">Hapus</button>
                  </div>
                )}
              </div>
              <PresensiPanel
                kegiatan={k}
                user={user}
                onUpdated={updated => setData(prev => prev.map(item => item.id === updated.id ? updated : item))}
              />
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? 'Edit Kegiatan' : 'Tambah Kegiatan'} size="lg">
        <div className="space-y-4">
          {editTarget && editTarget.kode_kegiatan && (
            <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-xs text-slate-400">Kode Kegiatan</span>
              <span className="font-mono text-sm font-semibold text-slate-600">{editTarget.kode_kegiatan}</span>
              <span className="text-xs text-slate-400 ml-auto">Auto-generate</span>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nama Kegiatan *</label>
            <input value={form.nama_kegiatan} onChange={e => set('nama_kegiatan', e.target.value)}
              placeholder="Nama kegiatan"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Deskripsi *</label>
            <textarea value={form.deskripsi} onChange={e => set('deskripsi', e.target.value)}
              rows={3} placeholder="Deskripsi kegiatan..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal Mulai *</label>
              <input type="datetime-local" value={form.tanggal_mulai} onChange={e => set('tanggal_mulai', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal Selesai *</label>
              <input type="datetime-local" value={form.tanggal_selesai} onChange={e => set('tanggal_selesai', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Lokasi *</label>
              <input value={form.lokasi} onChange={e => set('lokasi', e.target.value)}
                placeholder="Lokasi kegiatan"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status *</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="upcoming">Akan Datang</option>
                <option value="ongoing">Berlangsung</option>
                <option value="selesai">Selesai</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Desa *</label>
              <select value={form.desa_id} onChange={e => { set('desa_id', e.target.value); set('kelompok_id', '') }}
                disabled={!canPickScope}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed">
                <option value="">-- Pilih Desa --</option>
                {desaList.map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Kelompok *</label>
              <select value={form.kelompok_id} onChange={e => set('kelompok_id', e.target.value)}
                disabled={!canPickScope && tingkatanUser === 'kelompok'}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed">
                <option value="">-- Pilih Kelompok --</option>
                {kelompokList.filter(k => !form.desa_id || k.desa_id === form.desa_id).map(k => (
                  <option key={k.id} value={k.id}>{k.nama_kelompok}</option>
                ))}
              </select>
            </div>
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
