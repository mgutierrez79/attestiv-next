// Mapping from catalog auth-field keys (api_key, username, etc.)
// to the wizard's render shape. Centralising this means a new auth
// method only needs one descriptor entry to surface in the UI.
//
// Keys not in the map fall through to a sensible default (text
// input, label = humanised key). Adding a new descriptor is
// preferred so the hint copy can explain provider quirks.

export type AuthFieldDescriptor = {
  // Form label rendered above the input.
  label: string
  // Help text rendered below in muted color. Optional.
  hint?: string
  // 'password' renders an obscured input + masks the value in the
  // settings page after save. Anything else is plain text.
  type?: 'text' | 'password'
}

export const AUTH_FIELD_DESCRIPTORS: Record<string, AuthFieldDescriptor> = {
  api_key: {
    label: 'API key',
    type: 'password',
    hint: 'Generate from the connector vendor admin console.',
  },
  api_token: {
    label: 'API token',
    type: 'password',
  },
  token: {
    label: 'Token',
    type: 'password',
  },
  password: {
    label: 'Password',
    type: 'password',
  },
  username: {
    label: 'Username',
  },
  client_id: {
    label: 'OAuth client ID',
  },
  client_secret: {
    label: 'OAuth client secret',
    type: 'password',
  },
  app_token: {
    label: 'App token',
    type: 'password',
  },
  user_token: {
    label: 'User token',
    type: 'password',
  },
  access_key: {
    label: 'Access key ID',
  },
  secret_key: {
    label: 'Secret access key',
    type: 'password',
  },
  session_token: {
    label: 'Session token',
    type: 'password',
  },
  serial: {
    label: 'Serial number',
    hint: 'Used for HA-aware scoping.',
  },
  customer: {
    label: 'Customer perimeter',
    hint: 'Your mySOC perimeter slug — the first path segment of the mySOC API URL.',
  },
  tenant_id: {
    label: 'Directory (tenant) ID',
    hint: 'Azure AD / Entra tenant GUID (Entra admin center → Overview).',
  },
  workspace_id: {
    label: 'Log Analytics workspace ID',
    hint: 'GUID of the Sentinel / Log Analytics workspace the queries run against (Sentinel → Settings → Workspace settings → Workspace ID). Not the workspace name.',
  },
  access_token: {
    label: 'Access token',
    type: 'password',
    hint: 'Bearer token for the Log Analytics API. Azure tokens are short-lived (~1h) — fine for a test, but use the app method for unattended polling.',
  },
  base_dn: {
    label: 'Base DN',
    hint: 'LDAP search root, e.g. DC=corp,DC=example,DC=com. Leave blank to auto-detect from the directory (RootDSE defaultNamingContext).',
  },
}

export function describeAuthField(key: string): AuthFieldDescriptor {
  const known = AUTH_FIELD_DESCRIPTORS[key]
  if (known) return known
  // Fallback: humanise unknown_key → "Unknown key".
  const label = key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
  return { label }
}

// Auth-method grouping. A connector's catalog `auth[]` is a flat list
// of credential keys the backend accepts, but those keys typically
// represent MUTUALLY EXCLUSIVE methods — e.g. Palo Alto accepts
// `[api_key, username, password]` to mean "use the API key OR the
// username/password pair, not both". Rendering all three at once is
// confusing; this module groups them so the wizard can show a method
// picker and render only the active method's fields.
//
// Add a method here when a new catalog combination shows up. Order
// matters: composite methods are matched before single-field ones, so
// `username+password` claims those keys before a hypothetical
// standalone `password` method would.

export type AuthMethod = {
  // Stable identifier so the wizard can track which method the user
  // picked across re-renders (and clear the other method's fields
  // when they switch).
  key: string
  // Tab/segmented-button label.
  label: string
  // Optional context line under the picker once active.
  hint?: string
  // Credential keys, in render order, that belong to this method.
  fieldKeys: string[]
}

// Fields that belong to connector-specific configuration (e.g. PAN-OS
// firewall serial number, mySOC customer perimeter) and should always
// be visible regardless of which auth method is active. These are
// pulled out of the auth list into a separate "common fields" bucket
// so they don't get mistaken for mutually-exclusive auth methods (which
// would render a method picker and hide them behind a tab).
const NON_AUTH_FIELDS: ReadonlySet<string> = new Set(['serial', 'customer', 'perimeter', 'workspace_id', 'base_dn'])

type AuthMethodDef = {
  key: string
  label: string
  hint?: string
  match: (keys: ReadonlySet<string>) => string[] | null
}

const AUTH_METHOD_DEFINITIONS: AuthMethodDef[] = [
  {
    key: 'username_password',
    label: 'Username + password',
    hint: 'Use the service-account credentials configured on the target.',
    match: (keys) => (keys.has('username') && keys.has('password') ? ['username', 'password'] : null),
  },
  {
    key: 'oauth_client',
    label: 'OAuth (client ID + secret)',
    hint: 'OAuth 2.0 client credentials grant; the connector auto-refreshes the token.',
    // tenant_id belongs to this method when present (Azure/Entra apps),
    // so it renders WITH the client id/secret instead of being orphaned
    // into its own bogus single-field method.
    match: (keys) => {
      if (!keys.has('client_id') || !keys.has('client_secret')) return null
      const fields: string[] = []
      if (keys.has('tenant_id')) fields.push('tenant_id')
      fields.push('client_id', 'client_secret')
      return fields
    },
  },
  {
    key: 'aws_keys',
    label: 'AWS access keys',
    hint: 'IAM access key + secret (and optional session token for STS).',
    match: (keys) => {
      if (!keys.has('access_key') || !keys.has('secret_key')) return null
      const fields = ['access_key', 'secret_key']
      if (keys.has('session_token')) fields.push('session_token')
      return fields
    },
  },
  {
    key: 'glpi_tokens',
    label: 'GLPI app + user tokens',
    hint: 'Both tokens are required; the app token authorises the API client and the user token authenticates the operator.',
    match: (keys) => (keys.has('app_token') && keys.has('user_token') ? ['app_token', 'user_token'] : null),
  },
  {
    key: 'api_key',
    label: 'API key',
    hint: 'Single static key; preferred over username/password when the vendor supports it.',
    match: (keys) => (keys.has('api_key') ? ['api_key'] : null),
  },
  {
    key: 'api_token',
    label: 'API token',
    hint: 'Generated from the vendor admin console with the required scopes.',
    match: (keys) => (keys.has('api_token') ? ['api_token'] : null),
  },
  {
    key: 'access_token',
    label: 'Access token',
    hint: 'Paste a bearer token for the API. Azure tokens are short-lived (~1h) — prefer the app method for unattended polling.',
    match: (keys) => (keys.has('access_token') ? ['access_token'] : null),
  },
  {
    key: 'token',
    label: 'Token',
    match: (keys) => (keys.has('token') ? ['token'] : null),
  },
]

// groupAuthMethods splits a flat credential-field list into:
//   - commonFields: connector-specific config that's not an auth choice
//   - methods: mutually-exclusive auth method groups
//
// If `methods.length <= 1` the caller should not render a picker —
// there is only one way to authenticate.
export function groupAuthMethods<T extends { key: string }>(
  fields: T[],
): { commonFields: T[]; methods: AuthMethod[] } {
  const allKeys = new Set(fields.map((f) => f.key))
  const consumed = new Set<string>()
  const commonFields: T[] = []
  const methods: AuthMethod[] = []

  for (const field of fields) {
    if (NON_AUTH_FIELDS.has(field.key)) {
      commonFields.push(field)
      consumed.add(field.key)
    }
  }

  for (const def of AUTH_METHOD_DEFINITIONS) {
    const matched = def.match(allKeys)
    if (!matched) continue
    if (matched.some((k) => consumed.has(k))) continue
    methods.push({ key: def.key, label: def.label, hint: def.hint, fieldKeys: matched })
    matched.forEach((k) => consumed.add(k))
  }

  // Any remaining auth field becomes its own single-field method —
  // ensures unknown keys still surface in the UI.
  for (const field of fields) {
    if (consumed.has(field.key)) continue
    methods.push({ key: field.key, label: describeAuthField(field.key).label, fieldKeys: [field.key] })
    consumed.add(field.key)
  }

  return { commonFields, methods }
}
