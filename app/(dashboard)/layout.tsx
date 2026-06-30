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
  { href: '/organisasi', label: 'Organisasi', icon: '🏛️', roles: ['super_admin'] },
  { href: '/audit-log', label: 'Audit Log', icon: '📋', roles: ['super_admin', 'daerah', 'desa', 'kelompok'], requiresKvs: true },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading } = useUser()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)

  useEffect(() => {
    const savedCollapse = localStorage.getItem('ryza_sidebar_collapsed')
    if (savedCollapse === 'true') setCollapsed(true)

    const savedDark = localStorage.getItem('ryza_dark_mode')
    const isDark = savedDark === 'true'
    setDarkMode(isDark)
    if (isDark) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
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

  const toggleDarkMode = () => {
    const next = !darkMode
    setDarkMode(next)
    localStorage.setItem('ryza_dark_mode', String(next))
    if (next) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
  }

  const handleSignOut = async () => {
    setConfirmLogout(false)
    await signOut()
    router.replace('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500 dark:text-slate-300 font-medium">Memuat...</span>
        </div>
      </div>
    )
  }

  if (!user) return null

  const tingkatan = user.role?.tingkatan
  // Audit Log hanya terlihat untuk Ketua/Wakil Ketua dan Super Admin
  const canManageMembers = tingkatan === 'super_admin' || (
    !!user.role && user.role.nama_role.toLowerCase().includes('ketua')
  )
  const avatarUrl = user.avatar_url || user.foto_url

  const visibleNav = navItems.filter(item => {
    if (!tingkatan || !item.roles.includes(tingkatan)) return false
    if ((item as any).requiresKvs && !canManageMembers) return false
    return true
  })

  const currentLabel = visibleNav.find(n => pathname.startsWith(n.href))?.label || ''

  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-slate-900 transition-colors duration-200">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Konfirmasi Logout */}
      {confirmLogout && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">🚪</div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Keluar Aplikasi?</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Kamu akan keluar dari sesi ini. Pastikan semua pekerjaan sudah tersimpan.</p>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setConfirmLogout(false)}
                className="flex-1 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                Batal
              </button>
              <button onClick={handleSignOut}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition">
                Ya, Keluar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className={[
        'fixed top-0 left-0 h-full bg-blue-900 text-white flex flex-col shadow-xl z-30 transition-all duration-300 ease-in-out overflow-hidden',
        'lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:shrink-0',
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

        {/* User Profile Section */}
        <div className="border-b border-blue-800 shrink-0">
          {collapsed ? (
            /* Collapsed: avatar + logout stacked */
            <div className="flex flex-col items-center gap-1 py-2">
              <Link href="/profil" title={user.nama_lengkap}
                className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-base font-bold hover:bg-blue-500 transition overflow-hidden ring-2 ring-blue-700 hover:ring-blue-400">
                {avatarUrl
                  ? <img src={avatarUrl} alt={user.nama_lengkap} className="w-full h-full object-cover" />
                  : <span>{user.nama_lengkap?.charAt(0).toUpperCase()}</span>
                }
              </Link>
              <button onClick={() => setConfirmLogout(true)} title="Keluar"
                className="w-9 h-9 flex items-center justify-center rounded-xl text-red-300 hover:bg-red-900/50 transition">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          ) : (
            /* Expanded: prominent avatar + name + role + logout */
            <div className="px-3 py-3">
              <div className="flex items-center gap-3">
                {/* Avatar besar dengan ring dan link ke profil */}
                <Link href="/profil" title="Lihat profil"
                  className="shrink-0 w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-lg font-bold overflow-hidden ring-2 ring-blue-600 hover:ring-white transition">
                  {avatarUrl
                    ? <img src={avatarUrl} alt={user.nama_lengkap} className="w-full h-full object-cover" />
                    : <span>{user.nama_lengkap?.charAt(0).toUpperCase()}</span>
                  }
                </Link>
                {/* Info nama + role */}
                <div className="flex-1 min-w-0">
                  <Link href="/profil" className="block hover:underline underline-offset-2">
                    <div className="text-sm font-bold text-white truncate leading-tight">{user.nama_lengkap}</div>
                  </Link>
                  <div className="text-blue-300 text-xs truncate mt-0.5 leading-tight">{user.role?.nama_role}</div>
                </div>
                {/* Logout button */}
                <button onClick={() => setConfirmLogout(true)} title="Keluar"
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-red-300 hover:bg-red-900/50 hover:text-red-200 transition">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
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

        {/* Toggle collapse - desktop only */}
        <div className="hidden lg:flex justify-center py-3 border-t border-blue-800 shrink-0">
          <button onClick={toggleCollapsed} title={collapsed ? 'Perlebar sidebar' : 'Kecilkan sidebar'}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-white hover:bg-blue-800 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between shrink-0 sticky top-0 z-10 transition-colors duration-200">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition text-slate-600 dark:text-slate-300" aria-label="Buka menu">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <h1 className="font-bold text-slate-800 dark:text-slate-100 text-base lg:text-lg leading-tight">{currentLabel}</h1>
              <p className="text-slate-400 dark:text-slate-500 text-xs hidden sm:block">
                {user.desa ? user.desa.nama_desa : 'Tingkat Daerah'}
                {user.kelompok ? ` · ${user.kelompok.nama_kelompok}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={toggleDarkMode} title={darkMode ? 'Mode Terang' : 'Mode Gelap'}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition text-slate-600 dark:text-slate-300">
              {darkMode ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            <Link href="/notifikasi" className="relative p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition">
              <span className="text-xl">🔔</span>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-3 sm:p-6 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
