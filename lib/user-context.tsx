'use client'

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { supabase } from './supabase'
import { getUserProfile } from './auth'
import { UserProfile } from './types'

interface UserContextType {
  user: UserProfile | null
  loading: boolean
  onlineCount: number
  refresh: () => Promise<void>
}

const UserContext = createContext<UserContextType>({
  user: null,
  loading: true,
  onlineCount: 0,
  refresh: async () => {},
})

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [onlineCount, setOnlineCount] = useState(0)
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

  const loadUser = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const profile = await getUserProfile(session.user.id)
      if (profile) {
        const masihValid = await checkSessionMasihValid(profile)
        if (!masihValid) {
          setUser(null)
          setLoading(false)
          return
        }
      }
      setUser(profile)
    } else {
      setUser(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadUser()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const profile = await getUserProfile(session.user.id)
        if (profile) {
          const masihValid = await checkSessionMasihValid(profile)
          if (!masihValid) {
            setUser(null)
            setLoading(false)
            return
          }
        }
        setUser(profile)
      } else {
        setUser(null)
      }
      setLoading(false)
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

  // Presence tracking - aktif di semua halaman saat user login
  useEffect(() => {
    if (!user?.id) {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      setOnlineCount(0)
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
      setOnlineCount(Object.keys(state).length)
    })

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          user_id: user.id,
          nama: user.nama_lengkap,
          online_at: new Date().toISOString(),
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
    <UserContext.Provider value={{ user, loading, onlineCount, refresh: loadUser }}>
      {children}
    </UserContext.Provider>
  )
}

export const useUser = () => useContext(UserContext)
