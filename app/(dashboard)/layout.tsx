'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/lib/user-context'
import { signOut } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { isGenerusBiasa, canManageMembers as checkCanManageMembers, canManagePresensi as checkCanManagePresensi, isTeamIT } from '@/lib/roles'
import { loadFeatureToggles, isFeatureEnabled, FeatureToggle } from '@/lib/feature-toggles'
import { useDarkMode } from '@/lib/dark-mode'
import { useTextSize, useHighContrast } from '@/lib/accessibility'
import GlobalSearch from '@/components/GlobalSearch'
import LoadingSpinner from '@/components/LoadingSpinner'
import ToastHost from '@/components/ToastHost'
import KonfirmasiHost from '@/components/KonfirmasiHost'

interface NavItem {
  href: string
  label: string
  icon: string
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
  // Kebalikan hideForGenerus -- item yang CUMA relevan buat Generus biasa (pengurus di tingkatan
  // yang sama tidak perlu lihat ini, mereka punya menu setara sendiri). SAAT INI cuma dipakai
  // '/profil/riwayat-absensi' (lihat komentar di baris itu) -- ditambahkan bareng bottom nav
  // mobile (Tahap 2 redesain navigasi), bukan berdiri sendiri.
  showOnlyForGenerus?: boolean
  // Item bottom-nav-mobile-ONLY (Tahap 2) -- tidak pernah muncul di sidebar desktop, walau lolos
  // semua filter roles/hideForGenerus di atas. Dipakai utk item yang sengaja tidak dinaikkan ke
  // sidebar (mis. shortcut riwayat presensi Generus) supaya scope desktop dari Tahap 1 tidak
  // ikut berubah diam-diam.
  hideFromSidebar?: boolean
  // Kunci pencocokan ke tabel feature_toggles (lib/feature-toggles.ts) -- HANYA menu yang
  // di-seed di migrasi create_feature_toggles yang punya field ini. Menu tanpa menuKey (mis.
  // Dashboard, Notifikasi, dan semua menu eksklusif Super Admin) selalu tampil, tidak pernah
  // bisa dimatikan lewat halaman "Pengaturan Fitur".
  menuKey?: string
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠', roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'] },
  // Blok "Pembina" (PPG -- Penggerak Pembina Generus) SENGAJA dikelompokkan berurutan di sini,
  // tepat setelah Dashboard -- sebelumnya 3 menu ini (Dashboard PPG, Catatan Pembinaan, Data
  // Pembina) tercecer jauh dari satu sama lain di sidebar (posisi #2, #4, #9), padahal untuk
  // PPG ini adalah workspace utamanya, dan untuk Pengurus (Daerah/Desa/Kelompok) ini adalah
  // konteks pengawasan/pembinaan yang berkaitan. Dikonfirmasi lewat audit menu pembina
  // 2026-07-17. Icon Data Pembina diganti dari 🛡️ (duplikat dgn Dashboard PPG) jadi 🪪 supaya
  // beda secara visual meski keduanya tampil berdekatan utk user PPG.
  { href: '/ppg', label: 'Dashboard PPG', icon: '🛡️', roles: ['ppg'] },
  // Super Admin SENGAJA TIDAK termasuk -- Catatan Pembinaan murni komunikasi satu arah
  // PPG ke Pengurus organisasi, bukan urusan Super Admin sama sekali (sejak audit peran;
  // RLS 'catatan_pembinaan_all_superadmin' juga sudah dicabut total di database).
  { href: '/catatan-pembinaan', label: 'Catatan Pembinaan', icon: '📝', roles: ['daerah', 'desa', 'kelompok', 'ppg'], hideForGenerus: true, menuKey: 'catatan-pembinaan' },
  // Data Pembina -- biodata PPG (Penggerak Pembina Generus), dipisah dari Data Generus
  // karena PPG adalah pembina, bukan Generus (lihat catatan lengkap di
  // app/(dashboard)/data-pembina/page.tsx). Visibilitas sidebar sama dengan Data Generus,
  // PLUS 'ppg' sendiri supaya PPG bisa melihat/mengedit biodatanya sendiri di sini.
  { href: '/data-pembina', label: 'Data Pembina', icon: '🪪', roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'], hideForGenerus: true, menuKey: 'data-pembina' },
  // "Data Generus" -- akun & biodata Generus se-Bekasi Timur digabung jadi satu menu dengan
  // tab "Akun"/"Biodata" di modal edit (lihat app/(dashboard)/generus/page.tsx). Sempat dilabeli
  // "Pengguna" saat baru digabung, direname krn isinya memang database Generus (bukan cuma akun
  // login) -- URL /generus dipertahankan apa adanya, sudah cocok dgn nama barunya. Dulu biodata
  // dipisah rute sendiri ("Data Generus" versi lama) supaya data sensitif tidak otomatis
  // terlihat setiap kali mengelola akun -- sekarang cukup dipisah TAB, gate akses tetap sama
  // (canManageMembers/canViewGenerusData), dan toggle fitur 'data-generus' tetap independen
  // (lihat useFeatureAccess 'data-generus' di dalam halaman) supaya Super Admin masih bisa
  // mematikan tab Biodata per jenjang tanpa mematikan menu ini sepenuhnya.
  // 'ppg' ditambahkan ke roles (sebelumnya tidak ada) -- PPG sudah lama berhak LIHAT Data
  // Generus di backend (RLS anggota_select mengizinkan tingkatan ppg tanpa syarat, dan
  // canViewGenerusData() di lib/roles.ts eksplisit menyebut PPG boleh melihat), tapi menu ini
  // tidak pernah menyertakan 'ppg' di array roles-nya sehingga tidak pernah muncul di sidebar.
  // Ditemukan lewat audit navigasi (lihat WISHLIST_ASSESSMENT.md bagian B2).
  { href: '/generus', label: 'Data Generus', icon: '👥', roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'], hideForGenerus: true, menuKey: 'generus' },
  { href: '/kegiatan', label: 'Kegiatan', icon: '📅', roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'], menuKey: 'kegiatan' },
  { href: '/absensi', label: 'Absensi', icon: '✅', roles: ['super_admin', 'daerah', 'desa', 'kelompok'], hideForGenerus: true, requiresPresensiAccess: true, menuKey: 'absensi' },
  // Absensi (Generus) -- shortcut bottom nav mobile (Tahap 2) ke riwayat presensi milik sendiri.
  // Halaman /profil/riwayat-absensi SUDAH ADA (dulu tab "Presensi" di Profil), tapi belum pernah
  // jadi menu top-level -- cuma dinaikkan jadi shortcut di sini, BUKAN perubahan akses (dicek
  // eksplisit ke Reno sebelum dikerjakan). showOnlyForGenerus supaya pengurus di tingkatan yang
  // sama (yang juga lolos filter roles di bawah) TIDAK ikut lihat -- mereka punya /absensi
  // sendiri (baris di atas) yang beda tujuannya (kelola, bukan lihat riwayat sendiri).
  // hideFromSidebar: Tahap 2 scope-nya mobile saja, desktop dari Tahap 1 sengaja tidak diubah.
  { href: '/profil/riwayat-absensi', label: 'Absensi', icon: '✅', roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'], showOnlyForGenerus: true, hideFromSidebar: true },
  { href: '/keuangan', label: 'Keuangan', icon: '💰', roles: ['super_admin', 'daerah', 'desa', 'kelompok'], hideForGenerus: true, menuKey: 'keuangan' },
  { href: '/pengumuman', label: 'Pengumuman', icon: '📢', roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'], menuKey: 'pengumuman' },
  { href: '/dokumen', label: 'Dokumen', icon: '📁', roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'], menuKey: 'dokumen' },
  // "Berita Organisasi" -- awalnya cuma Berita LDII, digeneralisasi jadi mirror multi-sumber
  // (LDII, PERSINAS ASAD, SENKOM Mitra Polri) dengan tab pemilih di dalam halaman. Route lama
  // /berita-ldii & menuKey lama 'berita-ldii' diganti -- tidak ada baris feature_toggles yang
  // memakai key lama (dicek dulu sebelum rename), jadi aman diganti langsung tanpa migrasi data.
  { href: '/berita', label: 'Berita Organisasi', icon: '📰', roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'], menuKey: 'berita-organisasi' },
  // FAQ/Panduan -- terbuka utk semua jenjang TERMASUK Generus biasa (tidak ada hideForGenerus)
  // karena ini justru paling berguna buat mereka (cara absen, reset password, ajukan izin).
  // Dikelola Super Admin lewat tombol +Tambah/edit/hapus di halaman yang sama.
  { href: '/faq', label: 'FAQ / Panduan', icon: '❓', roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'], menuKey: 'faq' },
  { href: '/notifikasi', label: 'Notifikasi', icon: '🔔', roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'] },
  // Pengaturan -- konsolidasi preferensi tampilan/aksesibilitas aplikasi (Mode Gelap, Ukuran
  // Teks, Kontras Tinggi, Ganti Bahasa, Versi Aplikasi). Terbuka utk semua jenjang termasuk
  // Generus biasa (sama seperti Notifikasi) -- tidak ada menuKey krn ini bukan menu data
  // organisasi yang perlu bisa dimatikan Super Admin per jenjang.
  { href: '/pengaturan', label: 'Pengaturan', icon: '⚙️', roles: ['super_admin', 'daerah', 'desa', 'kelompok', 'ppg'] },
  // "Organisasi & Role" -- gabungan Desa/Kelompok (dulu /organisasi) + Role (dulu tab di
  // menu "Administrasi Sistem" yang sudah dihapus) supaya semua master data struktural ada
  // di satu menu. Tetap eksklusif Super Admin.
  { href: '/organisasi', label: 'Organisasi & Role', icon: '🏛️', roles: ['super_admin'] },
  { href: '/backup-data', label: 'Backup Data', icon: '💾', roles: ['super_admin'] },
  // "Monitoring & Log" -- gabungan Kesehatan Sistem + Sesi Aktif (dulu di menu "Administrasi
  // Sistem") + Audit Log + Email Log, jadi satu menu observability. Visibilitas TIAP TAB di
  // dalam halaman ini tetap mengikuti aturan lama masing-masing (lihat komentar di
  // app/(dashboard)/monitoring/page.tsx) -- requiresKvs di sini memastikan menu ini muncul
  // di sidebar untuk siapapun yang setidaknya berhak atas Audit Log (kriteria paling longgar
  // di antara 4 sumber gabungan), sisanya baru disaring per-tab di dalam halaman.
  { href: '/monitoring', label: 'Monitoring & Log', icon: '📊', roles: ['super_admin', 'daerah', 'desa', 'kelompok'], requiresKvs: true, allowTeamIT: true, hideForGenerus: true, menuKey: 'monitoring' },
  // Pengaturan Fitur -- halaman toggle on/off menu per jenjang role, eksklusif Super Admin.
  // TIDAK punya menuKey (menu Super Admin tidak pernah bisa dimatikan lewat dirinya sendiri).
  { href: '/pengaturan-fitur', label: 'Pengaturan Fitur', icon: '🎛️', roles: ['super_admin'] },
]

// Bottom nav mobile (Tahap 2) -- 4 menu utama per kelompok peran, sisanya masuk sheet
// "Lainnya". SENGAJA daftar manual per peran (bukan "ambil N pertama dari urutan navItems
// di atas") -- urutan navItems disusun utk alasan lain (mis. cluster PPG berurutan), belum
// tentu representasi "paling sering dipakai" per peran. Dikonfirmasi via mockup interaktif
// sebelum implementasi (redesain navigasi Opsi C, Tahap 2). Notifikasi SENGAJA tidak diberi
// slot di peran manapun -- sudah ada lonceng permanen di topbar, tidak perlu dobel-alokasikan.
const BOTTOM_NAV_GENERUS = ['/dashboard', '/kegiatan', '/profil/riwayat-absensi', '/pengumuman']
const BOTTOM_NAV_PPG = ['/dashboard', '/ppg', '/catatan-pembinaan', '/kegiatan']
const BOTTOM_NAV_PENGURUS = ['/dashboard', '/absensi', '/generus', '/keuangan']
const BOTTOM_NAV_SUPER_ADMIN = ['/dashboard', '/generus', '/keuangan', '/monitoring']

// isGenerus dicek DULU sebelum tingkatan -- Generus biasa tingkatannya bisa kelompok/desa/daerah
// (ikut struktur tempatnya terdaftar), bukan nilai tingkatan tersendiri; yang membedakan dia dari
// pengurus beneran di tingkatan yang sama adalah isGenerusBiasa(), bukan tingkatan.
function getBottomNavHrefs(tingkatan: string | undefined, isGenerus: boolean): string[] {
  if (isGenerus) return BOTTOM_NAV_GENERUS
  if (tingkatan === 'ppg') return BOTTOM_NAV_PPG
  if (tingkatan === 'super_admin') return BOTTOM_NAV_SUPER_ADMIN
  return BOTTOM_NAV_PENGURUS
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading } = useUser()
  // Sheet "Lainnya" (Tahap 2, mobile) -- menggantikan drawer hamburger lama sepenuhnya
  // (drawer & tombol hamburger-nya sudah dihapus, lihat catatan di <aside> & topbar di bawah).
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  // Tooltip hover ikon (saat collapsed) SENGAJA satu instance dibagi bareng (bukan span
  // per-item) & posisinya dihitung lewat JS, bukan murni CSS `absolute` di dalam tiap item --
  // <nav> di bawah butuh overflow-y-auto (list menu bisa panjang), dan browser MEMAKSA
  // overflow-x ikut jadi 'auto' begitu overflow-y bukan 'visible' (aturan CSS Overflow Module:
  // pasangan salah satu non-visible => yang visible dipaksa jadi auto juga) -- jadi tooltip
  // yang cuma absolute di dalam <nav> akan ikut terpotong walau <aside>-nya sendiri sudah
  // overflow-visible. Dibuktikan lewat computed style check saat testing (overflowX: 'auto'
  // padahal cuma overflow-y-auto yang ditulis). Solusinya: render tooltip di LUAR <nav> (jadi
  // ia tidak lagi kena potong), posisi dihitung dari getBoundingClientRect() item yang di-hover.
  const [hoverTip, setHoverTip] = useState<{ label: string; top: number; left: number } | null>(null)
  const [darkMode, toggleDarkMode] = useDarkMode()
  // Text size & kontras tinggi TIDAK punya toggle di topbar (kontrolnya ada di halaman
  // /pengaturan) -- tapi hook-nya tetap dipanggil di sini supaya class-nya di <html>
  // langsung diterapkan begitu dashboard mount, sama seperti Mode Gelap, terlepas dari
  // halaman mana yang pertama kali dibuka.
  useTextSize()
  useHighContrast()
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

  useEffect(() => {
    if (!user) return
    loadFeatureToggles().then(setFeatureToggles)
  }, [user])

  // Baca preferensi UI tersimpan dari localStorage saat mount -- setState di sini murni
  // menyinkronkan React state dgn nilai yg sudah ada di localStorage (bukan derived state
  // dari props/state lain), jadi tidak ada risiko cascading render yg jadi target aturan ini.
  useEffect(() => {
    const savedCollapse = localStorage.getItem('gensiti_sidebar_collapsed')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (savedCollapse === 'true') setCollapsed(true)
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

  // Tutup sheet "Lainnya" tiap kali route berganti -- reaksi ke perubahan `pathname`
  // (external signal dari router), bukan derived state dari props/state React lain.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBottomSheetOpen(false)
  }, [pathname])

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('gensiti_sidebar_collapsed', String(next))
  }

  const handleSignOut = async () => {
    setConfirmLogout(false)
    await signOut()
    router.replace('/login')
  }

  if (loading || (user && maintenanceOk === null)) {
    return <LoadingSpinner label="Sabar ya, lagi disiapin..." fullScreen />
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

  // Predikat dasar dibagi bareng sidebar desktop & bottom nav mobile (Tahap 2) supaya aturan
  // roles/toggle-fitur tidak ditulis dua kali dan berisiko ketinggalan sinkron -- satu-satunya
  // beda ANTARA dua permukaan itu adalah hideFromSidebar (lihat pemakaiannya di bawah).
  const isNavItemVisible = (item: NavItem) => {
    if (!tingkatan || !item.roles.includes(tingkatan)) return false
    if (item.requiresKvs && !canManageMembers && !(item.allowTeamIT && isTeamIT(user))) return false
    if (item.requiresPresensiAccess && !canManagePresensi) return false
    if (item.hideForGenerus && isGenerus) return false
    if (item.showOnlyForGenerus && !isGenerus) return false
    if (item.menuKey && !isFeatureEnabled(featureToggles, item.menuKey, tingkatan)) return false
    return true
  }

  const visibleNav = navItems.filter(item => isNavItemVisible(item) && !item.hideFromSidebar)
  const visibleNavMobile = navItems.filter(isNavItemVisible)

  const bottomNavHrefs = getBottomNavHrefs(tingkatan, isGenerus)
  const bottomNavItems = bottomNavHrefs
    .map(href => visibleNavMobile.find(n => n.href === href))
    .filter((n): n is NavItem => !!n)
  const lainnyaItems = visibleNavMobile.filter(n => !bottomNavHrefs.includes(n.href))

  const currentLabel = visibleNavMobile.find(n => pathname.startsWith(n.href))?.label || ''

  return (
    <div className="relative isolate flex min-h-screen bg-slate-100 dark:bg-slate-900 transition-colors duration-200">
      {/* Ambient glow -- desktop only. Sidebar di lg: jadi kaca semi-transparan (lihat className
          <aside> di bawah), tapi tanpa sesuatu di baliknya buat "diburamkan", backdrop-blur nyaris
          tidak kelihatan bedanya dari warna solid biasa (beda dari tab Berita yang float di atas
          KONTEN yang di-scroll -- sidebar ini nempel di tepi, tidak overlay apa-apa). Dua blob ini
          cuma buat ngasih sidebar "sesuatu" utk diburamkan, murni dekoratif & -z-10 (lihat `isolate`
          di atas -- bikin stacking context sendiri biar -z-10 dijamin di belakang SEMUA konten di
          sini, bukan cuma di belakang elemen tanpa position). */}
      <div className="hidden lg:block fixed -z-10 top-[-80px] left-[-100px] w-80 h-80 rounded-full bg-blue-500/20 dark:bg-blue-500/10 blur-[80px] pointer-events-none" />
      <div className="hidden lg:block fixed -z-10 bottom-[-100px] left-10 w-72 h-72 rounded-full bg-blue-400/15 dark:bg-blue-400/10 blur-[80px] pointer-events-none" />

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

      {/* Sidebar -- desktop only sejak Tahap 2 (redesain navigasi Opsi C). Drawer mobile lama
          (geser dari kiri, trigger hamburger) sudah DIHAPUS TOTAL -- digantikan bottom nav +
          sheet "Lainnya" di bawah (lihat sebelum </main>). Makanya elemen ini sekarang `hidden
          lg:flex`, tidak lagi merender apa pun di mobile sama sekali. */}
      <aside className={[
        'hidden lg:flex flex-col bg-blue-900 text-white shadow-xl z-30 transition-all duration-300 ease-in-out',
        // lg:overflow-visible -- perlu supaya tooltip hover ikon (saat collapsed) bisa "keluar"
        // ke kanan sidebar tanpa terpotong. Aman dilepas krn tidak ada child dgn background
        // solid yang nempel edge-to-edge (semua section cuma border-b/border-t, transparan)
        // yang bisa "nongol" lewat rounded corner kalau overflow tidak lagi di-hidden.
        'lg:sticky lg:top-2 lg:mb-2 lg:ml-2 lg:h-[calc(100vh-1rem)] lg:shrink-0 lg:rounded-3xl lg:overflow-visible',
        // Glass: semi-transparan + blur + saturate, border highlight tipis (ring-inset), shadow
        // lembut menggantikan shadow-xl solid bawaan -- prinsip One UI di DESIGN_BRIEF_GENSITI.md.
        'lg:bg-blue-900/75 lg:backdrop-blur-xl lg:backdrop-saturate-150 lg:ring-1 lg:ring-inset lg:ring-white/10 lg:shadow-2xl lg:shadow-blue-950/40',
        collapsed ? 'lg:w-16' : 'lg:w-60',
      ].join(' ')}>

        {/* Logo -- kotak putih dipertahankan sebagai wadah kontras karena sidebar berlatar
            biru tua (bg-blue-900); logo asli GENSITI sendiri bergradasi biru-teal jadi kurang
            terlihat kalau ditempel langsung tanpa alas putih. */}
        <div className="px-3 py-4 border-b border-blue-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shrink-0 p-1">
              <img src="/icons/icon-512.png" alt="GENSITI" className="w-full h-full object-contain" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-black text-lg tracking-tight leading-none">GENSITI</div>
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
              // Sejak <aside> jadi `hidden lg:flex` (Tahap 2, lihat catatan di atasnya), blok ini
              // TIDAK PERNAH dirender di mobile sama sekali -- kelas collapsed di bawah aman polos
              // tanpa prefix lg: (beda dari sebelumnya). aria-label (bukan title) dipakai supaya
              // tidak dobel sama tooltip custom di bawah, tapi screen reader tetap dapat nama menunya.
              <Link key={item.href} href={item.href} aria-label={collapsed ? item.label : undefined}
                onMouseEnter={e => {
                  if (!collapsed) return
                  const r = e.currentTarget.getBoundingClientRect()
                  setHoverTip({ label: item.label, top: r.top + r.height / 2, left: r.right })
                }}
                onMouseLeave={() => setHoverTip(null)}
                className={`flex items-center rounded-xl text-sm font-medium transition-all ${
                  collapsed ? 'justify-center w-10 h-10 mx-auto' : 'gap-3 px-3 py-2.5'
                } ${
                  isActive ? 'bg-white text-blue-900 shadow-sm animate-nav-pop' : 'text-blue-100 hover:bg-blue-800 hover:text-white'
                }`}>
                <span className="text-base shrink-0">{item.icon}</span>
                {!collapsed && item.label}
              </Link>
            )
          })}
        </nav>

        {/* Tooltip hover ikon collapsed -- satu instance dibagi bareng, DI LUAR <nav> di atas
            (lihat catatan di deklarasi state hoverTip kenapa tidak bisa jadi span per-item). */}
        {collapsed && hoverTip && (
          <div
            className="hidden lg:block fixed z-50 px-2.5 py-1.5 rounded-lg bg-blue-950 text-white text-xs font-semibold whitespace-nowrap pointer-events-none shadow-lg animate-fade-in"
            style={{ top: hoverTip.top, left: hoverTip.left + 12, transform: 'translateY(-50%)' }}
          >
            {hoverTip.label}
          </div>
        )}

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
            {/* Tombol hamburger lama sudah dihapus (Tahap 2) -- navigasi mobile sepenuhnya
                lewat bottom nav + sheet "Lainnya" di bawah, tidak ada lagi drawer geser. */}
            <div>
              {/* key={currentLabel} SENGAJA dipasang -- h1 ini hidup di layout.tsx yang TIDAK
                  remount antar halaman (beda dari konten via template.tsx), jadi teks di
                  dalamnya biasanya cuma "meloncat" berganti tanpa transisi apa pun begitu
                  currentLabel berubah. Mengganti key memaksa React membongkar & memasang
                  ulang elemennya tiap kali berpindah menu, sehingga animate-fade-in (sudah
                  ada, dipakai juga di backdrop Modal/Konfirmasi) otomatis terputar ulang. */}
              <h1 key={currentLabel} className="font-bold text-slate-800 dark:text-slate-100 text-base lg:text-lg leading-tight animate-fade-in">{currentLabel}</h1>
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
            <Link href="/notifikasi" className="relative p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition">
              <span className="text-xl">🔔</span>
            </Link>
          </div>
        </header>

        {/* Page Content -- pb-24 di mobile ngasih ruang supaya konten paling bawah tidak
            ketutup bottom nav yang fixed (lihat di bawah); lg: kembali ke padding biasa krn
            bottom nav cuma dirender di mobile. */}
        <div className="flex-1 p-3 pb-24 sm:p-6 lg:pb-6 overflow-auto">
          {children}
        </div>
      </main>

      {/* Bottom Nav + sheet "Lainnya" -- mobile only (Tahap 2 redesain navigasi Opsi C),
          menggantikan drawer hamburger lama SEPENUHNYA. Treatment glass SAMA PERSIS dengan
          sidebar desktop (background semi-transparan + backdrop-blur + border highlight) --
          bedanya di sini kacanya genuinely membutakan konten yang di-scroll di baliknya (bukan
          cuma background halaman polos kayak sidebar), krn bottom nav mengambang DI ATAS
          konten, bukan nempel di tepi kosong -- makanya tidak perlu ambient-glow blob buatan
          seperti punya desktop. Label SELALU tampil (tidak disembunyikan di balik hover) --
          beda sengaja dari sidebar desktop krn mobile tidak punya mouse. */}
      <nav
        className="lg:hidden fixed left-2 right-2 z-40 flex items-stretch gap-1 rounded-3xl bg-blue-900/80 backdrop-blur-xl backdrop-saturate-150 ring-1 ring-inset ring-white/10 shadow-2xl shadow-blue-950/40 px-1.5 py-1.5"
        style={{ bottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        {bottomNavItems.map(item => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
          return (
            <Link key={item.href} href={item.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-2xl text-[10px] font-semibold transition-colors ${
                isActive ? 'bg-white text-blue-900' : 'text-blue-100'
              }`}>
              <span className="text-base leading-none">{item.icon}</span>
              <span className="truncate max-w-full px-0.5">{item.label}</span>
            </Link>
          )
        })}
        <button onClick={() => setBottomSheetOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-2xl text-[10px] font-semibold text-blue-100">
          <span className="text-base leading-none">⋯</span>
          <span>Lainnya</span>
        </button>
      </nav>

      {/* Sheet "Lainnya" -- backdrop + panel, mobile only */}
      {bottomSheetOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-40 animate-fade-in" onClick={() => setBottomSheetOpen(false)} />
      )}
      <div
        className={`lg:hidden fixed left-0 right-0 bottom-0 z-[45] rounded-t-3xl bg-white/90 dark:bg-slate-800/85 backdrop-blur-xl backdrop-saturate-150 ring-1 ring-inset ring-white/40 dark:ring-white/10 shadow-2xl max-h-[75vh] flex flex-col transition-transform duration-300 ease-out ${
          bottomSheetOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="w-9 h-1 rounded-full bg-slate-300 dark:bg-slate-600 mx-auto mt-3 mb-1 shrink-0" />

        {/* Profil + Keluar -- dulu ada di header drawer lama, sekarang pindah ke sini */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
          <Link href="/profil" onClick={() => setBottomSheetOpen(false)}
            className="shrink-0 w-11 h-11 rounded-full bg-blue-600 flex items-center justify-center text-base font-bold text-white overflow-hidden ring-2 ring-blue-100 dark:ring-blue-900">
            {avatarUrl
              ? <img src={avatarUrl} alt={user.nama_lengkap} className="w-full h-full object-cover" />
              : <span>{user.nama_lengkap?.charAt(0).toUpperCase()}</span>
            }
          </Link>
          <Link href="/profil" onClick={() => setBottomSheetOpen(false)} className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{user.nama_lengkap}</div>
            <div className="text-xs text-slate-400 dark:text-slate-500 truncate">{user.role?.nama_role}</div>
          </Link>
          <button onClick={() => { setBottomSheetOpen(false); setConfirmLogout(true) }} title="Keluar"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1 p-3 overflow-y-auto">
          {lainnyaItems.map(item => (
            <Link key={item.href} href={item.href} onClick={() => setBottomSheetOpen(false)}
              className="flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl text-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition">
              <span className="text-xl leading-none">{item.icon}</span>
              <span className="text-[10.5px] font-medium leading-tight">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Dipasang sekali di sini -- semua halaman cukup memanggil toast.*() dari
          lib/toast.ts dan konfirmasi() dari lib/konfirmasi.ts, tanpa perlu provider
          atau state modal sendiri. */}
      <ToastHost />
      <KonfirmasiHost />
    </div>
  )
}
