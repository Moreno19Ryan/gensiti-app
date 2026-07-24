'use client'

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { supabase } from './supabase'
import { getUserProfile } from './auth'
import { UserProfile } from './types'
import { flushAntrean } from './offline-queue'

// Satu "kehadiran" presence per user -- dilacak lewat channel.track() di bawah, dipakai
// utk menghitung onlineCount (global) sekaligus onlineCountScoped (lihat di bawah).
interface PresenceMeta {
  user_id: string
  nama: string
  online_at: string
  desa_id: string | null
  kelompok_id: string | null
}

interface UserContextType {
  user: UserProfile | null
  loading: boolean
  onlineCount: number
  // Jumlah pengguna online yang di-scope ke desa/kelompok user saat ini -- sama dengan
  // onlineCount kalau user di jenjang daerah/ppg/super_admin (tidak terikat desa/kelompok
  // tertentu). Dipakai dashboard supaya Ketua Kelompok/Desa tidak melihat angka online
  // se-organisasi yang tidak actionable buat scope-nya.
  onlineCountScoped: number
  refresh: () => Promise<void>
}

const UserContext = createContext<UserContextType>({
  user: null,
  loading: true,
  onlineCount: 0,
  onlineCountScoped: 0,
  refresh: async () => {},
})

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [onlineCount, setOnlineCount] = useState(0)
  const [onlineCountScoped, setOnlineCountScoped] = useState(0)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Single-session login: setiap login lewat form (bukan reload/tab baru di browser yang
  // sama) menyimpan token acak baru ke localStorage ('gensiti_session_token') SEKALIGUS ke
  // kolom users.active_session_token (lihat app/api/session/claim & app/login/page.tsx).
  // Fungsi ini membandingkan keduanya setiap kali profil dimuat -- kalau token lokal browser
  // ini TIDAK cocok lagi dengan token di database, artinya akun sudah login di tempat lain
  // dan MENGGANTIKAN sesi ini. Sesi ini (yang lama) harus logout sendiri, TANPA menyentuh
  // token di database (supaya sesi baru yang menggantikannya tidak ikut ter-invalidasi).
  //
  // Kasus yang SENGAJA tidak memicu peringatan (supaya tidak false-positive):
  // - localToken kosong (belum pernah klaim sesi lewat form login ini, mis. akun lama yang
  //   sudah login sejak sebelum fitur ini ada, atau localStorage baru saja dibersihkan).
  // - profile.active_session_token kosong (akun belum pernah login lewat form sejak fitur
  //   ini ditambahkan -- tidak ada dasar pembanding).
  const checkSessionMasihValid = async (profile: UserProfile): Promise<boolean> => {
    const localToken = localStorage.getItem('gensiti_session_token')
    if (!localToken || !profile.active_session_token) return true
    if (localToken === profile.active_session_token) return true

    // Token tidak cocok -- sesi ini sudah digantikan sesi baru di tempat lain.
    // Tandai pesan utk ditampilkan di halaman login, lalu logout HANYA sesi ini.
    localStorage.removeItem('gensiti_session_token')
    localStorage.setItem('gensiti_session_superseded', '1')
    await supabase.auth.signOut()
    return false
  }

  // finally menjamin setLoading(false) tetap jalan walau getSession()/signOut() melempar
  // exception tak terduga (mis. localStorage diblokir browser) -- tanpa ini, gate render di
  // DashboardLayout (`if (loading) return <LoadingSpinner fullScreen />`) bisa macet selamanya
  // di spinner alih-alih cuma sekali render kosong, jauh lebih buruk dari flash yang dicegah.
  const loadUser = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const profile = await getUserProfile(session.user.id)
        if (profile) {
          const masihValid = await checkSessionMasihValid(profile)
          if (!masihValid) {
            setUser(null)
            return
          }
        }
        setUser(profile)
      } else {
        setUser(null)
      }
    } finally {
      setLoading(false)
    }
  }

  // Data-fetching on mount (bukan derived state) -- lihat catatan serupa di dashboard/page.tsx.
  // Disable per-baris supaya perilaku persis sama, tidak restrukturisasi auth flow yang kritikal.
  useEffect(() => {
    loadUser()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      try {
        if (session?.user) {
          const profile = await getUserProfile(session.user.id)
          if (profile) {
            const masihValid = await checkSessionMasihValid(profile)
            if (!masihValid) {
              setUser(null)
              return
            }
          }
          setUser(profile)
        } else {
          setUser(null)
        }
      } finally {
        setLoading(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // Polling ringan (tiap 30 detik) selama tab ini terbuka & user login, supaya sesi yang
  // "digantikan" tidak perlu menunggu reload/navigasi manual utk terdeteksi -- cukup dalam
  // waktu singkat pengguna di sesi lama akan otomatis diarahkan ke halaman login dgn pesan.
  useEffect(() => {
    if (!user?.id) return
    const interval = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      const profile = await getUserProfile(session.user.id)
      if (!profile) return
      const masihValid = await checkSessionMasihValid(profile)
      if (!masihValid) {
        setUser(null)
      }
    }, 30_000)
    return () => clearInterval(interval)
  }, [user?.id])

  // Antrean presensi offline (lib/offline-queue.ts) -- coba kuras begitu user siap (menutup
  // kemungkinan ada antrean tersisa dari sesi sebelumnya yang terputus sebelum sempat sync)
  // DAN setiap kali browser mendeteksi koneksi kembali. Sengaja digantung di sini (provider
  // tunggal di root), bukan di tiap PresensiPanel/RfidKioskInput -- supaya tidak ada beberapa
  // instance memicu flush paralel yang sama saat lebih dari satu kartu kegiatan terbuka.
  // Digerbang oleh user?.id supaya tidak pernah mencoba flush sebelum sesi login dipastikan
  // siap (kalau tidak, RPC akan ditolak dgn "Anda harus login" yang keliru dianggap penolakan
  // sementara, padahal itemnya sendiri sebenarnya valid).
  useEffect(() => {
    if (!user?.id) return
    flushAntrean()
    const handleOnline = () => flushAntrean()
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [user?.id])

  // Presence tracking - aktif di semua halaman saat user login
  useEffect(() => {
    if (!user?.id) {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOnlineCount(0)
      setOnlineCountScoped(0)
      return
    }

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase.channel('online-users', {
      config: { presence: { key: user.id } },
    })

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      // Object.values(state) bisa berisi >1 meta per key kalau user yg sama buka >1 koneksi
      // (mis. 2 tab) -- ambil meta pertama saja per key supaya tetap 1 hitungan per user,
      // sama seperti Object.keys(state).length sebelumnya.
      const users = Object.values(state).map((metas) => (metas as unknown as PresenceMeta[])[0])
      setOnlineCount(users.length)
      const scoped = user.kelompok_id
        ? users.filter((u) => u.kelompok_id === user.kelompok_id).length
        : user.desa_id
        ? users.filter((u) => u.desa_id === user.desa_id).length
        : users.length
      setOnlineCountScoped(scoped)
    })

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          user_id: user.id,
          nama: user.nama_lengkap,
          online_at: new Date().toISOString(),
          desa_id: user.desa_id,
          kelompok_id: user.kelompok_id,
        })
      }
    })

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [user?.id])

  return (
    <UserContext.Provider value={{ user, loading, onlineCount, onlineCountScoped, refresh: loadUser }}>
      {children}
    </UserContext.Provider>
  )
}

export const useUser = () => useContext(UserContext)
