import { get, set } from 'idb-keyval'
import { supabase } from './supabase'

const QUEUE_KEY = 'gensiti_presensi_offline_queue'

type PresensiRpc = 'submit_presensi' | 'submit_presensi_rfid'

interface AntreanPresensi {
  id: string
  rpc: PresensiRpc
  params: Record<string, string>
  queuedAt: string
}

async function bacaAntrean(): Promise<AntreanPresensi[]> {
  return (await get<AntreanPresensi[]>(QUEUE_KEY)) || []
}

async function simpanAntrean(items: AntreanPresensi[]) {
  await set(QUEUE_KEY, items)
}

async function antrekan(rpc: PresensiRpc, params: Record<string, string>) {
  const antrean = await bacaAntrean()
  antrean.push({ id: crypto.randomUUID(), rpc, params, queuedAt: new Date().toISOString() })
  await simpanAntrean(antrean)
}

export async function getJumlahAntrean(): Promise<number> {
  return (await bacaAntrean()).length
}

// Pesan-pesan RAISE EXCEPTION dari submit_presensi/submit_presensi_rfid (lihat definisi RPC
// di Supabase) yang berarti server BENAR-BENAR menolak permintaannya -- mengulang kirim tidak
// akan pernah berhasil, jadi harus langsung dianggap selesai (gagal permanen), bukan diantrekan
// lagi. Selain pola-pola ini, error apa pun (termasuk gagal jaringan, sesi belum siap saat
// reconnect, atau error tak terduga lain) SENGAJA dianggap "coba lagi nanti" -- lebih aman
// kehilangan waktu daripada diam-diam menghapus presensi yang sebenarnya valid.
const POLA_PENOLAKAN_PERMANEN =
  /kedaluwarsa|sudah tercatat hadir|kode presensi salah|tidak ditemukan|tidak termasuk peserta|berstatus tidak aktif|khusus untuk|kartu tidak terbaca|belum diaktifkan oleh pengurus/i

function isPenolakanPermanen(msg: string): boolean {
  return POLA_PENOLAKAN_PERMANEN.test(msg)
}

// Submit presensi dengan fallback antrean lokal (IndexedDB) -- dipakai PresensiPanel &
// RfidKioskInput menggantikan supabase.rpc langsung. Kalau device sedang offline atau
// request gagal karena sebab yang tidak dikenali (bukan penolakan valid dari server),
// permintaan disimpan ke antrean lokal dan otomatis dikirim ulang lewat flushAntrean saat
// online lagi (lihat listener 'online' di lib/user-context.tsx).
export async function submitPresensiOffline(
  rpc: PresensiRpc,
  params: Record<string, string>
): Promise<{ queued: boolean; data?: unknown; error?: string }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await antrekan(rpc, params)
    return { queued: true }
  }
  try {
    const { data, error } = await supabase.rpc(rpc, params)
    if (error) {
      if (isPenolakanPermanen(error.message)) return { queued: false, error: error.message }
      await antrekan(rpc, params)
      return { queued: true }
    }
    return { queued: false, data }
  } catch {
    await antrekan(rpc, params)
    return { queued: true }
  }
}

// Kuras antrean secara berurutan. Berhenti begitu satu item gagal karena sebab yang tidak
// dikenali (anggap belum online sepenuhnya/sesi belum siap) supaya sisanya (termasuk item itu
// sendiri) tetap tersimpan untuk dicoba lagi -- bukan diproses acak/paralel yang bisa
// menyembunyikan kegagalan jaringan yang sama berulang kali.
export async function flushAntrean(
  onItemResolved?: (item: AntreanPresensi, hasil: { sukses: boolean; pesan?: string }) => void
): Promise<void> {
  const antrean = await bacaAntrean()
  if (antrean.length === 0) return
  let i = 0
  for (; i < antrean.length; i++) {
    const item = antrean[i]
    try {
      const { error } = await supabase.rpc(item.rpc, item.params)
      if (error) {
        if (!isPenolakanPermanen(error.message)) break
        onItemResolved?.(item, { sukses: false, pesan: error.message })
        continue
      }
      onItemResolved?.(item, { sukses: true })
    } catch {
      break
    }
  }
  await simpanAntrean(antrean.slice(i))
}
