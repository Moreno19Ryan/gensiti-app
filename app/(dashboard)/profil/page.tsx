'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/auth'
import { Absensi, EmailPreferensi } from '@/lib/types'
import { getPushPermission, getExistingPushSubscription, subscribeToPush, unsubscribeFromPush } from '@/lib/push'

interface GenerusRecord {
  id: string
  nomor_generus: string | null
  tempat_lahir: string | null
  tanggal_lahir: string | null
  jenis_kelamin: string | null
  alamat: string | null
  status: string | null
  nama_ayah: string | null
  nama_ibu: string | null
  nama_wali: string | null
  no_hp_orangtua_wali: string | null
  anak_ke: number | null
  jumlah_saudara: number | null
}

export default function ProfilPage() {
  const { user, refresh } = useUser()
  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'

  const [tab, setTab] = useState<'akun' | 'datadiri' | 'presensi' | 'notifikasi' | 'password'>('akun')
  const [form, setForm] = useState({ nama_lengkap: '', no_hp: '' })
  const [diriForm, setDiriForm] = useState({
    tempat_lahir: '', tanggal_lahir: '', jenis_kelamin: '',
    alamat: '', anak_ke: '', jumlah_saudara: '',
    nama_ayah: '', nama_ibu: '', nama_wali: '', no_hp_orangtua_wali: '',
  })
  const [pwForm, setPwForm] = useState({ lama: '', baru: '', konfirmasi: '' })
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [generusData, setGenerusData] = useState<GenerusRecord | null>(null)
  const [riwayatPresensi, setRiwayatPresensi] = useState<Absensi[]>([])
  const [loadingRiwayat, setLoadingRiwayat] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Preferensi notifikasi email -- default semua true kalau baris di email_preferensi
  // belum ada (belum pernah diubah user), sesuai desain tabel di database.
  const [notifPref, setNotifPref] = useState({ pengumuman: true, kegiatan: true, reminder: true, approval_ppg: true })
  const [savingNotif, setSavingNotif] = useState(false)

  // Status notifikasi push HP/desktop -- terpisah dari preferensi email di atas. 'unsupported'
  // = browser/perangkat tidak mendukung Web Push (mis. Safari lama, browser dalam WebView).
  const [pushActive, setPushActive] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [pushLoading, setPushLoading] = useState(false)
  const [pushMsg, setPushMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const loadGenerus = async (userId: string) => {
    const res = await authFetch(`/api/generus?userId=${userId}`)
    const json = await res.json()
    if (json.data) {
      const data = json.data as GenerusRecord
      setGenerusData(data)
      setDiriForm({
        tempat_lahir: data.tempat_lahir || '',
        tanggal_lahir: data.tanggal_lahir || '',
        jenis_kelamin: data.jenis_kelamin || '',
        alamat: data.alamat || '',
        anak_ke: data.anak_ke?.toString() || '',
        jumlah_saudara: data.jumlah_saudara?.toString() || '',
        nama_ayah: data.nama_ayah || '',
        nama_ibu: data.nama_ibu || '',
        nama_wali: data.nama_wali || '',
        no_hp_orangtua_wali: data.no_hp_orangtua_wali || '',
      })
    }
  }

  const loadNotifPref = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('email_preferensi')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (data) {
      const p = data as EmailPreferensi
      setNotifPref({
        pengumuman: p.pengumuman,
        kegiatan: p.kegiatan,
        reminder: p.reminder,
        approval_ppg: p.approval_ppg,
      })
    }
    // Kalau belum ada baris, biarkan default true (state awal) -- baris baru dibuat
    // saat user pertama kali menyimpan preferensi (lihat saveNotifPref).
  }, [])

  const loadRiwayatPresensi = useCallback(async (userId: string) => {
    setLoadingRiwayat(true)
    const { data: generus } = await supabase.from('generus').select('id').eq('user_id', userId).maybeSingle()
    if (!generus) {
      setRiwayatPresensi([])
      setLoadingRiwayat(false)
      return
    }
    const { data } = await supabase
      .from('absensi')
      .select('*, kegiatan:kegiatan_id(id, nama_kegiatan)')
      .eq('generus_id', generus.id)
      .order('waktu_absen', { ascending: false })
    setRiwayatPresensi((data as Absensi[]) || [])
    setLoadingRiwayat(false)
  }, [])

  useEffect(() => {
    if (!user) return
    setForm({ nama_lengkap: user.nama_lengkap || '', no_hp: user.no_hp || '' })
    const url = user.avatar_url || user.foto_url || null
    setAvatarUrl(url)

    if (!isSuperAdmin) {
      loadGenerus(user.id)
      loadRiwayatPresensi(user.id)
      // Tab & preferensi notifikasi disembunyikan untuk Super Admin (tidak relevan --
      // lihat komentar di const tabs), jadi tidak perlu di-load untuknya sama sekali.
      loadNotifPref(user.id)
    }
  }, [user])

  // Cek status izin & subscription push HP/desktop saat halaman dibuka -- supaya toggle
  // di tab Notifikasi langsung mencerminkan kondisi device ini (bukan device lain milik
  // user yang sama, karena subscription bersifat per-device/per-browser).
  useEffect(() => {
    setPushPermission(getPushPermission())
    getExistingPushSubscription().then((sub) => setPushActive(!!sub))
  }, [])

  const handleTogglePush = async () => {
    if (!user) return
    setPushLoading(true)
    setPushMsg(null)
    try {
      if (pushActive) {
        const err = await unsubscribeFromPush()
        if (err) { setPushMsg({ type: 'err', text: err }); return }
        setPushActive(false)
        setPushMsg({ type: 'ok', text: 'Notifikasi push dinonaktifkan di perangkat ini.' })
      } else {
        const err = await subscribeToPush(user.id)
        if (err) { setPushMsg({ type: 'err', text: err }); return }
        setPushActive(true)
        setPushPermission(getPushPermission())
        setPushMsg({ type: 'ok', text: 'Notifikasi push aktif! Anda akan menerima notifikasi walau aplikasi tertutup.' })
      }
    } finally {
      setPushLoading(false)
    }
  }

  const saveAkun = async () => {
    if (!user) return
    setSaving(true)
    setMsg(null)
    try {
      const body: Record<string, unknown> = { id: user.id, no_hp: form.no_hp }
      if (!isSuperAdmin) body.nama_lengkap = form.nama_lengkap
      const res = await authFetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.error) {
        setMsg({ type: 'err', text: json.error })
      } else {
        await refresh()
        setMsg({ type: 'ok', text: 'Profil berhasil diperbarui!' })
      }
    } catch (e) {
      setMsg({ type: 'err', text: String(e) })
    } finally {
      setSaving(false)
    }
  }

  const saveDataDiri = async () => {
    if (!user) return
    setSaving(true)
    setMsg(null)
    try {
      // Dipindah ke /api/generus (biodata murni) -- lihat app/api/generus/route.ts.
      // nama_lengkap TIDAK perlu dikirim lagi di sini karena endpoint ini sekarang
      // tidak lagi menyentuh field akun sama sekali.
      const res = await authFetch('/api/generus', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          tempat_lahir: diriForm.tempat_lahir.toUpperCase(),
          tanggal_lahir: diriForm.tanggal_lahir || null,
          jenis_kelamin: diriForm.jenis_kelamin,
          alamat: diriForm.alamat.toUpperCase(),
          anak_ke: diriForm.anak_ke ? parseInt(diriForm.anak_ke) : null,
          jumlah_saudara: diriForm.jumlah_saudara ? parseInt(diriForm.jumlah_saudara) : null,
          nama_ayah: diriForm.nama_ayah.toUpperCase(),
          nama_ibu: diriForm.nama_ibu.toUpperCase(),
          nama_wali: diriForm.nama_wali ? diriForm.nama_wali.toUpperCase() : null,
          no_hp_orangtua_wali: diriForm.no_hp_orangtua_wali,
        }),
      })
      const json = await res.json()
      if (json.error) {
        setMsg({ type: 'err', text: json.error })
      } else {
        setMsg({ type: 'ok', text: 'Data diri berhasil diperbarui!' })
        await loadGenerus(user.id)
      }
    } catch (e) {
      setMsg({ type: 'err', text: String(e) })
    } finally {
      setSaving(false)
    }
  }

  const savePassword = async () => {
    if (!user) return
    if (!pwForm.lama) { setMsg({ type: 'err', text: 'Password lama wajib diisi' }); return }
    if (!pwForm.baru) { setMsg({ type: 'err', text: 'Password baru wajib diisi' }); return }
    const pwValid = /^[A-Za-z0-9]{6,}$/.test(pwForm.baru)
    const hasUpper = /[A-Z]/.test(pwForm.baru)
    if (!pwValid) { setMsg({ type: 'err', text: 'Password hanya boleh huruf dan angka, tanpa spasi atau simbol, min. 6 karakter' }); return }
    if (!hasUpper) { setMsg({ type: 'err', text: 'Password wajib mengandung minimal 1 huruf kapital' }); return }
    if (pwForm.baru !== pwForm.konfirmasi) { setMsg({ type: 'err', text: 'Konfirmasi password tidak cocok' }); return }

    setSaving(true)
    setMsg(null)
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: pwForm.lama,
    })
    if (verifyErr) {
      setMsg({ type: 'err', text: 'Password lama salah. Silakan periksa kembali.' })
      setSaving(false)
      return
    }
    const { error } = await supabase.auth.updateUser({ password: pwForm.baru })
    if (error) {
      setMsg({ type: 'err', text: error.message })
    } else {
      setMsg({ type: 'ok', text: 'Password berhasil diubah!' })
      setPwForm({ lama: '', baru: '', konfirmasi: '' })
    }
    setSaving(false)
  }

  const saveNotifPref = async () => {
    if (!user) return
    setSavingNotif(true)
    setMsg(null)
    try {
      // Upsert: kalau baris belum ada (user belum pernah simpan preferensi), insert baru.
      // RLS email_preferensi_insert_own/update_own sudah menjamin user hanya bisa
      // insert/update baris miliknya sendiri (user_id = auth.uid()).
      const { error } = await supabase.from('email_preferensi').upsert({
        user_id: user.id,
        pengumuman: notifPref.pengumuman,
        kegiatan: notifPref.kegiatan,
        reminder: notifPref.reminder,
        approval_ppg: notifPref.approval_ppg,
        updated_at: new Date().toISOString(),
      })
      if (error) {
        setMsg({ type: 'err', text: 'Gagal menyimpan preferensi: ' + error.message })
      } else {
        setMsg({ type: 'ok', text: 'Preferensi notifikasi berhasil disimpan!' })
      }
    } catch (e) {
      setMsg({ type: 'err', text: String(e) })
    } finally {
      setSavingNotif(false)
    }
  }

  // Kompresi + resize foto profil di browser sebelum upload -- avatar tidak pernah perlu
  // resolusi tinggi (ditampilkan maks. ~56px di sidebar, sedikit lebih besar di halaman ini),
  // jadi foto kamera HP 4-5 MB bisa dipangkas jadi puluhan KB tanpa terlihat bedanya.
  // GIF SENGAJA DIKECUALIKAN -- canvas hanya menangkap frame pertama, jadi animasi akan hilang
  // kalau ikut dikompresi. GIF tetap diupload apa adanya (masih tunduk limit 5 MB di atas).
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
        // Kompresi gagal (mis. format tidak didukung canvas) -- lanjut upload file asli
        // daripada memblokir user sepenuhnya, karena file asli sudah lolos validasi di atas.
        file = rawFile
      }
    }

    // Nama file avatar SELALU tetap (avatar.jpg atau avatar.gif), bukan ikut ekstensi asli
    // upload -- karena kompresi bisa mengubah format (mis. .png -> .jpg). Kalau path berubah
    // setiap upload, file lama tidak pernah tertimpa oleh {upsert:true} dan menumpuk di storage,
    // bertentangan dengan tujuan hemat kuota dari kompresi ini sendiri.
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

    // Simpan ke DB via API (service role, bypass RLS)
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

  const formatDate = (d: string | null) => {
    if (!d) return '-'
    return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  }

  if (!user) return null

  const tabs = [
    { key: 'akun' as const, label: 'Akun' },
    ...(!isSuperAdmin ? [{ key: 'datadiri' as const, label: 'Data Diri' }] : []),
    ...(!isSuperAdmin ? [{ key: 'presensi' as const, label: 'Riwayat Presensi' }] : []),
    // Tab Notifikasi disembunyikan untuk Super Admin -- keempat jenis notifikasi yang ada
    // (pengumuman, kegiatan, reminder, approval_ppg) semuanya murni notifikasi konten
    // organisasi yang tidak relevan untuknya sebagai pengelola sistem, bukan pengurus
    // organisasi (sejak audit peran Super Admin).
    ...(!isSuperAdmin ? [{ key: 'notifikasi' as const, label: 'Notifikasi' }] : []),
    { key: 'password' as const, label: 'Password' },
  ]

  const notifOptions: { key: keyof typeof notifPref; label: string; desc: string }[] = [
    { key: 'pengumuman', label: 'Pengumuman Baru', desc: 'Email saat ada pengumuman baru yang relevan untuk Anda.' },
    { key: 'kegiatan', label: 'Kegiatan Baru/Diubah', desc: 'Email saat ada kegiatan baru atau perubahan jadwal/lokasi.' },
    { key: 'reminder', label: 'Reminder H-1 Kegiatan', desc: 'Pengingat email sehari sebelum kegiatan berlangsung.' },
    { key: 'approval_ppg', label: 'Approval PPG', desc: 'Email saat kegiatan/pengumuman Anda disetujui atau ditolak PPG.' },
  ]

  return (
    <div className="max-w-2xl space-y-6">
      {/* Avatar + Info */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700">
        <div className="flex items-center gap-5">
          <div className="relative shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Foto profil"
                className="w-16 h-16 rounded-2xl object-cover border-2 border-slate-100" />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center text-white text-2xl font-black">
                {user.nama_lengkap?.charAt(0).toUpperCase()}
              </div>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              title="Ganti foto profil"
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center justify-center shadow-md transition disabled:opacity-60"
            >
              {uploadingPhoto ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handlePhotoChange}
            />
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white">{user.nama_lengkap}</h2>
            <p className="text-slate-500 text-sm">{user.email}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                {user.role?.nama_role}
              </span>
              {user.desa && (
                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-xs">
                  {user.desa.nama_desa}
                </span>
              )}
              {user.kelompok && (
                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-xs">
                  {user.kelompok.nama_kelompok}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">Klik ikon kamera untuk ganti foto (maks. 5 MB)</p>
          </div>
        </div>

        {/* Data Generus ringkas - hanya non-super admin */}
        {!isSuperAdmin && generusData && (
          <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-700 grid grid-cols-2 gap-3">
            {[
              { label: 'No. Generus', val: generusData.nomor_generus },
              { label: 'Bergabung Sejak', val: formatDate(user.created_at) },
              { label: 'Status Akun', val: user.is_active ? 'Aktif' : 'Non-aktif' },
              { label: 'Status Generus', val: generusData.status?.toUpperCase() },
              { label: 'Jenis Kelamin', val: generusData.jenis_kelamin?.toUpperCase() },
            ].filter(x => x.val).map(({ label, val }) => (
              <div key={label}>
                <p className="text-xs text-slate-400">{label}</p>
                <p className="text-sm text-slate-700 dark:text-slate-200">{val}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tabs Edit */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
        <div className="flex border-b border-slate-100 dark:border-slate-700">
          {tabs.map(({ key, label }) => (
            <button key={key} onClick={() => { setTab(key); setMsg(null) }}
              className={`flex-1 py-3 text-sm font-medium transition -mb-px border-b-2 ${tab === key ? 'text-blue-600 border-blue-600 bg-blue-50' : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {msg && (
            <div className={`mb-4 p-3 rounded-xl text-sm ${msg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
              {msg.text}
            </div>
          )}

          {tab === 'akun' && (
            <div className="space-y-4">
              {/* Nama hanya bisa diubah oleh non-super admin */}
              {!isSuperAdmin && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nama Lengkap</label>
                  <input value={form.nama_lengkap} onChange={e => setForm(f => ({ ...f, nama_lengkap: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nama Pengguna (untuk login)</label>
                <input value={user.login_username || '-'} disabled
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-sm text-slate-400 cursor-not-allowed" />
                <p className="text-xs text-slate-400 mt-1">Dipakai untuk masuk ke aplikasi, bukan email</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">No. HP</label>
                <input value={form.no_hp} onChange={e => setForm(f => ({ ...f, no_hp: e.target.value }))}
                  placeholder="08xx-xxxx-xxxx"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input value={user.email} disabled
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-sm text-slate-400 cursor-not-allowed" />
                <p className="text-xs text-slate-400 mt-1">Untuk notifikasi sistem, tidak dapat diubah</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Bergabung Sejak</label>
                <input
                  value={user.created_at ? new Date(user.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'}
                  disabled
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-sm text-slate-400 cursor-not-allowed" />
              </div>
              <button onClick={saveAkun} disabled={saving}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
                {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          )}

          {tab === 'datadiri' && !isSuperAdmin && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 bg-blue-50 p-3 rounded-xl border border-blue-100">
                Data diri Anda. Perubahan akan tersimpan ke profil Generus.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tempat Lahir *</label>
                  <input value={diriForm.tempat_lahir}
                    onChange={e => setDiriForm(f => ({ ...f, tempat_lahir: e.target.value.toUpperCase() }))}
                    placeholder="BEKASI"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal Lahir *</label>
                  <input type="date" value={diriForm.tanggal_lahir}
                    onChange={e => setDiriForm(f => ({ ...f, tanggal_lahir: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Jenis Kelamin *</label>
                <select value={diriForm.jenis_kelamin}
                  onChange={e => setDiriForm(f => ({ ...f, jenis_kelamin: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Pilih jenis kelamin</option>
                  <option value="laki-laki">Laki-laki</option>
                  <option value="perempuan">Perempuan</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Alamat *</label>
                <textarea value={diriForm.alamat}
                  onChange={e => setDiriForm(f => ({ ...f, alamat: e.target.value.toUpperCase() }))}
                  rows={2} placeholder="ALAMAT LENGKAP"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none uppercase" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Anak Ke-</label>
                  <input type="number" min={1} value={diriForm.anak_ke}
                    onChange={e => setDiriForm(f => ({ ...f, anak_ke: e.target.value }))}
                    placeholder="1"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Dari ... Bersaudara</label>
                  <input type="number" min={1} value={diriForm.jumlah_saudara}
                    onChange={e => setDiriForm(f => ({ ...f, jumlah_saudara: e.target.value }))}
                    placeholder="3"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="border-t border-slate-100 pt-3 space-y-3">
                <p className="text-xs font-medium text-slate-500">Data Orang Tua / Wali</p>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nama Ayah Kandung *</label>
                  <input value={diriForm.nama_ayah}
                    onChange={e => setDiriForm(f => ({ ...f, nama_ayah: e.target.value.toUpperCase() }))}
                    placeholder="NAMA AYAH KANDUNG"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nama Ibu Kandung *</label>
                  <input value={diriForm.nama_ibu}
                    onChange={e => setDiriForm(f => ({ ...f, nama_ibu: e.target.value.toUpperCase() }))}
                    placeholder="NAMA IBU KANDUNG"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nama Wali (opsional)</label>
                  <input value={diriForm.nama_wali}
                    onChange={e => setDiriForm(f => ({ ...f, nama_wali: e.target.value.toUpperCase() }))}
                    placeholder="NAMA WALI (jika ada)"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">No. HP Orang Tua / Wali *</label>
                  <input value={diriForm.no_hp_orangtua_wali}
                    onChange={e => setDiriForm(f => ({ ...f, no_hp_orangtua_wali: e.target.value }))}
                    placeholder="08xx-xxxx-xxxx"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <button onClick={saveDataDiri} disabled={saving}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition">
                {saving ? 'Menyimpan...' : 'Simpan Data Diri'}
              </button>
            </div>
          )}

          {tab === 'presensi' && !isSuperAdmin && (
            <div className="space-y-3">
              {loadingRiwayat ? (
                <div className="text-center py-8 text-slate-400">
                  <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                </div>
              ) : riwayatPresensi.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <p className="text-sm">Belum ada riwayat presensi</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {riwayatPresensi.map(r => {
                    const badge: Record<string, string> = {
                      hadir: 'bg-green-100 text-green-700',
                      tidak_hadir: 'bg-red-100 text-red-600',
                      izin: 'bg-amber-100 text-amber-700',
                      sakit: 'bg-purple-100 text-purple-700',
                    }
                    const label: Record<string, string> = {
                      hadir: 'Hadir', tidak_hadir: 'Tidak Hadir', izin: 'Izin', sakit: 'Sakit',
                    }
                    return (
                      <div key={r.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{r.kegiatan?.nama_kegiatan || 'Kegiatan'}</p>
                          <p className="text-xs text-slate-400">{r.waktu_absen ? new Date(r.waktu_absen).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</p>
                        </div>
                        {r.status && (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${badge[r.status]}`}>{label[r.status]}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'notifikasi' && (
            <div className="space-y-4">
              {/* Notifikasi push HP/desktop -- terpisah dari preferensi email di bawah.
                  Berlaku PER PERANGKAT (subscription disimpan per browser/device), jadi
                  status toggle ini hanya mencerminkan perangkat yang sedang dipakai. */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">Notifikasi Push di Perangkat Ini</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {pushPermission === 'unsupported'
                        ? 'Perangkat/browser ini tidak mendukung notifikasi push.'
                        : pushPermission === 'denied'
                        ? 'Izin notifikasi diblokir -- aktifkan lewat pengaturan browser/HP.'
                        : 'Dapatkan notifikasi langsung ke HP/desktop walau GENSITI sedang tertutup.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={pushPermission === 'unsupported' || pushPermission === 'denied' || pushLoading}
                    onClick={handleTogglePush}
                    className={`shrink-0 relative w-11 h-6 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${pushActive ? 'bg-blue-600' : 'bg-slate-200'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${pushActive ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
                {pushMsg && (
                  <p className={`text-xs ${pushMsg.type === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>{pushMsg.text}</p>
                )}
              </div>

              <p className="text-xs text-slate-500 bg-blue-50 p-3 rounded-xl border border-blue-100">
                Atur jenis notifikasi email yang ingin Anda terima dari GENSITI. Perubahan berlaku untuk pengiriman email berikutnya.
              </p>
              <div className="divide-y divide-slate-100">
                {notifOptions.map(({ key, label, desc }) => (
                  <label key={key} className="flex items-center justify-between gap-4 py-3.5 cursor-pointer">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700">{label}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNotifPref(p => ({ ...p, [key]: !p[key] }))}
                      className={`shrink-0 relative w-11 h-6 rounded-full transition-colors ${notifPref[key] ? 'bg-blue-600' : 'bg-slate-200'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notifPref[key] ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </label>
                ))}
              </div>
              <button onClick={saveNotifPref} disabled={savingNotif}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition">
                {savingNotif ? 'Menyimpan...' : 'Simpan Preferensi'}
              </button>
            </div>
          )}

          {tab === 'password' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Password Lama *</label>
                <input type="password" value={pwForm.lama} onChange={e => setPwForm(f => ({ ...f, lama: e.target.value }))}
                  placeholder="Masukkan password saat ini"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Password Baru *</label>
                <input type="password" value={pwForm.baru} onChange={e => setPwForm(f => ({ ...f, baru: e.target.value }))}
                  placeholder="Min. 6 karakter, huruf kapital, hanya huruf & angka"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Konfirmasi Password Baru *</label>
                <input type="password" value={pwForm.konfirmasi} onChange={e => setPwForm(f => ({ ...f, konfirmasi: e.target.value }))}
                  placeholder="Ulangi password baru"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <button onClick={savePassword} disabled={saving}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
                {saving ? 'Memverifikasi...' : 'Ubah Password'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
