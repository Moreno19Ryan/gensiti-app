'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { authFetch } from '@/lib/auth'
import { isPPG } from '@/lib/roles'
import ProfilHeader from '@/components/ProfilHeader'

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

// Sub-halaman "Data Diri" -- dipecah dari tab "Data Diri" lama di
// app/(dashboard)/profil/page.tsx. Super Admin tidak punya biodata Generus sama sekali,
// jadi rute ini di-redirect balik ke /profil kalau diakses langsung lewat URL (bukan cuma
// disembunyikan dari daftar link).
export default function DataDiriPage() {
  const { user } = useUser()
  const router = useRouter()
  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'
  // PPG sudah dewasa, bukan anak asuh organisasi -- field anak-asuh (anak ke-/jumlah
  // saudara/nama ortu-wali) tidak ditampilkan utk akunnya, sama seperti biodata PPG di
  // data-pembina/page.tsx.
  const isPPGUser = isPPG(user)

  const [diriForm, setDiriForm] = useState({
    tempat_lahir: '', tanggal_lahir: '', jenis_kelamin: '',
    alamat: '', anak_ke: '', jumlah_saudara: '',
    nama_ayah: '', nama_ibu: '', nama_wali: '', no_hp_orangtua_wali: '',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const loadGenerus = useCallback(async (userId: string) => {
    const res = await authFetch(`/api/generus?userId=${userId}`)
    const json = await res.json()
    if (json.data) {
      const data = json.data as GenerusRecord
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
  }, [])

  useEffect(() => {
    if (!user) return
    if (isSuperAdmin) { router.replace('/profil'); return }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGenerus(user.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isSuperAdmin])

  const saveDataDiri = async () => {
    if (!user) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await authFetch('/api/generus', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          tempat_lahir: diriForm.tempat_lahir.toUpperCase(),
          tanggal_lahir: diriForm.tanggal_lahir || null,
          jenis_kelamin: diriForm.jenis_kelamin,
          alamat: diriForm.alamat.toUpperCase(),
          ...(!isPPGUser && {
            anak_ke: diriForm.anak_ke ? parseInt(diriForm.anak_ke) : null,
            jumlah_saudara: diriForm.jumlah_saudara ? parseInt(diriForm.jumlah_saudara) : null,
            nama_ayah: diriForm.nama_ayah.toUpperCase(),
            nama_ibu: diriForm.nama_ibu.toUpperCase(),
            nama_wali: diriForm.nama_wali ? diriForm.nama_wali.toUpperCase() : null,
            no_hp_orangtua_wali: diriForm.no_hp_orangtua_wali,
          }),
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

  if (!user || isSuperAdmin) return null

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <ProfilHeader title="Data Diri" backHref="/profil" />

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6 space-y-4">
        {msg && (
          <div className={`p-3 rounded-xl text-sm ${msg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {msg.text}
          </div>
        )}
        <p className="text-xs text-slate-500 bg-blue-50 p-3 rounded-xl border border-blue-100">
          {isPPGUser ? 'Data diri Anda sebagai PPG. Perubahan akan tersimpan ke profil Generus.' : 'Data diri Anda. Perubahan akan tersimpan ke profil Generus.'}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Tempat Lahir *</label>
            <input value={diriForm.tempat_lahir}
              onChange={e => setDiriForm(f => ({ ...f, tempat_lahir: e.target.value.toUpperCase() }))}
              placeholder="BEKASI"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Tanggal Lahir *</label>
            <input type="date" value={diriForm.tanggal_lahir}
              onChange={e => setDiriForm(f => ({ ...f, tanggal_lahir: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Jenis Kelamin *</label>
          <select value={diriForm.jenis_kelamin}
            onChange={e => setDiriForm(f => ({ ...f, jenis_kelamin: e.target.value }))}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Pilih jenis kelamin</option>
            <option value="laki-laki">Laki-laki</option>
            <option value="perempuan">Perempuan</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Alamat *</label>
          <textarea value={diriForm.alamat}
            onChange={e => setDiriForm(f => ({ ...f, alamat: e.target.value.toUpperCase() }))}
            rows={2} placeholder="ALAMAT LENGKAP"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none uppercase" />
        </div>
        {/* Anak ke-/jumlah saudara & Data Orang Tua/Wali disembunyikan utk PPG -- lihat
            catatan isPPGUser di atas. */}
        {!isPPGUser && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Anak Ke-</label>
                <input type="number" min={1} value={diriForm.anak_ke}
                  onChange={e => setDiriForm(f => ({ ...f, anak_ke: e.target.value }))}
                  placeholder="1"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Dari ... Bersaudara</label>
                <input type="number" min={1} value={diriForm.jumlah_saudara}
                  onChange={e => setDiriForm(f => ({ ...f, jumlah_saudara: e.target.value }))}
                  placeholder="3"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="border-t border-slate-100 dark:border-slate-700 pt-3 space-y-3">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Data Orang Tua / Wali</p>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Nama Ayah Kandung *</label>
                <input value={diriForm.nama_ayah}
                  onChange={e => setDiriForm(f => ({ ...f, nama_ayah: e.target.value.toUpperCase() }))}
                  placeholder="NAMA AYAH KANDUNG"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Nama Ibu Kandung *</label>
                <input value={diriForm.nama_ibu}
                  onChange={e => setDiriForm(f => ({ ...f, nama_ibu: e.target.value.toUpperCase() }))}
                  placeholder="NAMA IBU KANDUNG"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Nama Wali (opsional)</label>
                <input value={diriForm.nama_wali}
                  onChange={e => setDiriForm(f => ({ ...f, nama_wali: e.target.value.toUpperCase() }))}
                  placeholder="NAMA WALI (jika ada)"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">No. HP Orang Tua / Wali *</label>
                <input value={diriForm.no_hp_orangtua_wali}
                  onChange={e => setDiriForm(f => ({ ...f, no_hp_orangtua_wali: e.target.value }))}
                  placeholder="08xx-xxxx-xxxx"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </>
        )}
        <button onClick={saveDataDiri} disabled={saving}
          className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition">
          {saving ? 'Menyimpan...' : 'Simpan Data Diri'}
        </button>
      </div>
    </div>
  )
}
