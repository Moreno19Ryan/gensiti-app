'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Route /presensi diganti nama jadi /absensi (sebutan "Presensi" -> "Absensi" di seluruh UI &
// URL, sesuai permintaan pengguna). File ini SENGAJA dipertahankan sebagai redirect permanen
// (bukan dihapus, mengikuti pola app/(dashboard)/admin-sistem/page.tsx dan
// app/(dashboard)/anggota/page.tsx) supaya bookmark/notifikasi lama yang masih mengarah ke
// /presensi tidak 404. Nama teknis kode/database (canManagePresensi, submit_presensi, tabel
// absensi, dst.) TIDAK diubah -- hanya label UI & route URL yang berganti sebutan.
export default function PresensiRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/absensi')
  }, [router])
  return null
}
