'use client'

import { useCallback, useEffect } from 'react'
import { useSyncExternalStore } from 'react'

// Sumber kebenaran TUNGGAL untuk Mode Gelap -- sebelumnya app/(dashboard)/layout.tsx (ikon
// kanan atas) dan app/(dashboard)/profil/page.tsx (toggle "Mode Gelap") masing-masing punya
// useState terpisah yang cuma baca localStorage SEKALI saat mount. Keduanya menulis ke key
// yang sama, tapi toggle di satu tempat tidak pernah membuat komponen lain re-render --
// user harus reload halaman baru kelihatan sinkron. useSyncExternalStore memastikan SEMUA
// komponen yang pakai useDarkMode() re-render bersamaan begitu salah satu toggle di mana pun.
const DARK_MODE_KEY = 'gensiti_dark_mode'

type Listener = () => void
const listeners = new Set<Listener>()

function getSnapshot(): boolean {
  return localStorage.getItem(DARK_MODE_KEY) === 'true'
}

function getServerSnapshot(): boolean {
  return false
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function applyDomClass(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
}

export function setDarkMode(next: boolean) {
  localStorage.setItem(DARK_MODE_KEY, String(next))
  applyDomClass(next)
  listeners.forEach(listener => listener())
}

export function useDarkMode(): [boolean, () => void] {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Terapkan class 'dark' setiap kali nilai berubah (termasuk saat mount pertama, bukan
  // cuma saat toggle) -- supaya komponen manapun yang duluan mount tetap menerapkan
  // preferensi tersimpan dengan benar.
  useEffect(() => {
    applyDomClass(dark)
  }, [dark])

  const toggle = useCallback(() => setDarkMode(!getSnapshot()), [])

  return [dark, toggle]
}
