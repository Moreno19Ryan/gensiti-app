'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import { FeatureToggle } from '@/lib/feature-toggles'

// Halaman KHUSUS Super Admin -- matrix switch on/off per menu x jenjang role (Daerah/Desa/
// Kelompok/PPG). Toggle ini adalah GERBANG TAMBAHAN di atas hak akses dasar (lib/roles.ts) --
// tidak pernah bisa MENAMBAH akses di luar yang sudah diizinkan role, hanya bisa MENGURANGI
// (mematikan menu yang sebenarnya berhak diakses role tsb). Dicek di 2 tempat: sidebar
// (app/(dashboard)/layout.tsx, visibleNav) dan guard render tiap halaman menu (mencegah akses
// langsung lewat URL kalau menu sudah dimatikan). Super Admin sendiri TIDAK terpengaruh toggle
// apapun -- lihat isFeatureEnabled() di lib/feature-toggles.ts -- supaya dia tidak bisa
// mengunci dirinya sendiri keluar dari sistem.
//
// PENTING soal cakupan: toggle disimpan per JENJANG (kolom Daerah/Desa/Kelompok/PPG), BUKAN
// per role spesifik. Untuk menu yang bisa dilihat baik Pengurus maupun Generus biasa di
// jenjang yang sama (Kegiatan, Pengumuman, Dokumen, Absensi), mematikan toggle utk jenjang
// Kelompok akan berdampak ke SEMUA orang di jenjang itu -- Ketua Kelompok DAN Generus biasa
// sama-sama kehilangan akses. Ini keputusan desain yang disengaja (dikonfirmasi eksplisit),
// bukan bug -- peringatan ini ditampilkan juga di UI banner bawah judul halaman.

interface MenuGroup {
  menu_key: string
  menu_label: string
  // Kolom role yang relevan utk menu ini -- HANYA kolom yang di-seed di migrasi
  // create_feature_toggles yang ditampilkan (mis. 'keuangan' tidak punya kolom PPG krn PPG
  // memang sama sekali tidak bisa akses Keuangan, tidak ada gunanya menampilkan switch mati permanen).
  roleColumns: ('daerah' | 'desa' | 'kelompok' | 'ppg')[]
}

// Urutan & pengelompokan menu SENGAJA mengikuti urutan tampil di sidebar (app/(dashboard)/
// layout.tsx navItems) supaya Super Admin mudah mencocokkan dengan apa yang dia lihat di
// sidebarnya sendiri sehari-hari.
const MENU_GROUPS: MenuGroup[] = [
  { menu_key: 'generus', menu_label: 'Pengguna', roleColumns: ['daerah', 'desa', 'kelompok'] },
  { menu_key: 'data-generus', menu_label: 'Data Generus', roleColumns: ['daerah', 'desa', 'kelompok'] },
  { menu_key: 'data-pembina', menu_label: 'Data Pembina', roleColumns: ['daerah', 'desa', 'kelompok', 'ppg'] },
  { menu_key: 'kegiatan', menu_label: 'Kegiatan', roleColumns: ['daerah', 'desa', 'kelompok', 'ppg'] },
  { menu_key: 'absensi', menu_label: 'Absensi', roleColumns: ['daerah', 'desa', 'kelompok'] },
  { menu_key: 'keuangan', menu_label: 'Keuangan', roleColumns: ['daerah', 'desa', 'kelompok'] },
  { menu_key: 'pengumuman', menu_label: 'Pengumuman', roleColumns: ['daerah', 'desa', 'kelompok', 'ppg'] },
  { menu_key: 'dokumen', menu_label: 'Dokumen', roleColumns: ['daerah', 'desa', 'kelompok', 'ppg'] },
  { menu_key: 'catatan-pembinaan', menu_label: 'Catatan Pembinaan', roleColumns: ['daerah', 'desa', 'kelompok', 'ppg'] },
  { menu_key: 'monitoring', menu_label: 'Monitoring & Log', roleColumns: ['daerah', 'desa', 'kelompok'] },
]

const roleColLabel: Record<string, string> = {
  daerah: 'Daerah',
  desa: 'Desa',
  kelompok: 'Kelompok',
  ppg: 'PPG',
}

export default function PengaturanFiturPage() {
  const { user } = useUser()
  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'

  const [toggles, setToggles] = useState<FeatureToggle[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState('')

  const loadToggles = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase.from('feature_toggles').select('*')
    if (err) { setError(err.message); setLoading(false); return }
    setToggles((data as FeatureToggle[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!isSuperAdmin) return
    loadToggles()
  }, [isSuperAdmin, loadToggles])

  const getToggle = (menuKey: string, role: string) =>
    toggles.find(t => t.menu_key === menuKey && t.role_tingkatan === role)

  const handleToggle = async (menuKey: string, menuLabel: string, role: string) => {
    const current = getToggle(menuKey, role)
    // Kalau baris belum ada (mestinya tidak terjadi krn sudah di-seed penuh saat migrasi,
    // tapi dijaga sbg pengaman), buat baru dgn is_enabled=false (klik toggle = niatnya
    // mematikan sesuatu yang defaultnya nyala).
    const nextEnabled = current ? !current.is_enabled : false
    const rowKey = `${menuKey}:${role}`
    setSavingKey(rowKey)
    setError('')
    try {
      const { data, error: err } = await supabase
        .from('feature_toggles')
        .upsert(
          {
            menu_key: menuKey,
            menu_label: menuLabel,
            role_tingkatan: role,
            is_enabled: nextEnabled,
            updated_by: user?.id || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'menu_key,role_tingkatan' }
        )
        .select('*')
        .single()

      if (err) { setError(`Gagal menyimpan: ${err.message}`); return }

      setToggles(prev => {
        const idx = prev.findIndex(t => t.menu_key === menuKey && t.role_tingkatan === role)
        if (idx === -1) return [...prev, data as FeatureToggle]
        const copy = [...prev]
        copy[idx] = data as FeatureToggle
        return copy
      })

      if (user) {
        await logAudit(
          user,
          'UPDATE',
          'Pengaturan Fitur',
          `${menuLabel} -- ${roleColLabel[role]}`,
          { menu_key: menuKey, role_tingkatan: role, is_enabled: nextEnabled }
        )
      }
    } finally {
      setSavingKey(null)
    }
  }

  if (!isSuperAdmin) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🔒</div>
        <p className="font-semibold text-slate-600">Akses Dibatasi</p>
        <p className="text-sm mt-1">Menu Pengaturan Fitur hanya tersedia untuk Super Admin.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-slate-800">Pengaturan Fitur</h2>
        <p className="text-slate-400 text-sm">Aktifkan atau nonaktifkan menu tertentu per jenjang role</p>
      </div>

      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs leading-relaxed">
        <strong>Perhatian:</strong> toggle berlaku per JENJANG wilayah (Daerah/Desa/Kelompok/PPG), bukan per jabatan.
        Mematikan sebuah menu untuk jenjang Kelompok akan berdampak ke <strong>semua orang</strong> di jenjang itu --
        termasuk Ketua Kelompok maupun Generus biasa yang biasanya bisa melihat menu tersebut (mis. Kegiatan, Pengumuman, Dokumen, Absensi).
        Toggle ini tidak berlaku untuk Super Admin.
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium">Menu</th>
                  <th className="px-4 py-3 font-medium text-center">Daerah</th>
                  <th className="px-4 py-3 font-medium text-center">Desa</th>
                  <th className="px-4 py-3 font-medium text-center">Kelompok</th>
                  <th className="px-4 py-3 font-medium text-center">PPG</th>
                </tr>
              </thead>
              <tbody>
                {MENU_GROUPS.map(group => (
                  <tr key={group.menu_key} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-medium text-slate-700">{group.menu_label}</td>
                    {(['daerah', 'desa', 'kelompok', 'ppg'] as const).map(role => {
                      if (!group.roleColumns.includes(role)) {
                        return <td key={role} className="px-4 py-3 text-center text-slate-300 text-xs">--</td>
                      }
                      const toggle = getToggle(group.menu_key, role)
                      const isEnabled = toggle ? toggle.is_enabled : true
                      const rowKey = `${group.menu_key}:${role}`
                      const isSaving = savingKey === rowKey
                      return (
                        <td key={role} className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleToggle(group.menu_key, group.menu_label, role)}
                            disabled={isSaving}
                            aria-label={`${isEnabled ? 'Nonaktifkan' : 'Aktifkan'} ${group.menu_label} untuk ${roleColLabel[role]}`}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 ${
                              isEnabled ? 'bg-green-500' : 'bg-slate-300'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                                isEnabled ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
