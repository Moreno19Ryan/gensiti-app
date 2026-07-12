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
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, LineChart, Line,
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

// Rata-rata 6 bulan per unit (v3) -- dari RPC get_rata_rata_kehadiran_6bulan_{daerah,desa,
// kelompok}, dinormalisasi jadi `label` generik sama seperti KehadiranRow di atas. Dipakai
// sbg garis pembanding di grafik & basis deteksi anomali (lonjakan alpha vs histori unit itu
// sendiri, bukan ambang tetap sama utk semua unit spt v2).
interface RataRataRow {
  label: string
  rataPctHadir: number
  rataPctAlpha: number
}

// v4: rekap kehadiran per generus (individu) selama 1 bulan -- request user setelah lihat
// contoh laporan Excel manual lama ("5. JULI.xlsx") yang selalu mencantumkan nama tiap
// Generus per Kelompok, bukan cuma angka agregat spt laporan digital kita sebelumnya. Dari
// RPC get_rekap_generus_bulanan_{daerah,desa,kelompok} -- beda dari row lain di atas, row ini
// TIDAK dinormalisasi ke `label` generik krn butuh 2 tingkat grouping sekaligus utk scope
// daerah (Desa lalu Kelompok), jadi field grouping-nya dipertahankan apa adanya per scope.
interface RekapGenerusRow {
  id: string
  namaLengkap: string
  jenisKelamin: string | null
  namaDesa: string | null // hanya terisi utk scope daerah
  namaKelompok: string | null // terisi utk scope daerah & desa, kosong utk scope kelompok
  hadir: number
  izin: number
  sakit: number
  tidakHadir: number
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
  const [rataRata, setRataRata] = useState<RataRataRow[]>([])
  const [rekapGenerus, setRekapGenerus] = useState<RekapGenerusRow[]>([])

  // Ref ke tiap DOM node grafik -- dipakai html-to-image (toPng) utk capture grafik jadi PNG
  // sesaat sebelum export, supaya grafik yang sudah tampil di layar bisa ikut disisipkan ke
  // PDF/Excel (bukan cuma tampil on-screen). Node-nya SELALU di-render (lihat JSX di bawah,
  // wrapper "grafik" tidak dikondisikan hilang total walau sedang di mode Pratinjau PDF),
  // hanya disembunyikan via CSS saat tidak sedang ditampilkan -- supaya ref selalu siap
  // di-capture kapan pun user menekan Export, tanpa perlu switch tab dulu.
  const trenChartRef = useRef<HTMLDivElement>(null)
  const pertumbuhanChartRef = useRef<HTMLDivElement>(null)
  const kehadiranDesaChartRef = useRef<HTMLDivElement>(null)
  const trenPersenChartRef = useRef<HTMLDivElement>(null) // v3: grafik persentase vs rata-rata 6 bulan

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
        { data: rataRataData, error: errRataRata },
        { data: rekapGenerusData, error: errRekapGenerus },
      ] = await Promise.all([
        supabase.rpc(`get_laporan_kehadiran_bulanan_${rpcSuffix}`, { ...scopeParam, p_bulan: bulan, p_tahun: tahun }),
        supabase.rpc(`get_laporan_kelas_ngaji_${rpcSuffix}`, { ...scopeParam, p_bulan: bulan, p_tahun: tahun }),
        supabase.rpc(`get_tren_kehadiran_tahunan_${rpcSuffix}`, { ...scopeParam, p_tahun: tahun }),
        supabase.rpc('get_pertumbuhan_generus', {
          p_desa_id: scope.tingkatan === 'desa' ? scope.scopeId : null,
          p_kelompok_id: scope.tingkatan === 'kelompok' ? scope.scopeId : null,
          p_range_start: `${tahun}-01-01`,
        }),
        // v3: rata-rata 6 bulan per unit -- garis pembanding grafik & basis deteksi anomali.
        supabase.rpc(`get_rata_rata_kehadiran_6bulan_${rpcSuffix}`, { ...scopeParam, p_bulan: bulan, p_tahun: tahun }),
        // v4: rekap kehadiran per generus (nama individu) -- section "Daftar Generus".
        supabase.rpc(`get_rekap_generus_bulanan_${rpcSuffix}`, { ...scopeParam, p_bulan: bulan, p_tahun: tahun }),
      ])
      if (cancelled) return

      const firstError = errKehadiran || errKelasNgaji || errTren || errPertumbuhan || errRataRata || errRekapGenerus
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
      setRataRata(((rataRataData as RawRow[]) || []).map(r => ({
        label: toLabel(r),
        rataPctHadir: Number(r.rata_pct_hadir) || 0,
        rataPctAlpha: Number(r.rata_pct_alpha) || 0,
      })))
      setRekapGenerus(((rekapGenerusData as RawRow[]) || []).map(r => ({
        id: String(r.generus_id ?? ''),
        namaLengkap: String(r.nama_lengkap ?? '-'),
        jenisKelamin: (r.jenis_kelamin as string | null) ?? null,
        namaDesa: (r.nama_desa as string | null) ?? null,
        namaKelompok: (r.nama_kelompok as string | null) ?? null,
        hadir: Number(r.hadir) || 0,
        izin: Number(r.izin) || 0,
        sakit: Number(r.sakit) || 0,
        tidakHadir: Number(r.tidak_hadir) || 0,
      })))
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
  // 4-garis diganti AreaChart 2-area). `Hadir` di sini masih dalam JUMLAH ORANG (bukan %) --
  // dipertahankan spt semula supaya grafik tetap merepresentasikan volume absensi riil.
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
  //
  // v3: "perluPerhatian" sekarang deteksi LONJAKAN vs histori 6-bulan unit itu SENDIRI (dari
  // RPC get_rata_rata_kehadiran_6bulan_*), bukan ambang tetap sama utk semua unit spt v2.
  // Unit dianggap anomali kalau alpha rate bulan ini >= 2x rata-rata alpha 6-bulan-nya SENDIRI
  // (MULTIPLIER_ANOMALI). Kalau unit belum punya histori sama sekali (rataPctAlpha 0, mis.
  // baru dibentuk bulan ini), fallback ke AMBANG_ALPHA_ABSOLUT supaya tidak salah tandai "2x
  // dari 0" jadi selalu true utk alpha berapa pun -- perbandingan relatif tidak bermakna tanpa
  // baseline, jadi pakai ambang absolut sbg pengaman.
  const MULTIPLIER_ANOMALI = 2
  const AMBANG_ALPHA_ABSOLUT = 10 // % -- fallback kalau unit belum punya histori 6 bulan

  const rataRataMap = useMemo(() => new Map(rataRata.map(r => [r.label, r])), [rataRata])

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
      const histori = rataRataMap.get(u.unit)
      const punyaHistori = !!histori && histori.rataPctAlpha > 0
      const perluPerhatian = punyaHistori
        ? pctAlpha >= histori!.rataPctAlpha * MULTIPLIER_ANOMALI
        : pctAlpha >= AMBANG_ALPHA_ABSOLUT
      return {
        ...u, pctHadir, perluPerhatian,
        rataPctHadirHistori: histori?.rataPctHadir ?? null,
      }
    })
  }, [kehadiran, rataRataMap])

  // Task 46: breakdown per gender per unit, utk drill-down di tabel "Status per Unit" --
  // data mentahnya sudah ada di state `kehadiran` (sudah pecah per unit+gender dari RPC),
  // tinggal di-grouping ulang per unit jadi Map<unit, {laki-laki, perempuan}> supaya bisa
  // langsung dipakai saat baris unit diklik utk expand, TANPA fetch/RPC tambahan.
  const genderBreakdownPerUnit = useMemo(() => {
    const map = new Map<string, { jk: string; hadir: number; izin: number; sakit: number; alpha: number; total: number }[]>()
    for (const r of kehadiran) {
      const existing = map.get(r.label) || []
      const total = r.hadir + r.izin + r.sakit + r.tidak_hadir
      existing.push({
        jk: r.jenis_kelamin === 'laki-laki' ? 'Laki-laki' : r.jenis_kelamin === 'perempuan' ? 'Perempuan' : '-',
        hadir: r.hadir, izin: r.izin, sakit: r.sakit, alpha: r.tidak_hadir, total,
      })
      map.set(r.label, existing)
    }
    return map
  }, [kehadiran])

  const [expandedUnit, setExpandedUnit] = useState<string | null>(null)
  const [showDaftarGenerus, setShowDaftarGenerus] = useState(false)
  const [cariGenerus, setCariGenerus] = useState('')

  // v4: rekap per-generus diolah jadi bentuk siap-render -- tambah pctHadir, totalKegiatan,
  // status "perlu perhatian" (alpha tinggi individu, ambang absolut krn histori per-ORANG
  // blm ada RPC-nya -- beda dari deteksi anomali per-UNIT di atas yg sudah punya baseline 6
  // bulan), dan groupLabel (nama Kelompok, atau "Nama Desa -- Nama Kelompok" utk scope daerah
  // supaya tabel besar tetap bisa di-scan per grup tanpa 2 kolom terpisah). Diurutkan per grup
  // lalu nama, dan generus tanpa kegiatan sama sekali (total 0) diletakkan apa adanya (bukan
  // dianggap alpha -- tidak ada data kehadiran utk dinilai).
  const AMBANG_ALPHA_INDIVIDU = 50 // % -- ambang perhatian utk individu (blm ada baseline historis per-orang)
  const rekapGenerusRows = useMemo(() => {
    return rekapGenerus
      .map(r => {
        const total = r.hadir + r.izin + r.sakit + r.tidakHadir
        const pctHadir = total > 0 ? Math.round((r.hadir / total) * 100) : 0
        const pctAlpha = total > 0 ? Math.round((r.tidakHadir / total) * 100) : 0
        const groupLabel =
          scope.tingkatan === 'daerah' ? `${r.namaDesa ?? '-'} -- ${r.namaKelompok ?? '-'}`
          : scope.tingkatan === 'desa' ? (r.namaKelompok ?? '-')
          : ''
        return {
          ...r, total, pctHadir,
          perluPerhatian: total > 0 && pctAlpha >= AMBANG_ALPHA_INDIVIDU,
          groupLabel,
        }
      })
      .sort((a, b) => a.groupLabel.localeCompare(b.groupLabel) || a.namaLengkap.localeCompare(b.namaLengkap))
  }, [rekapGenerus, scope.tingkatan])

  // Unit dgn alpha rate tertinggi (dipakai utk menyebut nama unit di kalimat ringkasan) --
  // null kalau tidak ada satupun yang melewati ambang perhatian, atau scope kelompok (tidak
  // ada breakdown unit lain utk disebut).
  const unitPerluPerhatian = useMemo(() => {
    if (scope.tingkatan === 'kelompok') return null
    const kandidat = kehadiranPerUnitChartData.filter(u => u.perluPerhatian && u.unit)
    if (kandidat.length === 0) return null
    return kandidat.reduce((max, u) => (u.pctHadir < max.pctHadir ? u : max), kandidat[0])
  }, [kehadiranPerUnitChartData, scope.tingkatan])

  // Rata-rata pct hadir 6 bulan GABUNGAN semua unit (bukan per-unit) -- dipakai sbg satu
  // angka pembanding di kartu hero & garis putus-putus di grafik persentase kehadiran.
  // Dihitung sbg rata-rata sederhana dari rata-rata per-unit (bukan weighted by total baris)
  // krn RPC sumbernya sudah agregat per-unit, bukan per-baris mentah -- cukup presisi utk
  // konteks "kebiasaan umum scope ini", tidak diklaim sbg statistik presisi tinggi.
  const rataPctHadirGabungan = useMemo(() => {
    if (rataRata.length === 0) return null
    const total = rataRata.reduce((sum, r) => sum + r.rataPctHadir, 0)
    return Math.round(total / rataRata.length)
  }, [rataRata])

  // v3: data khusus grafik PERSENTASE kehadiran (beda dari trenChartData di atas yang dalam
  // jumlah orang) -- dipakai bareng garis rata-rata 6 bulan supaya skalanya sebanding (garis
  // pembanding dalam %, area chart jumlah orang tidak bisa dibandingkan apple-to-apple dgn
  // garis % tanpa dua sumbu Y). Dirender sbg grafik TERPISAH dari AreaChart Hadir/TidakHadir
  // yang sudah ada (lihat JSX) -- bukan menggantikannya, krn keduanya kasih insight berbeda
  // (volume vs rasio).
  const trenPersenChartData = useMemo(() => {
    return tren.map(r => {
      const total = r.hadir + r.izin + r.sakit + r.tidak_hadir
      const pctHadir = total > 0 ? Math.round((r.hadir / total) * 100) : 0
      return {
        bulan: BULAN_LABEL[r.bulan - 1].slice(0, 3),
        Kehadiran: pctHadir,
        RataRata6Bulan: rataPctHadirGabungan,
      }
    })
  }, [tren, rataPctHadirGabungan])

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
  // AI/LLM), supaya akurat & bisa ditelusuri persis dari mana angkanya berasal. Tiga bagian:
  // (1) perbandingan kehadiran vs bulan lalu, (2) perbandingan vs rata-rata 6 bulan (v3, kalau
  // datanya ada), (3) unit yang melonjak alpha-nya dari kebiasaan sendiri (v3: relatif thd
  // histori unit itu, bukan ambang tetap spt v2). Kalau tidak ada data sama sekali (grandTotal
  // 0), ringkasan dilewati (lihat kondisi render di JSX).
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
    if (rataPctHadirGabungan !== null && deltaKehadiran.pctSekarang !== null) {
      const selisih = deltaKehadiran.pctSekarang - rataPctHadirGabungan
      if (Math.abs(selisih) >= 1) {
        bagian.push(selisih > 0
          ? `Sedikit di atas rata-rata 6 bulan (${rataPctHadirGabungan}%).`
          : `Sedikit di bawah rata-rata 6 bulan (${rataPctHadirGabungan}%).`)
      } else {
        bagian.push(`Sejalan dengan rata-rata 6 bulan (${rataPctHadirGabungan}%).`)
      }
    }
    if (unitPerluPerhatian) {
      bagian.push(`${GROUPING_LABEL[scope.tingkatan]} ${unitPerluPerhatian.unit} melonjak dari kebiasaannya sendiri -- tingkat alpha jauh di atas rata-rata 6 bulan terakhir, layak ditindaklanjuti.`)
    }
    return bagian.join(' ')
  }, [deltaKehadiran, unitPerluPerhatian, rataPctHadirGabungan, bulan, scope.tingkatan])

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
          { header: 'Rata-rata 6 Bulan', key: 'rata', width: 16 },
          { header: 'Status', key: 'status', width: 16 },
        ],
        rows: kehadiranPerUnitChartData.map(u => ({
          unit: u.unit,
          pct: `${u.pctHadir}%`,
          rata: u.rataPctHadirHistori !== null ? `${u.rataPctHadirHistori}%` : '-',
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

    // v4: Daftar Generus -- rekap H/I/S/A per ORANG selama sebulan, request user setelah
    // membandingkan dgn contoh laporan Excel manual lama yg selalu mencantumkan nama tiap
    // Generus. Ditaruh SETELAH rekap agregat per gender di atas (angka besar dulu, baru
    // detail nama per orang) supaya urutan baca laporan tetap dari umum ke rinci.
    if (rekapGenerusRows.length > 0) {
      sections.push({
        heading: 'Daftar Generus',
        columns: [
          ...(scope.tingkatan !== 'kelompok' ? [{ header: scope.tingkatan === 'daerah' ? 'Desa -- Kelompok' : 'Kelompok', key: 'group', width: 24 }] : []),
          { header: 'Nama Lengkap', key: 'nama', width: 26 },
          { header: 'JK', key: 'jk', width: 6 },
          { header: 'Hadir', key: 'hadir', width: 8 },
          { header: 'Izin', key: 'izin', width: 8 },
          { header: 'Sakit', key: 'sakit', width: 8 },
          { header: 'Alpha', key: 'alpha', width: 8 },
          { header: '% Hadir', key: 'pct', width: 10 },
          { header: 'Status', key: 'status', width: 14 },
        ],
        rows: rekapGenerusRows.map(r => ({
          group: r.groupLabel,
          nama: r.namaLengkap,
          jk: r.jenisKelamin === 'laki-laki' ? 'L' : r.jenisKelamin === 'perempuan' ? 'P' : '-',
          hadir: r.hadir,
          izin: r.izin,
          sakit: r.sakit,
          alpha: r.tidakHadir,
          pct: r.total > 0 ? `${r.pctHadir}%` : '-',
          status: r.total === 0 ? 'Belum ada data' : r.perluPerhatian ? 'Perlu perhatian' : 'Baik',
        })),
      })
    }

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

    // v3: tabel persentase kehadiran vs rata-rata 6 bulan gabungan -- versi tabular dari
    // grafik trenPersenChartRef, supaya angka persisnya ikut terbawa ke PDF/Excel (grafik
    // sendiri sudah ikut lewat charts[], ini pelengkap datanya dalam bentuk tabel).
    if (rataPctHadirGabungan !== null && trenPersenChartData.some(r => r.Kehadiran > 0)) {
      sections.push({
        heading: `Persentase Kehadiran vs Rata-rata 6 Bulan Tahun ${tahun}`,
        columns: [
          { header: 'Bulan', key: 'bulan', width: 14 },
          { header: 'Kehadiran', key: 'kehadiran', width: 14 },
          { header: 'Rata-rata 6 Bulan', key: 'rata', width: 16 },
        ],
        rows: trenPersenChartData.map(r => ({
          bulan: r.bulan,
          kehadiran: `${r.Kehadiran}%`,
          rata: r.RataRata6Bulan !== null ? `${r.RataRata6Bulan}%` : '-',
        })),
      })
    }

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
      { ref: trenPersenChartRef, title: `Persentase Kehadiran vs Rata-rata 6 Bulan -- ${tahun}` },
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
              {ringkasanOtomatis && (
                <div className="bg-blue-50 rounded-xl px-4 py-3 flex items-start gap-2.5">
                  <span className="text-blue-500 shrink-0 mt-0.5">✨</span>
                  <p className="text-sm text-blue-800 leading-relaxed">{ringkasanOtomatis}</p>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl p-4 border border-slate-100 sm:col-span-1">
                  <p className="text-xs text-slate-400 mb-1.5">Tingkat kehadiran</p>
                  <p className="text-3xl font-bold text-green-600">
                    {deltaKehadiran.pctSekarang !== null ? `${deltaKehadiran.pctSekarang}%` : '-'}
                  </p>
                  {deltaKehadiran.delta !== null && (
                    <p className={`text-xs mt-1.5 ${deltaKehadiran.delta > 0 ? 'text-green-600' : deltaKehadiran.delta < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                      {deltaKehadiran.delta > 0 ? `↗ naik ${deltaKehadiran.delta}%` : deltaKehadiran.delta < 0 ? `↘ turun ${Math.abs(deltaKehadiran.delta)}%` : 'stabil'} dari {BULAN_LABEL[bulan - 2]}
                    </p>
                  )}
                  {rataPctHadirGabungan !== null && (
                    <p className="text-xs text-slate-400 mt-1">Rata-rata 6 bulan: {rataPctHadirGabungan}%</p>
                  )}
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

              {/* v3: grafik PERSENTASE kehadiran vs garis rata-rata 6 bulan (putus-putus) --
                  ditaruh SEBELUM AreaChart volume di bawah krn ini yang paling langsung
                  menjawab "gimana dibanding kebiasaan kita sendiri", baru detail volume orang. */}
              {trenPersenChartData.some(r => r.Kehadiran > 0) && rataPctHadirGabungan !== null && (
                <div ref={trenPersenChartRef} className="bg-white rounded-xl border border-slate-100 p-4">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">Persentase Kehadiran vs Rata-rata 6 Bulan -- {tahun}</h4>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={trenPersenChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="bulan" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} unit="%" domain={[0, 100]} />
                      <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(v) => `${v}%`} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="Kehadiran" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="RataRata6Bulan" name="Rata-rata 6 Bulan" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {(tren.some(r => r.hadir + r.izin + r.sakit + r.tidak_hadir > 0)) && (
                <div ref={trenChartRef} className="bg-white rounded-xl border border-slate-100 p-4">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">Hadir vs Tidak Hadir -- {tahun} (12 Bulan)</h4>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={trenChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="bulan" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="Hadir" stroke="#16a34a" fill="#16a34a" fillOpacity={0.15} strokeWidth={2} />
                      <Area type="monotone" dataKey="TidakHadir" name="Tidak Hadir (Izin+Sakit+Alpha)" stroke="#dc2626" fill="#dc2626" fillOpacity={0.1} strokeWidth={2} />
                    </AreaChart>
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

              {/* Grafik perbandingan antar-unit hanya relevan kalau ada lebih dari 1 unit di
                  bawah scope ini (Desa punya banyak Kelompok, Daerah punya banyak Desa) --
                  scope kelompok adalah unit terkecil, jadi grafik ini tidak pernah dirender
                  utknya (kehadiranPerUnitChartData akan selalu 1 baris berlabel kosong). */}
              {scope.tingkatan !== 'kelompok' && kehadiranPerUnitChartData.length > 0 && (
                <div ref={kehadiranDesaChartRef} className="bg-white rounded-xl border border-slate-100 p-4">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">
                    Perbandingan Kehadiran per {GROUPING_LABEL[scope.tingkatan]} -- {BULAN_LABEL[bulan - 1]} {tahun}
                  </h4>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={kehadiranPerUnitChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="unit" tick={{ fontSize: 12, fill: '#94a3b8' }} />
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

              {/* Status per unit -- ringkasan visual (bar + badge) sebelum tabel detail per
                  gender di bawah, supaya Ketua bisa langsung scan unit mana yang bermasalah
                  tanpa hitung manual dari angka mentah. Hanya utk scope yang punya breakdown
                  unit (daerah/desa) -- scope kelompok tidak relevan krn cuma 1 unit.
                  Task 46: baris bisa diklik utk expand breakdown per gender di tempat (tanpa
                  pindah section) -- data dari genderBreakdownPerUnit, sudah tersedia dari
                  `kehadiran` yg sudah di-fetch, tinggal toggle expandedUnit. */}
              {scope.tingkatan !== 'kelompok' && kehadiranPerUnitChartData.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-100">
                    <h4 className="text-sm font-semibold text-slate-700">Status per {GROUPING_LABEL[scope.tingkatan]}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Klik baris untuk lihat breakdown per jenis kelamin</p>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {kehadiranPerUnitChartData.map((u, i) => {
                      const isExpanded = expandedUnit === u.unit
                      const breakdown = genderBreakdownPerUnit.get(u.unit) || []
                      return (
                        <div key={i}>
                          <button
                            type="button"
                            onClick={() => setExpandedUnit(isExpanded ? null : u.unit)}
                            className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-slate-50 transition"
                          >
                            <span className={`text-slate-300 text-xs shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                            <span className="text-sm text-slate-700 w-40 shrink-0 truncate">{u.unit}</span>
                            <div className="flex-1 flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${u.pctHadir >= 80 ? 'bg-green-500' : u.pctHadir >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                                  style={{ width: `${u.pctHadir}%` }}
                                />
                              </div>
                              <span className="text-xs text-slate-500 w-9 text-right">{u.pctHadir}%</span>
                            </div>
                            {u.rataPctHadirHistori !== null && (
                              <span className="text-xs text-slate-400 shrink-0 hidden sm:inline">rata² 6bln: {u.rataPctHadirHistori}%</span>
                            )}
                            {u.perluPerhatian ? (
                              <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-md shrink-0">Perlu perhatian</span>
                            ) : (
                              <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-md shrink-0">Baik</span>
                            )}
                          </button>
                          {isExpanded && (
                            <div className="px-4 pb-3 pl-11">
                              {breakdown.length === 0 ? (
                                <p className="text-xs text-slate-400 py-2">Belum ada data absensi per gender untuk unit ini.</p>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-slate-400 border-b border-slate-100">
                                      <th className="py-1.5 font-medium">JK</th>
                                      <th className="py-1.5 font-medium text-center">Hadir</th>
                                      <th className="py-1.5 font-medium text-center">Izin</th>
                                      <th className="py-1.5 font-medium text-center">Sakit</th>
                                      <th className="py-1.5 font-medium text-center">Alpha</th>
                                      <th className="py-1.5 font-medium text-center">% Hadir</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {breakdown.map((b, bi) => (
                                      <tr key={bi} className="border-b border-slate-50 last:border-0">
                                        <td className="py-1.5 text-slate-600">{b.jk}</td>
                                        <td className="py-1.5 text-center text-slate-600">{b.hadir}</td>
                                        <td className="py-1.5 text-center text-slate-600">{b.izin}</td>
                                        <td className="py-1.5 text-center text-slate-600">{b.sakit}</td>
                                        <td className="py-1.5 text-center text-slate-600">{b.alpha}</td>
                                        <td className="py-1.5 text-center text-slate-600">
                                          {b.total > 0 ? Math.round((b.hadir / b.total) * 100) : 0}%
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {kehadiran.length === 0 && kelasNgaji.length === 0 ? (
                <div className="bg-white rounded-xl p-8 text-center text-slate-400 text-sm">
                  Belum ada data absensi/kegiatan untuk periode ini. Klik &ldquo;Pratinjau PDF&rdquo; untuk melihat format laporan lengkap (termasuk tren &amp; pertumbuhan Generus).
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-100">
                    <h4 className="text-sm font-semibold text-slate-700">
                      Rekap Kehadiran{scope.tingkatan !== 'kelompok' ? ` per ${GROUPING_LABEL[scope.tingkatan]}` : ''}
                    </h4>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                          {scope.tingkatan !== 'kelompok' && (
                            <th className="px-4 py-2 font-medium">{GROUPING_LABEL[scope.tingkatan]}</th>
                          )}
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
                            {scope.tingkatan !== 'kelompok' && (
                              <td className="px-4 py-2 text-slate-700">{r.label}</td>
                            )}
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

              {/* v4: Daftar Generus -- nama per orang dgn rekap H/I/S/A sebulan. Bisa berisi
                  ratusan baris (scope daerah), jadi TIDAK auto-expand spt section lain --
                  disembunyikan di balik toggle + search box supaya modal tetap ringan dibuka,
                  konsisten dgn filosofi "ringkasan dulu, detail on-demand" di seluruh modal ini. */}
              {rekapGenerusRows.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowDaftarGenerus(v => !v)}
                    className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-slate-50 transition"
                  >
                    <h4 className="text-sm font-semibold text-slate-700">
                      Daftar Generus ({rekapGenerusRows.length})
                    </h4>
                    <span className={`text-slate-300 text-xs transition-transform ${showDaftarGenerus ? 'rotate-90' : ''}`}>▶</span>
                  </button>
                  {showDaftarGenerus && (
                    <div className="border-t border-slate-100">
                      <div className="px-4 py-2.5 border-b border-slate-100">
                        <input
                          type="text"
                          value={cariGenerus}
                          onChange={e => setCariGenerus(e.target.value)}
                          placeholder="Cari nama generus..."
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-slate-50">
                            <tr className="text-left text-slate-500 border-b border-slate-100">
                              {scope.tingkatan !== 'kelompok' && (
                                <th className="px-4 py-2 font-medium">{scope.tingkatan === 'daerah' ? 'Desa -- Kelompok' : 'Kelompok'}</th>
                              )}
                              <th className="px-4 py-2 font-medium">Nama</th>
                              <th className="px-4 py-2 font-medium">JK</th>
                              <th className="px-4 py-2 font-medium text-center">Hadir</th>
                              <th className="px-4 py-2 font-medium text-center">Izin</th>
                              <th className="px-4 py-2 font-medium text-center">Sakit</th>
                              <th className="px-4 py-2 font-medium text-center">Alpha</th>
                              <th className="px-4 py-2 font-medium text-center">% Hadir</th>
                              <th className="px-4 py-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rekapGenerusRows
                              .filter(r => r.namaLengkap.toLowerCase().includes(cariGenerus.toLowerCase()))
                              .map(r => (
                                <tr key={r.id} className="border-b border-slate-50">
                                  {scope.tingkatan !== 'kelompok' && (
                                    <td className="px-4 py-2 text-slate-500 text-xs">{r.groupLabel}</td>
                                  )}
                                  <td className="px-4 py-2 text-slate-700">{r.namaLengkap}</td>
                                  <td className="px-4 py-2 text-slate-500 text-xs">{r.jenisKelamin === 'laki-laki' ? 'L' : r.jenisKelamin === 'perempuan' ? 'P' : '-'}</td>
                                  <td className="px-4 py-2 text-center">{r.hadir}</td>
                                  <td className="px-4 py-2 text-center">{r.izin}</td>
                                  <td className="px-4 py-2 text-center">{r.sakit}</td>
                                  <td className="px-4 py-2 text-center">{r.tidakHadir}</td>
                                  <td className="px-4 py-2 text-center">{r.total > 0 ? `${r.pctHadir}%` : '-'}</td>
                                  <td className="px-4 py-2">
                                    {r.total === 0 ? (
                                      <span className="text-xs text-slate-400">Belum ada data</span>
                                    ) : r.perluPerhatian ? (
                                      <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-md">Perlu perhatian</span>
                                    ) : (
                                      <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-md">Baik</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
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
