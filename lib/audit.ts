import * as Sentry from '@sentry/nextjs'
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
    } catch (err) {
    // Audit log gagal tidak boleh menghentikan operasi utama (fail-open by design) --
    // tapi kegagalannya sendiri tetap harus terlihat, jadi dilaporkan diam-diam ke Sentry
    // (bukan dilempar ke client) supaya jejak audit yang bolong tidak lolos tanpa jejak sama sekali.
    console.warn('[GENSITI] Audit log gagal:', { action, module, targetDesc })
    Sentry.captureException(err, { extra: { action, module, targetDesc, targetId } })
  }
}
