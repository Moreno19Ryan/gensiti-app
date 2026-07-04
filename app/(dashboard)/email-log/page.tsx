'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Route /email-log sudah dipindahkan ke /monitoring (digabung jadi "Monitoring & Log"
// bersama Kesehatan Sistem, Audit Log, dan Sesi Aktif -- tab Email Log tetap mengikuti
// aturan akses yang sama persis seperti sebelumnya: super_admin & daerah saja, selaras RLS
// email_log_select_admin, TIDAK berubah). File ini SENGAJA dipertahankan sebagai redirect
// permanen (bukan dihapus, mengikuti pola app/(dashboard)/anggota/page.tsx) supaya
// bookmark/link lama tidak 404.
export default function EmailLogRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/monitoring')
  }, [router])
  return null
}
