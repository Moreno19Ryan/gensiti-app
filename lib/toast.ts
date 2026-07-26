'use client'

import { useSyncExternalStore } from 'react'

// Sistem toast GENSITI -- pengganti `alert()` bawaan browser yang sebelumnya dipakai di 5
// halaman (16 tempat). Kenapa alert() diganti: memblokir seluruh halaman, tidak bisa
// distyle, menampilkan URL mentah "gensiti-app.vercel.app", dan yang paling merusak --
// MENGABAIKAN Mode Gelap sepenuhnya, sehingga user yang memilih tema gelap tiba-tiba
// disilaukan kotak putih. Di titik-titik itu seluruh kerja B3 praktis batal.
//
// Pola penyimpanannya sengaja MENIRU lib/dark-mode.ts & lib/accessibility.ts
// (module-level store + useSyncExternalStore), bukan React Context. Alasannya penting:
// dengan module store, `toast.gagal(...)` bisa dipanggil dari event handler mana pun
// tanpa perlu hook dan tanpa perlu membungkus halaman dengan provider -- sehingga
// mengganti `alert(x)` jadi `toast.gagal(x)` benar-benar penggantian satu baris, bukan
// refactor struktural di tiap halaman.

export type JenisToast = 'sukses' | 'gagal' | 'info'

export interface Toast {
  id: number
  jenis: JenisToast
  pesan: string
}

// Toast error bertahan lebih lama -- pesan gagal biasanya perlu dibaca & dicerna
// (sering memuat pesan error dari server), sementara notifikasi sukses cukup sekilas.
const DURASI_MS: Record<JenisToast, number> = {
  sukses: 4000,
  info: 4000,
  gagal: 7000,
}

// Batasi tumpukan supaya layar (terutama mobile) tidak tertutup penuh toast kalau ada
// beberapa aksi gagal beruntun. Yang tertua didorong keluar duluan.
const MAKS_TAMPIL = 3

let daftar: Toast[] = []
let idBerikutnya = 1

type Listener = () => void
const listeners = new Set<Listener>()
const timer = new Map<number, ReturnType<typeof setTimeout>>()

function pancarkan() {
  listeners.forEach(l => l())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): Toast[] {
  return daftar
}

// Array kosong yang SAMA (bukan [] baru tiap panggilan) -- useSyncExternalStore
// membandingkan hasil snapshot dengan Object.is, jadi literal baru tiap render akan
// dianggap selalu berubah dan memicu infinite loop saat SSR.
const KOSONG: Toast[] = []
function getServerSnapshot(): Toast[] {
  return KOSONG
}

export function tutupToast(id: number) {
  const t = timer.get(id)
  if (t) {
    clearTimeout(t)
    timer.delete(id)
  }
  daftar = daftar.filter(x => x.id !== id)
  pancarkan()
}

function tampilkan(jenis: JenisToast, pesan: string): number {
  const id = idBerikutnya++
  daftar = [...daftar, { id, jenis, pesan }]

  // Buang yang tertua kalau melebihi batas -- lewat tutupToast() supaya timer-nya ikut
  // dibersihkan, bukan sekadar dipotong dari array (kalau tidak, timer yatim akan tetap
  // menyala dan memanggil tutupToast untuk id yang sudah tidak ada).
  while (daftar.length > MAKS_TAMPIL) {
    tutupToast(daftar[0].id)
  }

  timer.set(id, setTimeout(() => tutupToast(id), DURASI_MS[jenis]))
  pancarkan()
  return id
}

export const toast = {
  sukses: (pesan: string) => tampilkan('sukses', pesan),
  gagal: (pesan: string) => tampilkan('gagal', pesan),
  info: (pesan: string) => tampilkan('info', pesan),
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
