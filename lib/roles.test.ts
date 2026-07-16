import { describe, it, expect } from 'vitest'
import {
  isGenerusBiasa,
  isPPG,
  isPengurus,
  canManageMembers,
  canViewGenerusData,
  canManageKontenOrganisasi,
  canManagePresensi,
  isBendahara,
  canAjukanReimbursement,
  canLihatLaporanDaerah,
  canLihatLaporanBulanan,
  getLaporanBulananScope,
  getAllowedTargetTingkatan,
} from './roles'
import type { Tingkatan, UserProfile } from './types'

type RoleUser = Pick<UserProfile, 'role'>
type ScopeUser = Pick<UserProfile, 'role' | 'desa_id' | 'kelompok_id'>

function makeUser(nama_role: string, tingkatan: Tingkatan): RoleUser {
  return { role: { id: 'role-1', nama_role, tingkatan } }
}

const generusKelompok = makeUser('Generus', 'kelompok')
const ketuaKelompok = makeUser('Ketua', 'kelompok')
const wakilKetuaKelompok = makeUser('Wakil Ketua', 'kelompok')
const sekretarisKelompok = makeUser('Sekretaris', 'kelompok')
const bendaharaKelompok = makeUser('Bendahara', 'kelompok')
const kemandirianKelompok = makeUser('Kemandirian', 'kelompok')
const ketuaDesa = makeUser('Ketua', 'desa')
const ketuaDaerah = makeUser('Ketua', 'daerah')
const sekretarisDaerah = makeUser('Sekretaris', 'daerah')
const bendaharaDaerah = makeUser('Bendahara', 'daerah')
const ppgUser = makeUser('PPG', 'ppg')
const superAdmin = makeUser('Super Admin', 'super_admin')

describe('isGenerusBiasa', () => {
  it('true untuk role Generus', () => {
    expect(isGenerusBiasa(generusKelompok)).toBe(true)
  })
  it('false untuk pengurus, PPG, dan super admin', () => {
    expect(isGenerusBiasa(ketuaKelompok)).toBe(false)
    expect(isGenerusBiasa(ppgUser)).toBe(false)
    expect(isGenerusBiasa(superAdmin)).toBe(false)
  })
  it('false untuk user/role null', () => {
    expect(isGenerusBiasa(null)).toBe(false)
    expect(isGenerusBiasa(undefined)).toBe(false)
    expect(isGenerusBiasa({ role: null })).toBe(false)
  })
})

describe('isPPG', () => {
  it('true hanya untuk tingkatan ppg', () => {
    expect(isPPG(ppgUser)).toBe(true)
  })
  it('false untuk tingkatan lain termasuk super_admin', () => {
    expect(isPPG(superAdmin)).toBe(false)
    expect(isPPG(ketuaDaerah)).toBe(false)
    expect(isPPG(null)).toBe(false)
  })
})

describe('isPengurus', () => {
  it('true untuk super admin dan pengurus non-generus non-PPG', () => {
    expect(isPengurus(superAdmin)).toBe(true)
    expect(isPengurus(ketuaKelompok)).toBe(true)
    expect(isPengurus(kemandirianKelompok)).toBe(true)
  })
  it('false untuk Generus biasa dan PPG', () => {
    expect(isPengurus(generusKelompok)).toBe(false)
    expect(isPengurus(ppgUser)).toBe(false)
  })
})

describe('canManageMembers', () => {
  it('true untuk Ketua/Wakil Ketua/Sekretaris di jenjang manapun', () => {
    expect(canManageMembers(ketuaKelompok)).toBe(true)
    expect(canManageMembers(wakilKetuaKelompok)).toBe(true)
    expect(canManageMembers(sekretarisKelompok)).toBe(true)
    expect(canManageMembers(ketuaDesa)).toBe(true)
    expect(canManageMembers(ketuaDaerah)).toBe(true)
  })
  it('true untuk super admin (akses penuh khusus modul ini)', () => {
    expect(canManageMembers(superAdmin)).toBe(true)
  })
  it('false untuk PPG, Bendahara, Kemandirian, dan Generus biasa', () => {
    expect(canManageMembers(ppgUser)).toBe(false)
    expect(canManageMembers(bendaharaKelompok)).toBe(false)
    expect(canManageMembers(kemandirianKelompok)).toBe(false)
    expect(canManageMembers(generusKelompok)).toBe(false)
  })
})

describe('canViewGenerusData', () => {
  it('true untuk semua pengurus, super admin, dan PPG', () => {
    expect(canViewGenerusData(ketuaKelompok)).toBe(true)
    expect(canViewGenerusData(bendaharaKelompok)).toBe(true)
    expect(canViewGenerusData(superAdmin)).toBe(true)
    expect(canViewGenerusData(ppgUser)).toBe(true)
  })
  it('false hanya untuk Generus biasa', () => {
    expect(canViewGenerusData(generusKelompok)).toBe(false)
  })
})

describe('canManageKontenOrganisasi', () => {
  it('true untuk Ketua/Wakil Ketua/Sekretaris', () => {
    expect(canManageKontenOrganisasi(ketuaKelompok)).toBe(true)
    expect(canManageKontenOrganisasi(sekretarisDaerah)).toBe(true)
  })
  it('false untuk super admin (dikecualikan sengaja, beda dari canManageMembers)', () => {
    expect(canManageKontenOrganisasi(superAdmin)).toBe(false)
  })
  it('false untuk PPG dan pengurus non-ketua/sekretaris', () => {
    expect(canManageKontenOrganisasi(ppgUser)).toBe(false)
    expect(canManageKontenOrganisasi(bendaharaKelompok)).toBe(false)
    expect(canManageKontenOrganisasi(kemandirianKelompok)).toBe(false)
  })
})

describe('canManagePresensi', () => {
  it('true untuk Ketua/Wakil Ketua/Sekretaris', () => {
    expect(canManagePresensi(ketuaKelompok)).toBe(true)
    expect(canManagePresensi(sekretarisKelompok)).toBe(true)
  })
  it('false untuk super admin, PPG, dan Bendahara', () => {
    expect(canManagePresensi(superAdmin)).toBe(false)
    expect(canManagePresensi(ppgUser)).toBe(false)
    expect(canManagePresensi(bendaharaKelompok)).toBe(false)
  })
})

describe('isBendahara', () => {
  it('true hanya untuk role Bendahara di jenjang manapun', () => {
    expect(isBendahara(bendaharaKelompok)).toBe(true)
    expect(isBendahara(bendaharaDaerah)).toBe(true)
  })
  it('false untuk role lain', () => {
    expect(isBendahara(ketuaKelompok)).toBe(false)
    expect(isBendahara(superAdmin)).toBe(false)
  })
})

describe('canAjukanReimbursement', () => {
  it('true untuk pengurus operasional selain Bendahara', () => {
    expect(canAjukanReimbursement(ketuaKelompok)).toBe(true)
    expect(canAjukanReimbursement(kemandirianKelompok)).toBe(true)
  })
  it('false untuk Bendahara sendiri, super admin, PPG, dan Generus biasa', () => {
    expect(canAjukanReimbursement(bendaharaKelompok)).toBe(false)
    expect(canAjukanReimbursement(superAdmin)).toBe(false)
    expect(canAjukanReimbursement(ppgUser)).toBe(false)
    expect(canAjukanReimbursement(generusKelompok)).toBe(false)
  })
})

describe('canLihatLaporanDaerah', () => {
  it('true untuk super admin dan PPG', () => {
    expect(canLihatLaporanDaerah(superAdmin)).toBe(true)
    expect(canLihatLaporanDaerah(ppgUser)).toBe(true)
  })
  it('true untuk Ketua/Sekretaris Daerah, false untuk jenjang lain', () => {
    expect(canLihatLaporanDaerah(ketuaDaerah)).toBe(true)
    expect(canLihatLaporanDaerah(sekretarisDaerah)).toBe(true)
    expect(canLihatLaporanDaerah(ketuaDesa)).toBe(false)
    expect(canLihatLaporanDaerah(ketuaKelompok)).toBe(false)
  })
  it('false untuk Bendahara Daerah (bukan Ketua/Sekretaris)', () => {
    expect(canLihatLaporanDaerah(bendaharaDaerah)).toBe(false)
  })
})

describe('canLihatLaporanBulanan', () => {
  it('true untuk super admin, PPG, dan Ketua/Sekretaris di Daerah/Desa/Kelompok', () => {
    expect(canLihatLaporanBulanan(superAdmin)).toBe(true)
    expect(canLihatLaporanBulanan(ppgUser)).toBe(true)
    expect(canLihatLaporanBulanan(ketuaDaerah)).toBe(true)
    expect(canLihatLaporanBulanan(ketuaDesa)).toBe(true)
    expect(canLihatLaporanBulanan(ketuaKelompok)).toBe(true)
  })
  it('false untuk Bendahara/Kemandirian di jenjang manapun', () => {
    expect(canLihatLaporanBulanan(bendaharaKelompok)).toBe(false)
    expect(canLihatLaporanBulanan(kemandirianKelompok)).toBe(false)
  })
})

describe('getLaporanBulananScope', () => {
  it('null kalau user tidak berhak lihat laporan bulanan', () => {
    expect(getLaporanBulananScope(bendaharaKelompok as ScopeUser)).toBeNull()
    expect(getLaporanBulananScope(generusKelompok as ScopeUser)).toBeNull()
  })
  it('scope kelompok memakai kelompok_id user', () => {
    const user: ScopeUser = { ...ketuaKelompok, desa_id: null, kelompok_id: 'kel-1' }
    expect(getLaporanBulananScope(user)).toEqual({ tingkatan: 'kelompok', scopeId: 'kel-1' })
  })
  it('scope desa memakai desa_id user', () => {
    const user: ScopeUser = { ...ketuaDesa, desa_id: 'desa-1', kelompok_id: null }
    expect(getLaporanBulananScope(user)).toEqual({ tingkatan: 'desa', scopeId: 'desa-1' })
  })
  it('scope daerah untuk Ketua Daerah, PPG, dan super admin (scopeId selalu null)', () => {
    const user: ScopeUser = { ...ketuaDaerah, desa_id: null, kelompok_id: null }
    expect(getLaporanBulananScope(user)).toEqual({ tingkatan: 'daerah', scopeId: null })
    expect(getLaporanBulananScope({ ...ppgUser, desa_id: 'desa-1', kelompok_id: null })).toEqual({
      tingkatan: 'daerah',
      scopeId: null,
    })
    expect(getLaporanBulananScope({ ...superAdmin, desa_id: null, kelompok_id: 'kel-1' })).toEqual({
      tingkatan: 'daerah',
      scopeId: null,
    })
  })
})

describe('getAllowedTargetTingkatan', () => {
  it('Kelompok hanya boleh membuat role kelompok', () => {
    expect(getAllowedTargetTingkatan(ketuaKelompok)).toEqual(['kelompok'])
  })
  it('Desa boleh membuat kelompok + desa, tidak lebih', () => {
    expect(getAllowedTargetTingkatan(ketuaDesa)).toEqual(['kelompok', 'desa'])
  })
  it('Daerah boleh membuat kelompok + desa + daerah, TIDAK ppg/super_admin', () => {
    const result = getAllowedTargetTingkatan(ketuaDaerah)
    expect(result).toEqual(['kelompok', 'desa', 'daerah'])
    expect(result).not.toContain('ppg')
    expect(result).not.toContain('super_admin')
  })
  it('PPG tidak boleh membuat siapapun', () => {
    expect(getAllowedTargetTingkatan(ppgUser)).toEqual([])
  })
  it('Super Admin boleh membuat semua tingkatan kecuali super_admin', () => {
    const result = getAllowedTargetTingkatan(superAdmin)
    expect(result).toEqual(['kelompok', 'desa', 'daerah', 'ppg'])
    expect(result).not.toContain('super_admin')
  })
  it('array kosong untuk user/role null', () => {
    expect(getAllowedTargetTingkatan(null)).toEqual([])
    expect(getAllowedTargetTingkatan(undefined)).toEqual([])
  })
})
