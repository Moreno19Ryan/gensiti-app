import { supabase } from './supabase'

// Helper Web Push Notification -- minta izin browser, subscribe ke push service, dan
// simpan subscription ke tabel push_subscriptions supaya edge function send-push (dipanggil
// dari trigger database lewat notify_push/notify_push_scope) bisa mengirim notifikasi HP
// walau aplikasi GENSITI sedang tertutup. Dipakai dari tab Notifikasi di halaman Profil.

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

// Push API browser butuh VAPID public key dalam bentuk Uint8Array, bukan base64 string.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
}

export function getPushPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

// Cek apakah user (device ini) sudah punya subscription aktif tersimpan di browser.
export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

// Alur lengkap: minta izin notifikasi -> subscribe ke push service -> simpan ke database.
// Mengembalikan pesan error (string) kalau gagal di langkah manapun, atau null kalau sukses.
export async function subscribeToPush(userId: string): Promise<string | null> {
  if (!isPushSupported()) return 'Perangkat/browser ini tidak mendukung notifikasi push.'
  if (!VAPID_PUBLIC_KEY) return 'Konfigurasi notifikasi push belum lengkap (hubungi admin).'

  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return 'Izin notifikasi ditolak. Aktifkan lewat pengaturan browser/HP untuk menyalakan fitur ini.'
    }

    const registration = await navigator.serviceWorker.ready
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      })
    }

    const json = subscription.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return 'Gagal membuat subscription push (data tidak lengkap).'
    }

    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
    }, { onConflict: 'user_id,endpoint' })

    if (error) return `Gagal menyimpan subscription: ${error.message}`

    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Gagal mengaktifkan notifikasi push.'
  }
}

// Matikan push di device ini: unsubscribe dari browser + hapus baris terkait di database.
export async function unsubscribeFromPush(): Promise<string | null> {
  if (!isPushSupported()) return null
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return null

    const endpoint = subscription.endpoint
    await subscription.unsubscribe()

    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
    if (error) return `Gagal menghapus subscription dari server: ${error.message}`

    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Gagal menonaktifkan notifikasi push.'
  }
}
