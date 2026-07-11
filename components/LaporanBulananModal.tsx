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
  ResponsiveContainer, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { toPng } from 'html-to-image'

// Modal "Laporan Bulanan" -- adaptasi dari laporan rekap Excel bulanan se-Daerah yang
// sebelumnya dikerjakan manual oleh PPG (lihat percakapan: user menunjukkan contoh file
// "5. JULI.xlsx" berisi rekap kehadiran per Desa+gender, breakdown kelas ngaji, tren 12
// bulan, dan pertumbuhan database Generus). Awalnya hanya utk PPG/Ketua Daerah/Super Admin,
// lalu diperluas (lihat canLihatLaporanBulanan & getLaporanBulananScope di lib/roles.ts)
// supaya Ketua/Sekretaris Desa & Kelompok juga punya laporan bulanan scope jenjangnya
// sendiri. Modal ini generik lewat prop `scope`: menentukan RPC mana yang dipanggil dan
// label breakdown apa yang dipakai (Desa utk scope daerah, Kelompok utk scope desa, tidak
// ada breakdown/hanya gender utk scope kelompok karena itu unit terkecil). Data diambil dari
// RPC get_laporan_kehadiran_bulanan_{daerah,desa,kelompok} / get_laporan_kelas_ngaji_{...} /
// get_tren_kehadiran_tahunan_{...} (migration create_laporan_bulanan_daerah_rpc,
// add_laporan_bulanan_rpc_scope_desa, add_laporan_bulanan_rpc_scope_kelompok) +
// get_pertumbuhan_generus yang sudah generik lewat p_desa_id/p_kelompok_id.

interface Props {
  open: boolean
  onClose: () => void
  user: UserProfile
  scope: { tingkatan: 'daerah' | 'desa' | 'kelompok'; scopeId: string | null }
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

// Row mentah dari RPC berbeda bentuk per scope (daerah -> desa_id/nama_desa, desa ->
// kelompok_id/nama_kelompok, kelompok -> tidak ada kolom grouping sama sekali). Dinormalisasi
// jadi `label` generik segera setelah fetch (lihat useEffect) supaya seluruh kode di bawah
// (render tabel, grafik, buildSections) tidak perlu tahu bedanya.
interface KehadiranRow {
  label: string
  jenis_kelamin: string | null
  hadir: number
  izin: number
  sakit: number
  tidak_hadir: number
}

interface KelasNgajiRow {
  label: string
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

// Label untuk breakdown grouping, disesuaikan per scope -- dipakai di header tabel & judul
// section export supaya konsisten dengan apa yang sebenarnya sedang di-breakdown.
const GROUPING_LABEL: Record<Props['scope']['tingkatan'], string> = {
  daerah: 'Desa',
  desa: 'Kelompok',
  kelompok: 'Jenis Kelamin', // scope kelompok tidak punya breakdown grouping lain
}

const JUDUL_LAPORAN: Record<Props['scope']['tingkatan'], string> = {
  daerah: 'Laporan Bulanan -- Se-Bekasi Timur',
  desa: 'Laporan Bulanan -- Tingkat Desa',
  kelompok: 'Laporan Bulanan -- Tingkat Kelompok',
}

export default function LaporanBulananModal({ open, onClose, user, scope }: Props) {
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

      // Pilih RPC & parameter sesuai scope. Kolom grouping RPC beda-beda per scope (desa_id/
      // nama_desa utk daerah, kelompok_id/nama_kelompok utk desa, tidak ada kolom grouping
      // sama sekali utk kelompok) -- dinormalisasi ke `label` generik di bawah.
      const rpcSuffix = scope.tingkatan // 'daerah' | 'desa' | 'kelompok'
      const scopeParam =
        scope.tingkatan === 'desa' ? { p_desa_id: scope.scopeId }
        : scope.tingkatan === 'kelompok' ? { p_kelompok_id: scope.scopeId }
        : {}

      const [
        { data: kehadiranData, error: errKehadiran },
        { data: kelasNgajiData, error: errKelasNgaji },
        { data: trenData, error: errTren },
        { data: pertumbuhanData, error: errPertumbuhan },
      ] = await Promise.all([
        supabase.rpc(`get_laporan_kehadiran_bulanan_${rpcSuffix}`, { ...scopeParam, p_bulan: bulan, p_tahun: tahun }),
        supabase.rpc(`get_laporan_kelas_ngaji_${rpcSuffix}`, { ...scopeParam, p_bulan: bulan, p_tahun: tahun }),
        supabase.rpc(`get_tren_kehadiran_tahunan_${rpcSuffix}`, { ...scopeParam, p_tahun: tahun }),
        supabase.rpc('get_pertumbuhan_generus', {
          p_desa_id: scope.tingkatan === 'desa' ? scope.scopeId : null,
          p_kelompok_id: scope.tingkatan === 'kelompok' ? scope.scopeId : null,
          p_range_start: `${tahun}-01-01`,
        }),
      ])
      if (cancelled) return

      const firstError = errKehadiran || errKelasNgaji || errTren || errPertumbuhan
      if (firstError) {
        setError(firstError.message)
        setLoading(false)
        return
      }

      // Normalisasi: scope daerah -> label = nama_desa, scope desa -> label = nama_kelompok,
      // scope kelompok -> tidak ada kolom grouping di RPC, label dikosongkan (tabel/export
      // akan skip kolom grouping utk scope ini, lihat buildSections & JSX render).
      type RawRow = Record<string, unknown>
      const toLabel = (r: RawRow): string =>
        scope.tingkatan === 'daerah' ? String(r.nama_desa ?? '-')
        : scope.tingkatan === 'desa' ? String(r.nama_kelompok ?? '-')
        : ''

      setKehadiran(((kehadiranData as RawRow[]) || []).map(r => ({
        label: toLabel(r),
        jenis_kelamin: (r.jenis_kelamin as string | null) ?? null,
        hadir: Number(r.hadir) || 0,
        izin: Number(r.izin) || 0,
        sakit: Number(r.sakit) || 0,
        tidak_hadir: Number(r.tidak_hadir) || 0,
      })))
      setKelasNgaji(((kelasNgajiData as RawRow[]) || []).map(r => ({
        label: toLabel(r),
        jenis_kelamin: (r.jenis_kelamin as string | null) ?? null,
        kelas_ngaji: String(r.kelas_ngaji ?? ''),
        jumlah: Number(r.jumlah) || 0,
      })))
      setTren((trenData as TrenRow[]) || [])
      setPertumbuhan((pertumbuhanData as PertumbuhanRow[]) || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [open, bulan, tahun, scope.tingkatan, scope.scopeId])

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
  // `TidakHadir` = gabungan izin+sakit+tidak_hadir(alpha), dipakai grafik area (v2) yg
  // membandingkan hadir vs semua bentuk ketidakhadiran jadi satu garis -- lebih gampang
  // dibaca polanya drpd 4 garis terpisah bertumpuk (lihat diskusi desain: versi lama LineChart
  // 4-garis diganti AreaChart 2-area).
  const trenChartData = useMemo(() => {
    return tren.map(r => ({
      bulan: BULAN_LABEL[r.bulan - 1].slice(0, 3),
      Hadir: r.hadir,
      Izin: r.izin,
      Sakit: r.sakit,
      Alpha: r.tidak_hadir,
      TidakHadir: r.izin + r.sakit + r.tidak_hadir,
    }))
  }, [tren])

  // Data grafik perbandingan antar-unit (Desa utk scope daerah, Kelompok utk scope desa) --
  // `kehadiran` state pecah per unit+gender, digabung per unit saja (jumlah kedua gender)
  // supaya grafik tidak terlalu padat/ramai. Utk scope kelompok (label selalu kosong krn tidak
  // ada breakdown grouping), hasilnya otomatis 1 baris saja -- grafik ini disembunyikan di JSX
  // utk scope kelompok (lihat kondisi render di bawah), jadi tidak masalah. Field `pct`
  // (persentase hadir) & `status` ('baik'/'perhatian') ditambahkan di sini (bukan cuma di JSX)
  // supaya bisa dipakai juga oleh ringkasanOtomatis di bawah dan buildSections utk export --
  // satu sumber kebenaran, tidak dihitung ulang beda tempat.
  const AMBANG_ALPHA_PERHATIAN = 10 // % -- di atas ini, unit ditandai "Perlu perhatian"

  const kehadiranPerUnitChartData = useMemo(() => {
    const map = new Map<string, { unit: string; Hadir: number; Izin: number; Sakit: number; Alpha: number }>()
    for (const r of kehadiran) {
      const existing = map.get(r.label) || { unit: r.label, Hadir: 0, Izin: 0, Sakit: 0, Alpha: 0 }
      existing.Hadir += r.hadir
      existing.Izin += r.izin
      existing.Sakit += r.sakit
      existing.Alpha += r.tidak_hadir
      map.set(r.label, existing)
    }
    return Array.from(map.values()).map(u => {
      const total = u.Hadir + u.Izin + u.Sakit + u.Alpha
      const pctHadir = total > 0 ? Math.round((u.Hadir / total) * 100) : 0
      const pctAlpha = total > 0 ? Math.round((u.Alpha / total) * 100) : 0
      return { ...u, pctHadir, perluPerhatian: pctAlpha >= AMBANG_ALPHA_PERHATIAN }
    })
  }, [kehadiran])

  // Unit dgn alpha rate tertinggi (dipakai utk menyebut nama unit di kalimat ringkasan) --
  // null kalau tidak ada satupun yang melewati ambang perhatian, atau scope kelompok (tidak
  // ada breakdown unit lain utk disebut).
  const unitPerluPerhatian = useMemo(() => {
    if (scope.tingkatan === 'kelompok') return null
    const kandidat = kehadiranPerUnitChartData.filter(u => u.perluPerhatian && u.unit)
    if (kandidat.length === 0) return null
    return kandidat.reduce((max, u) => (u.pctHadir < max.pctHadir ? u : max), kandidat[0])
  }, [kehadiranPerUnitChartData, scope.tingkatan])

  // Persentase kehadiran bulan ini vs bulan sebelumnya -- diambil dari state `tren` yang
  // SUDAH memuat data 12 bulan tahun berjalan (RPC get_tren_kehadiran_tahunan_*), jadi tidak
  // perlu RPC/fetch tambahan. Bulan Januari tidak punya pembanding dalam tahun yang sama
  // (butuh Desember tahun lalu, di luar cakupan RPC ini) -- delta jadi null, ringkasan
  // otomatis menyesuaikan kalimatnya (skip perbandingan) utk kasus ini.
  const deltaKehadiran = useMemo(() => {
    const baris = (b: number) => tren.find(r => r.bulan === b)
    const hitungPct = (r: TrenRow | undefined) => {
      if (!r) return null
      const total = r.hadir + r.izin + r.sakit + r.tidak_hadir
      return total > 0 ? Math.round((r.hadir / total) * 100) : null
    }
    const pctSekarang = hitungPct(baris(bulan))
    const pctSebelumnya = bulan > 1 ? hitungPct(baris(bulan - 1)) : null
    if (pctSekarang === null || pctSebelumnya === null) return { pctSekarang, delta: null }
    return { pctSekarang, delta: pctSekarang - pctSebelumnya }
  }, [tren, bulan])

  // Kalimat ringkasan otomatis -- murni template teks diisi hasil perhitungan di atas (BUKAN
  // AI/LLM), supaya akurat & bisa ditelusuri persis dari mana angkanya berasal. Dua bagian:
  // (1) perbandingan kehadiran vs bulan lalu (kalau datanya ada), (2) unit yang perlu
  // perhatian krn alpha rate tinggi (kalau ada & scope punya breakdown unit). Kalau tidak ada
  // data sama sekali (grandTotal 0), ringkasan dilewati (lihat kondisi render di JSX).
  const ringkasanOtomatis = useMemo(() => {
    const bagian: string[] = []
    if (deltaKehadiran.pctSekarang !== null) {
      if (deltaKehadiran.delta === null) {
        bagian.push(`Kehadiran bulan ini ${deltaKehadiran.pctSekarang}%.`)
      } else if (deltaKehadiran.delta > 0) {
        bagian.push(`Kehadiran naik ${deltaKehadiran.delta}% dari ${BULAN_LABEL[bulan - 2]}.`)
      } else if (deltaKehadiran.delta < 0) {
        bagian.push(`Kehadiran turun ${Math.abs(deltaKehadiran.delta)}% dari ${BULAN_LABEL[bulan - 2]}.`)
      } else {
        bagian.push(`Kehadiran stabil, sama seperti ${BULAN_LABEL[bulan - 2]}.`)
      }
    }
    if (unitPerluPerhatian) {
      bagian.push(`${GROUPING_LABEL[scope.tingkatan]} ${unitPerluPerhatian.unit} perlu perhatian -- tingkat alpha di atas ${AMBANG_ALPHA_PERHATIAN}%.`)
    }
    return bagian.join(' ')
  }, [deltaKehadiran, unitPerluPerhatian, bulan, scope.tingkatan])

  // Bangun ExportSection dari data yang sudah dimuat -- dipakai baik utk preview PDF maupun
  // export final, supaya keduanya selalu identik (sama seperti pola ExportPreviewModal yang
  // sudah ada di halaman lain).
  const buildSections = (): ExportSection[] => {
    const sections: ExportSection[] = []
    const groupingLabel = GROUPING_LABEL[scope.tingkatan]
    // Scope kelompok tidak punya kolom grouping (unit terkecil) -- kolom "Kelompok"/"Desa"
    // dilewati sepenuhnya utk section ini, cukup Jenis Kelamin.
    const showGrouping = scope.tingkatan !== 'kelompok'

    // Section "Status per unit" -- sama persis dgn ringkasan visual on-screen (bar+badge),
    // ditaruh PALING AWAL di file export supaya orang yang buka PDF/Excel langsung lihat
    // kesimpulan sebelum tabel detail mentah (konsisten dgn urutan tampilan modal di layar).
    // Kalimat ringkasanOtomatis sendiri sudah muncul sbg subtitle laporan (lihat exportOptions
    // di bawah), tidak diulang di sini sbg section terpisah.
    if (showGrouping && kehadiranPerUnitChartData.length > 0) {
      sections.push({
        heading: `Status per ${groupingLabel}`,
        columns: [
          { header: groupingLabel, key: 'unit', width: 22 },
          { header: 'Persentase Hadir', key: 'pct', width: 16 },
          { header: 'Status', key: 'status', width: 16 },
        ],
        rows: kehadiranPerUnitChartData.map(u => ({
          unit: u.unit,
          pct: `${u.pctHadir}%`,
          status: u.perluPerhatian ? 'Perlu perhatian' : 'Baik',
        })),
      })
    }

    sections.push({
      heading: `Rekap Kehadiran per ${showGrouping ? `${groupingLabel} & ` : ''}Jenis Kelamin`,
      columns: [
        ...(showGrouping ? [{ header: groupingLabel, key: 'unit', width: 20 }] : []),
        { header: 'Jenis Kelamin', key: 'jk', width: 14 },
        { header: 'Hadir', key: 'hadir', width: 10 },
        { header: 'Izin', key: 'izin', width: 10 },
        { header: 'Sakit', key: 'sakit', width: 10 },
        { header: 'Alpha', key: 'alpha', width: 10 },
        { header: 'Total', key: 'total', width: 10 },
      ],
      rows: kehadiran.map(r => ({
        unit: r.label,
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
      heading: `Breakdown Kelas Ngaji per ${showGrouping ? `${groupingLabel} & ` : ''}Jenis Kelamin (Generus Aktif Saat Ini)`,
      columns: [
        ...(showGrouping ? [{ header: groupingLabel, key: 'unit', width: 20 }] : []),
        { header: 'Jenis Kelamin', key: 'jk', width: 14 },
        { header: 'Kelas Ngaji', key: 'kelas', width: 18 },
        { header: 'Jumlah', key: 'jumlah', width: 10 },
      ],
      rows: kelasNgaji.map(r => ({
        unit: r.label,
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
    subtitle: `${JUDUL_LAPORAN[scope.tingkatan].replace('Laporan Bulanan -- ', '')} -- ${BULAN_LABEL[bulan - 1]} ${tahun}`,
    note: ringkasanOtomatis || undefined,
    sections: buildSections(),
    fileName: `Laporan-Bulanan-${scope.tingkatan[0].toUpperCase()}${scope.tingkatan.slice(1)}-${BULAN_LABEL[bulan - 1]}-${tahun}`,
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
      await logAudit(user, 'EXPORT', JUDUL_LAPORAN[scope.tingkatan], `PDF -- ${BULAN_LABEL[bulan - 1]} ${tahun}`)
    } finally {
      setExportingPdf(false)
    }
  }

  const handleExportExcel = async () => {
    setExportingExcel(true)
    try {
      const charts = await captureChartImages()
      await exportMultiSectionToExcel({ ...exportOptions, charts })
      await logAudit(user, 'EXPORT', JUDUL_LAPORAN[scope.tingkatan], `Excel -- ${BULAN_LABEL[bulan - 1]} ${tahun}`)
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
            <h2 className="text-lg font-bold text-slate-800">{JUDUL_LAPORAN[scope.tingkatan]}</h2>
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

    