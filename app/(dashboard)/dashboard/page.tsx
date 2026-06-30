'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase' // dipakai untuk stats queries

interface Stats {
  anggota: number
  kegiatan_aktif: number
  pemasukan: number
  pengeluaran: number
}

export default function DashboardPage() {
  const { user, onlineCount } = useUser()
  const [stats, setStats] = useState<Stats>({ anggota: 0, kegiatan_aktif: 0, pemasukan: 0, pengeluaran: 0 })
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())

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

      let anggotaQuery = supabase.from('anggota').select('id', { count: 'exact', head: true }).eq('status', 'aktif')
      let kegiatanQuery = supabase.from('kegiatan').select('id', { count: 'exact', head: true }).in('status', ['upcoming', 'ongoing'])
      let keuanganQuery = supabase.from('keuangan').select('jenis, jumlah')

      if (!isSuper && !isDaerah) {
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

  useEffect(() => {
    loadStats()
  }, [loadStats])

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

  const healthColor = healthScore >= 70 ? 'text-emerald-400' : healthScore >= 40 ? 'text-yellow-400' : 'text-red-400'
  const healthBg = healthScore >= 70 ? 'bg-emerald-500' : healthScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  const healthLabel = healthScore >= 70 ? 'Sehat' : healthScore >= 40 ? 'Perlu Perhatian' : 'Kritis'

  const isSuper = user?.role?.tingkatan === 'super_admin'

  // Tampilkan Health Score untuk ketua/wakil/bendahara di semua tingkatan
  const showHealthScore = isSuper || /Ketua|Wakil|Bendahara/i.test(user?.role?.nama_role || '')

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
    {
      label: showHealthScore ? 'Health Score' : 'Total Pemasukan',
      value: loading ? '...' : showHealthScore ? `${healthScore}%` : formatRupiah(stats.pemasukan),
      sub: showHealthScore ? healthLabel : 'Total masuk',
      icon: showHealthScore ? '❤️' : '💰',
      color: showHealthScore ? healthBg : 'bg-emerald-500',
    },
    {
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
          {[
            { href: '/anggota', label: 'Data Pengguna', icon: '👥', color: 'hover:bg-blue-50 hover:border-blue-200' },
            { href: '/kegiatan', label: 'Kegiatan', icon: '📅', color: 'hover:bg-indigo-50 hover:border-indigo-200' },
            { href: '/keuangan', label: 'Keuangan', icon: '💰', color: 'hover:bg-emerald-50 hover:border-emerald-200' },
            { href: '/pengumuman', label: 'Pengumuman', icon: '📢', color: 'hover:bg-orange-50 hover:border-orange-200' },
          ].map((item) => (
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
    </div>
  )
}
