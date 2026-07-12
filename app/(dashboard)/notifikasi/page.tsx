'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Notifikasi } from '@/lib/types'

const tipeColor: Record<string, string> = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-yellow-100 text-yellow-700',
  success: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
}

export default function NotifikasiPage() {
  const { user } = useUser()
  const [data, setData] = useState<Notifikasi[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    // Jangan query sebelum user & role siap — mencegah filter PostgREST yang tidak valid
    // (target_role.eq., target_user.eq.undefined) yang bisa gagal senyap atau salah hasil.
    if (!user?.id || !user?.role?.tingkatan) return
    const tingkatan = user.role.tingkatan
    // Limit 200 -- notifikasi lama tidak perlu ditarik semua tiap buka halaman, cukup
    // riwayat terbaru (mencegah query membengkak seiring notifikasi menumpuk dari waktu ke waktu).
    const { data: rows } = await supabase
      .from('notifikasi')
      .select('*')
      .or(`target_role.eq.all,target_role.eq.${tingkatan},target_user.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(200)
    setData(rows || [])
    setLoading(false)
  }

  // Data-fetching on mount/dependency-change (bukan derived state) -- lihat catatan serupa
  // di dashboard/page.tsx. Disable per-baris supaya perilaku persis sama.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const markRead = async (id: number) => {
    await supabase
      .from('notifikasi')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id)
    setData(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
  }

  const markAllRead = async () => {
    const ids = data.filter(n => !n.is_read).map(n => n.id)
    if (!ids.length) return
    await supabase.from('notifikasi').update({ is_read: true, read_at: new Date().toISOString() }).in('id', ids)
    setData(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  const unread = data.filter(n => !n.is_read).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Notifikasi</h2>
          {unread > 0 && <p className="text-slate-400 text-sm">{unread} belum dibaca</p>}
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Tandai semua dibaca
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Memuat...
        </div>
      ) : data.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">🔔</div>
          <p>Tidak ada notifikasi</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.is_read && markRead(n.id)}
              className={`bg-white rounded-2xl p-4 shadow-sm border transition cursor-pointer ${
                n.is_read
                  ? 'border-slate-100 opacity-70'
                  : 'border-blue-100 ring-1 ring-blue-100 hover:shadow-md'
              }`}
            >
              <div className="flex items-start gap-3">
                {!n.is_read && (
                  <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 shrink-0" />
                )}
                <div className="flex-1 min-w-0" style={{ marginLeft: n.is_read ? '20px' : undefined }}>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="font-semibold text-slate-800 text-sm">{n.judul}</h3>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium capitalize ${tipeColor[n.tipe] || tipeColor.info}`}>
                      {n.tipe}
                    </span>
                  </div>
                  <p className="text-slate-600 text-sm">{n.pesan}</p>
                  <p className="text-slate-400 text-xs mt-1">
                    {new Date(n.created_at).toLocaleString('id-ID', {
                      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
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
