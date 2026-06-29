'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Kegiatan } from '@/lib/types'

const statusLabel: Record<string, { label: string; color: string }> = {
  upcoming: { label: 'Akan Datang', color: 'bg-blue-100 text-blue-700' },
  ongoing: { label: 'Berlangsung', color: 'bg-green-100 text-green-700' },
  selesai: { label: 'Selesai', color: 'bg-slate-100 text-slate-500' },
}

export default function KegiatanPage() {
  const { user } = useUser()
  const [data, setData] = useState<Kegiatan[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    if (user) loadData()
  }, [user])

  const loadData = async () => {
    setLoading(true)
    let query = supabase.from('kegiatan').select('*').order('tanggal_mulai', { ascending: false })

    const tingkatan = user?.role?.tingkatan
    if (tingkatan !== 'super_admin' && tingkatan !== 'daerah') {
      if (user?.kelompok_id) query = query.eq('kelompok_id', user.kelompok_id)
      else if (user?.desa_id) query = query.eq('desa_id', user.desa_id)
    }

    const { data: rows } = await query
    setData(rows || [])
    setLoading(false)
  }

  const filtered = filter === 'all' ? data : data.filter(k => k.status === filter)

  const formatTanggal = (t: string | null) =>
    t ? new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Kegiatan</h2>
          <p className="text-slate-400 text-sm">{data.length} kegiatan total</p>
        </div>
        <button className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
          + Tambah
        </button>
      </div>

      <div className="flex gap-2">
        {['all', 'upcoming', 'ongoing', 'selesai'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition ${
              filter === s
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            {s === 'all' ? 'Semua' : statusLabel[s]?.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Memuat data...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">📅</div>
          <p className="font-medium">Belum ada kegiatan</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((k) => (
            <div key={k.id} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-800">{k.nama_kegiatan}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusLabel[k.status]?.color}`}>
                      {statusLabel[k.status]?.label}
                    </span>
                  </div>
                  {k.deskripsi && <p className="text-slate-500 text-sm mt-1 line-clamp-2">{k.deskripsi}</p>}
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                    {k.tanggal_mulai && (
                      <span>📅 {formatTanggal(k.tanggal_mulai)}{k.tanggal_selesai ? ` – ${formatTanggal(k.tanggal_selesai)}` : ''}</span>
                    )}
                    {k.lokasi && <span>📍 {k.lokasi}</span>}
                    {k.tingkatan && <span className="capitalize">🏷 {k.tingkatan}</span>}
                  </div>
                </div>
                <button className="text-blue-600 hover:text-blue-800 font-medium text-sm shrink-0">Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
