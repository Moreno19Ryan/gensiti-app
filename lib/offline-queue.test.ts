import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
vi.mock('./supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}))

// idb-keyval butuh IndexedDB asli (browser) -- di-mock dengan Map in-memory supaya bisa
// jalan di environment test 'node' milik vitest.config.ts, sekaligus bikin state antar test
// bisa direset lewat store.clear() di beforeEach.
const store = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: (key: string) => Promise.resolve(store.get(key)),
  set: (key: string, value: unknown) => {
    store.set(key, value)
    return Promise.resolve()
  },
}))

import { submitPresensiOffline, flushAntrean, getJumlahAntrean } from './offline-queue'

const PARAMS = { p_kegiatan_id: 'keg-1', p_kode: '123456' }

beforeEach(() => {
  store.clear()
  rpcMock.mockReset()
  vi.stubGlobal('navigator', { onLine: true })
})

describe('submitPresensiOffline', () => {
  it('langsung mengantrekan tanpa memanggil RPC kalau device offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const hasil = await submitPresensiOffline('submit_presensi', PARAMS)
    expect(hasil).toEqual({ queued: true })
    expect(rpcMock).not.toHaveBeenCalled()
    expect(await getJumlahAntrean()).toBe(1)
  })

  it('sukses: mengembalikan data, tidak mengantrekan', async () => {
    rpcMock.mockResolvedValue({ data: { nama_lengkap: 'Budi' }, error: null })
    const hasil = await submitPresensiOffline('submit_presensi', PARAMS)
    expect(hasil).toEqual({ queued: false, data: { nama_lengkap: 'Budi' } })
    expect(await getJumlahAntrean()).toBe(0)
  })

  it('penolakan permanen dari server (kode kedaluwarsa): dikembalikan sebagai error, TIDAK diantrekan', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'Kode presensi sudah kedaluwarsa' } })
    const hasil = await submitPresensiOffline('submit_presensi', PARAMS)
    expect(hasil).toEqual({ queued: false, error: 'Kode presensi sudah kedaluwarsa' })
    expect(await getJumlahAntrean()).toBe(0)
  })

  it('penolakan permanen "sudah tercatat hadir": tidak diantrekan', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'Generus ini sudah tercatat hadir' } })
    const hasil = await submitPresensiOffline('submit_presensi', PARAMS)
    expect(hasil.queued).toBe(false)
    expect(await getJumlahAntrean()).toBe(0)
  })

  it('error server yang tidak dikenali: diantrekan (fail-safe, bukan fail-drop)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'Internal Server Error' } })
    const hasil = await submitPresensiOffline('submit_presensi', PARAMS)
    expect(hasil).toEqual({ queued: true })
    expect(await getJumlahAntrean()).toBe(1)
  })

  it('rpc melempar exception (mis. gagal jaringan): diantrekan', async () => {
    rpcMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const hasil = await submitPresensiOffline('submit_presensi_rfid', PARAMS)
    expect(hasil).toEqual({ queued: true })
    expect(await getJumlahAntrean()).toBe(1)
  })
})

describe('flushAntrean', () => {
  it('antrean kosong: tidak memanggil RPC sama sekali', async () => {
    await flushAntrean()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('semua item sukses: antrean jadi kosong, onItemResolved dipanggil sukses:true utk tiap item', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await submitPresensiOffline('submit_presensi', { ...PARAMS, p_kode: 'a' })
    await submitPresensiOffline('submit_presensi', { ...PARAMS, p_kode: 'b' })
    expect(await getJumlahAntrean()).toBe(2)

    rpcMock.mockResolvedValue({ data: {}, error: null })
    const resolved: boolean[] = []
    await flushAntrean((_item, hasil) => resolved.push(hasil.sukses))

    expect(resolved).toEqual([true, true])
    expect(await getJumlahAntrean()).toBe(0)
  })

  it('item ditolak permanen saat flush: dibuang dari antrean (tidak diulang lagi), lanjut ke item berikutnya', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await submitPresensiOffline('submit_presensi', { ...PARAMS, p_kode: 'expired' })
    await submitPresensiOffline('submit_presensi', { ...PARAMS, p_kode: 'valid' })

    rpcMock
      .mockResolvedValueOnce({ data: null, error: { message: 'Kode presensi sudah kedaluwarsa' } })
      .mockResolvedValueOnce({ data: {}, error: null })

    const resolved: { sukses: boolean; pesan?: string }[] = []
    await flushAntrean((_item, hasil) => resolved.push(hasil))

    expect(resolved).toEqual([
      { sukses: false, pesan: 'Kode presensi sudah kedaluwarsa' },
      { sukses: true },
    ])
    expect(await getJumlahAntrean()).toBe(0)
  })

  it('item gagal karena sebab tak dikenal: berhenti di situ, item itu DAN sisanya tetap diantrekan utuh', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await submitPresensiOffline('submit_presensi', { ...PARAMS, p_kode: 'sukses-duluan' })
    await submitPresensiOffline('submit_presensi', { ...PARAMS, p_kode: 'gagal-tak-dikenal' })
    await submitPresensiOffline('submit_presensi', { ...PARAMS, p_kode: 'belum-sempat-dicoba' })

    rpcMock
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } })

    const resolved: boolean[] = []
    await flushAntrean((_item, hasil) => resolved.push(hasil.sukses))

    expect(resolved).toEqual([true])
    expect(rpcMock).toHaveBeenCalledTimes(2)
    expect(await getJumlahAntrean()).toBe(2)
  })

  it('rpc melempar exception di tengah antrean: berhenti, sisa antrean (termasuk yg gagal) tetap tersimpan', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await submitPresensiOffline('submit_presensi_rfid', { ...PARAMS, p_kartu_uid: '1' })
    await submitPresensiOffline('submit_presensi_rfid', { ...PARAMS, p_kartu_uid: '2' })

    rpcMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await flushAntrean()
    expect(await getJumlahAntrean()).toBe(2)
  })
})
