import { supabase } from './supabase'
import { UserProfile } from './types'

type AuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE'
  | 'LOGIN' | 'LOGOUT'
  | 'ACTIVATE' | 'DEACTIVATE'
  | 'UPLOAD' | 'DOWNLOAD'
  | 'EXPORT' | 'IMPORT'
  | 'VIEW'

export async function logAudit(
  user: UserProfile,
  action: AuditAction,
  module: string,
  targetDesc?: string,
  detail?: Record<string, unknown>,
  targetId?: string
) {
  try {
    await supabase.from('audit_log').insert({
      user_id: user.id,
      user_email: user.email,
      user_role: user.role?.tingkatan || '',
      action,
      module,
      target_id: targetId || null,
      target_desc: targetDesc || null,
      detail: detail || {},
      status: 'success',
      // Scope: untuk filter audit log per tingkatan
      desa_id: user.desa_id || null,
      kelompok_id: user.kelompok_id || null,
    })
    } catch {
    // Audit log gagal tidak boleh menghentikan operasi utama
    console.warn('[GENSITI] Audit log gagal:', { action, module, targetDesc })
  }
}
