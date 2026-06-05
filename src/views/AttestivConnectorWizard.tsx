'use client';
// Connector wizard.
//
// Four-step flow that lives inside the console: pick connector kind,
// fill credentials, run a connection test, save & schedule. The page
// keeps form state in React; only the final step makes a real backend
// call. The test button is best-effort — if /v1/connectors/test isn't
// available it's degraded into a "deferred" outcome so the user can
// still complete the wizard.
//
// Why a wizard rather than one long form: the eight pilot connectors
// have wildly different credential shapes (PAN-OS API key, vCenter
// SSO, Veeam OAuth, GLPI app+user tokens). Splitting the steps lets
// the credential block be replaced cleanly per kind without the rest
// of the form rerendering.

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import {
  Badge,
  Card,
  FormField,
  GhostButton,
  PrimaryButton,
  Select,
  Stepper,
  TextInput,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch, ApiError } from '../lib/api'
import { ConnectorLogo, connectorBrandHex } from '../components/ConnectorLogo'
import {
  loadConnectorCatalog,
  authFieldsFor,
  type ConnectorCatalogEntry,
} from '../lib/connectorCatalog'
import { describeAuthField, groupAuthMethods, type AuthMethod } from '../lib/connectorAuthFields'

import { useI18n } from '../lib/i18n';

type CredentialField = {
  key: string
  label: string
  type?: 'text' | 'password'
  hint?: string
  required?: boolean
}

// Mirrors internal/security/secrets.go IsSecretField. Used to decide
// whether a "********" value in the loaded edit response is a real
// masked secret (clear in the form, prompt for re-type) versus a
// literal eight-asterisk string (which we'd then pass through as-is
// — unlikely but supported).
const SECRET_FIELD_NAMES = new Set([
  'api_key',
  'api_token',
  'app_token',
  'access_key',
  'access_token',
  'client_secret',
  'password',
  'bnr_password',
  'secret',
  'secret_key',
  'session_token',
  'token',
  'user_token',
])
const MASKED_SECRET = '********'

function isSecretFieldName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  if (SECRET_FIELD_NAMES.has(normalized)) return true
  return normalized.endsWith('_secret') || normalized.endsWith('_token')
}

type ConnectorKind = {
  value: string
  label: string
  category: 'Network' | 'Storage' | 'Virtualization' | 'Backup' | 'ITSM' | 'Observability' | 'Security' | 'Identity' | 'Hardware'
  endpointHint: string
  fields: CredentialField[]
  pollDefault: number
  // Some connectors derive every URL from their auth fields (the Azure
  // ones: tenant_id + workspace_id + standard Microsoft hosts), so
  // there's no endpoint host to enter. When true the wizard doesn't
  // require the endpoint field.
  endpointOptional?: boolean
}

const STEPS = ['Pick connector', 'Credentials', 'Test connection', 'Save & schedule']

const CONNECTORS: ConnectorKind[] = [
  // Note on `fields`: this is now a SEED list. The wizard merges
  // each kind's seed fields with the catalog's `auth[]` array at
  // runtime (loadConnectorCatalog → authFieldsFor). Anything the
  // catalog declares that isn't in the seed gets rendered with the
  // descriptor map's defaults; anything in the seed that isn't in
  // the catalog still renders (so vendor niceties like "serial"
  // survive). Result: the wizard cannot drift from backend reality.
  {
    value: 'palo_alto_panorama',
    label: 'Palo Alto Panorama',
    category: 'Network',
    endpointHint: 'https://panorama.acme.internal',
    fields: [],
    pollDefault: 600,
  },
  {
    value: 'palo_alto_firewall',
    label: 'Palo Alto firewall (PAN-OS)',
    category: 'Network',
    endpointHint: 'https://fw01.acme.internal',
    fields: [
      { key: 'serial', label: 'Serial number', hint: 'Used for HA-aware scoping.' },
    ],
    pollDefault: 600,
  },
  // Dell DataDomain cards removed — Veeam EM already covers the
  // backup-job + repo-capacity evidence and the direct integration
  // didn't move the scoring needle. Backend collector code retained
  // (storage.go + data_domain_ssh.go) but no longer surfaced.
  {
    value: 'idrac',
    label: 'Dell iDRAC (Redfish)',
    category: 'Hardware',
    endpointHint: 'https://idrac-srv-01.acme.internal',
    fields: [
      { key: 'username', label: 'iDRAC username', required: true, hint: 'iDRAC local account with Operator or Administrator role.' },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    pollDefault: 21600,
  },
  {
    value: 'ilom',
    label: 'Oracle ILOM (Redfish)',
    category: 'Hardware',
    endpointHint: 'https://ilom-srv-01.acme.internal',
    fields: [
      { key: 'username', label: 'ILOM username', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    pollDefault: 21600,
  },
  {
    value: 'dell_openmanage',
    label: 'Dell OpenManage Enterprise',
    category: 'Hardware',
    endpointHint: 'https://ome.acme.internal',
    fields: [
      { key: 'username', label: 'OME username', required: true, hint: 'Fleet management account on OpenManage Enterprise — one endpoint covers all Dell servers OME manages.' },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    pollDefault: 21600,
  },
  {
    value: 'dell_powerstore',
    label: 'Dell PowerStore',
    category: 'Storage',
    endpointHint: 'https://powerstore.acme.internal',
    fields: [
      { key: 'username', label: 'Username', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    pollDefault: 1800,
  },
  {
    value: 'vmware_vcenter',
    label: 'VMware vCenter',
    category: 'Virtualization',
    endpointHint: 'https://vcenter.acme.internal',
    fields: [
      { key: 'username', label: 'SSO username', required: true, hint: 'Service account, e.g. attestiv@vsphere.local.' },
      { key: 'password', label: 'SSO password', type: 'password', required: true },
    ],
    pollDefault: 900,
  },
  {
    value: 'veeam_em',
    label: 'Veeam Backup Enterprise Manager',
    category: 'Backup',
    endpointHint: 'https://veeam-em.acme.internal',
    fields: [
      { key: 'client_id', label: 'OAuth client id', required: true },
      { key: 'client_secret', label: 'OAuth client secret', type: 'password', required: true },
      // Optional Veeam Backup & Replication REST API (port 9419). Needed
      // for tape jobs + repository (Data Domain) immutability, which
      // Enterprise Manager (9398) does not expose. Leave blank for an
      // all-in-one install — the backend derives <EM-host>:9419 and
      // reuses the EM credentials. Fill these when B&R is a SEPARATE
      // server or needs its own account.
      { key: 'bnr_url', label: 'B&R server URL (optional)', hint: 'Veeam Backup & Replication REST API, e.g. https://vbr-host:9419. Blank = same host as Enterprise Manager (auto-detected).' },
      { key: 'bnr_username', label: 'B&R username (optional)', hint: 'Blank = reuse the Enterprise Manager username. Use a domain-qualified, B&R-authorized account, e.g. ACME\\svc-veeam.' },
      { key: 'bnr_password', label: 'B&R password (optional)', type: 'password', hint: 'Blank = reuse the Enterprise Manager password.' },
    ],
    pollDefault: 1800,
  },
  {
    value: 'glpi',
    label: 'GLPI',
    category: 'ITSM',
    endpointHint: 'https://glpi.acme.example/apirest.php',
    fields: [
      { key: 'app_token', label: 'App token', type: 'password', required: true },
      { key: 'user_token', label: 'User token', type: 'password', required: true },
    ],
    pollDefault: 1800,
  },
  {
    value: 'dynatrace',
    label: 'Dynatrace',
    category: 'Observability',
    endpointHint: 'https://abc12345.live.dynatrace.com',
    fields: [
      { key: 'api_token', label: 'API token (Api-Token)', type: 'password', required: true, hint: 'Needs problems.read and metrics.read scopes.' },
    ],
    pollDefault: 600,
  },
  {
    value: 'zabbix',
    label: 'Zabbix',
    category: 'Observability',
    endpointHint: 'https://zabbix.acme.example',
    fields: [
      { key: 'username', label: 'Username', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    pollDefault: 600,
  },
  {
    value: 'advens_mysoc',
    label: 'Advens mySOC',
    category: 'Security',
    endpointHint: 'https://api.mysoc.io',
    fields: [
      { key: 'customer', label: 'Customer perimeter', required: true, hint: 'Your mySOC perimeter slug — the first path segment of the mySOC API URL.' },
      { key: 'api_token', label: 'API token', type: 'password', required: true, hint: 'mySOC Bearer token (portal → Authorize → Bearer).' },
    ],
    pollDefault: 21600,
  },
  {
    value: 'sentinelone',
    label: 'SentinelOne Singularity',
    category: 'Security',
    endpointHint: 'https://acme.sentinelone.net',
    fields: [
      { key: 'api_token', label: 'API token', type: 'password', required: true, hint: 'Console → Settings → Users → Service Users → Create. Header is "Authorization: ApiToken <token>" — NOT Bearer.' },
      { key: 'site_ids', label: 'Site IDs (optional)', hint: 'Comma-separated SentinelOne site IDs to scope the pull. Leave blank to pull from all sites the token can read.' },
    ],
    pollDefault: 21600,
  },
  {
    value: 'active_directory',
    label: 'Active Directory',
    category: 'Identity',
    endpointHint: 'ldaps://dc01.corp.example.com',
    fields: [
      { key: 'username', label: 'Bind DN or UPN', required: true, hint: 'Service account used for the LDAP bind, e.g. CN=svc-compliance,OU=Service,DC=corp,DC=example,DC=com or svc-compliance@corp.example.com.' },
      { key: 'base_dn', label: 'Base DN', hint: 'Search root, e.g. DC=corp,DC=example,DC=com. Leave blank to auto-detect from RootDSE.' },
    ],
    pollDefault: 21600,
  },
  {
    value: 'microsoft_graph',
    label: 'Microsoft Graph (Entra)',
    category: 'Identity',
    endpointHint: 'Not required — uses your Entra tenant',
    // tenant_id / client_id / client_secret come from the catalog.
    fields: [],
    pollDefault: 21600,
    endpointOptional: true,
  },
  {
    value: 'sentinel',
    label: 'Microsoft Sentinel',
    category: 'Security',
    endpointHint: 'Not required — uses the Log Analytics workspace ID',
    // tenant_id / client_id / client_secret / workspace_id come from
    // the catalog.
    fields: [],
    pollDefault: 21600,
    endpointOptional: true,
  },
  {
    value: 'cisco_catalyst',
    label: 'Cisco Catalyst 9000 (RESTCONF)',
    category: 'Network',
    endpointHint: 'https://sw-paris-core-01.acme.internal',
    fields: [
      { key: 'username', label: 'Username', required: true, hint: 'Local user (priv 15). Suggested: attestiv. Enable on the switch with `restconf` + `ip http secure-server`.' },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    pollDefault: 21600,
  },
  {
    value: 'cisco_catalyst_netconf',
    label: 'Cisco Catalyst 9000 (NETCONF/SSH)',
    category: 'Network',
    endpointHint: 'sw-paris-core-01.acme.internal:830',
    fields: [
      { key: 'username', label: 'Username', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    pollDefault: 21600,
  },
  {
    value: 'cisco_dna_center',
    label: 'Cisco DNA Center',
    category: 'Network',
    endpointHint: 'https://dnac.acme.internal',
    fields: [
      { key: 'username', label: 'DNA Center admin', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
      { key: 'aes_key', label: 'AES-256 key (optional)', type: 'password', hint: 'Only fill this in if you turned on CSCO-AES-256 credential encryption under DNAC System Configuration → AES Key. Accepts 64-char hex or 44-char base64. Leave blank for standard Basic Auth.' },
    ],
    pollDefault: 21600,
  },
  {
    value: 'cisco_psirt',
    label: 'Cisco PSIRT (CVE feed)',
    category: 'Security',
    endpointHint: 'Not required — uses apix.cisco.com',
    fields: [
      { key: 'client_id', label: 'PSIRT API client_id', required: true, hint: 'From apiconsole.cisco.com — Cisco PSIRT openVuln API entitlement.' },
      { key: 'client_secret', label: 'PSIRT API client_secret', type: 'password', hint: 'Use this OR the certificate fields below — not both. Cisco uses one or the other depending on the app type you registered.' },
      { key: 'client_cert', label: 'Client certificate (PEM)', type: 'password', hint: 'Paste the full PEM-encoded X.509 certificate Cisco issued when you chose mTLS. Begins with -----BEGIN CERTIFICATE-----.' },
      { key: 'client_key', label: 'Client private key (PEM)', type: 'password', hint: 'Paste the full PEM-encoded private key paired with the certificate above. Begins with -----BEGIN PRIVATE KEY----- (or RSA PRIVATE KEY).' },
      { key: 'version', label: 'IOS-XE versions', required: true, hint: 'Comma-separated list of IOS-XE versions running across your fleet, e.g. 17.9.4, 17.6.5. Get them from Inventory → Network devices → metadata.software_version.' },
    ],
    pollDefault: 86400,
    endpointOptional: true,
  },
]

type TestResult =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'pass'; details: string }
  | { state: 'fail'; details: string }
  | { state: 'deferred'; details: string }

// META_KEYS lists config keys that describe the connector instance
// itself rather than its authentication. The edit-mode prefill
// projects everything else into the credentials state map so the
// user sees the fields the catalog declared for this kind. Any
// addition here MUST also be excluded from the save body so we
// don't echo it back as a "credential" — the wizard's save
// flow already pulls these from explicit state (endpoint, name,
// pollSeconds, verifyTLS) so dropping them from `credentials` is
// what we want.
const META_KEYS = new Set<string>([
  'name',
  'endpoint',
  'base_url',
  'url',
  'host',
  'items',
  'poll_interval_seconds',
  'verify_tls',
])

// stringField is a tiny helper used by the edit-mode prefill to
// turn `unknown` (the JSON parse result) into a string with empty
// fallback. Numbers and booleans coerce to strings; null/undefined
// become "" so the form inputs stay controlled.
function stringField(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

// numberField turns `unknown` into a non-negative integer. Returns
// 0 when the value is missing or unparseable so the wizard's
// `if (poll > 0) setPollSeconds(...)` guard can decide whether to
// override the kind's default.
function numberField(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  if (typeof value === 'string') {
    const n = parseInt(value, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

// slugifyName mirrors the backend's connectorInstanceSlug rule so
// the wizard can pick the right items[] entry when editing a
// multi-instance row. Same character class as
// internal/httpapi/connectors_routes.go:connectorInstanceSlug.
function slugifyName(value: string): string {
  const lowered = value.trim().toLowerCase()
  let out = ''
  for (const ch of lowered) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) out += ch
    else out += '-'
  }
  return out.replace(/^-+|-+$/g, '')
}

// stripParentGlobals copies the parent-level keys that shouldn't
// override per-item fields when we merge a multi-instance edit. We
// keep verify_tls (parent global) and poll_interval_seconds so the
// form reflects effective behaviour, but drop items[] (we're
// flattening one item) and anything else item-specific. This is
// intentionally lenient — the items[]-specific overrides win.
function stripParentGlobals(parent: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parent)) {
    if (k === 'items') continue
    out[k] = v
  }
  return out
}

export function AttestivConnectorWizard() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const searchParams = useSearchParams()
  // Edit mode: ?edit=<row-name> (e.g. "palo_alto_panorama:auxia-prod").
  // After the flat-instance migration every saved connector is its
  // own top-level row; the wizard fetches the row directly and the
  // form pre-populates from a flat config. The kind for catalog
  // lookup is derived from the base of the row name (before any
  // colon) so the credential-fields panel still shows the right auth
  // surface.
  const editRowName = searchParams?.get('edit') ?? ''
  const editKind = editRowName.includes(':') ? editRowName.split(':', 2)[0] : editRowName
  const isEditMode = editRowName !== ''
  const [step, setStep] = useState(isEditMode ? 1 : 0)
  const [kind, setKind] = useState<string>(isEditMode && editKind ? editKind : 'palo_alto_panorama')
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [pollSeconds, setPollSeconds] = useState<number>(600)
  // TLS verification defaults to ON. Turning it off is required for
  // self-signed certs on private-network deployments but is a
  // foot-gun — the wizard surfaces a red warning when off.
  const [verifyTLS, setVerifyTLS] = useState<boolean>(true)
  const [testResult, setTestResult] = useState<TestResult>({ state: 'idle' })
  const [savingError, setSavingError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ id: string; created_at: string } | null>(null)
  const [catalog, setCatalog] = useState<ConnectorCatalogEntry[]>([])
  // editLoadError is shown above the form when we can't reach the
  // backend to fetch the existing config — without this the wizard
  // would silently render blank fields and a save would create a
  // new row instead of updating the one the user clicked Edit on.
  const [editLoadError, setEditLoadError] = useState<string | null>(null)
  const [editLoading, setEditLoading] = useState<boolean>(isEditMode)
  // Secret fields that came back masked ("********") from the server.
  // In edit mode we clear them from the form so the operator sees a
  // blank input instead of literal asterisks — when they submit it
  // blank we re-mask on the way back so the backend's MergeMasked-
  // Secrets path preserves the existing value. When they type a new
  // value the field name is removed from this set on the next render.
  const [originallyMasked, setOriginallyMasked] = useState<Set<string>>(new Set())

  // Fetch the catalog once at mount. The wizard renders before the
  // fetch resolves; in that window the credential step shows only
  // the seed fields. Once the catalog lands, missing auth fields
  // (e.g. Palo Alto's username/password) appear without a re-render
  // dance because authFieldsFor reads the live catalog state.
  useEffect(() => {
    let cancelled = false
    loadConnectorCatalog()
      .then((entries) => {
        if (!cancelled) setCatalog(entries)
      })
      .catch(() => {
        // Catalog fetch failures degrade the wizard to seed-only
        // fields. The user can still configure connectors using
        // the static fields; the only thing they lose is the
        // catalog-declared extras (e.g. PAN-OS username/password).
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Edit-mode prefill. Runs once at mount when ?edit= is present.
  // The handler:
  //   1. GET /v1/config/connectors/<base-kind> via apiFetch (which
  //      attaches X-Tenant-ID and Bearer) — secrets come back
  //      masked as "********" but the backend's MergeMaskedSecrets
  //      restores them on save, so the user can leave them alone
  //      to keep current creds or type new ones to rotate.
  //   2. For multi-instance kinds (editing palo_alto:panorama-a),
  //      walk items[] and pick the entry whose slugified name
  //      matches the URL's instance slug.
  //   3. Project the loaded values into form state — kind is
  //      already locked via the initial useState above, the rest
  //      (name, endpoint, credentials, pollSeconds, verifyTLS) get
  //      hydrated here.
  useEffect(() => {
    if (!isEditMode || !editKind) return
    let cancelled = false
    // apiFetch carries whichever credential the active auth mode uses
    // (session cookie for local/OIDC, Bearer for apiKey) and throws an
    // ApiError on non-2xx — so no manual apiKey gate or response.ok check.
    apiFetch(`/config/connectors/${encodeURIComponent(editRowName)}`)
      .then(async (response) => {
        if (cancelled) return
        const body = await response.json().catch(() => ({}))
        // The row response is the flat config — one row per
        // connector instance after the migration. No items[]
        // traversal, no parent-globals juggling.
        const target: Record<string, unknown> = body && typeof body === 'object' ? body : {}
        // Prefill scalar fields and credentials.
        const displayName = stringField(target.name)
        const verify =
          target.verify_tls === undefined ? true : !(target.verify_tls === false || target.verify_tls === 'false')
        const ep = stringField(target.base_url) || stringField(target.endpoint) || stringField(target.url) || stringField(target.host)
        const poll = numberField(target.poll_interval_seconds)
        const creds: Record<string, string> = {}
        const maskedKeys = new Set<string>()
        for (const [k, v] of Object.entries(target)) {
          if (META_KEYS.has(k)) continue
          if (typeof v === 'string') {
            // Detect masked secrets: blank the form so the operator
            // sees an empty field with "leave blank to keep current"
            // copy, and remember that this key was masked so we can
            // re-mask on save if they don't change it.
            if (isSecretFieldName(k) && v === MASKED_SECRET) {
              creds[k] = ''
              maskedKeys.add(k)
            } else {
              creds[k] = v
            }
          } else if (typeof v === 'number' || typeof v === 'boolean') {
            creds[k] = String(v)
          }
        }
        setName(displayName)
        setEndpoint(ep)
        setCredentials(creds)
        setOriginallyMasked(maskedKeys)
        setVerifyTLS(verify)
        if (poll > 0) setPollSeconds(poll)
        setEditLoadError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setEditLoadError(err instanceof Error ? err.message : 'Failed to load existing config')
      })
      .finally(() => {
        if (!cancelled) setEditLoading(false)
      })
    return () => {
      cancelled = true
    }
    // The dependency list deliberately does NOT include `kind` —
    // edit mode locks the kind to the URL value, and re-running
    // this effect on kind changes would clobber the user's edits
    // mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, editKind, editRowName])

  const connector = useMemo(() => {
    // Exact match wins.
    const exact = CONNECTORS.find((entry) => entry.value === kind)
    if (exact) return exact
    // Edit mode receives the canonical kind from the backend (e.g.
    // "redfish" after the user originally picked "idrac"), but the
    // wizard's card list only has the wizard-facing aliases. Map
    // canonical → preferred card so the rendered form / endpoint
    // hint / fields aren't leaked from CONNECTORS[0] (which is
    // palo_alto_panorama, hence the "wizard shows Panorama text on
    // a Redfish edit" bug).
    const aliasToCard: Record<string, string> = {
      redfish: 'idrac',
      palo_alto: 'palo_alto_firewall',
      vcenter: 'vmware_vcenter',
      powerstore: 'dell_powerstore',
      veeam_enterprise_manager: 'veeam_em',
      dnac: 'cisco_dna_center',
      restconf: 'cisco_catalyst',
      netconf: 'cisco_catalyst_netconf',
    }
    const aliased = aliasToCard[kind]
    if (aliased) {
      const fromAlias = CONNECTORS.find((entry) => entry.value === aliased)
      if (fromAlias) return fromAlias
    }
    return CONNECTORS[0]
  }, [kind])

  // mergedFields is the union of (a) the seed list curated in the
  // wizard and (b) the auth keys the catalog declares for this
  // connector. Seed entries come first to preserve curated label
  // copy / hints; catalog entries that aren't in the seed get
  // appended with descriptor-map defaults. Dupes are dropped.
  const mergedFields = useMemo<CredentialField[]>(() => {
    const seen = new Set<string>(connector.fields.map((f) => f.key))
    const out: CredentialField[] = [...connector.fields]
    for (const key of authFieldsFor(kind, catalog)) {
      if (seen.has(key)) continue
      seen.add(key)
      const desc = describeAuthField(key)
      out.push({
        key,
        label: desc.label,
        type: desc.type === 'password' ? 'password' : 'text',
        hint: desc.hint,
      })
    }
    return out
  }, [connector, kind, catalog])

  // Group the merged fields into common (non-auth) fields and a list
  // of mutually-exclusive auth methods. When the connector accepts
  // more than one auth method (e.g. Palo Alto: api_key OR
  // username/password), the wizard renders a picker and only the
  // active method's inputs.
  const { commonFields, authMethods } = useMemo(() => {
    const grouped = groupAuthMethods(mergedFields)
    return { commonFields: grouped.commonFields, authMethods: grouped.methods }
  }, [mergedFields])

  const [authMethodKey, setAuthMethodKey] = useState<string>('')

  // Auto-pick the first method when the connector kind changes (or
  // the catalog arrives after mount). If the user previously chose a
  // method that no longer exists for the current kind, fall back to
  // the first available method so the form is never in an invalid
  // state.
  useEffect(() => {
    if (authMethods.length === 0) {
      setAuthMethodKey('')
      return
    }
    if (!authMethods.some((m) => m.key === authMethodKey)) {
      setAuthMethodKey(authMethods[0].key)
    }
  }, [authMethods, authMethodKey])

  const activeAuthMethod: AuthMethod | undefined = useMemo(
    () => authMethods.find((m) => m.key === authMethodKey) ?? authMethods[0],
    [authMethods, authMethodKey],
  )

  // The fields actually rendered in the credentials step: common
  // fields (always visible) + the active method's fields. Field
  // metadata comes from mergedFields so we reuse the descriptor copy.
  const fieldByKey = useMemo(() => {
    const map = new Map<string, CredentialField>()
    mergedFields.forEach((f) => map.set(f.key, f))
    return map
  }, [mergedFields])

  const renderedFields = useMemo<CredentialField[]>(() => {
    const result: CredentialField[] = [...commonFields]
    if (activeAuthMethod) {
      for (const key of activeAuthMethod.fieldKeys) {
        const field = fieldByKey.get(key)
        if (field) result.push({ ...field, required: true })
      }
    }
    return result
  }, [commonFields, activeAuthMethod, fieldByKey])

  // When the user switches auth methods, drop credentials that
  // belong to methods other than the active one. We never want to
  // send both `api_key` and `password` to the backend just because
  // the user typed values into both before flipping the radio.
  function pickAuthMethod(nextKey: string) {
    setAuthMethodKey(nextKey)
    const next = authMethods.find((m) => m.key === nextKey)
    if (!next) return
    const keepKeys = new Set<string>([...commonFields.map((f) => f.key), ...next.fieldKeys])
    setCredentials((current) => {
      const trimmed: Record<string, string> = {}
      for (const [k, v] of Object.entries(current)) {
        if (keepKeys.has(k)) trimmed[k] = v
      }
      return trimmed
    })
  }

  function next() {
    setStep((current) => Math.min(current + 1, STEPS.length - 1))
  }

  function back() {
    setStep((current) => Math.max(current - 1, 0))
  }

  function selectKind(nextKind: string) {
    const entry = CONNECTORS.find((c) => c.value === nextKind)
    setKind(nextKind)
    setCredentials({})
    if (entry) {
      setPollSeconds(entry.pollDefault)
      if (!endpoint) {
        setEndpoint('')
      }
    }
  }

  function setCredential(key: string, value: string) {
    setCredentials((current) => ({ ...current, [key]: value }))
  }

  async function runTest() {
    setTestResult({ state: 'running' })
    try {
      // verify_tls travels inside credentials so the backend probe reads
      // boolConfig(config["verify_tls"], ...) — same shape as save().
      const probeCredentials = {
        ...credentials,
        verify_tls: verifyTLS ? 'true' : 'false',
      }
      // apiFetch carries the active credential (session cookie for
      // local/OIDC, Bearer for apiKey) + X-Tenant-ID, so the probe works
      // regardless of how the operator logged in — the old raw-fetch path
      // required a locally-stored apiKey and silently skipped the test
      // under cookie auth.
      const response = await apiFetch('/connectors/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, endpoint, credentials: probeCredentials }),
      })
      const body = await response.json().catch(() => ({}))
      // Backend now returns 200 + {status: 'fail', error: '...'} on
      // collector failures (instead of 502, which the reverse proxy
      // intercepts with HTML and masks the real error). Distinguish
      // success vs failure on the body's status field.
      if (body && typeof body.status === 'string' && body.status === 'fail') {
        setTestResult({
          state: 'fail',
          details: typeof body.error === 'string' && body.error.trim()
            ? body.error.trim()
            : 'Connection test failed',
        })
        return
      }
      setTestResult({
        state: 'pass',
        details: typeof body?.detail === 'string' ? body.detail : 'Endpoint reachable, credentials accepted.',
      })
    } catch (err: any) {
      // No test endpoint on this build → defer to the first worker poll
      // rather than failing the wizard.
      if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
        setTestResult({
          state: 'deferred',
          details: 'This build has no /v1/connectors/test endpoint. The connector will be saved and the worker will validate on the first poll.',
        })
        return
      }
      setTestResult({
        state: 'fail',
        details: err?.message ?? 'Connection test failed',
      })
    }
  }

  async function save() {
    setSavingError(null)
    try {
      // Re-mask any secret field that was loaded masked AND was not
      // re-typed by the operator. Sending "********" trips the backend
      // MergeMaskedSecrets path and preserves the stored value — empty
      // string would overwrite the secret with "", which is what
      // produced the "I changed the password but it's still 403" bug.
      const credsForSave: Record<string, string> = { ...credentials }
      for (const key of originallyMasked) {
        if ((credsForSave[key] ?? '') === '') {
          credsForSave[key] = MASKED_SECRET
        }
      }

      // apiFetch handles auth (cookie or Bearer) + X-Tenant-ID and throws
      // an ApiError carrying the upstream detail on non-2xx.
      const response = await apiFetch('/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || kind,
          kind,
          endpoint,
          // verify_tls travels alongside credentials so the backend
          // config map carries the same shape connectors already
          // read (boolConfig(config["verify_tls"], envBool(...))).
          credentials: { ...credsForSave, verify_tls: verifyTLS ? 'true' : 'false' },
          poll_interval_seconds: pollSeconds,
        }),
      })
      const body = await response.json().catch(() => ({}))
      setSaved({
        id: typeof body?.id === 'string' ? body.id : 'pending',
        created_at: typeof body?.created_at === 'string' ? body.created_at : new Date().toISOString(),
      })
    } catch (err: any) {
      setSavingError(err?.message ?? 'Failed to save connector')
    }
  }

  return (
    <>
      <Topbar
        title={isEditMode ? t('Edit connector', 'Edit connector') : t('New connector', 'New connector')}
        right={
          <GhostButton onClick={() => router.push('/connectors')}>
            <i className="ti ti-x" aria-hidden="true" />
            {t('Cancel', 'Cancel')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {editLoadError ? (
            <Card style={{ padding: '12px 16px', background: 'var(--color-status-red-soft, #fee2e2)', borderColor: 'var(--color-status-red-mid, #fca5a5)' }}>
              <strong>{t('Could not load existing connector:', 'Could not load existing connector:')}</strong>{' '}
              {editLoadError}
            </Card>
          ) : null}
          {editLoading ? (
            <Card style={{ padding: '12px 16px' }}>
              {t('Loading current configuration…', 'Loading current configuration…')}
            </Card>
          ) : null}
          <Card>
            <Stepper steps={STEPS} current={step} />
          </Card>

          <Card style={{ padding: '20px 22px' }}>
            {step === 0 && !isEditMode ? (
              <PickStep kind={kind} onChange={selectKind} />
            ) : null}
            {step === 0 && isEditMode ? (
              <div style={{ padding: '12px 0' }}>
                <Badge tone="navy">{t('Editing existing connector', 'Editing existing connector')}</Badge>
                <p style={{ marginTop: 12 }}>
                  {t(
                    'Kind is locked when editing. To change it, delete this connector and create a new one.',
                    'Kind is locked when editing. To change it, delete this connector and create a new one.',
                  )}
                </p>
              </div>
            ) : null}
            {step === 1 ? (
              <CredentialsStep
                connector={connector}
                fields={renderedFields}
                authMethods={authMethods}
                activeAuthMethodKey={activeAuthMethod?.key ?? ''}
                onPickAuthMethod={pickAuthMethod}
                name={name}
                endpoint={endpoint}
                credentials={credentials}
                pollSeconds={pollSeconds}
                verifyTLS={verifyTLS}
                originallyMasked={originallyMasked}
                setName={setName}
                setEndpoint={setEndpoint}
                setCredential={setCredential}
                setPollSeconds={setPollSeconds}
                setVerifyTLS={setVerifyTLS}
              />
            ) : null}
            {step === 2 ? (
              <TestStep result={testResult} onRun={runTest} onReset={() => setTestResult({ state: 'idle' })} connector={connector} />
            ) : null}
            {step === 3 ? (
              <SaveStep
                connector={connector}
                name={name}
                endpoint={endpoint}
                pollSeconds={pollSeconds}
                saved={saved}
                error={savingError}
                onSave={save}
                onOpenList={() => router.push('/connectors')}
              />
            ) : null}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 16,
                paddingTop: 16,
                borderTop: '0.5px solid var(--color-border-tertiary)',
              }}
            >
              <GhostButton onClick={back} disabled={step === 0}>
                <i className="ti ti-arrow-left" aria-hidden="true" />
                {t('Back', 'Back')}
              </GhostButton>
              {step < STEPS.length - 1 ? (
                <PrimaryButton
                  disabled={!canAdvance(step, { renderedFields, name, endpoint, endpointOptional: connector.endpointOptional, credentials, testResult })}
                  onClick={next}
                >
                  {t('Continue', 'Continue')}
                  <i className="ti ti-arrow-right" aria-hidden="true" />
                </PrimaryButton>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function canAdvance(
  step: number,
  values: {
    renderedFields: CredentialField[]
    name: string
    endpoint: string
    endpointOptional?: boolean
    credentials: Record<string, string>
    testResult: TestResult
  },
): boolean {
  if (step === 0) {
    return true
  }
  if (step === 1) {
    if (!values.endpointOptional && !values.endpoint.trim()) return false
    for (const field of values.renderedFields) {
      if (field.required && !values.credentials[field.key]?.trim()) {
        return false
      }
    }
    return true
  }
  if (step === 2) {
    return values.testResult.state === 'pass' || values.testResult.state === 'deferred'
  }
  return true
}

function PickStep({ kind, onChange }: { kind: string; onChange: (next: string) => void }) {
  const {
    t
  } = useI18n();
  const router = useRouter()

  return (
    <>
      <SectionHeader
        title={t('Choose a source', 'Choose a source')}
        sub={t(
          'Each connector pulls a different evidence shape (firewall config, snapshot lineage, vCenter inventory, observability incidents, SOC vulnerabilities) into the same signed pipeline.',
          'Each connector pulls a different evidence shape (firewall config, snapshot lineage, vCenter inventory, observability incidents, SOC vulnerabilities) into the same signed pipeline.'
        )}
      />
      {/* Bulk-import callout — for operators whose DNA Center / Panorama
          already discovered N switches. Skips the per-switch wizard
          slog and writes one cisco_restconf row whose devices array
          covers the whole fleet in one shot. */}
      <button
        type="button"
        onClick={() => router.push('/connectors/bulk-restconf')}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          gap: 10,
          padding: '10px 12px',
          marginBottom: 12,
          background: 'var(--color-status-blue-bg)',
          border: '0.5px solid var(--color-status-blue-mid)',
          borderRadius: 'var(--border-radius-md)',
          fontFamily: 'inherit',
          color: 'var(--color-status-blue-deep)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <i className="ti ti-plug-connected" aria-hidden="true" style={{ fontSize: 16 }} />
          <span>
            <strong>{t('Bulk-import Cisco RESTCONF', 'Bulk-import Cisco RESTCONF')}</strong>
            {' — '}
            {t(
              'auto-fan-out one credential pair across every network_device already in inventory.',
              'auto-fan-out one credential pair across every network_device already in inventory.',
            )}
          </span>
        </span>
        <i className="ti ti-arrow-right" aria-hidden="true" style={{ fontSize: 14, flexShrink: 0 }} />
      </button>
      {renderCategorisedConnectors(CONNECTORS, kind, onChange)}
    </>
  );
}

// renderCategorisedConnectors groups the catalog by category, drops
// a small header per group, and renders compact cards inside. The
// flat grid grew unscannable as the catalog expanded past ~20
// connectors; grouping + smaller cards puts roughly 3× more in the
// same viewport.
function renderCategorisedConnectors(
  connectors: ConnectorKind[],
  selected: string,
  onChange: (next: string) => void,
) {
  // Deterministic category order — Network first since that's what
  // most operators land on the wizard to configure, followed by the
  // remaining bands by rough frequency-of-use.
  const ORDER = [
    'Network',
    'Virtualization',
    'Storage',
    'Backup',
    'Hardware',
    'Security',
    'Identity',
    'Observability',
    'ITSM',
  ]
  const groups = new Map<string, ConnectorKind[]>()
  for (const c of connectors) {
    const cat = c.category || 'Other'
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat)!.push(c)
  }
  const ordered = Array.from(groups.entries()).sort((a, b) => {
    const ai = ORDER.indexOf(a[0])
    const bi = ORDER.indexOf(b[0])
    return (ai === -1 ? ORDER.length : ai) - (bi === -1 ? ORDER.length : bi)
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {ordered.map(([cat, members]) => (
        <section key={cat}>
          <div
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--color-text-tertiary)',
              marginBottom: 6,
              fontWeight: 600,
            }}
          >
            {cat} <span style={{ opacity: 0.6 }}>· {members.length}</span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 8,
            }}
          >
            {members.map((connector) => {
              const active = connector.value === selected
              const brandHex = connectorBrandHex(connector.value)
              return (
                <button
                  key={connector.value}
                  type="button"
                  onClick={() => onChange(connector.value)}
                  title={connector.label}
                  style={{
                    textAlign: 'left',
                    background: active
                      ? 'var(--color-status-blue-bg)'
                      : 'var(--color-background-primary)',
                    border: active
                      ? '1px solid var(--color-brand-blue)'
                      : '0.5px solid var(--color-border-tertiary)',
                    borderRadius: 'var(--border-radius-md)',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    color: 'var(--color-text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 48,
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      background: brandHex ? `${brandHex}1A` : 'var(--color-background-tertiary)',
                    }}
                  >
                    <ConnectorLogo name={connector.value} size={20} />
                  </div>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: active ? 600 : 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {connector.label}
                  </span>
                  {active ? (
                    <i
                      className="ti ti-check"
                      aria-hidden="true"
                      style={{
                        color: 'var(--color-brand-blue)',
                        flexShrink: 0,
                        fontSize: 14,
                      }}
                    />
                  ) : null}
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function CredentialsStep(props: {
  connector: ConnectorKind
  // fields is the list to render: common fields + the active auth
  // method's fields only. Non-active methods are hidden.
  fields: CredentialField[]
  authMethods: AuthMethod[]
  activeAuthMethodKey: string
  onPickAuthMethod: (key: string) => void
  name: string
  endpoint: string
  credentials: Record<string, string>
  pollSeconds: number
  verifyTLS: boolean
  originallyMasked: Set<string>
  setName: (v: string) => void
  setEndpoint: (v: string) => void
  setCredential: (key: string, value: string) => void
  setPollSeconds: (v: number) => void
  setVerifyTLS: (v: boolean) => void
}) {
  const {
    t
  } = useI18n();

  const activeMethod = props.authMethods.find((m) => m.key === props.activeAuthMethodKey)
  const showMethodPicker = props.authMethods.length > 1
  return (
    <>
      <SectionHeader
        title={`Configure ${props.connector.label}`}
        sub={t(
          'Credentials are encrypted at rest using the platform signing key. The worker uses them on every poll and never logs the cleartext.',
          'Credentials are encrypted at rest using the platform signing key. The worker uses them on every poll and never logs the cleartext.'
        )}
      />
      <FormField label={t('Display name', 'Display name')} hint={t(
        'Shown in the connector registry. Defaults to the kind if empty.',
        'Shown in the connector registry. Defaults to the kind if empty.'
      )}>
        <TextInput
          value={props.name}
          onChange={(event) => props.setName(event.target.value)}
          placeholder={props.connector.label}
        />
      </FormField>
      <FormField label={t('Endpoint', 'Endpoint')} hint={`e.g. ${props.connector.endpointHint}`}>
        <TextInput
          value={props.endpoint}
          onChange={(event) => props.setEndpoint(event.target.value)}
          placeholder={props.connector.endpointHint}
        />
      </FormField>
      {showMethodPicker ? (
        <FormField
          label={t('Authentication method', 'Authentication method')}
          hint={t(
            'Pick one. Only the selected method\'s credentials are sent to the connector.',
            'Pick one. Only the selected method\'s credentials are sent to the connector.'
          )}
        >
          <AuthMethodPicker
            methods={props.authMethods}
            activeKey={props.activeAuthMethodKey}
            onPick={props.onPickAuthMethod}
          />
          {activeMethod?.hint ? (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
              {activeMethod.hint}
            </div>
          ) : null}
        </FormField>
      ) : null}
      {props.fields.map((field) => {
        const wasMasked = props.originallyMasked.has(field.key)
        const hint = wasMasked
          ? t(
              'Stored value preserved if left blank. Type a new value to rotate.',
              'Stored value preserved if left blank. Type a new value to rotate.',
            )
          : field.hint
        const placeholder = wasMasked
          ? t('Leave blank to keep current', 'Leave blank to keep current')
          : undefined
        return (
          <FormField key={field.key} label={field.label} hint={hint}>
            <TextInput
              type={field.type === 'password' ? 'password' : 'text'}
              value={props.credentials[field.key] ?? ''}
              placeholder={placeholder}
              onChange={(event) => props.setCredential(field.key, event.target.value)}
            />
          </FormField>
        )
      })}
      <FormField label={t('Poll interval', 'Poll interval')} hint={t(
        'How often the worker collects evidence. Lower bound is enforced server-side.',
        'How often the worker collects evidence. Lower bound is enforced server-side.'
      )}>
        <Select
          value={String(props.pollSeconds)}
          onChange={(event) => props.setPollSeconds(Number(event.target.value))}
        >
          <option value="300">{t('Every 5 minutes', 'Every 5 minutes')}</option>
          <option value="600">{t('Every 10 minutes', 'Every 10 minutes')}</option>
          <option value="900">{t('Every 15 minutes', 'Every 15 minutes')}</option>
          <option value="1800">{t('Every 30 minutes', 'Every 30 minutes')}</option>
          <option value="3600">{t('Every hour', 'Every hour')}</option>
          <option value="21600">{t('Every 6 hours', 'Every 6 hours')}</option>
        </Select>
      </FormField>
      <FormField
        label={t('TLS certificate verification', 'TLS certificate verification')}
        hint={t(
          'Leave on unless the target uses a self-signed or internal-CA certificate the platform doesn\'t trust.',
          'Leave on unless the target uses a self-signed or internal-CA certificate the platform doesn\'t trust.'
        )}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={props.verifyTLS}
            onChange={(event) => props.setVerifyTLS(event.target.checked)}
          />
          <span>{t(
            'Verify TLS certificate (recommended)',
            'Verify TLS certificate (recommended)'
          )}</span>
        </label>
        {!props.verifyTLS ? (
          <div
            style={{
              marginTop: 8,
              padding: '8px 10px',
              fontSize: 11,
              border: '0.5px solid var(--color-status-red-mid)',
              background: 'var(--color-status-red-bg)',
              color: 'var(--color-status-red-deep)',
              borderRadius: 'var(--border-radius-md)',
            }}
          >
            <strong>{t('Insecure:', 'Insecure:')}</strong> {t(
              'the worker will accept any certificate the endpoint presents.\n            This disables protection against man-in-the-middle attacks for this connector and must\n            be documented as a compensating control in your security policy.',
              'the worker will accept any certificate the endpoint presents.\n            This disables protection against man-in-the-middle attacks for this connector and must\n            be documented as a compensating control in your security policy.'
            )}
          </div>
        ) : null}
      </FormField>
    </>
  );
}

function TestStep({
  result,
  connector,
  onRun,
  onReset,
}: {
  result: TestResult
  connector: ConnectorKind
  onRun: () => void
  onReset: () => void
}) {
  const {
    t
  } = useI18n();

  return (
    <>
      <SectionHeader
        title={t('Test the connection', 'Test the connection')}
        sub={`Sends a no-op probe to ${connector.label}. The connector is not saved until you continue past this step.`}
      />
      {result.state === 'idle' ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <PrimaryButton onClick={onRun}>
            <i className="ti ti-plug-connected" aria-hidden="true" />
            {t('Run connection test', 'Run connection test')}
          </PrimaryButton>
        </div>
      ) : null}
      {result.state === 'running' ? (
        <ResultBanner tone="blue" icon="ti-loader-2" title={t('Running probe...', 'Running probe...')} sub={t(
          'Reaching out to the configured endpoint.',
          'Reaching out to the configured endpoint.'
        )} spin />
      ) : null}
      {result.state === 'pass' ? (
        <ResultBanner tone="green" icon="ti-circle-check" title={t('Connection succeeded', 'Connection succeeded')} sub={result.details} />
      ) : null}
      {result.state === 'fail' ? (
        <ResultBanner tone="red" icon="ti-alert-triangle" title={t('Connection failed', 'Connection failed')} sub={result.details} />
      ) : null}
      {result.state === 'deferred' ? (
        <ResultBanner tone="amber" icon="ti-clock-pause" title={t('Test deferred', 'Test deferred')} sub={result.details} />
      ) : null}
      {result.state === 'fail' || result.state === 'pass' || result.state === 'deferred' ? (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <GhostButton onClick={onReset}>
            <i className="ti ti-refresh" aria-hidden="true" />
            {t('Run again', 'Run again')}
          </GhostButton>
        </div>
      ) : null}
    </>
  );
}

function SaveStep(props: {
  connector: ConnectorKind
  name: string
  endpoint: string
  pollSeconds: number
  saved: { id: string; created_at: string } | null
  error: string | null
  onSave: () => void
  onOpenList: () => void
}) {
  const {
    t
  } = useI18n();

  if (props.saved) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 8px' }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--color-status-green-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px',
          }}
        >
          <i
            className="ti ti-check"
            aria-hidden="true"
            style={{ fontSize: 28, color: 'var(--color-status-green-deep)' }}
          />
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>{t('Connector saved', 'Connector saved')}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 18 }}>ID <code>{props.saved.id}</code> {t('· queued for first poll.', '· queued for first poll.')}
        </div>
        <PrimaryButton onClick={props.onOpenList}>
          <i className="ti ti-list" aria-hidden="true" />
          {t('Back to connectors', 'Back to connectors')}
        </PrimaryButton>
      </div>
    );
  }
  return (
    <>
      <SectionHeader title={t('Review and save', 'Review and save')} sub={t(
        'The worker will pick up the new connector on its next poll cycle.',
        'The worker will pick up the new connector on its next poll cycle.'
      )} />
      <SummaryRow label={t('Kind', 'Kind')} value={props.connector.label} />
      <SummaryRow label={t('Display name', 'Display name')} value={props.name || props.connector.label} />
      <SummaryRow label={t('Endpoint', 'Endpoint')} value={props.endpoint} />
      <SummaryRow label={t('Poll interval', 'Poll interval')} value={`${props.pollSeconds}s`} />
      {props.error ? (
        <div
          style={{
            marginTop: 12,
            fontSize: 12,
            color: 'var(--color-status-red-deep)',
            background: 'var(--color-status-red-bg)',
            padding: '8px 10px',
            borderRadius: 'var(--border-radius-md)',
          }}
        >
          {props.error}
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <PrimaryButton onClick={props.onSave}>
          <i className="ti ti-device-floppy" aria-hidden="true" />
          {t('Save connector', 'Save connector')}
        </PrimaryButton>
      </div>
    </>
  );
}

function ResultBanner({
  tone,
  icon,
  title,
  sub,
  spin,
}: {
  tone: 'green' | 'red' | 'amber' | 'blue'
  icon: string
  title: string
  sub: string
  spin?: boolean
}) {
  const palette = {
    green: { bg: 'var(--color-status-green-bg)', fg: 'var(--color-status-green-deep)' },
    red: { bg: 'var(--color-status-red-bg)', fg: 'var(--color-status-red-deep)' },
    amber: { bg: 'var(--color-status-amber-bg)', fg: 'var(--color-status-amber-text)' },
    blue: { bg: 'var(--color-status-blue-bg)', fg: 'var(--color-status-blue-deep)' },
  }[tone]
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        background: palette.bg,
        color: palette.fg,
        borderRadius: 'var(--border-radius-md)',
        padding: '14px 16px',
        alignItems: 'flex-start',
      }}
    >
      <i
        className={`ti ${icon}`}
        aria-hidden="true"
        style={{ fontSize: 18, marginTop: 1, animation: spin ? 'attestiv-spin 1s linear infinite' : undefined }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12 }}>{sub}</div>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        fontSize: 13,
      }}
    >
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right' }}>{value || <Badge tone="amber">missing</Badge>}</span>
    </div>
  )
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>{sub}</div>
    </div>
  )
}

// AuthMethodPicker is a segmented-button row for choosing between
// mutually-exclusive authentication methods (e.g. "API key" vs
// "Username + password"). Only used when the connector accepts more
// than one method — for single-method connectors the picker is
// suppressed entirely.
function AuthMethodPicker({
  methods,
  activeKey,
  onPick,
}: {
  methods: AuthMethod[]
  activeKey: string
  onPick: (key: string) => void
}) {
  const {
    t
  } = useI18n();

  return (
    <div
      role="radiogroup"
      aria-label={t('Authentication method', 'Authentication method')}
      style={{
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        background: 'var(--color-background-tertiary)',
        padding: 4,
        borderRadius: 'var(--border-radius-md)',
      }}
    >
      {methods.map((method) => {
        const active = method.key === activeKey
        return (
          <button
            key={method.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(method.key)}
            style={{
              flex: '1 1 0',
              minWidth: 120,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: active ? 500 : 400,
              fontFamily: 'inherit',
              cursor: 'pointer',
              border: active
                ? '1px solid var(--color-brand-blue)'
                : '0.5px solid var(--color-border-tertiary)',
              borderRadius: 'var(--border-radius-md)',
              background: active ? 'var(--color-background-primary)' : 'transparent',
              color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {active ? <i className="ti ti-check" aria-hidden="true" /> : null}
            <span>{method.label}</span>
          </button>
        )
      })}
    </div>
  );
}
