'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { EmailPreferensi } from '@/lib/types'
import { getPushPermission, getExistingPushSubscription, subscribeToPush, unsubscribeFromPush } from '@/lib/push'
import { isPPG } from '@/lib/roles'
import ProfilHeader from '@/components/ProfilHeader'

// Sub-halaman "Notifikasi" -- dipecah dari tab "Notifikasi" lama di
// app/(dashboard)/profil/page.tsx. Disembunyikan (redirect) utk Super Admin -- keempat
// jenis notifikasi email di sini semuanya murni notifikasi konten organisasi yang tidak
// relevan untuknya sebagai pengelola sistem, bukan pengurus organisasi.
export default function NotifikasiProfilPage() {
  const { user } = useUser()
  const router = useRouter()
  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'
  // Toggle "Approval PPG" disembunyikan utk akun PPG sendiri -- notifikasi ini utk PENGAJU
  // kegiatan/pengumuman saat diputuskan PPG, sedangkan PPG tidak pernah bisa mengajukan
  // keduanya (canManageKontenOrganisasi mengecualikan PPG).
  const isPPGUser = isPPG(user)

  const [notifPref, setNotifPref] = useState({ pengumuman: true, kegiatan: true, reminder: true, approval_ppg: true })
  const [savingNotif, setSavingNotif] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [pushActive, setPushActive] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [pushLoading, setPushLoading] = useState(false)
  const [pushMsg, setPushMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

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
  }, [])

  useEffect(() => {
    if (!user) return
    if (isSuperAdmin) { router.replace('/profil'); return }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNotifPref(user.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isSuperAdmin])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const saveNotifPref = async () => {
    if (!user) return
    setSavingNotif(true)
    setMsg(null)
    try {
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

  if (!user || isSuperAdmin) return null

  const notifOptions: { key: keyof typeof notifPref; label: string; desc: string }[] = [
    { key: 'pengumuman', label: 'Pengumuman Baru', desc: 'Email saat ada pengumuman baru yang relevan untuk Anda.' },
    { key: 'kegiatan', label: 'Kegiatan Baru/Diubah', desc: 'Email saat ada kegiatan baru atau perubahan jadwal/lokasi.' },
    { key: 'reminder', label: 'Reminder H-1 Kegiatan', desc: 'Pengingat email sehari sebelum kegiatan berlangsung.' },
    ...(!isPPGUser ? [{ key: 'approval_ppg' as const, label: 'Approval PPG', desc: 'Email saat kegiatan/pengumuman Anda disetujui atau ditolak PPG.' }] : []),
  ]

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <ProfilHeader title="Notifikasi" backHref="/profil" />

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6 space-y-4">
        {msg && (
          <div className={`p-3 rounded-xl text-sm ${msg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {msg.text}
          </div>
        )}

        {/* Notifikasi push HP/desktop -- terpisah dari preferensi email di bawah. Berlaku
            PER PERANGKAT (subscription disimpan per browser/device). */}
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Notifikasi Push di Perangkat Ini</p>
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
              className={`shrink-0 relative w-11 h-6 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${pushActive ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-600'}`}
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
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {notifOptions.map(({ key, label, desc }) => (
            <label key={key} className="flex items-center justify-between gap-4 py-3.5 cursor-pointer">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
              </div>
              <button
                type="button"
                onClick={() => setNotifPref(p => ({ ...p, [key]: !p[key] }))}
                className={`shrink-0 relative w-11 h-6 rounded-full transition-colors ${notifPref[key] ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-600'}`}
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
    </div>
  )
}
