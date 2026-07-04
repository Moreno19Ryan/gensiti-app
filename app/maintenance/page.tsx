'use client'

// Halaman publik yang ditampilkan ke SEMUA pengguna NON-super_admin saat Mode Perawatan
// Sistem aktif (lihat app/(dashboard)/layout.tsx untuk gerbang pengalihannya, dan tab
// "Perawatan Sistem" di /monitoring untuk kontrol toggle-nya, khusus Super Admin).
// Super Admin TIDAK PERNAH diarahkan ke sini -- tetap bisa masuk dashboard penuh supaya bisa
// menonaktifkan mode ini kembali atau menyelesaikan operasi berisiko (restore backup, dsb).
// Halaman ini sengaja di luar folder app/(dashboard) supaya tidak ikut tunduk pada gerbang
// auth/maintenance-nya sendiri (mencegah redirect loop).
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { SystemConfig } from '@/lib/types'

export default function MaintenancePage() {
  const router = useRouter()
  const [config, setConfig] = useState<SystemConfig | null>(null)
  const [checking, setChecking] = useState(false)

  const loadConfig = useCallback(async () => {
    const { data } = await supabase.from('system_config').select('*').eq('id', true).maybeSingle()
    setConfig(data as SystemConfig | null)
    // Kalau ternyata maintenance sudah dinonaktifkan (mis. Super Admin baru saja
    // mematikannya), otomatis kembalikan pengguna ke dashboard tanpa perlu refresh manual.
    if (data && !(data as SystemConfig).maintenance_mode) {
      router.replace('/dashboard')
    }
  }, [router])

  useEffect(() => {
    loadConfig()
    // Polling ringan tiap 15 detik -- pola sama seperti checkSessionMasihValid di
    // lib/user-context.tsx, supaya pengguna tidak perlu me-refresh manual saat maintenance
    // selesai.
    const interval = setInterval(loadConfig, 15_000)
    return () => clearInterval(interval)
  }, [loadConfig])

  const cekSekarang = async () => {
    setChecking(true)
    await loadConfig()
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
