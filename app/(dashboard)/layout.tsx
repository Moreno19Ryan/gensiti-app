'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/lib/user-context'
import { signOut } from '@/lib/auth'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠', roles: ['super_admin', 'daerah', 'desa', 'kelompok'] },
  { href: '/anggota', label: 'Anggota', icon: '👥', roles: ['super_admin', 'daerah', 'desa', 'kelompok'] },
  { href: '/kegiatan', label: 'Kegiatan', icon: '📅', roles: ['super_admin', 'daerah', 'desa', 'kelompok'] },
  { href: '/keuangan', label: 'Keuangan', icon: '💰', roles: ['super_admin', 'daerah', 'desa', 'kelompok'] },
  { href: '/pengumuman', label: 'Pengumuman', icon: '📢', roles: ['super_admin', 'daerah', 'desa', 'kelompok'] },
  { href: '/notifikasi', label: 'Notifikasi', icon: '🔔', roles: ['super_admin', 'daerah', 'desa', 'kelompok'] },
  { href: '/users', label: 'Pengguna', icon: '⚙️', roles: ['super_admin'] },
  { href: '/audit-log', label: 'Audit Log', icon: '📋', roles: ['super_admin'] },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading } = useUser()

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login')
    }
  }, [user, loading, router])

  const handleSignOut = async () => {
    await signOut()
    router.replace('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500 font-medium">Memuat...</span>
        </div>
      </div>
    )
  }

  if (!user) return null

  const tingkatan = user.role?.tingkatan
  const visibleNav = navItems.filter(item => tingkatan && item.roles.includes(tingkatan))

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Sidebar */}
      <aside className="w-60 bg-blue-900 text-white flex flex-col shadow-xl shrink-0">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-blue-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shrink-0">
              <span className="text-blue-700 font-black text-lg">R</span>
            </div>
            <div>
              <div className="font-black text-lg tracking-tight leading-none">RYZA</div>
              <div className="text-blue-300 text-xs mt-0.5">Manajemen Organisasi</div>
            </div>
          </div>
        </div>

        {/* User Info */}
        <div className="px-4 py-3 border-b border-blue-800 mx-3 mt-3 rounded-xl bg-blue-800/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold shrink-0">
              {user.nama_lengkap?.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{user.nama_lengkap}</div>
              <div className="text-blue-300 text-xs truncate">{user.role?.nama_role}</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-0.5">
          {visibleNav.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-white text-blue-900 shadow-sm'
                    : 'text-blue-100 hover:bg-blue-800 hover:text-white'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="px-3 pb-4">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-300 hover:bg-red-900/50 hover:text-red-200 transition-all"
          >
            <span className="text-base">🚪</span>
            Keluar
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className="font-bold text-slate-800 text-lg capitalize">
              {visibleNav.find(n => n.href === pathname)?.label || 'Dashboard'}
            </h1>
            <p className="text-slate-400 text-xs mt-0.5">
              {user.desa ? user.desa.nama_desa : 'Tingkat Daerah'}
              {user.kelompok ? ` · ${user.kelompok.nama_kelompok}` : ''}
            </p>
          </div>
          <Link href="/notifikasi" className="relative p-2 hover:bg-slate-100 rounded-lg transition">
            <span className="text-xl">🔔</span>
          </Link>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-6 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
