'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Halaman Data Generus (biodata) sudah digabungkan jadi tab "Biodata" di menu Data Generus
// (app/(dashboard)/generus/page.tsx, satu halaman akun+biodata) -- redirect ini menjaga
// bookmark/link lama tetap jalan.
export default function DataGenerusPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/generus') }, [router])
  return null
}
