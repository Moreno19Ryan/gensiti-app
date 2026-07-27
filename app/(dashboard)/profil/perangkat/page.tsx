'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { labelPerangkat } from '@/lib/user-agent'
import { toast } from '@/lib/toast'
import { konfirmasi } from '@/lib/konfirmasi'
import { SkeletonRows } from '@/components/Skeleton'
import ProfilHeader from '@/components/ProfilHeader'

interface SesiSaya {
  id: string
  session_token: string
  user_agent: string | null
  created_at: string
}

// Self-service "Perangkat Aktif" (A4 -- multi-device, maks 2 sesi per akun). Melengkapi tab
// Sesi Aktif di Monitoring & Log (khusus Super Admin) dengan versi milik-sendiri utk SEMUA
// role -- supaya siapapun bisa lihat & mengeluarkan device lamanya sendiri tanpa perlu minta
// tolong Super Admin. RLS user_sessions_select/delete sudah otomatis membatasi ke baris milik
// sendiri (user_id = auth.uid()), jadi query di sini murni `.from('user_sessions')` biasa,
// tidak perlu filter user_id manual atau RPC tambahan.
export default function PerangkatAktifPage() {
  const { user } = useUser()
  const [sesiList, setSesiList] = useState<SesiSaya[]>([])
  const [loading, setLoading] = useState(true)
  const [keluarId, setKeluarId] = useState<string | null>(null)
  const sesiTokenSaya = typeof window !== 'undefined' ? localStorage.getItem('gensiti_session_token') : null

  const loadSesi = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('user_sessions')
      .select('id, session_token, user_agent, created_at')
      .order('created_at', { ascending: false })
    if (error) console.error('Gagal memuat perangkat aktif:', error.message)
    setSesiList(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSesi()
  }, [user, loadSesi])

  const keluarkanPerangkat = async (sesi: SesiSaya) => {
    const setuju = await konfirmasi({
      judul: 'Keluar dari perangkat ini?',
      pesan: `Perangkat "${labelPerangkat(sesi.user_agent)}" akan otomatis keluar dari GENSITI dalam waktu singkat. Kalau ini bukan Anda, ini cara yang tepat untuk mengamankan akun.`,
      labelYa: 'Ya, Keluarkan',
      destruktif: true,
    })
    if (!setuju) return
    setKeluarId(sesi.id)
    const { error } = await supabase.from('user_sessions').delete().eq('id', sesi.id)
    setKeluarId(null)
    if (error) { toast.gagal(`Gagal mengeluarkan perangkat: ${error.message}`); return }
    toast.sukses('Perangkat berhasil dikeluarkan.')
    loadSesi()
  }

  if (!user) return null

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <ProfilHeader title="Perangkat Aktif" backHref="/profil" />

      <p className="text-sm text-slate-500 dark:text-slate-400 -mt-2">
        Maksimal 2 perangkat bisa login bersamaan dengan akun ini. Kalau ada perangkat yang tidak Anda kenali di sini, segera keluarkan dan ganti password.
      </p>

      {loading ? (
        <SkeletonRows jumlah={2} />
      ) : sesiList.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center text-slate-400 border border-slate-100 dark:border-slate-700">
          <div className="text-4xl mb-2">🔐</div>
          <p>Belum ada perangkat aktif tercatat</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
          {sesiList.map(sesi => {
            const iniPerangkatSaya = sesi.session_token === sesiTokenSaya
            return (
              <div key={sesi.id} className="flex items-center gap-3 p-4">
                <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="2" width="16" height="20" rx="2" /><path d="M12 18h.01" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{labelPerangkat(sesi.user_agent)}</p>
                    {iniPerangkatSaya && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Perangkat Ini</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Login {new Date(sesi.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </div>
                {!iniPerangkatSaya && (
                  <button
                    onClick={() => keluarkanPerangkat(sesi)}
                    disabled={keluarId === sesi.id}
                    className="shrink-0 text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition"
                  >
                    {keluarId === sesi.id ? '...' : 'Keluarkan'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
