'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Pengumuman } from '@/lib/types'

export default function PengumumanPage() {
  const [data, setData] = useState<Pengumuman[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const { data: rows } = await supabase
      .from('pengumuman')
      .select('*')
      .eq('is_active', true)
      .order('tanggal_publish', { ascending: false })
    setData(rows || [])
    setLoading(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-800">Pengumuman</h2>
        <button className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
          + Buat
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Memuat...
        </div>
      ) : data.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">📢</div>
          <p>Belum ada pengumuman</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="font-semibold text-slate-800">{p.judul}</h3>
                    {p.tingkatan && (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs capitalize">
                        {p.tingkatan}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-600 text-sm line-clamp-3 whitespace-pre-line">{p.isi}</p>
                  <p className="text-slate-400 text-xs mt-2">
                    {new Date(p.tanggal_publish).toLocaleDateString('id-ID', {
                      day: 'numeric', month: 'long', year: 'numeric'
                    })}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
