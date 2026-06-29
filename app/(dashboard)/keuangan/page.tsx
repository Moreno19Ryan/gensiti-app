'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Keuangan } from '@/lib/types'

export default function KeuanganPage() {
  const { user } = useUser()
  const [data, setData] = useState<Keuangan[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pemasukan' | 'pengeluaran'>('all')

  useEffect(() => {
    if (user) loadData()
  }, [user])

  const loadData = async () => {
    setLoading(true)
    let query = supabase.from('keuangan').select('*').order('tanggal', { ascending: false })

    const tingkatan = user?.role?.tingkatan
    if (tingkatan !== 'super_admin' && tingkatan !== 'daerah') {
      if (user?.kelompok_id) query = query.eq('kelompok_id', user.kelompok_id)
      else if (user?.desa_id) query = query.eq('desa_id', user.desa_id)
    }

    const { data: rows } = await query
    setData(rows || [])
    setLoading(false)
  }

  const filtered = filter === 'all' ? data : data.filter(k => k.jenis === filter)

  const total = {
    pemasukan: data.filter(k => k.jenis === 'pemasukan').reduce((s, k) => s + Number(k.jumlah), 0),
    pengeluaran: data.filter(k => k.jenis === 'pengeluaran').reduce((s, k) => s + Number(k.jumlah), 0),
  }
  const saldo = total.pemasukan - total.pengeluaran

  const fmt = (n: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-800">Keuangan</h2>
        <button className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
          + Tambah
        </button>
      </div>

      {/* Summary Cards */}
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

      {/* Filter */}
      <div className="flex gap-2">
        {(['all', 'pemasukan', 'pengeluaran'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition capitalize ${
              filter === f ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            {f === 'all' ? 'Semua' : f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2" />
            Memuat...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <div className="text-4xl mb-2">💰</div>
            <p>Belum ada transaksi</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium">Tanggal</th>
                  <th className="px-4 py-3 font-medium">Jenis</th>
                  <th className="px-4 py-3 font-medium">Kategori</th>
                  <th className="px-4 py-3 font-medium">Deskripsi</th>
                  <th className="px-4 py-3 font-medium text-right">Jumlah</th>
                  <th className="px-4 py-3 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((k) => (
                  <tr key={k.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(k.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                        k.jenis === 'pemasukan' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {k.jenis}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{k.kategori || '-'}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{k.deskripsi || '-'}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${
                      k.jenis === 'pemasukan' ? 'text-emerald-600' : 'text-red-500'
                    }`}>
                      {k.jenis === 'pengeluaran' ? '-' : '+'}{fmt(Number(k.jumlah))}
                    </td>
                    <td className="px-4 py-3">
                      <button className="text-blue-600 hover:text-blue-800 font-medium text-xs">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
