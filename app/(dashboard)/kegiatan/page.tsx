'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Kegiatan } from '@/lib/types'
import { logAudit } from '@/lib/audit'
import { canManageKontenOrganisasi, isGenerusBiasa } from '@/lib/roles'
import { useFeatureAccess } from '@/lib/feature-toggles'
import Modal from '@/components/Modal'
import PresensiPanel from '@/components/PresensiPanel'
import PengajuanIzinPanel from '@/components/PengajuanIzinPanel'
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

// Kategori kegiatan -- HANYA relevan/berlaku utk tingkatan='daerah'. Memilih kategori apapun
// selain 'bukan_daerah' otomatis men-set tingkatan='daerah' di belakang layar (menggantikan
// checkbox generik "Kegiatan Tingkat Daerah" yang sebelumnya dipakai).
const kategoriKegiatanLabel: Record<string, string> = {
  pengajian_rutin: 'Pengajian Muda-Mudi Rutin',
  pegasus: 'PEGASUS',
  penerobosan_pusat: 'Penerobosan Muda-Mudi Pusat',
  pengajian_gabungan: 'Pengajian Muda-Mudi Daerah Gabungan',
}

// Target peserta -- menentukan siapa yang wajib presensi utk kegiatan ini, berlaku di semua
// tingkatan (bukan hanya Daerah).
const targetPesertaLabel: Record<string, string> = {
  semua_generus: 'Semua Generus',
  hanya_pengurus: 'Hanya Pengurus',
  kelas_ngaji_tertentu: 'Kelas Ngaji Tertentu',
}

const kelasNgajiLabel: Record<string, string> = {
  pra_remaja: 'Pra Remaja',
  remaja_muda: 'Remaja Muda',
  remaja_dewasa: 'Remaja Dewasa',
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
  kategori_kegiatan: '',
  target_peserta: 'semua_generus',
  target_kelas_ngaji: '',
}

export default function KegiatanPage() {
  const { user } = useUser()
  // Lapisan kedua setelah sidebar -- kalau Super Admin mematikan menu Kegiatan utk jenjang
  // role user ini lewat Pengaturan Fitur, akses langsung via URL juga diblok (guard render di
  // bawah, setelah return utama). Toggle ini berlaku per JENJANG (Kelompok/Desa/Daerah/PPG),
  // jadi kalau dimatikan utk Kelompok, Generus biasa DAN Ketua Kelompok sama-sama terdampak.
  const { enabled: featureEnabled, checking: featureChecking } = useFeatureAccess(user, 'kegiatan')
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
  const [error, setError] = useState('')
  // Kelas ngaji milik Generus yang login -- dipakai utk filter tampilan kegiatan dengan
  // target_peserta='kelas_ngaji_tertentu' (mis. kegiatan Remaja Dewasa tidak boleh muncul
  // ke Pra Remaja/Remaja Muda). null = belum termuat / user bukan Generus biasa.
  const [kelasNgajiSaya, setKelasNgajiSaya] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('kegiatan').select('*').order('tanggal_mulai', { ascending: false })
    const t = user?.role?.tingkatan
    if (t !== 'super_admin' && t !== 'daerah') {
      if (user?.kelompok_id) query = query.eq('kelompok_id', user.kelompok_id)
      else if (user?.desa_id) query = query.eq('desa_id', user.desa_id)
    }
    const { data: rows, error: err } = await query
    if (err) { console.error('Gagal memuat data kegiatan:', err.message) }
    setData(rows || [])
    setLoading(false)
  }, [user])

  // Data-fetching on mount/dependency-change (bukan derived state) -- lihat catatan serupa
  // di dashboard/page.tsx. Disable per-baris supaya perilaku persis sama.
  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadData()
      Promise.all([
        supabase.from('desa').select('id, nama_desa').eq('is_active', true).order('nama_desa'),
        supabase.from('kelompok').select('id, nama_kelompok, desa_id').eq('is_active', true).order('nama_kelompok'),
      ]).then(([{ data: d }, { data: k }]) => {
        setDesaList(d || [])
        setKelompokList(k || [])
      })
      // Hanya Generus biasa yang perlu tahu kelas_ngaji sendiri -- dipakai utk menyembunyikan
      // kegiatan yang target_peserta='kelas_ngaji_tertentu' tapi bukan untuk kelasnya.
      // Pengurus/PPG/Super Admin tetap melihat semua kegiatan (perlu mengelola/mengawasi).
      if (isGenerusBiasa(user)) {
        supabase.from('generus').select('kelas_ngaji').eq('user_id', user.id).maybeSingle()
          .then(({ data: g }) => setKelasNgajiSaya(g?.kelas_ngaji || null))
      }
    }
  }, [user, loadData])

  // Pengurus Desa/Kelompok otomatis membuat kegiatan di scope-nya sendiri (tingkatan
  // ikut scope, tidak pernah kosong). Super Admin/Daerah default ke 'daerah' (lintas
  // desa/kelompok) tapi tetap bisa pilih Desa/Kelompok tertentu lewat checkbox di form.
  const inferTingkatan = (): string => {
    if (tingkatanUser === 'desa' || tingkatanUser === 'kelompok') return tingkatanUser
    return 'daerah'
  }

  const openAdd = () => {
    setEditTarget(null)
    setError('')
    setForm({
      ...emptyForm,
      tingkatan: inferTingkatan(),
      desa_id: user?.desa_id || '',
      kelompok_id: user?.kelompok_id || '',
    })
    setModalOpen(true)
  }

  const openEdit = (k: Kegiatan) => {
    setEditTarget(k)
    setError('')
    setForm({
      nama_kegiatan: k.nama_kegiatan,
      deskripsi: k.deskripsi || '',
      tanggal_mulai: k.tanggal_mulai ? k.tanggal_mulai.slice(0, 16) : '',
      tanggal_selesai: k.tanggal_selesai ? k.tanggal_selesai.slice(0, 16) : '',
      lokasi: k.lokasi || '',
      // Data lama (sebelum perbaikan ini) bisa saja tersimpan dengan tingkatan kosong --
      // tebak scope yg paling masuk akal dari desa_id/kelompok_id yg sudah ada, alih-alih
      // biarkan form terkirim ulang dengan tingkatan kosong.
      tingkatan: k.tingkatan || (k.kelompok_id ? 'kelompok' : k.desa_id ? 'desa' : 'daerah'),
      desa_id: k.desa_id || '',
      kelompok_id: k.kelompok_id || '',
      status: k.status,
      kategori_kegiatan: k.kategori_kegiatan || '',
      target_peserta: k.target_peserta || 'semua_generus',
      target_kelas_ngaji: k.target_kelas_ngaji || '',
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    setError('')
    const isDaerah = form.tingkatan === 'daerah'
    // Setiap validasi WAJIB menampilkan pesan lewat setError() -- sebelumnya beberapa
    // validasi di sini `return` diam-diam tanpa pesan apapun, membuat tombol Simpan terasa
    // seperti tidak merespons/rusak padahal sebenarnya submit ditolak tanpa keterangan.
    if (!form.nama_kegiatan.trim()) { setError('Nama kegiatan wajib diisi.'); return }
    if (!form.deskripsi.trim()) { setError('Deskripsi wajib diisi.'); return }
    if (!form.tanggal_mulai) { setError('Tanggal mulai wajib diisi.'); return }
    if (!form.tanggal_selesai) { setError('Tanggal selesai wajib diisi.'); return }
    if (new Date(form.tanggal_selesai) < new Date(form.tanggal_mulai)) { setError('Tanggal selesai tidak boleh sebelum tanggal mulai.'); return }
    if (!form.lokasi.trim()) { setError('Lokasi wajib diisi.'); return }
    // Kegiatan tingkat Daerah SENGAJA tidak terikat 1 desa/kelompok (lintas Se-Bekasi Timur),
    // jadi desa/kelompok wajib KOSONG. Selain itu (desa/kelompok), keduanya tetap wajib diisi.
    if (!isDaerah && !form.desa_id) { setError('Pilih Desa.'); return }
    if (!isDaerah && !form.kelompok_id) { setError('Pilih Kelompok.'); return }
    // Kategori kegiatan wajib dipilih utk tingkat Daerah (menggantikan checkbox lama) --
    // menentukan jenis acara Daerah spesifik (Pengajian Rutin/PEGASUS/dst).
    if (isDaerah && !form.kategori_kegiatan) { setError('Pilih kategori kegiatan Daerah.'); return }
    if (form.target_peserta === 'kelas_ngaji_tertentu' && !form.target_kelas_ngaji) {
      setError('Pilih kelas ngaji untuk target peserta.')
      return
    }
    setSaving(true)
    try {
      // tingkatan SELALU eksplisit (tidak pernah null/kosong) -- sebelumnya field ini tidak
      // pernah terisi lewat form (tidak ada input-nya), sehingga SEMUA kegiatan tersimpan
      // dengan tingkatan NULL. Ini bug serius: trigger set_status_approval_kegiatan hanya
      // mewajibkan approval PPG kalau tingkatan = 'daerah' PERSIS -- tingkatan NULL selalu
      // lolos dengan status_approval default 'disetujui', jadi validasi PPG untuk kegiatan
      // Daerah bisa ter-bypass total tanpa siapapun sadar. Sekarang tingkatan diisi otomatis
      // sesuai scope pembuat (desa/kelompok), atau eksplisit 'daerah' kalau checkbox dicentang.
      const payload = {
        nama_kegiatan: form.nama_kegiatan,
        deskripsi: form.deskripsi,
        tanggal_mulai: form.tanggal_mulai,
        tanggal_selesai: form.tanggal_selesai,
        lokasi: form.lokasi,
        tingkatan: form.tingkatan,
        desa_id: isDaerah ? null : form.desa_id,
        kelompok_id: isDaerah ? null : form.kelompok_id,
        status: form.status,
        dibuat_oleh: user?.id,
        kategori_kegiatan: isDaerah ? (form.kategori_kegiatan || null) : null,
        target_peserta: form.target_peserta,
        target_kelas_ngaji: form.target_peserta === 'kelas_ngaji_tertentu' ? form.target_kelas_ngaji : null,
      }
      if (editTarget) {
        const { error: err } = await supabase.from('kegiatan').update(payload).eq('id', editTarget.id)
        if (err) { setError(`Gagal menyimpan perubahan: ${err.message}`); return }
        if (user) await logAudit(user, 'UPDATE', 'Kegiatan', form.nama_kegiatan, payload, editTarget.id)
      } else {
        const { data: inserted, error: err } = await supabase.from('kegiatan').insert(payload).select('id').single()
        if (err) { setError(`Gagal membuat kegiatan: ${err.message}`); return }
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
    const { error: err } = await supabase.from('kegiatan').delete().eq('id', id)
    if (err) { alert(`Gagal menghapus kegiatan: ${err.message}`); return }
    if (user) await logAudit(user, 'DELETE', 'Kegiatan', target?.nama_kegiatan || id, undefined, id)
    loadData()
  }

  // Hanya Ketua/Wakil Ketua (semua jenjang) yang boleh kelola kegiatan. Super Admin
  // SENGAJA DIKECUALIKAN (sejak audit peran) -- dia pengelola sistem, bukan pengurus
  // organisasi, jadi read-only untuk konten operasional seperti Kegiatan. Generus biasa
  // dan pengurus non-Ketua (Sekretaris, Bendahara, dll) juga hanya bisa melihat.
  const canManage = canManageKontenOrganisasi(user)

  // Hanya Super Admin dan Daerah yang boleh memilih desa/kelompok manapun saat membuat kegiatan.
  // Pengurus Desa/Kelompok dikunci ke scope-nya sendiri — RLS di database juga sudah menegakkan
  // ini, tapi mengunci di UI mencegah submit gagal dengan error yang membingungkan.
  const tingkatanUser = user?.role?.tingkatan
  const canPickScope = tingkatanUser === 'super_admin' || tingkatanUser === 'daerah'

  const set = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }))
  const fmt = (t: string | null) => t ? new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

  // Terapkan target_peserta -- HANYA membatasi apa yang dilihat Generus biasa (peserta).
  // Pengurus/PPG/Super Admin tetap melihat semua kegiatan di scope-nya karena mereka perlu
  // mengelola atau mengawasi, bukan sekadar jadi peserta kegiatan tertentu.
  const bisaLihatKegiatan = (k: Kegiatan): boolean => {
    if (!isGenerusBiasa(user)) return true
    if (k.target_peserta === 'hanya_pengurus') return false
    if (k.target_peserta === 'kelas_ngaji_tertentu') {
      // Belum termuat kelas ngaji sendiri -- sembunyikan dulu drpd salah tampil ke org lain.
      if (!kelasNgajiSaya) return false
      return k.target_kelas_ngaji === kelasNgajiSaya
    }
    return true
  }

  const filtered = data
    .filter(bisaLihatKegiatan)
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

  if (!featureChecking && !featureEnabled) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🚫</div>
        <p className="font-semibold text-slate-600">Fitur Dinonaktifkan</p>
        <p className="text-sm mt-1">Menu Kegiatan saat ini dinonaktifkan oleh Super Admin untuk jenjang Anda.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-bold text-slate-800">Kegiatan</h2>
          <p className="text-slate-400 text-sm">{data.filter(bisaLihatKegiatan).length} kegiatan total</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Export daftar kegiatan dibatasi ke yang berwenang mengelola kegiatan (Ketua/Wakil/
              Super Admin), konsisten dengan tombol "+ Tambah Kegiatan" -- Generus biasa boleh
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
                    {k.kategori_kegiatan && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                        {kategoriKegiatanLabel[k.kategori_kegiatan] || k.kategori_kegiatan}
                      </span>
                    )}
                    {k.target_peserta !== 'semua_generus' && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        {k.target_peserta === 'kelas_ngaji_tertentu' && k.target_kelas_ngaji
                          ? `Target: ${kelasNgajiLabel[k.target_kelas_ngaji] || k.target_kelas_ngaji}`
                          : `Target: ${targetPesertaLabel[k.target_peserta]}`}
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
              <PengajuanIzinPanel kegiatan={k} user={user} />
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

          {canPickScope && (
            <div className="p-2.5 bg-amber-50 border border-amber-100 rounded-xl space-y-2">
              <label className="block text-xs font-medium text-amber-800">Kategori Kegiatan Daerah</label>
              <select
                value={form.tingkatan === 'daerah' ? (form.kategori_kegiatan || '') : 'bukan_daerah'}
                onChange={e => {
                  const val = e.target.value
                  if (val === 'bukan_daerah') {
                    setForm(f => ({ ...f, tingkatan: 'desa', kategori_kegiatan: '' }))
                  } else {
                    setForm(f => ({ ...f, tingkatan: 'daerah', desa_id: '', kelompok_id: '', kategori_kegiatan: val }))
                  }
                }}
                className="w-full px-3 py-2 rounded-xl border border-amber-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                <option value="bukan_daerah">-- Bukan Kegiatan Daerah (pilih Desa/Kelompok di bawah) --</option>
                <option value="pengajian_rutin">{kategoriKegiatanLabel.pengajian_rutin}</option>
                <option value="pegasus">{kategoriKegiatanLabel.pegasus}</option>
                <option value="penerobosan_pusat">{kategoriKegiatanLabel.penerobosan_pusat}</option>
                <option value="pengajian_gabungan">{kategoriKegiatanLabel.pengajian_gabungan}</option>
              </select>
              {form.tingkatan === 'daerah' && (
                <p className="text-xs text-amber-700">Kegiatan tingkat Daerah (lintas Desa/Kelompok) -- wajib persetujuan PPG sebelum tampil ke semua orang.</p>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Target Peserta</label>
            <div className="grid grid-cols-2 gap-4">
              <select
                value={form.target_peserta}
                onChange={e => setForm(f => ({ ...f, target_peserta: e.target.value, target_kelas_ngaji: e.target.value === 'kelas_ngaji_tertentu' ? f.target_kelas_ngaji : '' }))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="semua_generus">{targetPesertaLabel.semua_generus}</option>
                <option value="hanya_pengurus">{targetPesertaLabel.hanya_pengurus}</option>
                <option value="kelas_ngaji_tertentu">{targetPesertaLabel.kelas_ngaji_tertentu}</option>
              </select>
              {form.target_peserta === 'kelas_ngaji_tertentu' && (
                <select
                  value={form.target_kelas_ngaji}
                  onChange={e => setForm(f => ({ ...f, target_kelas_ngaji: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">-- Pilih Kelas Ngaji --</option>
                  <option value="pra_remaja">{kelasNgajiLabel.pra_remaja}</option>
                  <option value="remaja_muda">{kelasNgajiLabel.remaja_muda}</option>
                  <option value="remaja_dewasa">{kelasNgajiLabel.remaja_dewasa}</option>
                </select>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">Menentukan siapa yang wajib absensi untuk kegiatan ini.</p>
          </div>

          {form.tingkatan !== 'daerah' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Desa *</label>
                <select value={form.desa_id}
                  onChange={e => setForm(f => ({ ...f, desa_id: e.target.value, kelompok_id: '', tingkatan: 'desa' }))}
                  disabled={!canPickScope}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed">
                  <option value="">-- Pilih Desa --</option>
                  {desaList.map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Kelompok *</label>
                <select value={form.kelompok_id}
                  onChange={e => setForm(f => ({ ...f, kelompok_id: e.target.value, tingkatan: e.target.value ? 'kelompok' : 'desa' }))}
                  disabled={!canPickScope && tingkatanUser === 'kelompok'}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed">
                  <option value="">-- Pilih Kelompok --</option>
                  {kelompokList.filter(k => !form.desa_id || k.desa_id === form.desa_id).map(k => (
                    <option key={k.id} value={k.id}>{k.nama_kelompok}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

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
    </div>
  )
}
