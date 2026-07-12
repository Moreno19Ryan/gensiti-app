'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Keuangan, PengajuanReimbursement } from '@/lib/types'
import Modal from '@/components/Modal'
import ExportPreviewModal from '@/components/ExportPreviewModal'
import { logAudit } from '@/lib/audit'
import { isGenerusBiasa, isBendahara, canAjukanReimbursement } from '@/lib/roles'
import { useFeatureAccess } from '@/lib/feature-toggles'
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

const emptyPengajuanForm = {
  kategori: '',
  jumlah: '',
  deskripsi: '',
  tanggal: new Date().toISOString().slice(0, 10),
}

const KATEGORI_SEMUA = ['Iuran', 'Donasi', 'Bantuan', 'Operasional', 'Konsumsi', 'Transport', 'Perlengkapan', 'Lainnya']

const statusPengajuanLabel: Record<string, { label: string; color: string }> = {
  menunggu: { label: 'Menunggu Bendahara', color: 'bg-amber-100 text-amber-700' },
  disetujui: { label: 'Disetujui', color: 'bg-green-100 text-green-700' },
  ditolak: { label: 'Ditolak', color: 'bg-red-100 text-red-600' },
}

// Halaman Keuangan -- sejak audit relasi hak akses lintas wilayah, HANYA Bendahara (jenjang
// manapun) yang boleh mencatat transaksi Keuangan langsung. Pengurus lain (Ketua/Wapon/
// Sekretaris/Kemandirian/Keputrian/dll) WAJIB mengajukan reimbursement pengeluaran yang
// perlu di-ACC Bendahara sebelum masuk sebagai transaksi resmi -- lihat tab "Pengajuan
// Reimbursement" di bawah. Semua pengurus operasional (Daerah/Desa/Kelompok) tetap bisa
// LIHAT seluruh laporan keuangan wilayahnya, hanya beda di hak tulis. PPG SENGAJA TIDAK
// bisa lihat sama sekali (lihat hasAccess di bawah) -- PPG bukan pengurus operasional dan
// tidak berkepentingan dengan data keuangan wilayah manapun.
export default function KeuanganPage() {
  const { user } = useUser()

  const tingkatan = user?.role?.tingkatan
  // Keuangan HANYA untuk pengurus operasional (Daerah/Desa/Kelompok) -- PPG sengaja
  // dikecualikan di sini (dikonfirmasi eksplisit): PPG bukan pengurus, perannya murni
  // pengawas/pembina (approval kegiatan/pengumuman tingkat Daerah + catatan pembinaan),
  // tidak berkepentingan dengan data keuangan wilayah manapun. Konsisten dgn RLS
  // keuangan_select & pengajuan_reimbursement_select yang sudah diperbaiki serupa.
  const hasAccess = !!tingkatan && ['daerah', 'desa', 'kelompok'].includes(tingkatan) && !isGenerusBiasa(user)
  const { enabled: featureEnabled, checking: featureChecking } = useFeatureAccess(user, 'keuangan')

  // Bendahara-only utk transaksi langsung. Sebelumnya isPengurus() dipakai di sini (keliru
  // meloloskan SEMUA role pengurus, padahal RLS database cuma pernah izinkan Ketua/Wapon) --
  // sekarang diperbaiki sesuai jobdesk organisasi yang sebenarnya.
  const canManage = isBendahara(user)
  // Pengurus lain (bukan Bendahara) yang boleh mengajukan reimbursement.
  const canAjukan = canAjukanReimbursement(user)

  const canPickScope = tingkatan === 'daerah'

  const [tab, setTab] = useState<'transaksi' | 'reimbursement'>('transaksi')

  const [data, setData] = useState<Keuangan[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pemasukan' | 'pengeluaran'>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'tanggal_desc' | 'tanggal_asc' | 'jumlah_desc' | 'jumlah_asc'>('tanggal_desc')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
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

  // State khusus alur Pengajuan Reimbursement
  const [pengajuanList, setPengajuanList] = useState<PengajuanReimbursement[]>([])
  const [loadingPengajuan, setLoadingPengajuan] = useState(false)
  const [pengajuanModalOpen, setPengajuanModalOpen] = useState(false)
  const [pengajuanForm, setPengajuanForm] = useState(emptyPengajuanForm)
  const [pengajuanError, setPengajuanError] = useState('')
  const [savingPengajuan, setSavingPengajuan] = useState(false)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [tolakTarget, setTolakTarget] = useState<PengajuanReimbursement | null>(null)
  const [tolakCatatan, setTolakCatatan] = useState('')

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
    const { data: rows, error: err } = await query
    if (err) { console.error('Gagal memuat data keuangan:', err.message) }
    setData(rows || [])
    setLoading(false)
  }, [user, hasAccess])

  // Muat daftar pengajuan reimbursement -- RLS otomatis membatasi: Bendahara lihat semua
  // di scope-nya, pengurus lain hanya lihat pengajuan miliknya sendiri, Daerah/Super
  // Admin/PPG lihat semua (konsisten dgn pola keuangan_select).
  const loadPengajuan = useCallback(async () => {
    if (!hasAccess || (!canManage && !canAjukan)) return
    setLoadingPengajuan(true)
    const { data: rows, error: err } = await supabase
      .from('pengajuan_reimbursement')
      .select('*, pengaju:diajukan_oleh(nama_lengkap)')
      .order('created_at', { ascending: false })
      .limit(200)
    if (err) console.error('Gagal memuat pengajuan reimbursement:', err.message)
    setPengajuanList((rows || []) as unknown as PengajuanReimbursement[])
    setLoadingPengajuan(false)
  }, [hasAccess, canManage, canAjukan])

  // Data-fetching on mount/dependency-change (bukan derived state) -- lihat catatan serupa
  // di dashboard/page.tsx. Disable per-baris supaya perilaku persis sama.
  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadData()
      loadPengajuan()
      Promise.all([
        supabase.from('desa').select('id, nama_desa').eq('is_active', true).order('nama_desa'),
        supabase.from('kelompok').select('id, nama_kelompok, desa_id').eq('is_active', true).order('nama_kelompok'),
      ]).then(([{ data: d }, { data: k }]) => {
        setDesaList(d || [])
        setKelompokList(k || [])
      })
    }
  }, [user, loadData, loadPengajuan])

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

  // Ajukan reimbursement baru -- tingkatan/desa_id/kelompok_id otomatis mengikuti scope
  // pengaju sendiri (tidak bisa pilih scope lain, konsisten dgn pola kunci-scope di modul
  // Kegiatan/Dokumen/Pengumuman utk pengurus Desa/Kelompok).
  const openPengajuan = () => {
    setPengajuanError('')
    setPengajuanForm(emptyPengajuanForm)
    setPengajuanModalOpen(true)
  }

  const handleSavePengajuan = async () => {
    setPengajuanError('')
    if (!pengajuanForm.jumlah || !pengajuanForm.tanggal || !pengajuanForm.kategori || !pengajuanForm.deskripsi) return
    const nominal = parseFloat(pengajuanForm.jumlah.replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(nominal) || nominal <= 0) {
      setPengajuanError('Jumlah harus berupa angka lebih dari 0.')
      return
    }
    if (!tingkatan || (tingkatan !== 'daerah' && tingkatan !== 'desa' && tingkatan !== 'kelompok')) {
      setPengajuanError('Jenjang akun Anda tidak dapat mengajukan reimbursement.')
      return
    }
    setSavingPengajuan(true)
    try {
      const payload = {
        kategori: pengajuanForm.kategori,
        jumlah: nominal,
        deskripsi: pengajuanForm.deskripsi,
        tanggal: pengajuanForm.tanggal,
        tingkatan,
        desa_id: user?.desa_id || null,
        kelompok_id: user?.kelompok_id || null,
        diajukan_oleh: user?.id,
      }
      const { data: ins, error: err } = await supabase.from('pengajuan_reimbursement').insert(payload).select('id').single()
      if (err) { setPengajuanError(`Gagal mengajukan reimbursement: ${err.message}`); return }
      if (user) await logAudit(user, 'CREATE', 'Pengajuan Reimbursement', `${pengajuanForm.kategori} - Rp${pengajuanForm.jumlah}`, payload, ins?.id)
      setPengajuanModalOpen(false)
      loadPengajuan()
    } finally {
      setSavingPengajuan(false)
    }
  }

  // ACC pengajuan -- panggil RPC proses_reimbursement yang otomatis insert ke tabel
  // keuangan (sbg pengeluaran) & kirim notifikasi in-app ke pengaju, dalam satu transaksi
  // atomik di database (bukan 2 langkah terpisah dari client yang rawan gagal separuh jalan).
  const handleAcc = async (p: PengajuanReimbursement) => {
    if (!confirm(`Setujui pengajuan reimbursement Rp${p.jumlah.toLocaleString('id-ID')} ini? Transaksi akan otomatis tercatat di Keuangan.`)) return
    setProcessingId(p.id)
    try {
      const { error: err } = await supabase.rpc('proses_reimbursement', {
        p_pengajuan_id: p.id,
        p_keputusan: 'disetujui',
        p_catatan: null,
      })
      if (err) { alert(`Gagal menyetujui pengajuan: ${err.message}`); return }
      if (user) await logAudit(user, 'UPDATE', 'Pengajuan Reimbursement', `Disetujui -- ${p.kategori} - Rp${p.jumlah}`, undefined, p.id)
      loadPengajuan()
      loadData()
    } finally {
      setProcessingId(null)
    }
  }

  const openTolak = (p: PengajuanReimbursement) => {
    setTolakTarget(p)
    setTolakCatatan('')
  }

  const handleTolak = async () => {
    if (!tolakTarget) return
    setProcessingId(tolakTarget.id)
    try {
      const { error: err } = await supabase.rpc('proses_reimbursement', {
        p_pengajuan_id: tolakTarget.id,
        p_keputusan: 'ditolak',
        p_catatan: tolakCatatan || null,
      })
      if (err) { alert(`Gagal menolak pengajuan: ${err.message}`); return }
      if (user) await logAudit(user, 'UPDATE', 'Pengajuan Reimbursement', `Ditolak -- ${tolakTarget.kategori} - Rp${tolakTarget.jumlah}`, undefined, tolakTarget.id)
      setTolakTarget(null)
      loadPengajuan()
    } finally {
      setProcessingId(null)
    }
  }

  const set = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }))
  const setPengajuan = (key: string, val: string) => setPengajuanForm(f => ({ ...f, [key]: val }))
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

  const kategoriPengeluaranOptions = ['Operasional', 'Konsumsi', 'Transport', 'Perlengkapan', 'Lainnya']

  const pengajuanMenunggu = pengajuanList.filter(p => p.status === 'menunggu')
  const pengajuanSelesai = pengajuanList.filter(p => p.status !== 'menunggu')

  const exportKelompokOptions = kelompokList.filter(k => exportDesaId === 'all' || k.desa_id === exportDesaId)

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

  if (!hasAccess) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🔒</div>
        <p className="font-semibold text-slate-600">Akses Dibatasi</p>
        <p className="text-sm mt-1">Menu Keuangan hanya tersedia untuk role Daerah, Desa, Kelompok, dan PPG.</p>
      </div>
    )
  }

  // Lapisan kedua setelah sidebar -- kalau Super Admin mematikan menu ini utk jenjang role
  // user ini lewat Pengaturan Fitur, akses langsung via URL juga diblok di sini.
  if (!featureChecking && !featureEnabled) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🚫</div>
        <p className="font-semibold text-slate-600">Fitur Dinonaktifkan</p>
        <p className="text-sm mt-1">Menu Keuangan saat ini dinonaktifkan oleh Super Admin untuk jenjang Anda.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-bold text-slate-800">Keuangan</h2>
        <div className="flex items-center gap-2">
          {canManage && (
            <button onClick={handleOpenPreview}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition flex items-center gap-1.5">
              🔍 Pratinjau & Export
            </button>
          )}
          {canManage && (
            <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
              + Tambah Transaksi
            </button>
          )}
          {canAjukan && (
            <button onClick={openPengajuan} className="px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-xl hover:bg-amber-600 transition">
              + Ajukan Reimbursement
            </button>
          )}
        </div>
      </div>

      {/* Tab -- Transaksi (semua pengurus bisa lihat) vs Pengajuan Reimbursement (Bendahara
          proses, pengurus lain lihat riwayat pengajuannya sendiri). Tab kedua cuma muncul
          kalau relevan utk role user (Bendahara ATAU bisa mengajukan). */}
      {(canManage || canAjukan) && (
        <div className="flex gap-2 border-b border-slate-200">
          <button onClick={() => setTab('transaksi')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === 'transaksi' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            Transaksi
          </button>
          <button onClick={() => setTab('reimbursement')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition flex items-center gap-1.5 ${tab === 'reimbursement' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            Pengajuan Reimbursement
            {pengajuanMenunggu.length > 0 && canManage && (
              <span className="px-1.5 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full">{pengajuanMenunggu.length}</span>
            )}
          </button>
        </div>
      )}

      {tab === 'reimbursement' ? (
        <div className="space-y-4">
          {loadingPengajuan ? (
            <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            </div>
          ) : (
            <>
              {canManage && pengajuanMenunggu.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-500">Menunggu Persetujuan Anda</p>
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-100">
                    {pengajuanMenunggu.map(p => (
                      <div key={p.id} className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-slate-700 text-sm">{p.kategori} -- {fmt(Number(p.jumlah))}</p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              Diajukan oleh {p.pengaju?.nama_lengkap || '-'} · {new Date(p.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                            <p className="text-sm text-slate-600 mt-1">{p.deskripsi}</p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${statusPengajuanLabel[p.status]?.color}`}>
                            {statusPengajuanLabel[p.status]?.label}
                          </span>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => handleAcc(p)} disabled={processingId === p.id}
                            className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition disabled:opacity-50">
                            {processingId === p.id ? '...' : '✓ Setujui'}
                          </button>
                          <button onClick={() => openTolak(p)} disabled={processingId === p.id}
                            className="px-3 py-1.5 bg-white border border-red-200 text-red-500 text-xs font-medium rounded-lg hover:bg-red-50 transition disabled:opacity-50">
                            ✕ Tolak
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500">{canManage ? 'Riwayat Pengajuan' : 'Riwayat Pengajuan Saya'}</p>
                {pengajuanSelesai.length === 0 && (!canManage || pengajuanMenunggu.length === 0) ? (
                  <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
                    <div className="text-4xl mb-2">🧾</div>
                    <p>Belum ada pengajuan reimbursement</p>
                    {canAjukan && <button onClick={openPengajuan} className="mt-3 text-blue-600 text-sm font-medium hover:underline">+ Ajukan sekarang</button>}
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-100">
                    {(canManage ? pengajuanSelesai : pengajuanList).map(p => (
                      <div key={p.id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-slate-700 text-sm">{p.kategori} -- {fmt(Number(p.jumlah))}</p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {canManage ? `${p.pengaju?.nama_lengkap || '-'} · ` : ''}{new Date(p.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                            <p className="text-sm text-slate-600 mt-1">{p.deskripsi}</p>
                            {p.status === 'ditolak' && p.catatan_bendahara && (
                              <p className="text-xs text-red-500 mt-1">Alasan: {p.catatan_bendahara}</p>
                            )}
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${statusPengajuanLabel[p.status]?.color}`}>
                            {statusPengajuanLabel[p.status]?.label}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {canManage && (
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
          )}

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
        </>
      )}

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

      <Modal open={pengajuanModalOpen} onClose={() => setPengajuanModalOpen(false)} title="Ajukan Reimbursement">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">Pengajuan ini akan dikirim ke Bendahara {tingkatan === 'daerah' ? 'Daerah' : tingkatan === 'desa' ? 'Desa' : 'Kelompok'} Anda untuk disetujui. Setelah disetujui, transaksi otomatis tercatat sebagai pengeluaran.</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Kategori *</label>
              <select value={pengajuanForm.kategori} onChange={e => setPengajuan('kategori', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">-- Pilih --</option>
                {kategoriPengeluaranOptions.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Jumlah (Rp) *</label>
              <input type="number" min="1" step="1" value={pengajuanForm.jumlah} onChange={e => setPengajuan('jumlah', e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal *</label>
            <input type="date" value={pengajuanForm.tanggal} onChange={e => setPengajuan('tanggal', e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Deskripsi / Keperluan *</label>
            <textarea value={pengajuanForm.deskripsi} onChange={e => setPengajuan('deskripsi', e.target.value)} rows={3}
              placeholder="Jelaskan keperluan pengeluaran ini..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          {pengajuanError && (
            <div className="p-2.5 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600">{pengajuanError}</div>
          )}

          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button onClick={() => setPengajuanModalOpen(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
              Batal
            </button>
            <button onClick={handleSavePengajuan} disabled={savingPengajuan}
              className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 disabled:bg-amber-300 transition flex items-center justify-center gap-2">
              {savingPengajuan ? 'Mengirim...' : 'Ajukan'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!tolakTarget} onClose={() => setTolakTarget(null)} title="Tolak Pengajuan" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Berikan alasan penolakan (opsional, tapi disarankan supaya pengaju paham).</p>
          <textarea value={tolakCatatan} onChange={e => setTolakCatatan(e.target.value)} rows={3}
            placeholder="Alasan penolakan..."
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button onClick={() => setTolakTarget(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
              Batal
            </button>
            <button onClick={handleTolak} disabled={processingId === tolakTarget?.id}
              className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:bg-red-300 transition flex items-center justify-center gap-2">
              {processingId === tolakTarget?.id ? 'Memproses...' : 'Tolak Pengajuan'}
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
