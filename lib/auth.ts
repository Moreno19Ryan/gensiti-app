import { supabase } from './supabase'
import { UserProfile } from './types'

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .select(`
      id, email, login_username, active_session_token, nama_lengkap, no_hp, foto_url, avatar_url, is_active, desa_id, kelompok_id, role_id,
      role:roles(id, nama_role, tingkatan),
      desa:desa(id, nama_desa),
      kelompok:kelompok(id, nama_kelompok)
    `)
    .eq('id', userId)
    .single()

  if (error || !data) return null
  return data as unknown as UserProfile
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// Wrapper fetch yang otomatis menyisipkan access token sesi saat ini sebagai Bearer token.
// Dipakai untuk memanggil API route internal (mis. /api/users) yang memverifikasi identitas
// pemanggil di server sebelum menggunakan service role key.
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const session = await getSession()
  const headers = new Headers(init.headers)
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }
  return fetch(input, { ...init, headers })
}
