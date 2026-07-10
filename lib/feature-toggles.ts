import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { UserProfile } from './types'

// Sistem toggle fitur per menu x jenjang role, dikelola Super Admin lewat halaman
// "Pengaturan Fitur" (app/(dashboard)/pengaturan-fitur/page.tsx). Toggle ini adalah GERBANG
// TAMBAHAN di atas hak akses dasar (lib/roles.ts) -- tidak pernah MENAMBAH akses di luar yang
// sudah diizinkan role, hanya bisa MENGURANGI (mematikan menu yang sebenarnya berhak diakses
// role tsb). Super Admin SENGAJA TIDAK terpengaruh toggle apapun (lihat isFeatureEnabled) --
// dia harus selalu bisa membuka Pengaturan Fitur ini sendiri utk mengubah/memulihkan toggle,
// jadi tidak boleh bisa mengunci dirinya sendiri keluar dari sistem.
export interface FeatureToggle {
  id: string
  menu_key: string
  menu_label: string
  role_tingkatan: 'daerah' | 'desa' | 'kelompok' | 'ppg'
  is_enabled: boolean
  updated_at: string
  updated_by: string | null
}

// Dipanggil sekali di layout.tsx (disimpan di state/context) lalu dipakai ulang oleh setiap
// halaman lewat prop/hook -- lihat useFeatureToggles() di bawah. Query ringan (satu tabel
// kecil, tidak ada join) jadi aman dipanggil per halaman juga kalau dibutuhkan independen.
export async function loadFeatureToggles(): Promise<FeatureToggle[]> {
  const { data, error } = await supabase.from('feature_toggles').select('*')
  if (error) {
    console.error('Gagal memuat feature_toggles:', error.message)
    return []
  }
  return (data as FeatureToggle[]) || []
}

// True kalau menu_key BOLEH diakses oleh role dgn tingkatan tsb. FAIL-OPEN by design: kalau
// tidak ada baris utk kombinasi menu_key+tingkatan (belum di-seed, atau tabel gagal dimuat
// krn error jaringan), dianggap AKTIF -- supaya kegagalan memuat toggle tidak pernah secara
// tidak sengaja mengunci pengguna dari fitur yang sebenarnya berhak dia akses. Super Admin
// SELALU true tanpa syarat -- toggle tidak pernah berlaku utk menu miliknya sendiri.
export function isFeatureEnabled(
  toggles: FeatureToggle[],
  menuKey: string,
  tingkatan: string | null | undefined
): boolean {
  if (!tingkatan || tingkatan === 'super_admin') return true
  const row = toggles.find(t => t.menu_key === menuKey && t.role_tingkatan === tingkatan)
  if (!row) return true
  return row.is_enabled
}

// Hook dipakai di guard render tiap halaman menu yang punya menuKey (lihat navItems di
// app/(dashboard)/layout.tsx) -- sidebar SUDAH menyembunyikan menu yang dimatikan, hook ini
// adalah lapisan kedua supaya akses langsung lewat URL (mengetik/bookmark) juga diblok.
// `checking` dibedakan dari `enabled` supaya halaman bisa menampilkan loading state sesaat
// (bukan langsung "akses ditolak" yang salah sebelum data toggle datang) -- konsisten dgn
// fail-open isFeatureEnabled: SELAMA checking=true, enabled selalu dianggap true dulu.
export function useFeatureAccess(
  user: Pick<UserProfile, 'role'> | null | undefined,
  menuKey: string
): { enabled: boolean; checking: boolean } {
  const [toggles, setToggles] = useState<FeatureToggle[]>([])
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    loadFeatureToggles().then(rows => {
      if (cancelled) return
      setToggles(rows)
      setChecking(false)
    })
    return () => { cancelled = true }
  }, [user])

  const enabled = isFeatureEnabled(toggles, menuKey, user?.role?.tingkatan)
  return { enabled, checking }
}
