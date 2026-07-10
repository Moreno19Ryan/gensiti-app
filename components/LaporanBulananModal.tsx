'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import { UserProfile } from '@/lib/types'
import {
  MultiSectionExportOptions,
  ExportSection,
  ExportChartImage,
  exportMultiSectionToPDF,
  exportMultiSectionToExcel,
  getMultiSectionPdfPreviewDataUrl,
} from '@/lib/export'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { toPng } from 'html-to-image'

// Modal "Laporan Bulanan" -- adaptasi dari laporan rekap Excel bulanan se-Daerah yang
// sebelumnya dikerjakan manual oleh PPG (lihat percakapan: user menunjukkan contoh file
// "5. JULI.xlsx" berisi rekap kehadiran per Desa+gender, breakdown kelas ngaji, tren 12
// bulan, dan pertumbuhan database Generus). Hanya utk PPG/Ketua Daerah/Super Admin --
// lihat canLihatLaporanDaerah di lib/roles.ts. Data diambil dari 3 RPC (migration
// create_laporan_bulanan_daerah_rpc) + get_pertumbuhan_generus yang sudah ada.

interface Props {
  open: boolean
  onClose: () => void
  user: UserProfile
}

const BULAN_LABEL = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

const KELAS_NGAJI_LABEL: Record<string, string> = {
  pra_remaja: 'Pra Remaja',
  remaja_muda: 'Remaja Muda',
  remaja_dewasa: 'Remaja Dewasa',
}

interface KehadiranRow {
  desa_id: string
  nama_desa: string
  jenis_kelamin: string | null
  hadir: number
  izin: number
  sakit: number
  tidak_hadir: number
}

interface KelasNgajiRow {
  desa_id: string
  nama_desa: string
  jenis_kelamin: string | null
  kelas_ngaji: string
  jumlah: number
}

interface TrenRow {
  bulan: number
  hadir: number
  izin: number
  sakit: number
  tidak_hadir: number
}

interface PertumbuhanRow {
  bulan: string
  jumlah: number
}

export default function LaporanBulananModal({ open, onClose, user }: Props) {
  const now = new Date()
  const [bulan, setBulan] = useState(now.getMonth() + 1)
  const [tahun, setTahun] = useState(now.getFullYear())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)

  const [kehadiran, setKehadiran] = useState<KehadiranRow[]>([])
  const [kelasNgaji, setKelasNgaji] = useState<KelasNgajiRow[]>([])
  const [tren, setTren] = useState<TrenRow[]>([])
  const [pertumbuhan, setPertumbuhan] = useState<PertumbuhanRow[]>([])

  // Ref ke tiap DOM node grafik -- dipakai html-to-image (toPng) utk capture grafik jadi PNG
  // sesaat sebelum export, supaya grafik yang sudah tampil di layar bisa ikut disisipkan ke
  // PDF/Excel (bukan cuma tampil on-screen). Node-nya SELALU di-render (lihat JSX di bawah,
  // wrapper "grafik" tidak dikondisikan hilang total walau sedang di mode Pratinjau PDF),
  // hanya disembunyikan via CSS saat tidak sedang ditampilkan -- supaya ref selalu siap
  // di-capture kapan pun user menekan Export, tanpa perlu switch tab dulu.
  const trenChartRef = useRef<HTMLDivElement>(null)
  const pertumbuhanChartRef = useRef<HTMLDivElement>(null)
  const kehadiranDesaChartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      const [
        { data: kehadiranData, error: errKehadiran },
        { data: kelasNgajiData, error: errKelasNgaji },
        { data: trenData, error: errTren },
        { data: pertumbuhanData, error: errPertumbuhan },
      ] = await Promise.all([
        supabase.rpc('get_laporan_kehadiran_bulanan_daerah', { p_bulan: bulan, p_tahun: tahun }),
        supabase.rpc('get_laporan_kelas_ngaji_daerah', { p_bulan: bulan, p_tahun: tahun }),
        supabase.rpc('get_tren_kehadiran_tahunan_daerah', { p_tahun: tahun }),
        supabase.rpc('get_pertumbuhan_generus', { p_range_start: `${tahun}-01-01` }),
      ])
      if (cancelled) return

      const firstError = errKehadiran || errKelasNgaji || errTren || errPertumbuhan
      if (firstError) {
        setError(firstError.message)
        setLoading(false)
        return
      }

      setKehadiran((kehadiranData as KehadiranRow[]) || [])
      setKelasNgaji((kelasNgajiData as KelasNgajiRow[]) || [])
      setTren((trenData as TrenRow[]) || [])
      setPertumbuhan((pertumbuhanData as PertumbuhanRow[]) || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [open, bulan, tahun])

  // Total se-Daerah (semua Desa+gender digabung) -- dipakai utk kartu ringkasan di atas.
  const totalKehadiran = useMemo(() => {
    return kehadiran.reduce(
      (acc, r) => ({
        hadir: acc.hadir + r.hadir,
        izin: acc.izin + r.izin,
        sakit: acc.sakit + r.sakit,
        tidak_hadir: acc.tidak_hadir + r.tidak_hadir,
      }),
      { hadir: 0, izin: 0, sakit: 0, tidak_hadir: 0 }
    )
  }, [kehadiran])

  const grandTotal = totalKehadiran.hadir + totalKehadiran.izin + totalKehadiran.sakit + totalKehadiran.tidak_hadir

  // Data grafik pertumbuhan Generus per bulan (12 bulan) -- logic sama persis dgn yang
  // dipakai buildSections() utk section export, diekstrak jadi useMemo terpisah supaya
  // tidak dihitung ulang 2x (sekali utk grafik, sekali utk export) dan konsisten.
  const pertumbuhanChartData = useMemo(() => {
    const map = new Map(pertumbuhan.map(p => [p.bulan, p.jumlah]))
    return Array.from({ length: 12 }, (_, i) => {
      const key = `${tahun}-${String(i + 1).padStart(2, '0')}`
      return { bulan: BULAN_LABEL[i].slice(0, 3), jumlah: map.get(key) || 0 }
    })
  }, [pertumbuhan, tahun])

  // Data grafik tren kehadiran 12 bulan -- langsung dari state `tren` (sudah per-bulan,
  // sudah include bulan kosong = 0 dari RPC generate_series), tinggal mapping label bulan.
  const trenChartData = useMemo(() => {
    return tren.map(r => ({
      bulan: BULAN_LABEL[r.bulan - 1].slice(0, 3),
      Hadir: r.hadir,
      Izin: r.izin,
      Sakit: r.sakit,
      Alpha: r.tidak_hadir,
    }))
  }, [tren])

  // Data grafik perbandingan antar-Desa -- `kehadiran` state pecah per Desa+gender, digabung
  // per Desa saja (jumlah kedua gender) supaya grafik tidak terlalu padat/ramai.
  const kehadiranPerDesaChartData = useMemo(() => {
    const map = new Map<string, { desa: string; Hadir: number; Izin: number; Sakit: number; Alpha: number }>()
    for (const r of kehadiran) {
      const existing = map.get(r.nama_desa) || { desa: r.nama_desa, Hadir: 0, Izin: 0, Sakit: 0, Alpha: 0 }
      existing.Hadir += r.hadir
      existing.Izin += r.izin
      existing.Sakit += r.sakit
      existing.Alpha += r.tidak_hadir
      map.set(r.nama_desa, existing)
    }
    return Array.from(map.values())
  }, [kehadiran])

  // Bangun ExportSection dari data yang sudah dimuat -- dipakai baik utk preview PDF maupun
  // export final, supaya keduanya selalu identik (sama seperti pola ExportPreviewModal yang
  // sudah ada di halaman lain).
  const buildSections = (): ExportSection[] => {
    const sections: ExportSection[] = []

    sections.push({
      heading: 'Rekap Kehadiran per Desa & Jenis Kelamin',
      columns: [
        { header: 'Desa', key: 'desa', width: 20 },
        { header: 'Jenis Kelamin', key: 'jk', width: 14 },
        { header: 'Hadir', key: 'hadir', width: 10 },
        { header: 'Izin', key: 'izin', width: 10 },
        { header: 'Sakit', key: 'sakit', width: 10 },
        { header: 'Alpha', key: 'alpha', width: 10 },
        { header: 'Total', key: 'total', width: 10 },
      ],
      rows: kehadiran.map(r => ({
        desa: r.nama_desa,
        jk: r.jenis_kelamin === 'laki-laki' ? 'Laki-laki' : r.jenis_kelamin === 'perempuan' ? 'Perempuan' : '-',
        hadir: r.hadir,
        izin: r.izin,
        sakit: r.sakit,
        alpha: r.tidak_hadir,
        total: r.hadir + r.izin + r.sakit + r.tidak_hadir,
      })),
      summary: [
        { label: 'Total Hadir', value: `${totalKehadiran.hadir} (${grandTotal > 0 ? Math.round((totalKehadiran.hadir / grandTotal) * 100) : 0}%)` },
        { label: 'Total Izin', value: `${totalKehadiran.izin} (${grandTotal > 0 ? Math.round((totalKehadiran.izin / grandTotal) * 100) : 0}%)` },
        { label: 'Total Sakit', value: `${totalKehadiran.sakit} (${grandTotal > 0 ? Math.round((totalKehadiran.sakit / grandTotal) * 100) : 0}%)` },
        { label: 'Total Alpha', value: `${totalKehadiran.tidak_hadir} (${grandTotal > 0 ? Math.round((totalKehadiran.tidak_hadir / grandTotal) * 100) : 0}%)` },
        { label: 'Grand Total', value: String(grandTotal) },
      ],
    })

    sections.push({
      heading: 'Breakdown Kelas Ngaji per Desa & Jenis Kelamin (Generus Aktif Saat Ini)',
      columns: [
        { header: 'Desa', key: 'desa', width: 20 },
        { header: 'Jenis Kelamin', key: 'jk', width: 14 },
        { header: 'Kelas Ngaji', key: 'kelas', width: 18 },
        { header: 'Jumlah', key: 'jumlah', width: 10 },
      ],
      rows: kelasNgaji.map(r => ({
        desa: r.nama_desa,
        jk: r.jenis_kelamin === 'laki-laki' ? 'Laki-laki' : r.jenis_kelamin === 'perempuan' ? 'Perempuan' : '-',
        kelas: KELAS_NGAJI_LABEL[r.kelas_ngaji] || r.kelas_ngaji,
        jumlah: r.jumlah,
      })),
    })

    sections.push({
      heading: `Tren Kehadiran Tahun ${tahun}`,
      columns: [
        { header: 'Bulan', key: 'bulan', width: 14 },
        { header: 'Hadir', key: 'hadir', width: 10 },
        { header: 'Izin', key: 'izin', width: 10 },
        { header: 'Sakit', key: 'sakit', width: 10 },
        { header: 'Alpha', key: 'alpha', width: 10 },
        { header: 'Total', key: 'total', width: 10 },
      ],
      rows: tren.map(r => ({
        bulan: BULAN_LABEL[r.bulan - 1],
        hadir: r.hadir,
        izin: r.izin,
        sakit: r.sakit,
        alpha: r.tidak_hadir,
        total: r.hadir + r.izin + r.sakit + r.tidak_hadir,
      })),
    })

    sections.push({
      heading: `Pertumbuhan Database Generus Tahun ${tahun}`,
      columns: [
        { header: 'Bulan', key: 'bulan', width: 14 },
        { header: 'Generus Baru', key: 'jumlah', width: 14 },
      ],
      rows: pertumbuhanChartData.map((r, i) => ({ bulan: BULAN_LABEL[i], jumlah: r.jumlah })),
    })

    return sections
  }

  // exportOptions TANPA charts -- dipakai utk pratinjau PDF di layar (getMultiSectionPdfPreviewDataUrl)
  // supaya pratinjau tetap cepat/ringan (tidak nunggu capture PNG). Grafik hanya disisipkan pas
  // export final (lihat captureChartImages + handleExportPDF/Excel di bawah).
  const exportOptions: MultiSectionExportOptions = {
    title: 'Laporan Bulanan Kehadiran & Database Generus',
    subtitle: `Se-Bekasi Timur -- ${BULAN_LABEL[bulan - 1]} ${tahun}`,
    sections: buildSections(),
    fileName: `Laporan-Bulanan-Daerah-${BULAN_LABEL[bulan - 1]}-${tahun}`,
  }

  const previewUrl = useMemo(() => {
    if (!previewOpen || loading) return null
    try {
      return getMultiSectionPdfPreviewDataUrl(exportOptions)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    } catch (e) {
      console.error('Gagal membangun pratinjau PDF laporan bulanan:', e)
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen, loading, kehadiran, kelasNgaji, tren, pertumbuhan])

  // Capture ketiga grafik (kalau datanya ada & node sudah ter-mount) jadi PNG base64 lewat
  // html-to-image -- dipanggil sesaat sebelum export PDF/Excel supaya file yang diunduh ikut
  // memuat visualisasi yang sama persis dengan yang tampil di layar. Grafik yang datanya kosong
  // (guard `.some(...)`/`.length > 0` di JSX) node-nya tidak ter-render sama sekali, jadi
  // otomatis dilewati di sini juga (ref tetap null).
  //
  // PENTING: node grafik hanya ter-mount di mode "Ringkasan" (previewOpen === false) --
  // kalau user menekan Export saat sedang berada di mode Pratinjau PDF (iframe), ref-nya
  // masih null. Makanya di awal fungsi ini kita paksa balik ke mode Ringkasan dulu (kalau
  // perlu) dan tunggu satu render cycle sebelum capture, supaya chart selalu berhasil
  // di-capture apa pun mode yang sedang aktif saat tombol Export ditekan.
  const captureChartImages = async (): Promise<ExportChartImage[]> => {
    if (previewOpen) {
      setPreviewOpen(false)
      // Tunggu React commit render mode Ringkasan (Recharts butuh 1 tick tambahan supaya
      // ResponsiveContainer sempat mengukur lebar kontainer sebelum bisa di-capture).
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    const targets: { ref: React.RefObject<HTMLDivElement | null>; title: string }[] = [
      { ref: trenChartRef, title: `Tren Kehadiran ${tahun} (12 Bulan)` },
      { ref: pertumbuhanChartRef, title: `Pertumbuhan Database Generus ${tahun} (12 Bulan)` },
      { ref: kehadiranDesaChartRef, title: `Perbandingan Kehadiran per Desa -- ${BULAN_LABEL[bulan - 1]} ${tahun}` },
    ]
    const results: ExportChartImage[] = []
    for (const t of targets) {
      const node = t.ref.current
      if (!node) continue
      try {
        const imageDataUrl = await toPng(node, { backgroundColor: '#ffffff', pixelRatio: 2 })
        const rect = node.getBoundingClientRect()
        const aspectRatio = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 9
        results.push({ title: t.title, imageDataUrl, aspectRatio })
      } catch (e) {
        console.error(`Gagal meng-capture grafik "${t.title}":`, e)
      }
    }
    return results
  }

  const handleExportPDF = async () => {
    setExportingPdf(true)
    try {
      const charts = await captureChartImages()
      exportMultiSectionToPDF({ ...exportOptions, charts })
      await logAudit(user, 'EXPORT', 'Laporan Bulanan Daerah', `PDF -- ${BULAN_LABEL[bulan - 1]} ${tahun}`)
    } finally {
      setExportingPdf(false)
    }
  }

  const handleExportExcel = async () => {
    setExportingExcel(true)
    try {
      const charts = await captureChartImages()
      await exportMultiSectionToExcel({ ...exportOptions, charts })
      await logAudit(user, 'EXPORT', 'Laporan Bulanan Daerah', `Excel -- ${BULAN_LABEL[bulan - 1]} ${tahun}`)
    } finally {
      setExportingExcel(false)
    }
  }

  if (!open) return null

  const tahunOptions = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Laporan Bulanan -- Se-Bekasi Timur</h2>
            <p className="text-xs text-slate-400 mt-0.5">Rekap kehadiran, kelas ngaji, tren, dan pertumbuhan Generus</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
            ✕
          </button>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 shrink-0 flex items-center gap-3 flex-wrap">
          <label className="text-xs text-slate-500">Bulan:</label>
          <select value={bulan} onChange={e => setBulan(Number(e.target.value))}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {BULAN_LABEL.map((b, i) => <option key={b} value={i + 1}>{b}</option>)}
          </select>
          <label className="text-xs text-slate-500">Tahun:</label>
          <select value={tahun} onChange={e => setTahun(Number(e.target.value))}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {tahunOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {!previewOpen && (
            <button onClick={() => setPreviewOpen(true)} disabled={loading}
              className="ml-auto px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition disabled:opacity-50">
              🔍 Pratinjau PDF
            </button>
          )}
          {previewOpen && (
            <button onClick={() => setPreviewOpen(false)}
              className="ml-auto px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition">
              ← Kembali ke Ringkasan
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm mb-4">{error}</div>}

          {loading ? (
            <div className="h-full flex items-center justify-center text-slate-400">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : previewOpen ? (
            previewUrl ? (
              <iframe src={previewUrl} title="Pratinjau Laporan Bulanan" className="w-full h-full rounded-xl border border-slate-200 bg-white" />
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">Gagal membuat pratinjau.</div>
            )
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl p-4 border border-slate-100">
                  <p className="text-2xl font-bold text-green-600">{totalKehadiran.hadir}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Hadir</p>
                </div>
                <div className="bg-white rounded-xl p-4 border border-slate-100">
                  <p className="text-2xl font-bold text-amber-600">{totalKehadiran.izin}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Izin</p>
                </div>
                <div className="bg-white rounded-xl p-4 border border-slate-100">
                  <p className="text-2xl font-bold text-purple-600">{totalKehadiran.sakit}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Sakit</p>
                </div>
                <div className="bg-white rounded-xl p-4 border border-slate-100">
                  <p className="text-2xl font-bold text-red-600">{totalKehadiran.tidak_hadir}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Alpha</p>
                </div>
              </div>

              {(tren.some(r => r.hadir + r.izin + r.sakit + r.tidak_hadir > 0)) && (
                <div ref={trenChartRef} className="bg-white rounded-xl border border-slate-100 p-4">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">Tren Kehadiran {tahun} (12 Bulan)</h4>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={trenChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="bulan" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="Hadir" stroke="#16a34a" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="Izin" stroke="#d97706" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="Sakit" stroke="#9333ea" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="Alpha" stroke="#dc2626" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {pertumbuhanChartData.some(r => r.jumlah > 0) && (
                <div ref={pertumbuhanChartRef} className="bg-white rounded-xl border border-slate-100 p-4">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">Pertumbuhan Database Generus {tahun} (12 Bulan)</h4>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={pertumbuhanChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="bulan" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                      <Bar dataKey="jumlah" name="Generus Baru" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {kehadiranPerDesaChartData.length > 0 && (
                <div ref={kehadiranDesaChartRef} className="bg-white rounded-xl border border-slate-100 p-4">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">
                    Perbandingan Kehadiran per Desa -- {BULAN_LABEL[bulan - 1]} {tahun}
                  </h4>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={kehadiranPerDesaChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="desa" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Hadir" fill="#16a34a" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="Izin" fill="#d97706" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="Sakit" fill="#9333ea" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="Alpha" fill="#dc2626" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {kehadiran.length === 0 && kelasNgaji.length === 0 ? (
                <div className="bg-white rounded-xl p-8 text-center text-slate-400 text-sm">
                  Belum ada data absensi/kegiatan untuk periode ini. Klik "Pratinjau PDF" untuk melihat format laporan lengkap (termasuk tren & pertumbuhan Generus).
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-100">
                    <h4 className="text-sm font-semibold text-slate-700">Rekap Kehadiran per Desa</h4>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                          <th className="px-4 py-2 font-medium">Desa</th>
                          <th className="px-4 py-2 font-medium">JK</th>
                          <th className="px-4 py-2 font-medium text-center">Hadir</th>
                          <th className="px-4 py-2 font-medium text-center">Izin</th>
                          <th className="px-4 py-2 font-medium text-center">Sakit</th>
                          <th className="px-4 py-2 font-medium text-center">Alpha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kehadiran.map((r, i) => (
                          <tr key={i} className="border-b border-slate-50">
                            <td className="px-4 py-2 text-slate-700">{r.nama_desa}</td>
                            <td className="px-4 py-2 text-slate-500 text-xs">{r.jenis_kelamin === 'laki-laki' ? 'L' : r.jenis_kelamin === 'perempuan' ? 'P' : '-'}</td>
                            <td className="px-4 py-2 text-center">{r.hadir}</td>
                            <td className="px-4 py-2 text-center">{r.izin}</td>
                            <td className="px-4 py-2 text-center">{r.sakit}</td>
                            <td className="px-4 py-2 text-center">{r.tidak_hadir}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <p className="text-xs text-slate-400 text-center">
                Rekap lengkap (breakdown kelas ngaji, tren 12 bulan, pertumbuhan Generus) tersedia di pratinjau PDF & hasil export.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 shrink-0 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition">
            Tutup
          </button>
          <button onClick={handleExportPDF} disabled={loading || exportingPdf}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition disabled:opacity-50 flex items-center gap-1.5">
            {exportingPdf ? 'Menyimpan...' : '📄 Export PDF'}
          </button>
          <button onClick={handleExportExcel} disabled={loading || exportingExcel}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-1.5">
            {exportingExcel ? 'Menyimpan...' : '📊 Export Excel'}
          </button>
        </div>
      </div>
    </div>
  )
}
