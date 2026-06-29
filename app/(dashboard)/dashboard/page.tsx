'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'

interface Stats {
  anggota: number
  kegiatan_aktif: number
  pemasukan: number
  pengeluaran: number
}

export default function DashboardPage() {
  const { user } = useUser()
  const [stats, setStats] = useState<Stats>({ anggota: 0, kegiatan_aktif: 0, pemasukan: 0, pengeluaran: 0 })
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!user) return
    loadStats()
  }, [user])

  const loadStats = async () => {
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
  }

  const formatRupiah = (n: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

  const formatDate = (d: Date) =>
    d.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const statCards = [
    {
      label: 'Total Anggota Aktif',
      value: loading ? '...' : stats.anggota.toLocaleString('id-ID'),
      icon: '👥',
      color: 'bg-blue-500',
    },
    {
      label: 'Kegiatan Berjalan',
      value: loading ? '...' : stats.kegiatan_aktif.toString(),
      icon: '📅',
      color: 'bg-indigo-500',
    },
    {
      label: 'Total Pemasukan',
      value: loading ? '...' : formatRupiah(stats.pemasukan),
      icon: '💰',
      color: 'bg-emerald-500',
    },
    {
      label: 'Total Pengeluaran',
      value: loading ? '...' : formatRupiah(stats.pengeluaran),
      icon: '💸',
      color: 'bg-red-500',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-blue-100 text-sm font-medium">Selamat datang kembali,</p>
            <h2 className="text-2xl font-bold mt-0.5">{user?.nama_lengkap}</h2>
            <p className="text-blue-200 text-sm mt-1">{user?.role?.nama_role}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-mono font-bold">{formatTime(now)}</div>
            <div className="text-blue-200 text-sm mt-0.5">{formatDate(now)}</div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className={`w-10 h-10 ${card.color} rounded-xl flex items-center justify-center text-xl mb-3`}>
              {card.icon}
            </div>
            <div className="text-xl font-bold text-slate-800">{card.value}</div>
            <div className="text-slate-500 text-sm mt-0.5">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
        <h3 className="font-semibold text-slate-700 mb-4">Akses Cepat</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { href: '/anggota', label: 'Data Anggota', icon: '👥', color: 'hover:bg-blue-50 hover:border-blue-200' },
            { href: '/kegiatan', label: 'Kegiatan', icon: '📅', color: 'hover:bg-indigo-50 hover:border-indigo-200' },
            { href: '/keuangan', label: 'Keuangan', icon: '💰', color: 'hover:bg-emerald-50 hover:border-emerald-200' },
            { href: '/pengumuman', label: 'Pengumuman', icon: '📢', color: 'hover:bg-orange-50 hover:border-orange-200' },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border border-slate-100 transition-colors ${item.color}`}
            >
              <span className="text-2xl">{item.icon}</span>
              <span className="text-sm font-medium text-slate-600">{item.label}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
