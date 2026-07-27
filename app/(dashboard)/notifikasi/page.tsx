'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Notifikasi } from '@/lib/types'
import { isPushSupported, getPushPermission, getExistingPushSubscription, subscribeToPush } from '@/lib/push'

const tipeColor: Record<string, string> = {
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

// Kunci localStorage buat "Nanti Saja" -- dismiss permanen per browser, bukan cuma per sesi.
// Sengaja TIDAK muncul lagi otomatis setelah beberapa waktu (v1) supaya tidak terasa
// mengganggu/nagging -- lihat diskusi WISHLIST_ASSESSMENT.md soal adopsi push notification.
const PUSH_BANNER_DISMISSED_KEY = 'gensiti_push_banner_dismissed'

export default function NotifikasiPage() {
  const { user } = useUser()
  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'
  const [data, setData] = useState<Notifikasi[]>([])
  const [loading, setLoading] = useState(true)

  // Banner ajakan aktifkan push -- HANYA muncul kalau: browser mendukung, izin belum ditolak
  // permanen, belum ada subscription aktif di device ini, dan belum pernah di-dismiss. Super
  // Admin dikecualikan (sama seperti profil/notifikasi/page.tsx yang redirect Super Admin
  // keluar dari pengaturan push -- fitur ini murni untuk notifikasi konten organisasi).
  const [showPushBanner, setShowPushBanner] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [pushErr, setPushErr] = useState<string | null>(null)

  useEffect(() => {
    if (!user || isSuperAdmin) return
    if (!isPushSupported() || getPushPermission() === 'denied') return
    if (localStorage.getItem(PUSH_BANNER_DISMISSED_KEY) === 'true') return
    getExistingPushSubscription().then(sub => {
      if (!sub) setShowPushBanner(true)
    })
  }, [user, isSuperAdmin])

  const handleAktifkanPush = async () => {
    if (!user) return
    setPushLoading(true)
    setPushErr(null)
    const err = await subscribeToPush(user.id)
    setPushLoading(false)
    if (err) { setPushErr(err); return }
    setShowPushBanner(false)
  }

  const handleDismissPushBanner = () => {
    localStorage.setItem(PUSH_BANNER_DISMISSED_KEY, 'true')
    setShowPushBanner(false)
  }

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
      {showPushBanner && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-2xl p-4 flex items-start gap-3">
          <div className="text-2xl shrink-0">🔔</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">Aktifkan Notifikasi Push?</p>
            <p className="text-xs text-blue-700/80 dark:text-blue-400/80 mt-0.5">
              Dapatkan notifikasi langsung ke HP/desktop walau GENSITI sedang tertutup -- kegiatan baru, pengumuman, dan pengingat penting.
            </p>
            {pushErr && <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{pushErr}</p>}
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={handleAktifkanPush}
                disabled={pushLoading}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:bg-blue-300 transition"
              >
                {pushLoading ? 'Mengaktifkan...' : 'Aktifkan'}
              </button>
              <button
                onClick={handleDismissPushBanner}
                className="px-3 py-1.5 text-blue-700 dark:text-blue-400 rounded-lg text-xs font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition"
              >
                Nanti Saja
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Notifikasi</h2>
          {unread > 0 && <p className="text-slate-400 text-sm">{unread} belum dibaca</p>}
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
          >
            Tandai semua dibaca
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Sabar ya, lagi disiapin...
        </div>
      ) : data.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">🔔</div>
          <p>Belum ada notifikasi nih, aman!</p>
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
                  : 'border-blue-100 ring-1 ring-blue-100 hover:shadow-md dark:border-blue-800 dark:ring-blue-800'
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
