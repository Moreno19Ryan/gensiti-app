import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// Test kontrak (Prioritas #3 NATIVE_READINESS_AUDIT.md, dikerjakan tepat setelah Prioritas #2
// migrasi otorisasi ke RPC selesai -- lihat PLAN_MIGRASI_OTORISASI_RPC.md). Mengunci perilaku
// 5 fungsi otorisasi MURNI di schema public yang jadi sumber kebenaran tunggal sejak migrasi
// Fase 1 (add_shared_authorization_helpers, 21 Juli 2026).
//
// Beda dari lib/roles.test.ts (unit test murni, tanpa jaringan): file ini SATU-SATUNYA test
// yang benar-benar memanggil Supabase, pakai ANON KEY (bukan secret -- sama persis yang dipakai
// client browser & aman muncul apa adanya di CI/publik). Kasus di sini mirror PERSIS 30 skenario
// yang diverifikasi manual via SQL saat migrasi diterapkan; menaruhnya di sini membuat verifikasi
// itu PERMANEN & otomatis (kalau ada yang mengubah fungsi ini di masa depan dan perilakunya
// diam-diam berubah, test ini akan merah), bukan sekali jalan lalu terlupakan.
//
// SENGAJA hanya menguji fungsi MURNI (parameter eksplisit, granted ke anon) -- wrapper
// self-check yang bergantung auth.uid() (can_manage_members, get_generus_biodata,
// update_generus_biodata, update_user_profile) butuh sesi login sungguhan (test user
// ber-kredensial), yang di luar cakupan file ini. Alasan: super_admin adalah akun tunggal
// mutlak (trigger enforce_single_super_admin menolak baris kedua), jadi skenario yang
// melibatkan super_admin tidak bisa punya fixture test terisolasi -- tetap diverifikasi manual
// (ad-hoc SQL) tiap ada perubahan RPC terkait, bukan lewat suite otomatis ini.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Skip diam-diam (bukan gagal) kalau env belum diset -- konsisten dgn cara file test lain di
// proyek ini memperlakukan ketiadaan .env.local; CI mengisi keduanya (lihat ci.yml).
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } })
  : null

describe.skipIf(!supabase)('Kontrak RPC otorisasi (public schema, anon key, read-only/murni)', () => {
  describe('member_management_allowed(tingkatan, nama_role)', () => {
    it('super_admin -> true', async () => {
      const { data, error } = await supabase!.rpc('member_management_allowed', { p_tingkatan: 'super_admin', p_nama_role: null })
      expect(error).toBeNull()
      expect(data).toBe(true)
    })
    it('ketua kelompok -> true', async () => {
      const { data } = await supabase!.rpc('member_management_allowed', { p_tingkatan: 'kelompok', p_nama_role: 'Ketua' })
      expect(data).toBe(true)
    })
    it('wakil ketua desa -> true', async () => {
      const { data } = await supabase!.rpc('member_management_allowed', { p_tingkatan: 'desa', p_nama_role: 'Wakil Ketua' })
      expect(data).toBe(true)
    })
    it('sekretaris daerah -> true', async () => {
      const { data } = await supabase!.rpc('member_management_allowed', { p_tingkatan: 'daerah', p_nama_role: 'Sekretaris' })
      expect(data).toBe(true)
    })
    it('bendahara -> false', async () => {
      const { data } = await supabase!.rpc('member_management_allowed', { p_tingkatan: 'kelompok', p_nama_role: 'Bendahara' })
      expect(data).toBe(false)
    })
    it('generus biasa -> false', async () => {
      const { data } = await supabase!.rpc('member_management_allowed', { p_tingkatan: 'kelompok', p_nama_role: 'Generus' })
      expect(data).toBe(false)
    })
    it('ppg -> false', async () => {
      const { data } = await supabase!.rpc('member_management_allowed', { p_tingkatan: 'ppg', p_nama_role: 'PPG' })
      expect(data).toBe(false)
    })
    it('nama_role null -> false', async () => {
      const { data } = await supabase!.rpc('member_management_allowed', { p_tingkatan: 'kelompok', p_nama_role: null })
      expect(data).toBe(false)
    })
  })

  describe('scope_action_allowed(tingkatan, nama_role, caller_desa, caller_kel, target_desa, target_kel)', () => {
    const DESA_A = '11111111-1111-1111-1111-111111111111'
    const DESA_B = '22222222-2222-2222-2222-222222222222'
    const KEL_A = '33333333-3333-3333-3333-333333333333'

    it('super_admin lintas scope -> true', async () => {
      const { data } = await supabase!.rpc('scope_action_allowed', {
        p_tingkatan: 'super_admin', p_nama_role: null, p_caller_desa_id: null, p_caller_kelompok_id: null,
        p_target_desa_id: DESA_A, p_target_kelompok_id: null,
      })
      expect(data).toBe(true)
    })
    it('daerah lintas scope -> true', async () => {
      const { data } = await supabase!.rpc('scope_action_allowed', {
        p_tingkatan: 'daerah', p_nama_role: 'Ketua', p_caller_desa_id: null, p_caller_kelompok_id: null,
        p_target_desa_id: DESA_A, p_target_kelompok_id: null,
      })
      expect(data).toBe(true)
    })
    it('desa cocok -> true', async () => {
      const { data } = await supabase!.rpc('scope_action_allowed', {
        p_tingkatan: 'desa', p_nama_role: 'Ketua', p_caller_desa_id: DESA_A, p_caller_kelompok_id: null,
        p_target_desa_id: DESA_A, p_target_kelompok_id: null,
      })
      expect(data).toBe(true)
    })
    it('desa beda -> false', async () => {
      const { data } = await supabase!.rpc('scope_action_allowed', {
        p_tingkatan: 'desa', p_nama_role: 'Ketua', p_caller_desa_id: DESA_A, p_caller_kelompok_id: null,
        p_target_desa_id: DESA_B, p_target_kelompok_id: null,
      })
      expect(data).toBe(false)
    })
    it('desa keduanya null -> true (IS NOT DISTINCT FROM, mirror JS ===)', async () => {
      const { data } = await supabase!.rpc('scope_action_allowed', {
        p_tingkatan: 'desa', p_nama_role: 'Ketua', p_caller_desa_id: null, p_caller_kelompok_id: null,
        p_target_desa_id: null, p_target_kelompok_id: null,
      })
      expect(data).toBe(true)
    })
    it('kelompok cocok -> true', async () => {
      const { data } = await supabase!.rpc('scope_action_allowed', {
        p_tingkatan: 'kelompok', p_nama_role: 'Ketua', p_caller_desa_id: null, p_caller_kelompok_id: KEL_A,
        p_target_desa_id: null, p_target_kelompok_id: KEL_A,
      })
      expect(data).toBe(true)
    })
    it('bukan pengurus -> false (gagal di member_management_allowed dulu)', async () => {
      const { data } = await supabase!.rpc('scope_action_allowed', {
        p_tingkatan: 'daerah', p_nama_role: 'Bendahara', p_caller_desa_id: null, p_caller_kelompok_id: null,
        p_target_desa_id: DESA_A, p_target_kelompok_id: null,
      })
      expect(data).toBe(false)
    })
  })

  describe('tingkatan_hierarchy_allowed(caller_tingkatan)', () => {
    it('kelompok -> [kelompok]', async () => {
      const { data } = await supabase!.rpc('tingkatan_hierarchy_allowed', { p_caller_tingkatan: 'kelompok' })
      expect(data).toEqual(['kelompok'])
    })
    it('desa -> [kelompok, desa]', async () => {
      const { data } = await supabase!.rpc('tingkatan_hierarchy_allowed', { p_caller_tingkatan: 'desa' })
      expect(data).toEqual(['kelompok', 'desa'])
    })
    it('daerah -> [kelompok, desa, daerah]', async () => {
      const { data } = await supabase!.rpc('tingkatan_hierarchy_allowed', { p_caller_tingkatan: 'daerah' })
      expect(data).toEqual(['kelompok', 'desa', 'daerah'])
    })
    it('ppg -> [] (tak pernah boleh membuat/mengubah role siapapun)', async () => {
      const { data } = await supabase!.rpc('tingkatan_hierarchy_allowed', { p_caller_tingkatan: 'ppg' })
      expect(data).toEqual([])
    })
    it('super_admin -> [kelompok, desa, daerah, ppg] (kecuali super_admin sendiri)', async () => {
      const { data } = await supabase!.rpc('tingkatan_hierarchy_allowed', { p_caller_tingkatan: 'super_admin' })
      expect(data).toEqual(['kelompok', 'desa', 'daerah', 'ppg'])
    })
    it('null -> []', async () => {
      const { data } = await supabase!.rpc('tingkatan_hierarchy_allowed', { p_caller_tingkatan: null })
      expect(data).toEqual([])
    })
    it('tingkatan tak dikenal -> []', async () => {
      const { data } = await supabase!.rpc('tingkatan_hierarchy_allowed', { p_caller_tingkatan: 'planet_mars' })
      expect(data).toEqual([])
    })
  })

  describe('tingkatan_assignment_allowed(caller_tingkatan, target_tingkatan)', () => {
    it('target null -> selalu true', async () => {
      const { data } = await supabase!.rpc('tingkatan_assignment_allowed', { p_caller_tingkatan: 'kelompok', p_target_tingkatan: null })
      expect(data).toBe(true)
    })
    it('target kosong -> selalu true', async () => {
      const { data } = await supabase!.rpc('tingkatan_assignment_allowed', { p_caller_tingkatan: 'kelompok', p_target_tingkatan: '' })
      expect(data).toBe(true)
    })
    it('desa -> kelompok: boleh (turun jenjang)', async () => {
      const { data } = await supabase!.rpc('tingkatan_assignment_allowed', { p_caller_tingkatan: 'desa', p_target_tingkatan: 'kelompok' })
      expect(data).toBe(true)
    })
    it('kelompok -> desa: tidak boleh (naik jenjang)', async () => {
      const { data } = await supabase!.rpc('tingkatan_assignment_allowed', { p_caller_tingkatan: 'kelompok', p_target_tingkatan: 'desa' })
      expect(data).toBe(false)
    })
    it('super_admin -> ppg: boleh', async () => {
      const { data } = await supabase!.rpc('tingkatan_assignment_allowed', { p_caller_tingkatan: 'super_admin', p_target_tingkatan: 'ppg' })
      expect(data).toBe(true)
    })
    it('super_admin -> super_admin: tidak boleh (akun tunggal mutlak)', async () => {
      const { data } = await supabase!.rpc('tingkatan_assignment_allowed', { p_caller_tingkatan: 'super_admin', p_target_tingkatan: 'super_admin' })
      expect(data).toBe(false)
    })
    it('ppg -> apapun: tidak boleh', async () => {
      const { data } = await supabase!.rpc('tingkatan_assignment_allowed', { p_caller_tingkatan: 'ppg', p_target_tingkatan: 'kelompok' })
      expect(data).toBe(false)
    })
  })

  describe('normalize_login_username(raw)', () => {
    it('trim + collapse spasi ganda + uppercase', async () => {
      const { data } = await supabase!.rpc('normalize_login_username', { p_raw: '  ahmad   fauzi  ' })
      expect(data).toBe('AHMAD FAUZI')
    })
    it('nama yang sudah rapi tetap konsisten', async () => {
      const { data } = await supabase!.rpc('normalize_login_username', { p_raw: 'Budi Santoso' })
      expect(data).toBe('BUDI SANTOSO')
    })
  })
})
