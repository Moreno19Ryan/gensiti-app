'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/lib/user-context'
import { signOut } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { isGenerusBiasa, canManageMembers as checkCanManageMembers, canManagePresensi as checkCanManagePresensi, isTeamIT } from '@/lib/roles'
import { loadFeatureToggles, isFeatureEnabled, FeatureToggle } from '@/lib/feature-toggles'
import GlobalSearch from '@/components/GlobalSearch'

// Ikon garis (line icon) ala mockup Claude Design -- ganti dari emoji sebelumnya.
// stroke="currentColor" supaya otomatis ikut warna teks Link (aktif/hover), tidak perlu
// di-hardcode per ikon.
function navIcon(children: ReactNode) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {children}
    </svg>
  )
}

interface NavItem {
  href: string
  label: string
  icon: ReactNode
  roles: string[]
  requiresKvs?: boolean
  // Kecuali tambahan atas requiresKvs -- SAAT INI hanya dipakai Monitoring & Log, supaya
  // Team IT (isTeamIT di lib/roles.ts) juga bisa membuka menu ini untuk tab Kesehatan Sistem,
  // walau dia bukan Ketua/Wakil Ketua/Sekretaris. Tab lain di dalam halaman (Audit Log, Sesi
  // Aktif, Perawatan Sistem) tetap mengikuti gate aslinya masing-masing di dalam halaman itu
  // sendiri -- flag ini cuma membuka pintu MENU-nya, bukan menyamaratakan semua isi di dalamnya.
  allowTeamIT?: boolean
  // Khusus menu Presensi: Ketua/Wakil Ketua, Sekretaris & Super Admin (beda dgn requiresKvs
  // yang hanya Ketua/Wakil Ketua & Super Admin, dipakai Audit Log).
  requiresPresensiAccess?: boolean
  // Menu yang tidak relevan untuk Generus biasa (bukan pengurus) — mis. Keuangan, Pengguna, Organisasi.
  // Generus biasa hanya perlu melihat Kegiatan, Pengumuman, Dokumen, Notifikasi, dan Profil sendiri.
  hideForGenerus?: boolean
  // Kunci pencocokan ke tabel feature_toggles (lib/feature-toggles.ts) -- HANYA menu yang
  // di-seed di migrasi create_feature_toggles yang punya field ini. Menu tanpa menuKey (mis.
  // Dashboard, Notifikasi, dan semua menu eksklusif Super Admin) selalu tampil, tidak pernah
  // bisa dimatikan lewat halaman "Pengaturan Fitur".
  menuKey?: string
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: navIcon(<><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" /></>), roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'] },
  // Blok "Pembina" (PPG -- Penggerak Pembina Generus) SENGAJA dikelompokkan berurutan di sini,
  // tepat setelah Dashboard -- sebelumnya 3 menu ini (Dashboard PPG, Catatan Pembinaan, Data
  // Pembina) tercecer jauh dari satu sama lain di sidebar (posisi #2, #4, #9), padahal untuk
  // PPG ini adalah workspace utamanya, dan untuk Pengurus (Daerah/Desa/Kelompok) ini adalah
  // konteks pengawasan/pembinaan yang berkaitan. Dikonfirmasi lewat audit menu pembina
  // 2026-07-17. Icon Data Pembina diganti dari 🛡️ (duplikat dgn Dashboard PPG) jadi 🪪 supaya
  // beda secara visual meski keduanya tampil berdekatan utk user PPG.
  { href: '/ppg', label: 'Dashboard PPG', icon: navIcon(<><circle cx="12" cy="8" r="5" /><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" /></>), roles: ['ppg'] },
  // Super Admin SENGAJA TIDAK termasuk -- Catatan Pembinaan murni komunikasi satu arah
  // PPG ke Pengurus organisasi, bukan urusan Super Admin sama sekali (sejak audit peran;
  // RLS 'catatan_pembinaan_all_superadmin' juga sudah dicabut total di database).
  { href: '/catatan-pembinaan', label: 'Catatan Pembinaan', icon: navIcon(<path d="M12 20l-7-7a5 5 0 1 1 7-7 5 5 0 1 1 7 7l-7 7Z" />), roles: ['daerah', 'desa', 'kelompok', 'ppg'], hideForGenerus: true, menuKey: 'catatan-pembinaan' },
  // Data Pembina -- biodata PPG (Penggerak Pembina Generus), dipisah dari Data Generus
  // karena PPG adalah pembina, bukan Generus (lihat catatan lengkap di
  // app/(dashboard)/data-pembina/page.tsx). Visibilitas sidebar sama dengan Data Generus,
  // PLUS 'ppg' sendiri supaya PPG bisa melihat/mengedit biodatanya sendiri di sini.
  { href: '/data-pembina', label: 'Data Pembina', icon: navIcon(<path d="M12 3 4 6v6c0 5 3.5 8.5 8 9.5 4.5-1 8-4.5 8-9.5V6l-8-3Z" />), roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'], hideForGenerus: true, menuKey: 'data-pembina' },
  // "Data Generus" -- akun & biodata Generus se-Bekasi Timur digabung jadi satu menu dengan
  // tab "Akun"/"Biodata" di modal edit (lihat app/(dashboard)/generus/page.tsx). Sempat dilabeli
  // "Pengguna" saat baru digabung, direname krn isinya memang database Generus (bukan cuma akun
  // login) -- URL /generus dipertahankan apa adanya, sudah cocok dgn nama barunya. Dulu biodata
  // dipisah rute sendiri ("Data Generus" versi lama) supaya data sensitif tidak otomatis
  // terlihat setiap kali mengelola akun -- sekarang cukup dipisah TAB, gate akses tetap sama
  // (canManageMembers/canViewGenerusData), dan toggle fitur 'data-generus' tetap independen
  // (lihat useFeatureAccess 'data-generus' di dalam halaman) supaya Super Admin masih bisa
  // mematikan tab Biodata per jenjang tanpa mematikan menu ini sepenuhnya.
  { href: '/generus', label: 'Data Generus', icon: navIcon(<><path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>), roles: ['super_admin', 'daerah', 'desa', 'kelompok'], hideForGenerus: true, menuKey: 'generus' },
  { href: '/kegiatan', label: 'Kegiatan', icon: navIcon(<><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></>), roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'], menuKey: 'kegiatan' },
  { href: '/absensi', label: 'Absensi', icon: navIcon(<><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></>), roles: ['super_admin', 'daerah', 'desa', 'kelompok'], hideForGenerus: true, requiresPresensiAccess: true, menuKey: 'absensi' },
  { href: '/keuangan', label: 'Keuangan', icon: navIcon(<><rect x="2.5" y="6" width="19" height="13" rx="2.5" /><path d="M2.5 10h19M6 15h4" /></>), roles: ['super_admin', 'daerah', 'desa', 'kelompok'], hideForGenerus: true, menuKey: 'keuangan' },
  { href: '/pengumuman', label: 'Pengumuman', icon: navIcon(<path d="M3 11l18-7-7 18-3-7-8-4Z" />), roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'], menuKey: 'pengumuman' },
  { href: '/dokumen', label: 'Dokumen', icon: navIcon(<><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v5h5" /></>), roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'], menuKey: 'dokumen' },
  { href: '/notifikasi', label: 'Notifikasi', icon: navIcon(<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>), roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'] },
  // "Organisasi & Role" -- gabungan Desa/Kelompok (dulu /organisasi) + Role (dulu tab di
  // menu "Administrasi Sistem" yang sudah dihapus) supaya semua master data struktural ada
  // di satu menu. Tetap eksklusif Super Admin.
  { href: '/organisasi', label: 'Organisasi & Role', icon: navIcon(<><path d="M3 21V10l9-6 9 6v11" /><path d="M9 21v-6h6v6" /></>), roles: ['super_admin'] },
  { href: '/backup-data', label: 'Backup Data', icon: navIcon(<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>), roles: ['super_admin'] },
  // "Monitoring & Log" -- gabungan Kesehatan Sistem + Sesi Aktif (dulu di menu "Administrasi
  // Sistem") + Audit Log + Email Log, jadi satu menu observability. Visibilitas TIAP TAB di
  // dalam halaman ini tetap mengikuti aturan lama masing-masing (lihat komentar di
  // app/(dashboard)/monitoring/page.tsx) -- requiresKvs di sini memastikan menu ini muncul
  // di sidebar untuk siapapun yang setidaknya berhak atas Audit Log (kriteria paling longgar
  // di antara 4 sumber gabungan), sisanya baru disaring per-tab di dalam halaman.
  { href: '/monitoring', label: 'Monitoring & Log', icon: navIcon(<path d="M4 20V10M12 20V4M20 20v-7" />), roles: ['super_admin', 'daerah', 'desa', 'kelompok'], requiresKvs: true, allowTeamIT: true, hideForGenerus: true, menuKey: 'monitoring' },
  // Pengaturan Fitur -- halaman toggle on/off menu per jenjang role, eksklusif Super Admin.
  // TIDAK punya menuKey (menu Super Admin tidak pernah bisa dimatikan lewat dirinya sendiri).
  { href: '/pengaturan-fitur', label: 'Pengaturan Fitur', icon: navIcon(<><path d="M4 6h16M4 12h10M4 18h13" /><circle cx="18" cy="6" r="1.6" /><circle cx="7" cy="12" r="1.6" /><circle cx="15" cy="18" r="1.6" /></>), roles: ['super_admin'] },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading } = useUser()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  // Mode Perawatan Sistem -- null = belum dicek (jangan render apapun dulu supaya non-SA
  // tidak sempat "mengintip" dashboard sebelum redirect). Super Admin dikecualikan total
  // (selalu diizinkan lanjut) supaya tetap bisa menonaktifkan mode ini atau menyelesaikan
  // operasi berisiko yang jadi alasan mode ini diaktifkan.
  const [maintenanceOk, setMaintenanceOk] = useState<boolean | null>(null)
  // Toggle fitur per menu x role (lib/feature-toggles.ts) -- dimuat sekali saat user siap,
  // dipakai utk menyaring visibleNav di bawah. null = belum dimuat (semua menu dianggap
  // tampil dulu, fail-open, supaya sidebar tidak "berkedip kosong" sesaat sebelum data toggle
  // datang -- lihat isFeatureEnabled yang juga fail-open kalau toggles masih []).
  const [featureToggles, setFeatureToggles] = useState<FeatureToggle[]>([])
  // Badge notifikasi belum dibaca di ikon lonceng topbar -- query count nyata dari tabel
  // notifikasi (sama sumbernya dgn halaman /notifikasi), bukan dekoratif. Refetch tiap ganti
  // route (mis. setelah user membuka /notifikasi & menandai baca) + poll ringan 30 detik.
  const [unreadNotif, setUnreadNotif] = useState(0)

  useEffect(() => {
    if (!user) return
    loadFeatureToggles().then(setFeatureToggles)
  }, [user])

  useEffect(() => {
    if (!user?.id || !user?.role?.tingkatan) return
    const tingkatanUser = user.role.tingkatan
    let cancelled = false
    const loadUnread = async () => {
      const { count } = await supabase
        .from('notifikasi')
        .select('id', { count: 'exact', head: true })
        .or(`target_role.eq.all,target_role.eq.${tingkatanUser},target_user.eq.${user.id}`)
        .eq('is_read', false)
      if (!cancelled) setUnreadNotif(count || 0)
    }
    loadUnread()
    const interval = setInterval(loadUnread, 30_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [user, pathname])

  // Baca preferensi UI tersimpan dari localStorage saat mount -- setState di sini murni
  // menyinkronkan React state dgn nilai yg sudah ada di localStorage (bukan derived state
  // dari props/state lain), jadi tidak ada risiko cascading render yg jadi target aturan ini.
  useEffect(() => {
    const savedCollapse = localStorage.getItem('gensiti_sidebar_collapsed')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (savedCollapse === 'true') setCollapsed(true)

    const savedDark = localStorage.getItem('gensiti_dark_mode')
    const isDark = savedDark === 'true'
    setDarkMode(isDark)
    if (isDark) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
  }, [])

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading, router])

  // Gerbang Mode Perawatan Sistem -- dicek sekali saat user siap, lalu polling ringan tiap
  // 15 detik (pola sama seperti checkSessionMasihValid di lib/user-context.tsx) supaya
  // pengguna yang sedang membuka aplikasi otomatis terdorong ke /maintenance begitu Super
  // Admin mengaktifkannya, tanpa perlu refresh manual. Super Admin SELALU lolos gerbang ini.
  // Sekaligus menangani JADWAL: kalau scheduled_activation_at sudah lewat tapi maintenance_mode
  // masih false, client yang sedang polling ini akan memicu UPDATE untuk mengaktifkannya --
  // tidak ada cron job di proyek ini, jadi auto-aktivasi bergantung pada client aktif (Super
  // Admin sendiri tidak memicu ini karena dia early-return duluan di atas).
  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user.role?.tingkatan === 'super_admin') { setMaintenanceOk(true); return }

    let cancelled = false
    const cekMaintenance = async () => {
      const { data } = await supabase.from('system_config').select('maintenance_mode, scheduled_activation_at, scheduled_message').eq('id', true).maybeSingle()
      if (cancelled) return

      if (data?.maintenance_mode) {
        router.replace('/maintenance')
        setMaintenanceOk(false)
        return
      }

      if (data?.scheduled_activation_at && new Date(data.scheduled_activation_at) <= new Date()) {
        // Jadwal sudah lewat -- panggil endpoint service-role untuk mengaktifkan (client
        // biasa tidak punya izin UPDATE lewat RLS system_config_update_superadmin, dan memang
        // sengaja begitu -- lihat app/api/maintenance/activate-scheduled/route.ts). Trigger
        // trg_notify_email_maintenance yang sudah ada otomatis kirim email "mode perawatan
        // aktif" ke semua user non-SA setelah baris ini ter-update.
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) {
          await fetch('/api/maintenance/activate-scheduled', {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
          }).catch(() => {})
        }
        if (cancelled) return
        router.replace('/maintenance')
        setMaintenanceOk(false)
        return
      }

      setMaintenanceOk(true)
    }
    cekMaintenance()
    const interval = setInterval(cekMaintenance, 15_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [user, router])

  // Tutup sidebar mobile tiap kali route berganti -- reaksi ke perubahan `pathname`
  // (external signal dari router), bukan derived state dari props/state React lain.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSidebarOpen(false)
  }, [pathname])

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('gensiti_sidebar_collapsed', String(next))
  }

  const toggleDarkMode = () => {
    const next = !darkMode
    setDarkMode(next)
    localStorage.setItem('gensiti_dark_mode', String(next))
    if (next) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
  }

  const handleSignOut = async () => {
    setConfirmLogout(false)
    await signOut()
    router.replace('/login')
  }

  if (loading || (user && maintenanceOk === null)) {
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
  if (maintenanceOk === false) return null

  const tingkatan = user.role?.tingkatan
  const isSuperAdmin = tingkatan === 'super_admin'
  // Audit Log hanya terlihat untuk Ketua/Wakil Ketua dan Super Admin
  const canManageMembers = checkCanManageMembers(user)
  // Presensi: menu tetap terlihat untuk Ketua/Wakil Ketua, Sekretaris, dan Super Admin --
  // canManagePresensi() sendiri kini EXCLUDE super_admin (dia read-only, sejak audit peran),
  // tapi itu hanya mengatur hak KELOLA presensi di dalam halamannya, bukan visibility menu.
  // Super Admin tetap harus bisa membuka menu untuk melihat rekap presensi.
  const canManagePresensi = checkCanManagePresensi(user) || isSuperAdmin
  const isGenerus = isGenerusBiasa(user)
  const avatarUrl = user.avatar_url || user.foto_url

  const visibleNav = navItems.filter(item => {
    if (!tingkatan || !item.roles.includes(tingkatan)) return false
    if (item.requiresKvs && !canManageMembers && !(item.allowTeamIT && isTeamIT(user))) return false
    if (item.requiresPresensiAccess && !canManagePresensi) return false
    if (item.hideForGenerus && isGenerus) return false
    if (item.menuKey && !isFeatureEnabled(featureToggles, item.menuKey, tingkatan)) return false
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

      {/* Sidebar -- ala mockup Claude Design: latar putih (bukan navy), border tipis kanan,
          item aktif jadi pil biru muda, ikon garis (bukan emoji). Profil user dipindah ke
          FOOTER (bawah nav), sesuai posisi di mockup -- sebelumnya di atas, tepat di bawah logo. */}
      <aside className={[
        'fixed top-0 left-0 h-full bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border-r border-[#ECEFF4] dark:border-slate-700 flex flex-col shadow-xl lg:shadow-none z-30 transition-all duration-300 ease-in-out overflow-hidden',
        'lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:shrink-0',
        sidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64',
        collapsed ? 'lg:w-16' : 'lg:w-60',
      ].join(' ')}>

        {/* Logo */}
        <div className="px-3 py-4 border-b border-[#ECEFF4] dark:border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#1259C3] rounded-xl flex items-center justify-center shrink-0 p-1">
              <img src="/icons/icon-512.png" alt="GENSITI" className="w-full h-full object-contain" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-black text-lg tracking-tight leading-none text-slate-800 dark:text-slate-100">GENSITI</div>
                <div className="text-[#9AA3B2] text-xs mt-0.5">Manajemen Organisasi</div>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 py-3 space-y-0.5 overflow-y-auto ${collapsed ? 'px-1.5' : 'px-3'}`}>
          {visibleNav.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined}
                className={`flex items-center rounded-xl text-sm font-medium transition-all ${collapsed ? 'justify-center w-10 h-10 mx-auto' : 'gap-3 px-3 py-2.5'} ${
                  isActive
                    ? 'bg-[#EAF1FC] text-[#1259C3] dark:bg-blue-900/40 dark:text-blue-300'
                    : 'text-[#4B5563] dark:text-slate-300 hover:bg-[#F5F7FA] dark:hover:bg-slate-700'
                }`}>
                {item.icon}
                {!collapsed && item.label}
              </Link>
            )
          })}
        </nav>

        {/* User Profile Section -- footer, ala mockup */}
        <div className="border-t border-[#ECEFF4] dark:border-slate-700 shrink-0">
          {collapsed ? (
            /* Collapsed: avatar + logout stacked */
            <div className="flex flex-col items-center gap-1 py-2">
              <Link href="/profil" title={user.nama_lengkap}
                className="w-10 h-10 rounded-full bg-[#1259C3] text-white flex items-center justify-center text-base font-bold hover:bg-blue-700 transition overflow-hidden">
                {avatarUrl
                  ? <img src={avatarUrl} alt={user.nama_lengkap} className="w-full h-full object-cover" />
                  : <span>{user.nama_lengkap?.charAt(0).toUpperCase()}</span>
                }
              </Link>
              <button onClick={() => setConfirmLogout(true)} title="Keluar"
                className="w-9 h-9 flex items-center justify-center rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          ) : (
            /* Expanded: avatar + name + role + logout */
            <div className="px-3.5 py-3.5">
              <div className="flex items-center gap-2.5">
                <Link href="/profil" title="Lihat profil"
                  className="shrink-0 w-[38px] h-[38px] rounded-full bg-[#1259C3] text-white flex items-center justify-center text-sm font-bold overflow-hidden">
                  {avatarUrl
                    ? <img src={avatarUrl} alt={user.nama_lengkap} className="w-full h-full object-cover" />
                    : <span>{user.nama_lengkap?.charAt(0).toUpperCase()}</span>
                  }
                </Link>
                <div className="flex-1 min-w-0">
                  <Link href="/profil" className="block hover:underline underline-offset-2">
                    <div className="text-[13.5px] font-bold text-slate-800 dark:text-slate-100 truncate leading-tight">{user.nama_lengkap}</div>
                  </Link>
                  <div className="text-[#9AA3B2] text-[11.5px] truncate mt-0.5 leading-tight">{user.role?.nama_role}</div>
                </div>
                <button onClick={() => setConfirmLogout(true)} title="Keluar"
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            </div>
          )}
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
            <button onClick={toggleCollapsed} title={collapsed ? 'Perlebar sidebar' : 'Kecilkan sidebar'}
              className="hidden lg:flex p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition text-slate-500 dark:text-slate-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <h1 className="font-bold text-slate-800 dark:text-slate-100 text-base lg:text-lg leading-tight">{currentLabel}</h1>
              <p className="text-slate-400 dark:text-slate-500 text-xs hidden sm:block">
                {tingkatan === 'ppg' ? 'PPG · Bekasi Timur' : user.desa ? user.desa.nama_desa : 'Tingkat Daerah'}
                {user.kelompok ? ` · ${user.kelompok.nama_kelompok}` : ''}
              </p>
            </div>
          </div>
          <div className="flex-1 flex justify-center px-4">
            <GlobalSearch />
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
            <Link href="/notifikasi" className="relative p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition text-slate-600 dark:text-slate-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
              {unreadNotif > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-600 rounded-full border border-white dark:border-slate-800" />
              )}
            </Link>
            <Link href="/profil" title="Lihat profil"
              className="ml-1 shrink-0 w-[34px] h-[34px] rounded-full bg-[#1259C3] text-white flex items-center justify-center text-[13px] font-bold overflow-hidden">
              {avatarUrl
                ? <img src={avatarUrl} alt={user.nama_lengkap} className="w-full h-full object-cover" />
                : <span>{user.nama_lengkap?.charAt(0).toUpperCase()}</span>
              }
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
