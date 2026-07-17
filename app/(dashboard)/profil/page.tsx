'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { authFetch, signOut } from '@/lib/auth'
import Modal from '@/components/Modal'
import ProfilHeader from '@/components/ProfilHeader'
import type { UserIdentity } from '@supabase/supabase-js'

const APP_VERSION = '0.1.0'

interface GenerusRingkas {
  nomor_generus: string | null
}

// Dihoist ke module scope (bukan didefinisikan di dalam ProfilPage) -- komponen yg dibuat
// ulang di setiap render kehilangan identitas React-nya tiap kali (bisa memicu remount/
// kehilangan state internal), murni fungsi presentational tanpa hook/closure ke state
// ProfilPage, jadi aman dipindah tanpa mengubah perilaku sama sekali.
function ListItem({ href, icon, iconBg, iconColor, label, value, badge, disabled }: {
  href?: string
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  label: string
  value?: string
  badge?: string
  disabled?: boolean
}) {
  const inner = (
    <>
      <div className={`w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>
        {icon}
      </div>
      <span className={`flex-1 text-sm font-semibold ${disabled ? 'text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'}`}>{label}</span>
      {badge && (
        <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 dark:bg-slate-700 dark:text-slate-400 px-2 py-0.5 rounded-full">{badge}</span>
      )}
      {value && <span className="text-[13px] text-slate-400 font-semibold">{value}</span>}
      {href && !disabled && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C2C8D3" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      )}
    </>
  )
  const className = `flex items-center gap-3 px-4 py-3.5 ${disabled ? 'cursor-default' : href ? 'hover:bg-slate-50 dark:hover:bg-slate-700/50 transition' : ''}`
  if (href && !disabled) {
    return <Link href={href} className={className}>{inner}</Link>
  }
  return <div className={className}>{inner}</div>
}

// Halaman overview Profil -- gaya "Settings" mobile (kartu berisi daftar link/toggle),
// bukan lagi tab tunggal. Sub-fitur yang butuh form/edit lebih dalam (Edit Profil, Data
// Diri, Ganti Password, Riwayat Absensi, Notifikasi) dipindah ke halaman /profil/* masing-
// masing -- HANYA Akun Google, foto profil, Mode Gelap, dan Keluar Aplikasi yang tetap
// inline di sini (lihat komentar masing-masing kenapa).
export default function ProfilPage() {
  const { user, refresh } = useUser()
  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [generusData, setGenerusData] = useState<GenerusRingkas | null>(null)

  // Status akun Google -- tetap INLINE di halaman overview ini (bukan dipindah ke sub-
  // halaman) karena redirectTo di handleLinkGoogle di bawah sudah di-whitelist persis
  // "/profil" di Supabase Dashboard (Authentication -> URL Configuration). Memindahkan UI
  // ini ke /profil/edit akan butuh menambah redirect URL baru di Supabase -- dihindari
  // supaya tidak perlu config ulang manual, dan cukup diarahkan balik ke overview ini yang
  // sudah pasti kebuka.
  const [googleIdentity, setGoogleIdentity] = useState<UserIdentity | null>(null)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleMsg, setGoogleMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [unlinkConfirm, setUnlinkConfirm] = useState(false)
  const [unlinking, setUnlinking] = useState(false)

  // Mode Gelap -- state & mekanisme (localStorage key + class 'dark' di documentElement)
  // SAMA PERSIS dengan toggleDarkMode di app/(dashboard)/layout.tsx, supaya toggle dari sini
  // ATAU dari sidebar tetap konsisten satu sama lain (bukan dua sumber kebenaran terpisah).
  const [darkMode, setDarkModeState] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)

  const loadGenerus = async (userId: string) => {
    const res = await authFetch(`/api/generus?userId=${userId}`)
    const json = await res.json()
    if (json.data) setGenerusData({ nomor_generus: json.data.nomor_generus })
  }

  const loadGoogleIdentity = async () => {
    const { data } = await supabase.auth.getUserIdentities()
    setGoogleIdentity(data?.identities.find(i => i.provider === 'google') || null)
  }

  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvatarUrl(user.avatar_url || user.foto_url || null)
    if (!isSuperAdmin) loadGenerus(user.id)
    loadGoogleIdentity()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Baca preferensi Mode Gelap tersimpan saat mount -- murni sinkronisasi state dgn
  // localStorage yg sudah ada (bukan derived state), sama pola dgn layout.tsx.
  useEffect(() => {
    const saved = localStorage.getItem('gensiti_dark_mode')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDarkModeState(saved === 'true')
  }, [])

  // Baca hasil redirect setelah proses linkIdentity('google') selesai (sukses/gagal/
  // dibatalkan) -- lihat komentar sama persis di HANDOFF sebelumnya. HANYA hapus key yg
  // kita kenal sendiri dari URL, bukan pathname polos (jaga2 kalau ada 'code' PKCE yg
  // belum sempat diproses detectSessionInUrl bawaan supabase-js).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const linked = params.get('linked')
    const err = params.get('error')
    const errDesc = params.get('error_description')
    if (!linked && !err) return

    if (err) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGoogleMsg({ type: 'err', text: errDesc || 'Gagal menghubungkan akun Google.' })
    } else if (linked === 'google') {
      setGoogleMsg({ type: 'ok', text: 'Akun Google berhasil dihubungkan!' })
      loadGoogleIdentity()
    }

    params.delete('linked')
    params.delete('error')
    params.delete('error_description')
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleDarkMode = () => {
    const next = !darkMode
    setDarkModeState(next)
    localStorage.setItem('gensiti_dark_mode', String(next))
    if (next) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
  }

  const handleSignOut = async () => {
    setConfirmLogout(false)
    await signOut()
    window.location.href = '/login'
  }

  // Beroperasi di atas SESI YANG SUDAH LOGIN (user sudah masuk lewat nama+password) --
  // sama sekali tidak menyentuh /api/resolve-login atau /api/session/claim, jadi tidak
  // mengganggu alur login existing.
  const handleLinkGoogle = async () => {
    setGoogleLoading(true)
    setGoogleMsg(null)
    const { error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/profil?linked=google' },
    })
    if (error) {
      setGoogleMsg({ type: 'err', text: error.message })
      setGoogleLoading(false)
    }
  }

  // Supabase mensyaratkan user punya >=2 identity utk bisa unlink (ditolak server kalau
  // cuma 1) -- aman dipanggil kapan saja, identity email tetap ada sbg fallback login.
  const handleUnlinkGoogle = async () => {
    if (!googleIdentity) return
    setUnlinking(true)
    const { error } = await supabase.auth.unlinkIdentity(googleIdentity)
    if (error) {
      setGoogleMsg({ type: 'err', text: error.message })
    } else {
      setGoogleIdentity(null)
      setGoogleMsg({ type: 'ok', text: 'Akun Google berhasil diputuskan. Anda tetap bisa masuk pakai nama pengguna + password.' })
    }
    setUnlinking(false)
    setUnlinkConfirm(false)
  }

  const MAX_AVATAR_DIMENSION = 512
  const compressImage = (file: File): Promise<File> => new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const scale = Math.min(1, MAX_AVATAR_DIMENSION / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(file); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return }
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
        },
        'image/jpeg',
        0.82
      )
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Gagal membaca gambar')) }
    img.src = objectUrl
  })

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0]
    if (!rawFile || !user) return
    if (rawFile.size > 5 * 1024 * 1024) {
      setMsg({ type: 'err', text: 'Ukuran foto maksimal 5 MB.' })
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(rawFile.type)) {
      setMsg({ type: 'err', text: 'Format foto harus JPG, PNG, WebP, atau GIF.' })
      return
    }
    setUploadingPhoto(true)
    setMsg(null)

    let file = rawFile
    if (rawFile.type !== 'image/gif') {
      try {
        file = await compressImage(rawFile)
      } catch {
        file = rawFile
      }
    }

    const ext = file.type === 'image/gif' ? 'gif' : 'jpg'
    const filePath = `${user.id}/avatar.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('profile-photos')
      .upload(filePath, file, { upsert: true, contentType: file.type })

    if (uploadErr) {
      setMsg({ type: 'err', text: 'Gagal upload foto: ' + uploadErr.message })
      setUploadingPhoto(false)
      return
    }

    const { data: urlData } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(filePath)

    const publicUrl = urlData.publicUrl + '?t=' + Date.now()

    const res = await authFetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id, avatar_url: publicUrl }),
    })
    const json = await res.json()
    if (json.error) {
      setMsg({ type: 'err', text: 'Foto terupload tapi gagal simpan: ' + json.error })
    } else {
      setAvatarUrl(publicUrl)
      await refresh()
      setMsg({ type: 'ok', text: 'Foto profil berhasil diperbarui!' })
    }
    setUploadingPhoto(false)
  }

  if (!user) return null

  const formatDateShort = (d: string | null) => {
    if (!d) return '-'
    return new Date(d).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <ProfilHeader title="Profil Saya" backHref="/dashboard" />

      {msg && (
        <div className={`p-3 rounded-xl text-sm ${msg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {/* Kartu hero avatar -- gaya centered ala mockup */}
      <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-[20px] py-7 px-5 flex flex-col items-center text-center">
        <div className="relative mb-3.5">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Foto profil" className="w-[84px] h-[84px] rounded-full object-cover" />
          ) : (
            <div className="w-[84px] h-[84px] rounded-full bg-blue-600 text-white flex items-center justify-center font-extrabold text-[28px]">
              {user.nama_lengkap?.charAt(0).toUpperCase()}
            </div>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingPhoto}
            title="Ganti foto profil"
            className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center text-blue-600 shadow-sm disabled:opacity-60"
          >
            {uploadingPhoto ? (
              <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </button>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handlePhotoChange} />
        </div>
        <h2 className="font-extrabold text-[19px] text-slate-900 dark:text-white tracking-tight">{user.nama_lengkap}</h2>
        <div className="inline-flex items-center gap-1.5 bg-[#EAF1FC] dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-3 py-1 rounded-full text-xs font-bold mt-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 4 5v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V5l-8-3Z" />
          </svg>
          {user.role?.nama_role}
        </div>
        <p className="text-[13px] text-slate-400 mt-2.5">
          {[user.desa?.nama_desa, user.kelompok?.nama_kelompok].filter(Boolean).join(' · ') || 'Sistem GENSITI'}
          {' · '}Bergabung {formatDateShort(user.created_at)}
        </p>
      </div>

      {/* Kartu Akun */}
      <div>
        <p className="text-[12px] font-bold text-slate-400 uppercase tracking-wide px-1.5 pb-2">Akun</p>
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-[18px] divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
          <ListItem
            href="/profil/edit"
            iconBg="bg-[#EAF1FC] dark:bg-blue-900/30" iconColor="text-blue-600 dark:text-blue-400"
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}
            label="Edit Profil"
          />
          {!isSuperAdmin && (
            <ListItem
              href="/profil/data-diri"
              iconBg="bg-[#EAF1FC] dark:bg-blue-900/30" iconColor="text-blue-600 dark:text-blue-400"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M7 9h6M7 13h10M7 17h10" /></svg>}
              label="Data Diri"
            />
          )}
          <ListItem
            href="/profil/password"
            iconBg="bg-[#EAF1FC] dark:bg-blue-900/30" iconColor="text-blue-600 dark:text-blue-400"
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="10" rx="2.2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>}
            label="Ganti Password"
          />
          {/* Akun Google -- inline (bukan link), lihat komentar googleIdentity di atas */}
          <div className="px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 bg-slate-100 dark:bg-slate-700">
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.48a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3a7.14 7.14 0 0 1-10.6-3.76H1.5v3.09A12 12 0 0 0 12 24Z" />
                  <path fill="#FBBC05" d="M5.47 14.33a7.2 7.2 0 0 1 0-4.66V6.58H1.5a12 12 0 0 0 0 10.84l3.97-3.09Z" />
                  <path fill="#EA4335" d="M12 4.75c1.76 0 3.35.6 4.6 1.8l3.45-3.45C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.5 6.58l3.97 3.09A7.15 7.15 0 0 1 12 4.75Z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Akun Google</p>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  {googleIdentity ? `Terhubung -- ${googleIdentity.identity_data?.email || ''}` : 'Belum terhubung'}
                </p>
              </div>
              {googleIdentity ? (
                <button type="button" onClick={() => setUnlinkConfirm(true)} className="shrink-0 text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 px-2.5 py-1.5 rounded-lg transition">Putuskan</button>
              ) : (
                <button type="button" onClick={handleLinkGoogle} disabled={googleLoading} className="shrink-0 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300 px-2.5 py-1.5 rounded-lg transition">
                  {googleLoading ? 'Mengarahkan...' : 'Hubungkan'}
                </button>
              )}
            </div>
            {googleMsg && <p className={`text-xs mt-2 ${googleMsg.type === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>{googleMsg.text}</p>}
          </div>
          {!isSuperAdmin && generusData?.nomor_generus && (
            <ListItem
              iconBg="bg-slate-100 dark:bg-slate-700" iconColor="text-slate-500 dark:text-slate-400"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M7 9h6M7 13h10M7 17h10" /></svg>}
              label="Nomor Anggota"
              value={generusData.nomor_generus}
            />
          )}
        </div>
      </div>

      {/* Kartu Preferensi */}
      <div>
        <p className="text-[12px] font-bold text-slate-400 uppercase tracking-wide px-1.5 pb-2">Preferensi</p>
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-[18px] divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 bg-[#F0EBFB] dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" /></svg>
            </div>
            <span className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">Mode Gelap</span>
            <button
              type="button" onClick={toggleDarkMode}
              className={`shrink-0 relative w-11 h-6 rounded-full transition-colors ${darkMode ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${darkMode ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          {!isSuperAdmin && (
            <ListItem
              href="/profil/notifikasi"
              iconBg="bg-[#E9F5EC] dark:bg-green-900/30" iconColor="text-green-600 dark:text-green-400"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z" /><path d="m4 6 8 6 8-6" /></svg>}
              label="Notifikasi"
            />
          )}
          {/* Bahasa -- placeholder, belum ada fitur multi-bahasa (aplikasi ini sepenuhnya
              berbahasa Indonesia). Ditampilkan disabled dgn badge "Segera hadir" drpd
              dihilangkan total, sesuai keputusan produk. */}
          <ListItem
            iconBg="bg-slate-100 dark:bg-slate-700" iconColor="text-slate-500 dark:text-slate-400"
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z" /></svg>}
            label="Bahasa"
            value="Indonesia"
            badge="Segera hadir"
            disabled
          />
        </div>
      </div>

      {/* Kartu Tentang -- Bantuan & FAQ juga placeholder (belum ada halaman bantuan). */}
      <div>
        <p className="text-[12px] font-bold text-slate-400 uppercase tracking-wide px-1.5 pb-2">Tentang</p>
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-[18px] divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
          <ListItem
            iconBg="bg-slate-100 dark:bg-slate-700" iconColor="text-slate-500 dark:text-slate-400"
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>}
            label="Bantuan & FAQ"
            badge="Segera hadir"
            disabled
          />
          <ListItem
            iconBg="bg-slate-100 dark:bg-slate-700" iconColor="text-slate-500 dark:text-slate-400"
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V5l-8-3Z" /></svg>}
            label="Versi Aplikasi"
            value={APP_VERSION}
          />
        </div>
      </div>

      <button
        onClick={() => setConfirmLogout(true)}
        className="w-full py-3.5 rounded-2xl border-[1.5px] border-[#F4CFCB] bg-[#FEF7F6] dark:bg-red-900/10 dark:border-red-900/40 text-[#D1594F] dark:text-red-400 text-sm font-bold flex items-center justify-center gap-2 transition hover:bg-red-50 dark:hover:bg-red-900/20"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
        </svg>
        Keluar Aplikasi
      </button>

      <p className="text-center text-[12px] text-slate-400 dark:text-slate-500">
        GENSITI v{APP_VERSION} &middot; Sistem Manajemen Organisasi
      </p>

      <Modal open={unlinkConfirm} onClose={() => setUnlinkConfirm(false)} title="Putuskan Akun Google?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Yakin ingin memutuskan akun Google <strong>{googleIdentity?.identity_data?.email || ''}</strong>? Anda tetap bisa masuk pakai nama pengguna + password seperti biasa.
          </p>
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button onClick={() => setUnlinkConfirm(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
            <button onClick={handleUnlinkGoogle} disabled={unlinking}
              className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:bg-red-300 transition flex items-center justify-center gap-2">
              {unlinking ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Ya, Putuskan'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmLogout} onClose={() => setConfirmLogout(false)} title="Keluar Aplikasi?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">Kamu akan keluar dari sesi ini. Pastikan semua pekerjaan sudah tersimpan.</p>
          <div className="flex gap-3 pt-2 border-t border-slate-100 dark:border-slate-700">
            <button onClick={() => setConfirmLogout(false)} className="flex-1 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition">Batal</button>
            <button onClick={handleSignOut} className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition">Ya, Keluar</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
