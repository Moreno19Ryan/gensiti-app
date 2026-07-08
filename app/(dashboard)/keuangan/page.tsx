'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Keuangan } from '@/lib/types'
import Modal from '@/components/Modal'
import ExportPreviewModal from '@/components/ExportPreviewModal'
import { logAudit } from '@/lib/audit'
import { isGenerusBiasa, isPengurus } from '@/lib/roles'
import { ExportOptions } from '@/lib/export'

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

const KATEGORI_SEMUA = ['Iuran', 'Donasi', 'Bantuan', 'Operasional', 'Konsumsi', 'Transport', 'Perlengkapan', 'Lainnya']

export default function KeuanganPage() {
  const { user } = useUser()

  // Super Admin dan Generus biasa (role 'Generus') tidak punya akses ke keuangan —
  // keuangan adalah privilese Pengurus Muda-Mudi di jenjang Daerah/Desa/Kelompok.
  // PPG juga bisa MELIHAT (read-only, pengawasan lintas Bekasi Timur) tapi tidak mengelola --
  // lihat guard canManage di bawah utk membedakan hak lihat vs hak tulis.
  const tingkatan = user?.role?.tingkatan
  const hasAccess = !!tingkatan && (['daerah', 'desa', 'kelompok'].includes(tingkatan) || tingkatan === 'ppg') && !isGenerusBiasa(user)

  // Hanya pengurus operasional (bukan PPG) yang boleh tambah/edit/hapus transaksi.
  // Sebelumnya halaman ini tidak punya guard tulis sama sekali -- siapapun yg hasAccess
  // otomatis dapat tombol kelola. Diperbaiki agar PPG (read-only by design) tidak ikut
  // kebagian tombol tulis hanya karena ditambahkan ke daftar hasAccess di atas.
  const canManage = isPengurus(user)

  // Hanya Daerah yang boleh memilih desa/kelompok manapun saat mencatat transaksi.
  // Pengurus Desa/Kelompok dikunci ke scope-nya sendiri, konsisten dengan Kegiatan/Dokumen/Pengumuman.
  const canPickScope = tingkatan === 'daerah'

  const [data, setData] = useState<Keuangan[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pemasukan' | 'pengeluaran'>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'tanggal_desc' | 'tanggal_asc' | 'jumlah_desc' | 'jumlah_asc'>('tanggal_desc')
  // Filter rentang tanggal -- khusus untuk lingkup laporan export, tidak memengaruhi
  // tampilan tabel utama (biar user tetap bisa lihat semua transaksi seperti biasa).
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  // Filter tambahan khusus lingkup export -- juga terpisah dari tabel utama, supaya user
  // bisa mis. menarik laporan "pemasukan Desa Aren Jaya saja" tanpa mengubah apa yang
  // sedang dia lihat di tabel. 'all' berarti tidak difilter (semua desa/kelompok/kategori).
  const [exportDesaId, setExportDesaId] = useState<string>('all')
  const [exportKelompokId, setExportKelompokId] = useState<string>('all')
  const [exportKategori, setExportKategori] = useState<string>('all')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Keuangan | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [desaList, setDesaList] = useState<DesaOpt[]>([])
  const [kelompokList, setKelompokList] = useState<KelompokOpt[]>([])
  const [error, setError] = useState('')

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
    // daerah & ppg: lihat semua (PPG lintas Bekasi Timur, read-only)
    const { data: rows, error: err } = await query
    if (err) { console.error('Gagal memuat data keuangan:', err.message) }
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
    setError('')
    setForm({ ...emptyForm, desa_id: user?.desa_id || '', kelompok_id: user?.kelompok_id || '' })
    setModalOpen(true)
  }

  const openEdit = (k: Keuangan) => {
    setEditTarget(k)
    setError('')
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
    setError('')
    if (!form.jumlah || !form.tanggal || !form.kategori || !form.deskripsi || !form.desa_id) return
    const nominal = parseFloat(form.jumlah.replace(/\./g, '').replace(',', '.'))
    // Sebelumnya nominal 0 atau negatif bisa lolos tersimpan (cuma dicek "truthy"/terisi,
    // bukan validitas angkanya) -- transaksi keuangan dengan jumlah 0/minus tidak masuk akal
    // dan akan merusak perhitungan saldo/laporan.
    if (!Number.isFinite(nominal) || nominal <= 0) {
      setError('Jumlah harus berupa angka lebih dari 0.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        jenis: form.jenis as 'pemasukan' | 'pengeluaran',
        kategori: form.kategori || null,
        jumlah: nominal,
        deskripsi: form.deskripsi || null,
        tanggal: form.tanggal,
        tingkatan: form.tingkatan || null,
        desa_id: form.desa_id || null,
        kelompok_id: form.kelompok_id || null,
        dibuat_oleh: user?.id,
      }
      if (editTarget) {
        const { error: err } = await supabase.from('keuangan').update(payload).eq('id', editTarget.id)
        if (err) { setError(`Gagal menyimpan perubahan: ${err.message}`); return }
        if (user) await logAudit(user, 'UPDATE', 'Keuangan', `${form.jenis} - ${form.kategori}`, payload, editTarget.id)
      } else {
        const { data: ins, error: err } = await supabase.from('keuangan').insert(payload).select('id').single()
        if (err) { setError(`Gagal membuat transaksi: ${err.message}`); return }
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
    const { error: err } = await supabase.from('keuangan').delete().eq('id', id)
    if (err) { alert(`Gagal menghapus transaksi: ${err.message}`); return }
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
        k.nomor_transaksi?.toLowerCase().includes(q)
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

  // Kelompok yang ditawarkan di filter export -- kalau desa export dipilih, batasi hanya
  // kelompok di bawah desa itu (konsisten dengan pola filter desa->kelompok di form Modal).
  const exportKelompokOptions = kelompokList.filter(k => exportDesaId === 'all' || k.desa_id === exportDesaId)

  // Data untuk laporan export -- pakai `filtered` (jenis + pencarian yang sedang aktif di
  // tabel) ditambah filter rentang tanggal & desa/kelompok/kategori KHUSUS export, supaya
  // user bisa menarik laporan lebih spesifik (mis. "pemasukan Desa Aren Jaya saja") tanpa
  // mengubah apa yang sedang dia lihat di tabel utama.
  const exportRows = useMemo(() => filtered.filter(k => {
    if (dateFrom && k.tanggal < dateFrom) return false
    if (dateTo && k.tanggal > dateTo) return false
    if (exportDesaId !== 'all' && k.desa_id !== exportDesaId) return false
    if (exportKelompokId !== 'all' && k.kelompok_id !== exportKelompokId) return false
    if (exportKategori !== 'all' && k.kategori !== exportKategori) return false
    return true
  }), [filtered, dateFrom, dateTo, exportDesaId, exportKelompokId, exportKategori])

  const exportSummary = () => {
    const p = exportRows.filter(k => k.jenis === 'pemasukan').reduce((s, k) => s + Number(k.jumlah), 0)
    const g = exportRows.filter(k => k.jenis === 'pengeluaran').reduce((s, k) => s + Number(k.jumlah), 0)
    return [
      { label: 'Total Pemasukan', value: fmt(p) },
      { label: 'Total Pengeluaran', value: fmt(g) },
      { label: 'Saldo', value: fmt(p - g) },
    ]
  }

  const exportScopeLabel = () => {
    if (exportKelompokId !== 'all') {
      return `Kelompok ${kelompokList.find(k => k.id === exportKelompokId)?.nama_kelompok || ''}`
    }
    if (exportDesaId !== 'all') {
      return `Desa ${desaList.find(d => d.id === exportDesaId)?.nama_desa || ''}`
    }
    return user?.role?.tingkatan === 'kelompok' ? (user?.kelompok?.nama_kelompok || 'Se-Bekasi Timur')
      : user?.role?.tingkatan === 'desa' ? (user?.desa?.nama_desa || 'Se-Bekasi Timur')
      : 'Se-Bekasi Timur'
  }

  const exportSubtitle = () => {
    const periode = dateFrom || dateTo
      ? `Periode ${dateFrom ? new Date(dateFrom).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '...'} - ${dateTo ? new Date(dateTo).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '...'}`
      : 'Seluruh Periode'
    const jenisLabel = filter === 'all' ? '' : filter === 'pemasukan' ? ' -- Pemasukan Saja' : ' -- Pengeluaran Saja'
    const kategoriLabel = exportKategori === 'all' ? '' : ` -- ${exportKategori}`
    return `${exportScopeLabel()} -- ${periode}${jenisLabel}${kategoriLabel}`
  }

  const exportFileName = () => {
    const scope = exportScopeLabel().replace(/[^a-zA-Z0-9]/g, '-')
    return `Laporan-Keuangan-${scope}-${new Date().toISOString().slice(0, 10)}`
  }

  const exportColumns = [
    { header: 'No. Transaksi', key: 'no', width: 20 },
    { header: 'Tanggal', key: 'tanggal', width: 14 },
    { header: 'Jenis', key: 'jenis', width: 12 },
    { header: 'Kategori', key: 'kategori', width: 14 },
    { header: 'Deskripsi', key: 'deskripsi', width: 30 },
    { header: 'Jumlah', key: 'jumlah', width: 16 },
  ]

  const buildExportData = () => exportRows.map(k => ({
    no: k.nomor_transaksi || '-',
    tanggal: new Date(k.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
    jenis: k.jenis === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran',
    kategori: k.kategori || '-',
    deskripsi: k.deskripsi || '-',
    jumlah: (k.jenis === 'pengeluaran' ? '-' : '+') + fmt(Number(k.jumlah)),
  }))

  // Opsi export yang sedang aktif, dihitung ulang setiap filter export berubah -- diteruskan
  // ke ExportPreviewModal supaya pratinjau PDF selalu mencerminkan filter TERKINI, termasuk
  // saat user mengubah filter sambil modal preview masih terbuka.
  const previewOptions: ExportOptions = {
    title: 'Laporan Keuangan',
    subtitle: exportSubtitle(),
    columns: exportColumns,
    rows: buildExportData(),
    summary: exportSummary(),
    fileName: exportFileName(),
  }

  const handleOpenPreview = () => setPreviewOpen(true)

  const handleExported = async (format: 'pdf' | 'excel') => {
    if (user) await logAudit(user, 'EXPORT', 'Keuangan', `${format === 'pdf' ? 'PDF' : 'Excel'} -- ${exportRows.length} transaksi (${exportScopeLabel()})`)
  }

  // Blokir akses Super Admin
  if (!hasAccess) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🔒</div>
        <p className="font-semibold text-slate-600">Akses Dibatasi</p>
        <p className="text-sm mt-1">Menu Keuangan hanya tersedia untuk role Daerah, Desa, Kelompok, dan PPG.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-bold text-slate-800">Keuangan</h2>
        <div className="flex items-center gap-2">
          <button onClick={handleOpenPreview}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition flex items-center gap-1.5">
            🔍 Pratinjau & Export
          </button>
          {canManage && (
            <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
              + Tambah Transaksi
            </button>
          )}
        </div>
      </div>

      {/* Filter lingkup laporan -- periode, desa/kelompok, kategori. Semua terpisah dari
          filter tabel utama di bawah, supaya user bisa menarik laporan spesifik (mis.
          "pemasukan Desa Aren Jaya bulan ini saja") tanpa mengubah tampilan tabel. */}
      <div className="bg-white rounded-2xl p-3 shadow-sm border border-slate-100 space-y-2">
        <p className="text-xs font-medium text-slate-500">Lingkup Laporan (untuk Pratinjau & Export):</p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-slate-400 text-sm">s/d</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

          <select value={exportDesaId} onChange={e => { setExportDesaId(e.target.value); setExportKelompokId('all') }}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">Semua Desa</option>
            {desaList.map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
          </select>

          <select value={exportKelompokId} onChange={e => setExportKelompokId(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">Semua Kelompok</option>
            {exportKelompokOptions.map(k => <option key={k.id} value={k.id}>{k.nama_kelompok}</option>)}
          </select>

          <select value={exportKategori} onChange={e => setExportKategori(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">Semua Kategori</option>
            {KATEGORI_SEMUA.map(k => <option key={k} value={k}>{k}</option>)}
          </select>

          {(dateFrom || dateTo || exportDesaId !== 'all' || exportKelompokId !== 'all' || exportKategori !== 'all') && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); setExportDesaId('all'); setExportKelompokId('all'); setExportKategori('all') }}
              className="text-xs text-blue-600 hover:underline">
              Reset lingkup
            </button>
          )}
          <span className="text-xs text-slate-400 ml-auto">{exportRows.length} transaksi tercakup{filter !== 'all' ? ` (filter tabel: ${filter})` : ''}</span>
        </div>
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
            {canManage && <button onClick={openAdd} className="mt-3 text-blue-600 text-sm font-medium hover:underline">+ Tambah sekarang</button>}
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
                  {canManage && <th className="px-4 py-3 font-medium">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(k => (
                  <tr key={k.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-slate-400">{k.nomor_transaksi || '-'}</span>
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
                    {canManage && (
                      <td className="px-4 py-3 flex gap-3">
                        <button onClick={() => openEdit(k)} className="text-blue-600 hover:text-blue-800 font-medium text-xs">Edit</button>
                        <button onClick={() => handleDelete(k.id, `${k.jenis} - ${k.kategori}`)} className="text-red-400 hover:text-red-600 font-medium text-xs">Hapus</button>
                      </td>
                    )}
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
              <input type="number" min="1" step="1" value={form.jumlah} onChange={e => set('jumlah', e.target.value)}
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
              <label className="block text-xs font-medium text-slate-600 mb-1">Kelompok</label>
              <select value={form.kelompok_id} onChange={e => set('kelompok_id', e.target.value)}
                disabled={!canPickScope && tingkatan === 'kelompok'}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed">
                <option value="">-- Semua --</option>
                {kelompokList.filter(k => !form.desa_id || k.desa_id === form.desa_id).map(k => (
                  <option key={k.id} value={k.id}>{k.nama_kelompok}</option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="p-2.5 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600">{error}</div>
          )}

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

      <ExportPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        options={previewOptions}
        onExported={handleExported}
      />
    </div>
  )
}
