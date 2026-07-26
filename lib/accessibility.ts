'use client'

import { useCallback, useEffect } from 'react'
import { useSyncExternalStore } from 'react'

// Ukuran Teks & Kontras Tinggi -- pola SAMA PERSIS dengan lib/dark-mode.ts
// (useSyncExternalStore, satu key localStorage per fitur, class di <html>) supaya toggle
// di halaman Pengaturan mana pun langsung sinkron real-time tanpa reload. Lihat catatan
// lengkap soal kenapa useSyncExternalStore dipakai di lib/dark-mode.ts.

export type TextSize = 'normal' | 'besar' | 'lebih-besar'
const TEXT_SIZE_KEY = 'gensiti_text_size'
const TEXT_SIZES: TextSize[] = ['normal', 'besar', 'lebih-besar']

type Listener = () => void
const textSizeListeners = new Set<Listener>()

function getTextSizeSnapshot(): TextSize {
  const saved = localStorage.getItem(TEXT_SIZE_KEY)
  return (TEXT_SIZES as string[]).includes(saved || '') ? (saved as TextSize) : 'normal'
}

function getTextSizeServerSnapshot(): TextSize {
  return 'normal'
}

function subscribeTextSize(listener: Listener): () => void {
  textSizeListeners.add(listener)
  return () => textSizeListeners.delete(listener)
}

function applyTextSizeClass(size: TextSize) {
  const root = document.documentElement
  TEXT_SIZES.forEach(s => root.classList.remove(`text-size-${s}`))
  if (size !== 'normal') root.classList.add(`text-size-${size}`)
}

export function setTextSize(next: TextSize) {
  localStorage.setItem(TEXT_SIZE_KEY, next)
  applyTextSizeClass(next)
  textSizeListeners.forEach(listener => listener())
}

export function useTextSize(): [TextSize, (next: TextSize) => void] {
  const size = useSyncExternalStore(subscribeTextSize, getTextSizeSnapshot, getTextSizeServerSnapshot)

  useEffect(() => {
    applyTextSizeClass(size)
  }, [size])

  return [size, setTextSize]
}

const HIGH_CONTRAST_KEY = 'gensiti_high_contrast'
const highContrastListeners = new Set<Listener>()

function getHighContrastSnapshot(): boolean {
  return localStorage.getItem(HIGH_CONTRAST_KEY) === 'true'
}

function getHighContrastServerSnapshot(): boolean {
  return false
}

function subscribeHighContrast(listener: Listener): () => void {
  highContrastListeners.add(listener)
  return () => highContrastListeners.delete(listener)
}

function applyHighContrastClass(active: boolean) {
  document.documentElement.classList.toggle('high-contrast', active)
}

export function setHighContrast(next: boolean) {
  localStorage.setItem(HIGH_CONTRAST_KEY, String(next))
  applyHighContrastClass(next)
  highContrastListeners.forEach(listener => listener())
}

export function useHighContrast(): [boolean, () => void] {
  const active = useSyncExternalStore(subscribeHighContrast, getHighContrastSnapshot, getHighContrastServerSnapshot)

  useEffect(() => {
    applyHighContrastClass(active)
  }, [active])

  const toggle = useCallback(() => setHighContrast(!getHighContrastSnapshot()), [])

  return [active, toggle]
}
