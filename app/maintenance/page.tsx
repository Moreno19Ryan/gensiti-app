'use client'

// Halaman publik yang ditampilkan ke SEMUA pengguna NON-super_admin saat Mode Perawatan
// Sistem aktif (lihat app/(dashboard)/layout.tsx untuk gerbang pengalihannya, dan tab
// "Perawatan Sistem" di /monitoring untuk kontrol toggle-nya, khusus Super Admin).
// Super Admin TIDAK PERNAH diarahkan ke sini -- tetap bisa masuk dashboard penuh supaya bisa
// menonaktifkan mode ini kembali atau menyelesaikan operasi berisiko (restore backup, dsb).
// Halaman ini sengaja di luar folder app/(dashboard) supaya tidak ikut tunduk pada gerbang
// auth/maintenance-nya sendiri (mencegah redirect loop).
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { SystemConfig } from '@/lib/types'

export default function MaintenancePage() {
  const router = useRouter()
  const [config, setConfig] = useState<SystemConfig | null>(null)
  const [checking, setChecking] = useState(false)
  // Hitung berapa kali BERTURUT-TURUT terdeteksi maintenance_mode = false, sebelum benar-benar
  // redirect ke dashboard. Mencegah bug redirect loop /maintenance <-> /dashboard yang terjadi
  // sebelumnya: kalau langsung redirect di pengecekan pertama yang false, dan ternyata itu
  // hasil baca stale/race (mis. sesaat sebelum trigger DB benar-benar commit, atau delay
  // propagasi antar koneksi PostgREST), pengguna terlempar ke /dashboard, lalu gerbang di
  // app/(dashboard)/layout.tsx mendeteksi maintenance_mode masih true dan melempar balik ke
  // sini -- berulang terus tanpa henti. Dengan syarat 2x berturut-turut (~15 detik jeda),
  // false-positive tunggal tidak lagi memicu redirect.
  const falseStreakRef = useRef(0)

  const loadConfig = useCallback(async (opts?: { forceRedirect?: boolean }) => {
    const { data } = await supabase.from('system_config').select('*').eq('id', true).maybeSingle()
    setConfig(data as SystemConfig | null)
    if (data && !(data as SystemConfig).maintenance_mode) {
      falseStreakRef.current += 1
      // Kalau ini dipicu oleh tombol "Cek Status Sekarang" (klik manual), pengguna sudah
      // sengaja minta re-check -- percaya hasilnya langsung tanpa perlu menunggu streak.
      if (falseStreakRef.current >= 2 || opts?.forceRedirect) {
        router.replace('/dashboard')
      }
    } else {
      falseStreakRef.current = 0
    }
  }, [router])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConfig()
    // Polling ringan tiap 15 detik -- pola sama seperti checkSessionMasihValid di
    // lib/user-context.tsx, supaya pengguna tidak perlu me-refresh manual saat maintenance
    // selesai.
    const interval = setInterval(() => loadConfig(), 15_000)
    return () => clearInterval(interval)
  }, [loadConfig])

  const cekSekarang = async () => {
    setChecking(true)
    await loadConfig({ forceRedirect: true })
    setChecking(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center space-y-4">
        <div className="text-5xl">🛠️</div>
        <h1 className="text-xl font-bold text-slate-800">Sedang Dalam Perawatan</h1>
        <p className="text-slate-500 text-sm">
          {config?.maintenance_message?.trim()
            ? config.maintenance_message
            : 'GENSITI sedang menjalani pemeliharaan teknis singkat. Mohon coba kembali beberapa saat lagi.'}
        </p>
        {config?.maintenance_started_at && (
          <p className="text-slate-300 text-xs">
            Dimulai {new Date(config.maintenance_started_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        )}
        <button
          onClick={cekSekarang}
          disabled={checking}
          className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2"
        >
          {checking ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Cek Status Sekarang'}
        </button>
        <p className="text-slate-300 text-xs">Halaman ini akan otomatis memeriksa ulang setiap 15 detik.</p>
      </div>
    </div>
  )
}
