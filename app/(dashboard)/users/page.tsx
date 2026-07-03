'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Halaman Pengguna sudah digabungkan ke halaman Generus
export default function UsersPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/generus') }, [router])
  return null
}
