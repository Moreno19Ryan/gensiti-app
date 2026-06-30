'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/lib/user-context'
import { signOut } from '@/lib/auth'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠', roles: ['super_admin', 'daerah', 'desa', 'kelompok'] },
  { href: '/anggota', label: 'Pengguna', icon: '👥', roles: ['super_admin', 'daerah', 'desa', 'kelompok'] },
  { href: '/kegiatan', label: 'Kegiatan', icon: '📅', roles: ['super_admin', 'daerah', 'desa', 'kelompok'] },
  { href: '/keuangan', label: 'Keuangan', icon: '💰', roles: ['super_admin', 'daerah', 'desa', 'kelompok'] },
  { href: '/pengumuman', label: 'Pengumuman', icon: '📢', roles: ['super_admin', 'daerah', 'desa', 'kelompok'] },
  { href: '/dokumen', label: 'Dokumen', icon: '📁', roles: ['super_admin', 'daerah', 'desa', 'kelompok'] },
  { href: '/notifikasi', label: 'Notifikasi', icon: '🔔', roles: ['super_admin', 'daerah', 'desa', 'kelompok'] },
  { href: '/organisasi', label: 'Organisasi', icon: '🏛\uFE0F', roles: ['super_admin'] },
  { href: '/audit-log', label: 'Audit Log', icon: '📋', roles: ['super_admin', 'daerah', 'desa', 'kelompok'], requiresKvs: true },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading } = useUser()
  const [sidebarOpen, setSidebarOpen] = useState(false)   // mobile overlay
  const [collapsed, setCollapsed] = useState(false)        // desktop collapse

  // Load preferensi sidebar dari localStorage
  useEffect(() => {
    const saved = localStorage.getItem('ryza_sidebar_collapsed')
    if (saved === 'true') setCollapsed(true)
  }, [])

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading, router])

  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('ryza_sidebar_collapsed', String(next))
  }

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
  const isKvsOrAdmin = tingkatan === 'super_admin' || /Ketua|Wakil/i.test(user.role?.nama_role || '')

  const visibleNav = navItems.filter(item => {
    if (!tingkatan || !item.roles.includes(tingkatan)) return false
    if ((item as any).requiresKvs && !isKvsOrAdmin) return false
    return true
  })

  const currentLabel = visibleNav.find(n => pathname.startsWith(n.href))?.label || 'Dashboard'

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={[
        'fixed top-0 left-0 h-full bg-blue-900 text-white flex flex-col shadow-xl z-30 transition-all duration-300 ease-in-out overflow-hidden',
        'lg:static lg:translate-x-0 lg:shrink-0',
        sidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64',
        collapsed ? 'lg:w-16' : 'lg:w-60',
      ].join(' ')}>

        {/* Logo */}
        <div className="px-3 py-4 border-b border-blue-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shrink-0">
              <span className="text-blue-700 font-black text-lg">R</span>
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-black text-lg tracking-tight leading-none">RYZA</div>
                <div className="text-blue-300 text-xs mt-0.5">Manajemen Organisasi</div>
              </div>
            )}
          </div>
        </div>

        {/* User Info + Logout */}
        <div className="px-2 py-2 border-b border-blue-800 shrink-0">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1">
              <Link href="/profil" title={user.nama_lengkap}
                className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold hover:bg-blue-500 transition">
                {user.nama_lengkap?.charAt(0).toUpperCase()}
              </Link>
              <button onClick={handleSignOut} title="Keluar"
                className="w-9 h-9 flex items-center justify-center rounded-xl text-red-300 hover:bg-red-900/50 transition">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Link href="/profil" className="flex-1 flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-blue-800/70 transition min-w-0">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold shrink-0">
                  {user.nama_lengkap?.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{user.nama_lengkap}</div>
                  <div className="text-blue-300 text-xs truncate">{user.role?.nama_role}</div>
                </div>
              </Link>
              <button onClick={handleSignOut} title="Keluar"
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl text-red-300 hover:bg-red-900/50 hover:text-red-200 transition">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className={`flex-1 py-3 space-y-0.5 overflow-y-auto ${collapsed ? 'px-1.5' : 'px-3'}`}>
          {visibleNav.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined}
                className={`flex items-center rounded-xl text-sm font-medium transition-all ${collapsed ? 'justify-center w-10 h-10 mx-auto' : 'gap-3 px-3 py-2.5'} ${
                  isActive ? 'bg-white text-blue-900 shadow-sm' : 'text-blue-100 hover:bg-blue-800 hover:text-white'
                }`}>
                <span className="text-base shrink-0">{item.icon}</span>
                {!collapsed && item.label}
              </Link>
            )
          })}
        </nav>

        {/* Toggle collapse button - hanya desktop */}
        <div className="hidden lg:flex justify-center py-3 border-t border-blue-800 shrink-0">
          <button onClick={toggleCollapsed} title={collapsed ? 'Perlebar sidebar' : 'Kecilkan sidebar'}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-blue-300 hover:bg-blue-800 hover:text-white transition">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {collapsed
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />}
            </svg>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shrink-0 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-100 transition text-slate-600" aria-label="Buka menu">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <h1 className="font-bold text-slate-800 text-base lg:text-lg leading-tight">{currentLabel}</h1>
              <p className="text-slate-400 text-xs hidden sm:block">
                {user.desa ? user.desa.nama_desa : 'Tingkat Daerah'}
                {user.kelompok ? ` · ${user.kelompok.nama_kelompok}` : ''}
              </p>
            </div>
          </div>
          <Link href="/notifikasi" className="relative p-2 hover:bg-slate-100 rounded-lg transition">
            <span className="text-xl">🔔</span>
          </Link>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-3 sm:p-6 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
