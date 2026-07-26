'use client'

import { useSyncExternalStore } from 'react'

// Dialog konfirmasi GENSITI -- pengganti `confirm()` bawaan browser (sebelumnya dipakai di
// 5 tempat: hapus transaksi/kegiatan/pengumuman/dokumen, dan setujui reimbursement).
//
// Yang paling mengganggu dari confirm() bawaan: keputusan finansial nyata (menyetujui
// reimbursement di keuangan/page.tsx) disajikan lewat kotak abu-abu sistem yang tampilannya
// sama persis dengan "Hapus dokumen ini?" -- tidak ada hierarki visual antara aksi ringan
// dan aksi berdampak. Dialog ini memisahkan keduanya lewat prop `destruktif`.
//
// API-nya sengaja berbasis Promise supaya bentuk pemanggilan di call site nyaris identik
// dengan sebelumnya -- `if (!confirm('...')) return` cukup jadi
// `if (!await konfirmasi({ pesan: '...' })) return`. Tidak perlu memecah handler jadi
// callback bersarang atau menambah state modal di tiap halaman.

export interface OpsiKonfirmasi {
  judul?: string
  pesan: string
  labelYa?: string
  labelBatal?: string
  /** Warnai tombol utama merah + ikon peringatan. Untuk aksi yang sulit/tidak bisa dibatalkan. */
  destruktif?: boolean
}

export interface StateKonfirmasi extends OpsiKonfirmasi {
  id: number
  resolve: (setuju: boolean) => void
}

let aktif: StateKonfirmasi | null = null
let idBerikutnya = 1

type Listener = () => void
const listeners = new Set<Listener>()

function pancarkan() {
  listeners.forEach(l => l())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): StateKonfirmasi | null {
  return aktif
}

function getServerSnapshot(): StateKonfirmasi | null {
  return null
}

/**
 * Tampilkan dialog konfirmasi. Resolve `true` kalau user menyetujui, `false` kalau
 * membatalkan (termasuk lewat tombol Batal, Escape, atau klik backdrop).
 */
export function konfirmasi(opsi: OpsiKonfirmasi): Promise<boolean> {
  // Kalau sudah ada dialog terbuka, tutup dulu dengan jawaban "batal" -- mencegah dialog
  // lama menggantung tanpa pernah di-resolve (promise yatim yang bikin handler pemanggilnya
  // berhenti selamanya). Dalam praktiknya jarang terjadi, tapi murah untuk dijaga.
  if (aktif) aktif.resolve(false)

  return new Promise<boolean>(resolve => {
    aktif = { ...opsi, id: idBerikutnya++, resolve }
    pancarkan()
  })
}

export function jawabKonfirmasi(setuju: boolean) {
  if (!aktif) return
  const { resolve } = aktif
  aktif = null
  pancarkan()
  resolve(setuju)
}

export function useKonfirmasi(): StateKonfirmasi | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
