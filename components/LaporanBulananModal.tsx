'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import { UserProfile } from '@/lib/types'
import {
  MultiSectionExportOptions,
  ExportSection,
  exportMultiSectionToPDF,
  exportMultiSectionToExcel,
  getMultiSectionPdfPreviewDataUrl,
} from '@/lib/export'

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
      rows: (() => {
        const map = new Map(pertumbuhan.map(p => [p.bulan, p.jumlah]))
        return Array.from({ length: 12 }, (_, i) => {
          const key = `${tahun}-${String(i + 1).padStart(2, '0')}`
          return { bulan: BULAN_LABEL[i], jumlah: map.get(key) || 0 }
        })
      })(),
    })

    return sections
  }

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

  const handleExportPDF = async () => {
    setExportingPdf(true)
    try {
      exportMultiSectionToPDF(exportOptions)
      await logAudit(user, 'EXPORT', 'Laporan Bulanan Daerah', `PDF -- ${BULAN_LABEL[bulan - 1]} ${tahun}`)
    } finally {
      setExportingPdf(false)
    }
  }

  const handleExportExcel = async () => {
    setExportingExcel(true)
    try {
      await exportMultiSectionToExcel(exportOptions)
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
