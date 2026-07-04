'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Route /audit-log sudah dipindahkan ke /monitoring (digabung jadi "Monitoring & Log"
// bersama Kesehatan Sistem, Email Log, dan Sesi Aktif -- tab Audit Log tetap mengikuti
// aturan akses yang sama persis seperti sebelumnya: super_admin/daerah/desa/kelompok via
// canManageMembers, TIDAK berubah). File ini SENGAJA dipertahankan sebagai redirect
// permanen (bukan dihapus, mengikuti pola app/(dashboard)/anggota/page.tsx) supaya
// bookmark/link lama tidak 404.
export default function AuditLogRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/monitoring')
  }, [router])
  return null
}
