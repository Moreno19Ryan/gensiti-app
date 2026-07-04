'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Route /admin-sistem sudah dipecah & dipindahkan: tab Role -> /organisasi (digabung jadi
// "Organisasi & Role"), tab Kesehatan Sistem & Sesi Aktif -> /monitoring (digabung jadi
// "Monitoring & Log" bersama Audit Log dan Email Log). File ini SENGAJA dipertahankan
// sebagai redirect permanen (bukan dihapus, mengikuti pola app/(dashboard)/anggota/page.tsx)
// supaya bookmark/link lama tidak 404. Diarahkan ke /monitoring karena itu tujuan mayoritas
// isi halaman ini (2 dari 3 tab).
export default function AdminSistemRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/monitoring')
  }, [router])
  return null
}
