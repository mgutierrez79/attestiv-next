'use client';
// Users & RBAC.
//
// Real user management wired to the admin API (/v1/admin/users):
// list, create, edit roles/status, reset password, delete. Passwords
// are hashed server-side (the endpoint never returns the hash). Roles
// are the four the backend RBAC actually enforces — admin (superset),
// reporter, reader, auditor — not the earlier mock's "engineer".

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Card,
  CardTitle,
  FormField,
  GhostButton,
  PrimaryButton,
  Select,
  TextInput,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch, apiJson, ApiError } from '../lib/api'

import { useI18n } from '../lib/i18n'

type Role = 'admin' | 'reporter' | 'reader' | 'auditor'

const ROLES: Role[] = ['admin', 'reporter', 'reader', 'auditor']

const ROLE_TONE: Record<Role, 'navy' | 'blue' | 'green' | 'gray'> = {
  admin: 'navy',
  auditor: 'blue',
  reader: 'green',
  reporter: 'gray',
}

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Full access: user management, key rotation, tenant + scoring settings.',
  reporter: 'Generate reports, manage remediation/exceptions. No admin settings.',
  reader: 'Read-only across the console.',
  auditor: 'Read-only, scoped to audit endpoints. For external auditors.',
}

type User = {
  subject: string
  email?: string
  name?: string
  roles: Role[]
  status?: string
  created_at?: string
  updated_at?: string
}

function normalizeUser(raw: any): User {
  const rolesRaw = Array.isArray(raw?.roles) ? raw.roles : typeof raw?.roles === 'string' ? raw.roles.split(/[;,]/) : []
  const roles = rolesRaw
    .map((r: unknown) => String(r).trim().toLowerCase())
    .filter((r: string): r is Role => (ROLES as string[]).includes(r))
  return {
    subject: String(raw?.subject ?? ''),
    email: raw?.email ? String(raw.email) : undefined,
    name: raw?.name ? String(raw.name) : undefined,
    roles,
    status: raw?.status ? String(raw.status) : 'active',
    created_at: raw?.created_at ? String(raw.created_at) : undefined,
    updated_at: raw?.updated_at ? String(raw.updated_at) : undefined,
  }
}

export function AttestivUsersAndRbacPage() {
  const { t } = useI18n()

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; user: User } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<{ items?: any[] }>('/admin/users')
      const items = Array.isArray(data?.items) ? data.items : []
      setUsers(items.map(normalizeUser).filter((u) => u.subject))
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to load users'
      setError(`${msg}. The admin users API requires an admin session.`)
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const totals: Record<Role, number> = { admin: 0, reporter: 0, reader: 0, auditor: 0 }
    for (const user of users) {
      for (const role of user.roles) totals[role] += 1
    }
    return totals
  }, [users])

  async function handleDelete(user: User) {
    if (!window.confirm(`Delete user ${user.subject}? This cannot be undone.`)) return
    setError(null)
    setNotice(null)
    try {
      await apiFetch(`/admin/users/${encodeURIComponent(user.subject)}`, { method: 'DELETE' })
      setNotice(`Deleted ${user.subject}.`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    }
  }

  return (
    <>
      <Topbar
        title={t('Users & RBAC', 'Users & RBAC')}
        right={
          <PrimaryButton onClick={() => { setNotice(null); setDialog({ mode: 'create' }) }}>
            <i className="ti ti-user-plus" aria-hidden="true" />
            {t('Add user', 'Add user')}
          </PrimaryButton>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="red">{error}</Banner> : null}
        {notice ? <Banner tone="blue">{notice}</Banner> : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10,
            marginBottom: 14,
          }}
        >
          {ROLES.map((role) => (
            <div
              key={role}
              style={{
                background: 'var(--color-background-secondary)',
                borderRadius: 'var(--border-radius-md)',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Badge tone={ROLE_TONE[role]}>{role}</Badge>
              <div style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 500 }}>{counts[role]}</div>
            </div>
          ))}
        </div>

        <Card>
          <CardTitle right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{users.length} users</span>}>
            {t('Local users', 'Local users')}
          </CardTitle>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '16px 0' }}>{t('Loading...', 'Loading...')}</div>
          ) : users.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '16px 0' }}>
              {t('No local users yet. Add one to enable username/password sign-in.', 'No local users yet. Add one to enable username/password sign-in.')}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 10px 6px 0' }}>{t('User', 'User')}</th>
                    <th style={{ padding: '6px 10px' }}>{t('Roles', 'Roles')}</th>
                    <th style={{ padding: '6px 10px' }}>{t('Status', 'Status')}</th>
                    <th style={{ padding: '6px 10px' }}>{t('Created', 'Created')}</th>
                    <th style={{ padding: '6px 0 6px 10px', textAlign: 'right' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.subject} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                      <td style={{ padding: '10px 10px 10px 0' }}>
                        <div style={{ fontWeight: 500 }}>{user.name || user.subject}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{user.email || user.subject}</div>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {user.roles.length > 0 ? (
                            user.roles.map((role) => <Badge key={role} tone={ROLE_TONE[role]}>{role}</Badge>)
                          ) : (
                            <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <Badge tone={user.status === 'active' || !user.status ? 'green' : 'gray'}>{user.status || 'active'}</Badge>
                      </td>
                      <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>
                        {user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '10px 0 10px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <GhostButton onClick={() => { setNotice(null); setDialog({ mode: 'edit', user }) }}>{t('Edit', 'Edit')}</GhostButton>
                        <GhostButton onClick={() => handleDelete(user)}>{t('Delete', 'Delete')}</GhostButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card style={{ marginTop: 10 }}>
          <CardTitle>{t('Role definitions', 'Role definitions')}</CardTitle>
          <div style={{ display: 'grid', gap: 8 }}>
            {ROLES.map((role) => (
              <div key={role} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12, paddingBottom: 8, borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                <Badge tone={ROLE_TONE[role]}>{role}</Badge>
                <span style={{ color: 'var(--color-text-secondary)', flex: 1 }}>{ROLE_DESCRIPTIONS[role]}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {dialog ? (
        <UserDialog
          mode={dialog.mode}
          user={dialog.mode === 'edit' ? dialog.user : undefined}
          onClose={() => setDialog(null)}
          onSaved={(msg) => { setDialog(null); setNotice(msg); void load() }}
          onError={(msg) => setError(msg)}
        />
      ) : null}
    </>
  )
}

function Banner({ tone, children }: { tone: 'red' | 'blue'; children: ReactNode }) {
  const color = tone === 'red' ? 'var(--color-status-red-deep)' : 'var(--color-status-blue-deep)'
  const bg = tone === 'red' ? 'var(--color-status-red-bg)' : 'var(--color-status-blue-bg)'
  return (
    <div style={{ fontSize: 12, color, background: bg, padding: '8px 12px', borderRadius: 'var(--border-radius-md)', marginBottom: 12 }}>
      {children}
    </div>
  )
}

function UserDialog({
  mode,
  user,
  onClose,
  onSaved,
  onError,
}: {
  mode: 'create' | 'edit'
  user?: User
  onClose: () => void
  onSaved: (msg: string) => void
  onError: (msg: string) => void
}) {
  const { t } = useI18n()
  const [subject, setSubject] = useState(user?.subject ?? '')
  const [name, setName] = useState(user?.name ?? '')
  const [roles, setRoles] = useState<Role[]>(user?.roles ?? ['reader'])
  const [status, setStatus] = useState(user?.status ?? 'active')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  function toggleRole(role: Role) {
    setRoles((current) => (current.includes(role) ? current.filter((r) => r !== role) : [...current, role]))
  }

  async function submit() {
    if (mode === 'create' && (!subject.trim() || !password)) {
      onError('Username and password are required.')
      return
    }
    if (roles.length === 0) {
      onError('Select at least one role.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'create') {
        await apiFetch('/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: subject.trim(),
            email: subject.trim(),
            name: name.trim(),
            roles,
            status,
            password,
          }),
        })
        onSaved(`Created ${subject.trim()}.`)
      } else {
        const body: Record<string, unknown> = { name: name.trim(), roles, status }
        if (password) body.password = password
        await apiFetch(`/admin/users/${encodeURIComponent(user!.subject)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        onSaved(`Updated ${user!.subject}.`)
      }
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(4, 44, 83, 0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--color-background-primary)', borderRadius: 'var(--border-radius-lg)', padding: '20px 22px', width: 'min(460px, 100%)', boxShadow: '0 20px 50px rgba(0,0,0,0.18)' }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {mode === 'create' ? t('Add user', 'Add user') : t('Edit user', 'Edit user')}
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)' }} aria-label={t('Close', 'Close')}>
            <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 16 }} />
          </button>
        </div>

        <FormField label={t('Username (email)', 'Username (email)')}>
          <TextInput
            type="email"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder={t('user@acme.example', 'user@acme.example')}
            disabled={mode === 'edit'}
            autoFocus={mode === 'create'}
          />
        </FormField>
        <FormField label={t('Display name (optional)', 'Display name (optional)')}>
          <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder={t('Jane Doe', 'Jane Doe')} />
        </FormField>

        <FormField label={t('Roles', 'Roles')}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 2 }}>
            {ROLES.map((role) => (
              <label key={role} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={roles.includes(role)} onChange={() => toggleRole(role)} />
                {role}
              </label>
            ))}
          </div>
        </FormField>

        <FormField label={t('Status', 'Status')}>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </Select>
        </FormField>

        <FormField
          label={mode === 'create' ? t('Password', 'Password') : t('Reset password (optional)', 'Reset password (optional)')}
          hint={t('At least 12 characters. Stored hashed (PBKDF2); never shown again.', 'At least 12 characters. Stored hashed (PBKDF2); never shown again.')}
        >
          <TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••••" autoComplete="new-password" />
        </FormField>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <GhostButton onClick={onClose}>{t('Cancel', 'Cancel')}</GhostButton>
          <PrimaryButton disabled={busy} onClick={submit}>
            {busy ? t('Saving…', 'Saving…') : mode === 'create' ? t('Create', 'Create') : t('Save', 'Save')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}
