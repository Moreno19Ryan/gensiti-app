'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Halaman Pengguna sudah digabungkan ke halaman Anggota
export default function UsersPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/anggota') }, [router])
  return null
}
