'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Halaman Data Generus sudah digabungkan jadi tab "Biodata" di menu Pengguna
// (app/(dashboard)/generus/page.tsx) -- redirect ini menjaga bookmark/link lama tetap jalan.
export default function DataGenerusPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/generus') }, [router])
  return null
}
