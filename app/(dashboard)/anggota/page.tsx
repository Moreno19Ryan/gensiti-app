'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Route /anggota sudah dipindahkan ke /generus (rename istilah "Anggota/Ru'yah" -> "Generus").
// File ini SENGAJA dipertahankan sebagai redirect permanen (bukan dihapus) supaya:
// 1. Bookmark/link lama yang mengarah ke /anggota tidak 404.
// 2. Tidak ada dua halaman aktif yang mengandalkan skema tabel 'anggota' yang sudah
//    di-rename total menjadi 'generus' di database -- halaman ini TIDAK melakukan query
//    apapun ke database, murni redirect di sisi client.
export default function AnggotaToGenerusRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/generus')
  }, [router])
  return null
}
