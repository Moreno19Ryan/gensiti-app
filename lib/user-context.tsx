'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from './supabase'
import { getUserProfile } from './auth'
import { UserProfile } from './types'

interface UserContextType {
  user: UserProfile | null
  loading: boolean
  refresh: () => Promise<void>
}

const UserContext = createContext<UserContextType>({
  user: null,
  loading: true,
  refresh: async () => {},
})

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadUser = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const profile = await getUserProfile(session.user.id)
      setUser(profile)
    } else {
      setUser(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    // Inisialisasi: baca session dari storage
    loadUser()

    // Dengarkan perubahan auth state (login, logout, refresh token)
    // Gunakan session dari callback langsung agar tidak ada race condition
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const profile = await getUserProfile(session.user.id)
        setUser(profile)
      } else {
        setUser(null)
      }
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <UserContext.Provider value={{ user, loading, refresh: loadUser }}>
      {children}
    </UserContext.Provider>
  )
}

export const useUser = () => useContext(UserContext)
