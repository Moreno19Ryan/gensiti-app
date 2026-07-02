'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase' // dipakai untuk stats queries
import { isPengurus } from '@/lib/roles'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

interface Stats {
  anggota: number
  kegiatan_aktif: number
  pemasukan: number
  pengeluaran: number
}

interface ArusKasBulan { bulan: string; pemasukan: number; pengeluaran: number }
interface KehadiranBulan { bulan: string; persentase: number }
interface PertumbuhanBulan { bulan: string; anggota_baru: number }

// 6 bulan terakhir termasuk bulan berjalan, format label pendek Indonesia (mis. "Jan 2026").
// Dipakai sebagai kerangka sumbu-X grafik supaya bulan tanpa data tetap muncul sebagai 0,
// bukan hilang dari grafik (grafik yang "bolong" lebih membingungkan daripada nilai nol).
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
  const [stats, setStats] = useState<Stats>({ anggota: 0, kegiatan_aktif: 0, pemasukan: 0, pengeluaran: 0 })
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())

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
      // PPG mengawasi seluruh Bekasi Timur (read-only) -- statistiknya harus lintas
      // Desa/Kelompok seperti Daerah/Super Admin, bukan ter-filter ke scope tertentu
      // (PPG tidak punya desa_id/kelompok_id).
      const isPPGUser = user?.role?.tingkatan === 'ppg'

      let anggotaQuery = supabase.from('anggota').select('id', { count: 'exact', head: true }).eq('status', 'aktif')
      let kegiatanQuery = supabase.from('kegiatan').select('id', { count: 'exact', head: true }).in('status', ['upcoming', 'ongoing'])
      let keuanganQuery = supabase.from('keuangan').select('jenis, jumlah')

      if (!isSuper && !isDaerah && !isPPGUser) {
        if (user?.desa_id) {
          anggotaQuery = anggotaQuery.eq('desa_id', user.desa_id)
          kegiatanQuery = kegiatanQuery.eq('desa_id', user.desa_id)
          keuanganQuery = keuanganQuery.eq('desa_id', user.desa_id)
        }
        if (user?.kelompok_id) {
          anggotaQuery = anggotaQuery.eq('kelompok_id', user.kelompok_id)
          kegiatanQuery = kegiatanQuery.eq('kelompok_id', user.kelompok_id)
          keuanganQuery = keuanganQuery.eq('kelompok_id', user.kelompok_id)
        }
      }

      const [{ count: anggotaCount }, { count: kegiatanCount }, { data: keuanganData }] = await Promise.all([
        anggotaQuery,
        kegiatanQuery,
        keuanganQuery,
      ])

      let pemasukan = 0
      let pengeluaran = 0
      keuanganData?.forEach((k) => {
        if (k.jenis === 'pemasukan') pemasukan += Number(k.jumlah)
        else pengeluaran += Number(k.jumlah)
      })

      setStats({
        anggota: anggotaCount || 0,
        kegiatan_aktif: kegiatanCount || 0,
        pemasukan,
        pengeluaran,
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
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

      // Scope filter sama seperti loadStats -- kelompok/desa lihat datanya sendiri,
      // daerah/super_admin/ppg lihat lintas Bekasi Timur.
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

      // --- Arus kas per bulan (hanya untuk yang punya akses Keuangan: bukan ru'yah, bukan PPG) ---
      // Pakai isPengurus(user) langsung (bukan variabel showHealthScore di scope komponen)
      // karena loadCharts adalah useCallback terpisah -- lebih aman & eksplisit daripada
      // bergantung pada urutan deklarasi variabel di body komponen.
      const canSeeKeuangan = isPengurus(user)
      if (canSeeKeuangan) {
        let kq = supabase.from('keuangan').select('jenis, jumlah, tanggal').gte('tanggal', rangeStart)
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

      // --- Pertumbuhan anggota per bulan (jumlah anggota baru, bukan kumulatif) ---
      let aq = supabase.from('anggota').select('created_at').gte('created_at', rangeStart)
      aq = applyScope(aq)
      const { data: aRows } = await aq
      const tumbuhMap = new Map(bulanList.map(b => [b.key, 0]))
      aRows?.forEach(r => {
        const key = r.created_at.slice(0, 7)
        if (tumbuhMap.has(key)) tumbuhMap.set(key, (tumbuhMap.get(key) || 0) + 1)
      })
      setPertumbuhan(bulanList.map(b => ({ bulan: b.label, anggota_baru: tumbuhMap.get(b.key) || 0 })))

      // --- Tren kehadiran per bulan (persentase hadir dari semua absensi tercatat pada kegiatan
      // dalam scope, dikelompokkan berdasarkan tanggal kegiatan bukan waktu_absen, supaya
      // kehadiran H-1/susulan tetap terhitung ke bulan kegiatannya) ---
      let kegq = supabase.from('kegiatan').select('id, tanggal_mulai').gte('tanggal_mulai', rangeStart)
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

  const formatRupiah = (n: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

  const formatDate = (d: Date) =>
    d.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  // Hitung health score keuangan (0-100)
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

  // Tampilkan Health Score untuk semua pengurus (ru'yah biasa & PPG tidak perlu lihat ini --
  // PPG bukan pengurus operasional, lihat isPengurus() di lib/roles.ts)
  const showHealthScore = isPengurus(user)

  const quickActions = isPPGUser
    ? [
        { href: '/ppg', label: 'Dashboard PPG', icon: '🛡️', color: 'hover:bg-purple-50 hover:border-purple-200' },
        { href: '/kegiatan', label: 'Kegiatan', icon: '📅', color: 'hover:bg-indigo-50 hover:border-indigo-200' },
        { href: '/pengumuman', label: 'Pengumuman', icon: '📢', color: 'hover:bg-orange-50 hover:border-orange-200' },
        { href: '/catatan-pembinaan', label: 'Catatan Pembinaan', icon: '📝', color: 'hover:bg-emerald-50 hover:border-emerald-200' },
      ]
    : [
        { href: '/anggota', label: 'Data Pengguna', icon: '👥', color: 'hover:bg-blue-50 hover:border-blue-200' },
        { href: '/kegiatan', label: 'Kegiatan', icon: '📅', color: 'hover:bg-indigo-50 hover:border-indigo-200' },
        { href: '/keuangan', label: 'Keuangan', icon: '💰', color: 'hover:bg-emerald-50 hover:border-emerald-200' },
        { href: '/pengumuman', label: 'Pengumuman', icon: '📢', color: 'hover:bg-orange-50 hover:border-orange-200' },
      ]

  // PPG bukan pengurus operasional -- tidak perlu lihat data finansial mentah (Total
  // Pemasukan/Pengeluaran) ataupun Health Score di dashboard umum ini. Cukup tampilkan
  // Anggota Aktif se-Bekasi Timur; detail approval & ringkasan lengkap ada di /ppg.
  const statCards = [
    {
      label: 'Pengguna Online',
      value: loading ? '...' : onlineCount.toString(),
      sub: 'Realtime aktif',
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
    isPPGUser
      ? { label: 'Ru\'yah Aktif', value: loading ? '...' : stats.anggota.toLocaleString('id-ID'), sub: 'Se-Bekasi Timur', icon: '👥', color: 'bg-violet-500' }
      : {
          label: showHealthScore ? 'Health Score' : 'Total Pemasukan',
          value: loading ? '...' : showHealthScore ? `${healthScore}%` : formatRupiah(stats.pemasukan),
          sub: showHealthScore ? healthLabel : 'Total masuk',
          icon: showHealthScore ? '❤️' : '💰',
          color: showHealthScore ? healthBg : 'bg-emerald-500',
        },
    isPPGUser
      ? { label: 'Dashboard PPG', value: 'Lihat', sub: 'Persetujuan & pengawasan', icon: '🛡️', color: 'bg-purple-500' }
      : {
          label: showHealthScore ? 'Anggota Aktif' : 'Total Pengeluaran',
          value: loading ? '...' : showHealthScore ? stats.anggota.toLocaleString('id-ID') : formatRupiah(stats.pengeluaran),
          sub: showHealthScore ? 'Terdaftar & aktif' : 'Total keluar',
          icon: showHealthScore ? '👥' : '💸',
          color: showHealthScore ? 'bg-violet-500' : 'bg-red-500',
        },
  ]

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Greeting */}
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

      {/* Stats Grid */}
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

      {/* Quick Actions */}
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

      {/* Grafik Tren 6 Bulan Terakhir */}
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
          <h3 className="font-semibold text-slate-700 mb-1">Pertumbuhan Anggota 6 Bulan Terakhir</h3>
          <p className="text-slate-400 text-xs mb-4">Jumlah anggota baru terdaftar per bulan</p>
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
                <Bar dataKey="anggota_baru" name="Anggota Baru" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}
