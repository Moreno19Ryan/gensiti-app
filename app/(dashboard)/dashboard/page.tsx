'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { isPengurus, isBendahara, canManageKontenOrganisasi } from '@/lib/roles'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

interface Stats {
  generus: number
  kegiatan_aktif: number
  pemasukan: number
  pengeluaran: number
}

interface AdminAlert {
  resetPasswordPending: number
  emailErrorRate: number
  emailFailedCount: number
  emailTotal: number
}

interface BendaharaAlert {
  reimbursementPending: number
  saldoBulanIni: number
}

interface KontenAlert {
  kegiatanMenunggu: number
  pengumumanMenunggu: number
}

interface KegiatanMendatang {
  id: string
  nama_kegiatan: string
  tanggal_mulai: string
  lokasi: string | null
}
interface PengumumanTerbaru {
  id: string
  judul: string
  isi: string
  tanggal_publish: string | null
}
interface GenerusInsight {
  kegiatanMendatang: KegiatanMendatang[]
  pengumumanTerbaru: PengumumanTerbaru[]
  persentaseHadir6Bulan: number
  totalHadir6Bulan: number
  totalKegiatan6Bulan: number
}

interface ArusKasBulan { bulan: string; pemasukan: number; pengeluaran: number }
interface KehadiranBulan { bulan: string; persentase: number }
interface PertumbuhanBulan { bulan: string; generus_baru: number }

function get6BulanTerakhir(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' })
    out.push({ key, label })
  }
  return out
}

export default function DashboardPage() {
  const { user, onlineCount } = useUser()
  const [stats, setStats] = useState<Stats>({ generus: 0, kegiatan_aktif: 0, pemasukan: 0, pengeluaran: 0 })
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())
  const [adminAlert, setAdminAlert] = useState<AdminAlert | null>(null)
  const [bendaharaAlert, setBendaharaAlert] = useState<BendaharaAlert | null>(null)
  const [kontenAlert, setKontenAlert] = useState<KontenAlert | null>(null)
  const [generusInsight, setGenerusInsight] = useState<GenerusInsight | null>(null)
  const [loadingInsight, setLoadingInsight] = useState(false)

  const [arusKas, setArusKas] = useState<ArusKasBulan[]>([])
  const [kehadiran, setKehadiran] = useState<KehadiranBulan[]>([])
  const [pertumbuhan, setPertumbuhan] = useState<PertumbuhanBulan[]>([])
  const [loadingChart, setLoadingChart] = useState(true)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const loadStats = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const isSuper = user?.role?.tingkatan === 'super_admin'
      const isDaerah = user?.role?.tingkatan === 'daerah'
      const isPPGUser = user?.role?.tingkatan === 'ppg'
      const isGenerusBiasaUser = !isPengurus(user) && !isPPGUser

      let kegiatanQuery = supabase.from('kegiatan').select('id', { count: 'exact', head: true }).in('status', ['upcoming', 'ongoing'])
      let scopeDesaId: string | null = null
      let scopeKelompokId: string | null = null

      if (!isSuper && !isDaerah && !isPPGUser) {
        if (user?.desa_id) {
          kegiatanQuery = kegiatanQuery.eq('desa_id', user.desa_id)
          scopeDesaId = user.desa_id
        }
        if (user?.kelompok_id) {
          kegiatanQuery = kegiatanQuery.eq('kelompok_id', user.kelompok_id)
          scopeKelompokId = user.kelompok_id
        }
      }

      const [{ data: generusCount }, { count: kegiatanCount }, { data: ringkasanKeuangan }] = await Promise.all([
        supabase.rpc('get_jumlah_generus_aktif', { p_desa_id: scopeDesaId, p_kelompok_id: scopeKelompokId }),
        kegiatanQuery,
        isGenerusBiasaUser
          ? Promise.resolve({ data: null })
          : supabase.rpc('get_ringkasan_keuangan', { p_desa_id: scopeDesaId, p_kelompok_id: scopeKelompokId }),
      ])

      const pemasukan = Number(ringkasanKeuangan?.[0]?.pemasukan) || 0
      const pengeluaran = Number(ringkasanKeuangan?.[0]?.pengeluaran) || 0

      setStats({
        generus: Number(generusCount) || 0,
        kegiatan_aktif: kegiatanCount || 0,
        pemasukan,
        pengeluaran,
      })

      if (isSuper) {
        const ninetyDaysAgo = new Date()
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
        const [{ count: pendingCount }, { data: emailRows }] = await Promise.all([
          supabase.from('reset_password_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('email_log').select('status').gte('created_at', ninetyDaysAgo.toISOString()),
        ])
        const rows = emailRows || []
        const emailTotal = rows.length
        const emailFailedCount = rows.filter(r => r.status === 'failed').length
        const emailErrorRate = emailTotal > 0 ? Math.round((emailFailedCount / emailTotal) * 100) : 0
        setAdminAlert({
          resetPasswordPending: pendingCount || 0,
          emailErrorRate,
          emailFailedCount,
          emailTotal,
        })
      } else {
        setAdminAlert(null)
      }

      if (isBendahara(user)) {
        const nowForMonth = new Date()
        const startOfMonth = new Date(nowForMonth.getFullYear(), nowForMonth.getMonth(), 1).toISOString().slice(0, 10)
        const [{ count: reimbPending }, { data: keuanganBulanIni }] = await Promise.all([
          supabase
            .from('pengajuan_reimbursement')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'menunggu'),
          supabase.from('keuangan').select('jenis, jumlah').gte('tanggal', startOfMonth),
        ])
        const rows = keuanganBulanIni || []
        const masuk = rows.filter(r => r.jenis === 'pemasukan').reduce((s, r) => s + Number(r.jumlah), 0)
        const keluar = rows.filter(r => r.jenis === 'pengeluaran').reduce((s, r) => s + Number(r.jumlah), 0)
        setBendaharaAlert({
          reimbursementPending: reimbPending || 0,
          saldoBulanIni: masuk - keluar,
        })
      } else {
        setBendaharaAlert(null)
      }

      if (canManageKontenOrganisasi(user)) {
        const [{ count: kegiatanMenunggu }, { count: pengumumanMenunggu }] = await Promise.all([
          supabase.from('kegiatan').select('id', { count: 'exact', head: true }).eq('status_approval', 'menunggu_ppg'),
          supabase.from('pengumuman').select('id', { count: 'exact', head: true }).eq('status_approval', 'menunggu_ppg'),
        ])
        setKontenAlert({
          kegiatanMenunggu: kegiatanMenunggu || 0,
          pengumumanMenunggu: pengumumanMenunggu || 0,
        })
      } else {
        setKontenAlert(null)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [user])

  const loadGenerusInsight = useCallback(async () => {
    if (!user) return
    const isGenerusBiasaUser = !isPengurus(user) && user?.role?.tingkatan !== 'ppg'
    if (!isGenerusBiasaUser) { setGenerusInsight(null); return }

    setLoadingInsight(true)
    try {
      const nowIso = new Date().toISOString()
      const sixMonthsAgo = new Date()
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

      let kegiatanQ = supabase
        .from('kegiatan')
        .select('id, nama_kegiatan, tanggal_mulai, lokasi')
        .gte('tanggal_mulai', nowIso)
        .in('status', ['upcoming', 'ongoing'])
        .order('tanggal_mulai', { ascending: true })
        .limit(5)
      if (user.kelompok_id) kegiatanQ = kegiatanQ.eq('kelompok_id', user.kelompok_id)
      else if (user.desa_id) kegiatanQ = kegiatanQ.eq('desa_id', user.desa_id)

      let pengumumanQ = supabase
        .from('pengumuman')
        .select('id, judul, isi, tanggal_publish')
        .eq('is_active', true)
        .eq('status_approval', 'disetujui')
        .order('tanggal_publish', { ascending: false, nullsFirst: false })
        .limit(3)
      if (user.kelompok_id) {
        pengumumanQ = pengumumanQ.or(`tingkatan.eq.semua,tingkatan.eq.daerah,and(tingkatan.eq.desa,desa_id.eq.${user.desa_id}),and(tingkatan.eq.kelompok,kelompok_id.eq.${user.kelompok_id})`)
      }

      const { data: generusRow } = await supabase.from('generus').select('id').eq('user_id', user.id).maybeSingle()

      const [{ data: kegiatanRows }, { data: pengumumanRows }] = await Promise.all([
        kegiatanQ,
        pengumumanQ,
      ])

      let persentaseHadir = 0
      let totalHadir = 0
      let totalKegiatan = 0
      if (generusRow) {
        const { data: absRows } = await supabase
          .from('absensi')
          .select('status, kegiatan:kegiatan_id(tanggal_mulai)')
          .eq('generus_id', generusRow.id)
          .limit(500)
        const relevan = (absRows || []).filter((r) => {
          const tgl = (r as unknown as { kegiatan: { tanggal_mulai: string } | null }).kegiatan?.tanggal_mulai
          return tgl && tgl >= sixMonthsAgo.toISOString()
        })
        totalKegiatan = relevan.length
        totalHadir = relevan.filter(r => r.status === 'hadir').length
        persentaseHadir = totalKegiatan > 0 ? Math.round((totalHadir / totalKegiatan) * 100) : 0
      }

      setGenerusInsight({
        kegiatanMendatang: (kegiatanRows as KegiatanMendatang[]) || [],
        pengumumanTerbaru: (pengumumanRows as PengumumanTerbaru[]) || [],
        persentaseHadir6Bulan: persentaseHadir,
        totalHadir6Bulan: totalHadir,
        totalKegiatan6Bulan: totalKegiatan,
      })
    } catch (err) {
      console.error('Gagal memuat insight Generus:', err)
    } finally {
      setLoadingInsight(false)
    }
  }, [user])

  const loadCharts = useCallback(async () => {
    if (!user) return
    setLoadingChart(true)
    try {
      const isSuper = user?.role?.tingkatan === 'super_admin'
      const isDaerah = user?.role?.tingkatan === 'daerah'
      const isPPGUser = user?.role?.tingkatan === 'ppg'
      const bulanList = get6BulanTerakhir()
      const rangeStart = bulanList[0].key + '-01'

      const applyScope = <T,>(q: T): T => {
        if (!isSuper && !isDaerah && !isPPGUser) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let qq: any = q
          if (user?.desa_id) qq = qq.eq('desa_id', user.desa_id)
          if (user?.kelompok_id) qq = qq.eq('kelompok_id', user.kelompok_id)
          return qq
        }
        return q
      }

      const canSeeKeuangan = isPengurus(user) && user?.role?.tingkatan !== 'super_admin'
      if (canSeeKeuangan) {
        let kq = supabase.from('keuangan').select('jenis, jumlah, tanggal').gte('tanggal', rangeStart).limit(2000)
        kq = applyScope(kq)
        const { data: kRows } = await kq
        const kasMap = new Map(bulanList.map(b => [b.key, { pemasukan: 0, pengeluaran: 0 }]))
        kRows?.forEach(r => {
          const key = r.tanggal.slice(0, 7)
          const entry = kasMap.get(key)
          if (!entry) return
          if (r.jenis === 'pemasukan') entry.pemasukan += Number(r.jumlah)
          else entry.pengeluaran += Number(r.jumlah)
        })
        setArusKas(bulanList.map(b => ({ bulan: b.label, ...kasMap.get(b.key)! })))
      } else {
        setArusKas([])
      }

      const scopeDesaIdChart = (!isSuper && !isDaerah && !isPPGUser) ? (user?.desa_id || null) : null
      const scopeKelompokIdChart = (!isSuper && !isDaerah && !isPPGUser) ? (user?.kelompok_id || null) : null
      const { data: pertumbuhanRows } = await supabase.rpc('get_pertumbuhan_generus', {
        p_desa_id: scopeDesaIdChart,
        p_kelompok_id: scopeKelompokIdChart,
        p_range_start: rangeStart,
      })
      const tumbuhMap = new Map(bulanList.map(b => [b.key, 0]))
      ;(pertumbuhanRows as { bulan: string; jumlah: number }[] | null)?.forEach(r => {
        if (tumbuhMap.has(r.bulan)) tumbuhMap.set(r.bulan, r.jumlah)
      })
      setPertumbuhan(bulanList.map(b => ({ bulan: b.label, generus_baru: tumbuhMap.get(b.key) || 0 })))

      let kegq = supabase.from('kegiatan').select('id, tanggal_mulai').gte('tanggal_mulai', rangeStart).limit(500)
      kegq = applyScope(kegq)
      const { data: kegRows } = await kegq
      const kegiatanBulanMap = new Map((kegRows || []).map(k => [k.id, k.tanggal_mulai?.slice(0, 7)]))
      const kegiatanIds = (kegRows || []).map(k => k.id)

      const hadirMap = new Map(bulanList.map(b => [b.key, { hadir: 0, total: 0 }]))
      if (kegiatanIds.length > 0) {
        const { data: absRows } = await supabase
          .from('absensi')
          .select('status, kegiatan_id')
          .in('kegiatan_id', kegiatanIds)
          .limit(5000)
        absRows?.forEach(r => {
          const bulanKey = r.kegiatan_id ? kegiatanBulanMap.get(r.kegiatan_id) : null
          if (!bulanKey) return
          const entry = hadirMap.get(bulanKey)
          if (!entry) return
          entry.total += 1
          if (r.status === 'hadir') entry.hadir += 1
        })
      }
      setKehadiran(bulanList.map(b => {
        const entry = hadirMap.get(b.key)!
        return { bulan: b.label, persentase: entry.total > 0 ? Math.round((entry.hadir / entry.total) * 100) : 0 }
      }))
    } catch (err) {
      console.error('Gagal memuat data grafik:', err)
    } finally {
      setLoadingChart(false)
    }
  }, [user])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  useEffect(() => {
    loadCharts()
  }, [loadCharts])

  useEffect(() => {
    loadGenerusInsight()
  }, [loadGenerusInsight])

  const formatRupiah = (n: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

  const formatDate = (d: Date) =>
    d.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const formatTanggalSingkat = (iso: string) =>
    new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const healthScore = (() => {
    if (stats.pemasukan === 0 && stats.pengeluaran === 0) return 100
    if (stats.pemasukan === 0) return 0
    const score = Math.max(0, Math.round(((stats.pemasukan - stats.pengeluaran) / stats.pemasukan) * 100))
    return Math.min(score, 100)
  })()

  const healthBg = healthScore >= 70 ? 'bg-emerald-500' : healthScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  const healthLabel = healthScore >= 70 ? 'Sehat' : healthScore >= 40 ? 'Perlu Perhatian' : 'Kritis'

  const isSuper = user?.role?.tingkatan === 'super_admin'
  const isPPGUser = user?.role?.tingkatan === 'ppg'
  const isBendaharaUser = isBendahara(user)
  const isKontenManager = canManageKontenOrganisasi(user)
  const isGenerusBiasaUser = !isPengurus(user) && !isPPGUser

  const showHealthScore = isPengurus(user) && !isSuper && !isGenerusBiasaUser

  const quickActions = isPPGUser
    ? [
        { href: '/ppg', label: 'Dashboard PPG', icon: '🛡️', color: 'hover:bg-purple-50 hover:border-purple-200' },
        { href: '/kegiatan', label: 'Kegiatan', icon: '📅', color: 'hover:bg-indigo-50 hover:border-indigo-200' },
        { href: '/pengumuman', label: 'Pengumuman', icon: '📢', color: 'hover:bg-orange-50 hover:border-orange-200' },
        { href: '/catatan-pembinaan', label: 'Catatan Pembinaan', icon: '📝', color: 'hover:bg-emerald-50 hover:border-emerald-200' },
      ]
    : isSuper
    ? [
        { href: '/generus', label: 'Data Pengguna', icon: '👥', color: 'hover:bg-blue-50 hover:border-blue-200' },
        { href: '/kegiatan', label: 'Kegiatan', icon: '📅', color: 'hover:bg-indigo-50 hover:border-indigo-200' },
        { href: '/organisasi', label: 'Organisasi', icon: '🏛️', color: 'hover:bg-violet-50 hover:border-violet-200' },
        { href: '/pengumuman', label: 'Pengumuman', icon: '📢', color: 'hover:bg-orange-50 hover:border-orange-200' },
      ]
    : isGenerusBiasaUser
    ? [
        { href: '/kegiatan', label: 'Kegiatan', icon: '📅', color: 'hover:bg-indigo-50 hover:border-indigo-200' },
        { href: '/absensi', label: 'Absensi', icon: '✅', color: 'hover:bg-teal-50 hover:border-teal-200' },
        { href: '/pengumuman', label: 'Pengumuman', icon: '📢', color: 'hover:bg-orange-50 hover:border-orange-200' },
        { href: '/profil', label: 'Profil Saya', icon: '👤', color: 'hover:bg-blue-50 hover:border-blue-200' },
      ]
    : [
        { href: '/generus', label: 'Data Pengguna', icon: '👥', color: 'hover:bg-blue-50 hover:border-blue-200' },
        { href: '/kegiatan', label: 'Kegiatan', icon: '📅', color: 'hover:bg-indigo-50 hover:border-indigo-200' },
        { href: '/keuangan', label: 'Keuangan', icon: '💰', color: 'hover:bg-emerald-50 hover:border-emerald-200' },
        { href: '/pengumuman', label: 'Pengumuman', icon: '📢', color: 'hover:bg-orange-50 hover:border-orange-200' },
      ]

  const statCards = [
    {
      label: 'Pengguna Online',
      value: loading ? '...' : onlineCount.toString(),
      sub: 'Tab browser terbuka sekarang',
      icon: '🟢',
      color: 'bg-blue-500',
    },
    {
      label: 'Kegiatan Berjalan',
      value: loading ? '...' : stats.kegiatan_aktif.toString(),
      sub: 'Upcoming & ongoing',
      icon: '📅',
      color: 'bg-indigo-500',
    },
    (isPPGUser || isSuper || isGenerusBiasaUser)
      ? { label: 'Generus Aktif', value: loading ? '...' : stats.generus.toLocaleString('id-ID'), sub: isPPGUser ? 'Se-Bekasi Timur' : 'Terdaftar & aktif', icon: '👥', color: 'bg-violet-500' }
      : {
          label: showHealthScore ? 'Health Score' : 'Total Pemasukan',
          value: loading ? '...' : showHealthScore ? `${healthScore}%` : formatRupiah(stats.pemasukan),
          sub: showHealthScore ? healthLabel : 'Total masuk',
          icon: showHealthScore ? '❤️' : '💰',
          color: showHealthScore ? healthBg : 'bg-emerald-500',
        },
    isPPGUser
      ? { label: 'Dashboard PPG', value: 'Lihat', sub: 'Persetujuan & pengawasan', icon: '🛡️', color: 'bg-purple-500' }
      : isSuper
      ? { label: 'Organisasi', value: 'Lihat', sub: 'Struktur Desa & Kelompok', icon: '🏛️', color: 'bg-slate-500' }
      : isGenerusBiasaUser
      ? {
          label: 'Kehadiran Saya',
          value: loadingInsight ? '...' : `${generusInsight?.persentaseHadir6Bulan ?? 0}%`,
          sub: '6 bulan terakhir',
          icon: '✅',
          color: 'bg-teal-500',
        }
      : {
          label: showHealthScore ? 'Generus Aktif' : 'Total Pengeluaran',
          value: loading ? '...' : showHealthScore ? stats.generus.toLocaleString('id-ID') : formatRupiah(stats.pengeluaran),
          sub: showHealthScore ? 'Terdaftar & aktif' : 'Total keluar',
          icon: showHealthScore ? '👥' : '💸',
          color: showHealthScore ? 'bg-violet-500' : 'bg-red-500',
        },
  ]

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-5 sm:p-6 text-white">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-blue-100 text-sm font-medium">Assalamualaikum,</p>
            <h2 className="text-xl sm:text-2xl font-bold mt-0.5 truncate">{user?.nama_lengkap}</h2>
            <p className="text-blue-200 text-sm mt-1">{user?.role?.nama_role}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg sm:text-2xl font-mono font-bold tabular-nums">{formatTime(now)}</div>
            <div className="text-blue-200 text-xs sm:text-sm mt-0.5 hidden sm:block">{formatDate(now)}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100">
            <div className={`w-10 h-10 ${card.color} rounded-xl flex items-center justify-center text-xl mb-3`}>
              {card.icon}
            </div>
            <div className="text-lg sm:text-xl font-bold text-slate-800 truncate">{card.value}</div>
            <div className="text-slate-700 text-sm font-medium mt-0.5 leading-tight">{card.label}</div>
            <div className="text-slate-400 text-xs mt-0.5">{card.sub}</div>
          </div>
        ))}
      </div>

      {isSuper && adminAlert && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <a
            href="/reset-password-requests"
            className={`rounded-2xl p-4 sm:p-5 border transition-colors flex items-center gap-4 ${
              adminAlert.resetPasswordPending > 0
                ? 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                : 'bg-white border-slate-100 hover:bg-slate-50'
            }`}
          >
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${adminAlert.resetPasswordPending > 0 ? 'bg-amber-500' : 'bg-slate-300'}`}>
              🔑
            </div>
            <div className="min-w-0">
              <div className="text-lg font-bold text-slate-800">{adminAlert.resetPasswordPending} permintaan</div>
              <div className="text-slate-600 text-sm font-medium">Reset Password Menunggu</div>
              <div className="text-slate-400 text-xs">{adminAlert.resetPasswordPending > 0 ? 'Klik untuk proses' : 'Tidak ada yang menunggu'}</div>
            </div>
          </a>
          <a
            href="/monitoring?tab=email"
            className={`rounded-2xl p-4 sm:p-5 border transition-colors flex items-center gap-4 ${
              adminAlert.emailErrorRate > 10
                ? 'bg-red-50 border-red-200 hover:bg-red-100'
                : adminAlert.emailErrorRate > 0
                ? 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                : 'bg-white border-slate-100 hover:bg-slate-50'
            }`}
          >
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${
              adminAlert.emailErrorRate > 10 ? 'bg-red-500' : adminAlert.emailErrorRate > 0 ? 'bg-amber-500' : 'bg-slate-300'
            }`}>
              ✉️
            </div>
            <div className="min-w-0">
              <div className="text-lg font-bold text-slate-800">{adminAlert.emailErrorRate}% gagal</div>
              <div className="text-slate-600 text-sm font-medium">Error Rate Email (90 hari)</div>
              <div className="text-slate-400 text-xs">{adminAlert.emailFailedCount} gagal dari {adminAlert.emailTotal} email</div>
            </div>
          </a>
        </div>
      )}

      {isBendaharaUser && bendaharaAlert && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <a
            href="/keuangan"
            className={`rounded-2xl p-4 sm:p-5 border transition-colors flex items-center gap-4 ${
              bendaharaAlert.reimbursementPending > 0
                ? 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                : 'bg-white border-slate-100 hover:bg-slate-50'
            }`}
          >
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${bendaharaAlert.reimbursementPending > 0 ? 'bg-amber-500' : 'bg-slate-300'}`}>
              🧾
            </div>
            <div className="min-w-0">
              <div className="text-lg font-bold text-slate-800">{bendaharaAlert.reimbursementPending} pengajuan</div>
              <div className="text-slate-600 text-sm font-medium">Reimbursement Menunggu</div>
              <div className="text-slate-400 text-xs">{bendaharaAlert.reimbursementPending > 0 ? 'Klik untuk ACC/Tolak' : 'Tidak ada yang menunggu'}</div>
            </div>
          </a>
          <div className="rounded-2xl p-4 sm:p-5 border bg-white border-slate-100 flex items-center gap-4">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${bendaharaAlert.saldoBulanIni >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}>
              💵
            </div>
            <div className="min-w-0">
              <div className="text-lg font-bold text-slate-800">{formatRupiah(bendaharaAlert.saldoBulanIni)}</div>
              <div className="text-slate-600 text-sm font-medium">Saldo Bulan Ini</div>
              <div className="text-slate-400 text-xs">Pemasukan dikurangi pengeluaran</div>
            </div>
          </div>
        </div>
      )}

      {isKontenManager && kontenAlert && (kontenAlert.kegiatanMenunggu > 0 || kontenAlert.pengumumanMenunggu > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {kontenAlert.kegiatanMenunggu > 0 && (
            <a href="/kegiatan" className="rounded-2xl p-4 sm:p-5 border bg-amber-50 border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 bg-amber-500">📅</div>
              <div className="min-w-0">
                <div className="text-lg font-bold text-slate-800">{kontenAlert.kegiatanMenunggu} kegiatan</div>
                <div className="text-slate-600 text-sm font-medium">Menunggu Approval PPG</div>
                <div className="text-slate-400 text-xs">Klik untuk lihat status</div>
              </div>
            </a>
          )}
          {kontenAlert.pengumumanMenunggu > 0 && (
            <a href="/pengumuman" className="rounded-2xl p-4 sm:p-5 border bg-amber-50 border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 bg-amber-500">📢</div>
              <div className="min-w-0">
                <div className="text-lg font-bold text-slate-800">{kontenAlert.pengumumanMenunggu} pengumuman</div>
                <div className="text-slate-600 text-sm font-medium">Menunggu Approval PPG</div>
                <div className="text-slate-400 text-xs">Klik untuk lihat status</div>
              </div>
            </a>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100">
        <h3 className="font-semibold text-slate-700 mb-4">Akses Cepat</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quickActions.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-2 p-3 sm:p-4 rounded-xl border border-slate-100 transition-colors ${item.color}`}
            >
              <span className="text-2xl">{item.icon}</span>
              <span className="text-xs font-medium text-slate-600">{item.label}</span>
            </a>
          ))}
        </div>
      </div>

      {isGenerusBiasaUser && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100">
            <h3 className="font-semibold text-slate-700 mb-1">Kegiatan Mendatang</h3>
            <p className="text-slate-400 text-xs mb-4">Kegiatan terdekat di kelompok/desa Anda</p>
            {loadingInsight ? (
              <div className="h-32 flex items-center justify-center text-slate-400">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : !generusInsight?.kegiatanMendatang.length ? (
              <div className="py-8 text-center text-slate-400 text-sm">Belum ada kegiatan mendatang</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {generusInsight.kegiatanMendatang.map((k) => (
                  <a key={k.id} href="/kegiatan" className="flex items-start gap-3 py-3 hover:bg-slate-50 -mx-2 px-2 rounded-lg transition-colors">
                    <span className="text-lg mt-0.5">📅</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">{k.nama_kegiatan}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{formatTanggalSingkat(k.tanggal_mulai)}{k.lokasi ? ` -- ${k.lokasi}` : ''}</p>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100">
            <h3 className="font-semibold text-slate-700 mb-1">Pengumuman Terbaru</h3>
            <p className="text-slate-400 text-xs mb-4">Info terkini untuk Anda</p>
            {loadingInsight ? (
              <div className="h-32 flex items-center justify-center text-slate-400">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : !generusInsight?.pengumumanTerbaru.length ? (
              <div className="py-8 text-center text-slate-400 text-sm">Belum ada pengumuman aktif</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {generusInsight.pengumumanTerbaru.map((p) => (
                  <a key={p.id} href="/pengumuman" className="block py-3 hover:bg-slate-50 -mx-2 px-2 rounded-lg transition-colors">
                    <p className="text-sm font-medium text-slate-700 truncate">{p.judul}</p>
                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{p.isi}</p>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {showHealthScore && (
          <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100">
            <h3 className="font-semibold text-slate-700 mb-1">Arus Kas 6 Bulan Terakhir</h3>
            <p className="text-slate-400 text-xs mb-4">Pemasukan vs pengeluaran per bulan</p>
            {loadingChart ? (
              <div className="h-64 flex items-center justify-center text-slate-400">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={arusKas}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="bulan" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => Number(v) >= 1000000 ? `${(Number(v) / 1000000).toFixed(0)}jt` : String(v)} />
                  <Tooltip formatter={(v) => formatRupiah(Number(v))} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="pemasukan" name="Pemasukan" fill="#10b981" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="pengeluaran" name="Pengeluaran" fill="#ef4444" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100">
          <h3 className="font-semibold text-slate-700 mb-1">Tren Kehadiran 6 Bulan Terakhir</h3>
          <p className="text-slate-400 text-xs mb-4">Persentase kehadiran dari seluruh kegiatan per bulan</p>
          {loadingChart ? (
            <div className="h-64 flex items-center justify-center text-slate-400">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={kehadiran}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="bulan" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v) => `${v}%`} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Line type="monotone" dataKey="persentase" name="Kehadiran" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100 xl:col-span-2">
          <h3 className="font-semibold text-slate-700 mb-1">Pertumbuhan Generus 6 Bulan Terakhir</h3>
          <p className="text-slate-400 text-xs mb-4">Jumlah Generus baru bergabung per bulan</p>
          {loadingChart ? (
            <div className="h-64 flex items-center justify-center text-slate-400">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={pertumbuhan}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="bulan" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Bar dataKey="generus_baru" name="Generus Baru" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}
