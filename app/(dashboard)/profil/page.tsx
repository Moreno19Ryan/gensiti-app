'use client'

import { useState, useEffect, useRef } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'

interface AnggotaRecord {
  id: string
  nomor_anggota: string | null
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
  const [tab, setTab] = useState<'profil' | 'datadiri' | 'password'>('profil')
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
  const [anggotaData, setAnggotaData] = useState<AnggotaRecord | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return
    setForm({ nama_lengkap: user.nama_lengkap || '', no_hp: user.no_hp || '' })
    setAvatarUrl((user as any).avatar_url || null)

    supabase
      .from('anggota')
      .select('id, nomor_anggota, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, status, nama_ayah, nama_ibu, nama_wali, no_hp_orangtua_wali, nama_orang_tua, anak_ke, jumlah_saudara')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setAnggotaData(data as AnggotaRecord)
          setDiriForm({
            tempat_lahir: data.tempat_lahir || '',
            tanggal_lahir: data.tanggal_lahir || '',
            jenis_kelamin: data.jenis_kelamin || '',
            alamat: data.alamat || '',
            anak_ke: data.anak_ke?.toString() || '',
            jumlah_saudara: data.jumlah_saudara?.toString() || '',
            nama_ayah: data.nama_ayah || (data as any).nama_orang_tua || '',
            nama_ibu: data.nama_ibu || '',
            nama_wali: data.nama_wali || '',
            no_hp_orangtua_wali: data.no_hp_orangtua_wali || '',
          })
        }
      })
  }, [user])

  const saveProfile = async () => {
    if (!user) return
    setSaving(true)
    setMsg(null)
    const { error } = await supabase.from('users').update({
      nama_lengkap: form.nama_lengkap,
      no_hp: form.no_hp,
    }).eq('id', user.id)

    if (error) {
      setMsg({ type: 'err', text: error.message })
    } else {
      await refresh()
      setMsg({ type: 'ok', text: 'Profil berhasil diperbarui!' })
    }
    setSaving(false)
  }

  const saveDataDiri = async () => {
    if (!user) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user.id,
          anggota_id: anggotaData?.id,
          nama_lengkap: user.nama_lengkap,
          tempat_lahir: diriForm.tempat_lahir.toUpperCase(),
          tanggal_lahir: diriForm.tanggal_lahir || null,
          jenis_kelamin: diriForm.jenis_kelamin.toUpperCase(),
          alamat: diriForm.alamat.toUpperCase(),
          anak_ke: diriForm.anak_ke ? parseInt(diriForm.anak_ke) : null,
          jumlah_saudara: diriForm.jumlah_saudara ? parseInt(diriForm.jumlah_saudara) : null,
          nama_ayah: diriForm.nama_ayah.toUpperCase(),
          nama_ibu: diriForm.nama_ibu.toUpperCase(),
          nama_wali: diriForm.nama_wali.toUpperCase() || null,
          no_hp_orangtua_wali: diriForm.no_hp_orangtua_wali,
        }),
      })
      const json = await res.json()
      if (json.error) {
        setMsg({ type: 'err', text: json.error })
      } else {
        setMsg({ type: 'ok', text: 'Data diri berhasil diperbarui!' })
        const { data } = await supabase.from('anggota')
          .select('id, nomor_anggota, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, status, nama_ayah, nama_ibu, nama_wali, no_hp_orangtua_wali, anak_ke, jumlah_saudara')
          .eq('user_id', user.id).single()
        if (data) setAnggotaData(data as AnggotaRecord)
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

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return

    if (file.size > 5 * 1024 * 1024) {
      setMsg({ type: 'err', text: 'Ukuran foto maksimal 5 MB.' })
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setMsg({ type: 'err', text: 'Format foto harus JPG, PNG, WebP, atau GIF.' })
      return
    }

    setUploadingPhoto(true)
    setMsg(null)

    const ext = file.name.split('.').pop()
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

    await supabase.from('users').update({ avatar_url: publicUrl }).eq('id', user.id)
    setAvatarUrl(publicUrl)
    await refresh()
    setMsg({ type: 'ok', text: 'Foto profil berhasil diperbarui!' })
    setUploadingPhoto(false)
  }

  const formatDate = (d: string | null) => {
    if (!d) return '-'
    return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  }

  if (!user) return null

  return (
    <div className="max-w-2xl space-y-6">
      {/* Avatar + Info */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
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
            <h2 className="text-xl font-bold text-slate-800">{user.nama_lengkap}</h2>
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

        {/* Data anggota ringkas */}
        {anggotaData && (
          <div className="mt-5 pt-5 border-t border-slate-100 grid grid-cols-2 gap-3">
            {[
              { label: 'No. Anggota', val: anggotaData.nomor_anggota },
              { label: 'Status Anggota', val: anggotaData.status },
              { label: 'Tempat Lahir', val: anggotaData.tempat_lahir },
              { label: 'Tanggal Lahir', val: formatDate(anggotaData.tanggal_lahir) },
              { label: 'Jenis Kelamin', val: anggotaData.jenis_kelamin },
              { label: 'HP Orang Tua/Wali', val: anggotaData.no_hp_orangtua_wali },
              { label: 'Nama Ayah', val: anggotaData.nama_ayah },
              { label: 'Nama Ibu', val: anggotaData.nama_ibu },
              { label: 'Nama Wali', val: anggotaData.nama_wali },
            ].filter(x => x.val).map(({ label, val }) => (
              <div key={label}>
                <p className="text-xs text-slate-400">{label}</p>
                <p className="text-sm text-slate-700">{val}</p>
              </div>
            ))}
            {anggotaData.alamat && (
              <div className="col-span-2">
                <p className="text-xs text-slate-400">Alamat</p>
                <p className="text-sm text-slate-700">{anggotaData.alamat}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs Edit */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex border-b border-slate-100">
          {([
            { key: 'profil', label: 'Akun' },
            { key: 'datadiri', label: 'Data Diri' },
            { key: 'password', label: 'Password' },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => { setTab(key); setMsg(null) }}
              className={`flex-1 py-3 text-sm font-medium transition ${tab === key ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
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

          {tab === 'profil' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nama Lengkap</label>
                <input value={form.nama_lengkap} onChange={e => setForm(f => ({ ...f, nama_lengkap: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
                <p className="text-xs text-slate-400 mt-1">Email tidak dapat diubah</p>
              </div>
              <button onClick={saveProfile} disabled={saving}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
                {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          )}

          {tab === 'datadiri' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 bg-blue-50 p-3 rounded-xl border border-blue-100">
                Data diri Anda. Perubahan akan tersimpan ke profil anggota.
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
                  <option value="LAKI-LAKI">LAKI-LAKI</option>
                  <option value="PEREMPUAN">PEREMPUAN</option>
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
                  placeholder="Min. 6 karakter"
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
