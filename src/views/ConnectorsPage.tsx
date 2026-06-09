'use client';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ApiError, apiFetch, apiJson } from '../lib/api'
import { Button, Card, DangerButton, ErrorBox, HelpTip, Label, PageTitle } from '../components/Ui'

import { useI18n } from '../lib/i18n';

type ConnectorAlert = {
  key: string
  level: 'info' | 'warning' | 'error'
  message: string
}
type ReplicationVolumeStatus = {
  id?: string | null
  name?: string | null
  status?: string | null
  hosts?: string[]
  host_groups?: string[]
}
type ReplicationVolumeGroupStatus = {
  id?: string | null
  name?: string | null
  status?: string | null
  replication_mode?: string | null
  replication_role?: string | null
  volumes?: ReplicationVolumeStatus[]
}
type ReplicationRemoteSystemStatus = {
  id?: string | null
  name?: string | null
  replication_modes?: string[]
  status?: string | null
}
type VmLastBackupStatus = {
  name?: string | null
  last_success?: string | null
  job_name?: string | null
  status?: string | null
  last_recovery?: string | null
  last_recovery_status?: string | null
  last_recovery_type?: string | null
}
type PowerStoreVmStatus = {
  id?: string | null
  name?: string | null
  replication_state?: string | null
  volume_count?: number
  derived_from_source?: string | null
  replication_volumes?: { id?: string | null; name?: string | null; status?: string | null; state?: string | null }[]
}
type ConnectorLastError = { timestamp?: string | null; message?: string | null } | string
type ConnectorPartialFailure = { timestamp?: string | null; message?: string | null } | string
type ConnectorValidationIssue = { message?: string | null; detail?: string | null; field?: string | null } | string
type ConnectorStatus = {
  name: string
  label?: string
  category?: string
  status?: string
  last_run?: string | null
  last_success?: string | null
  last_error?: ConnectorLastError | null
  success_count?: number
  failure_count?: number
  partial_failure_count?: number
  partial_failures?: ConnectorPartialFailure[]
  total_runs?: number
  last_duration_seconds?: number | null
  last_validation?: string | null
  validation_issue_count?: number
  validation_issues?: ConnectorValidationIssue[]
  last_provenance?: string | null
  provenance_input_hashes?: number
  success_rate?: number | null
  ha_configured?: boolean
  ha_status?: string | null
  change_detected?: boolean
  last_change_at?: string | null
  last_change_keys?: string[]
  last_change_count?: number
  input_hash_count?: number
  alerts?: ConnectorAlert[]
  replication_volumes?: ReplicationVolumeStatus[]
  replication_volume_groups?: ReplicationVolumeGroupStatus[]
  remote_systems?: ReplicationRemoteSystemStatus[]
  vm_last_backups?: VmLastBackupStatus[]
  storage_vms?: PowerStoreVmStatus[]
  sla?: Record<string, unknown>
}
type HealthSortKey = 'name' | 'category' | 'status' | 'last_run' | 'success' | 'validation' | 'signals'

type ConnectorsResponse = { connectors: ConnectorStatus[] }
type ConnectorConfigResponse = { available: string[]; enabled: string[] }
type FrameworkConfigResponse = {
  enabled?: string[]
  frameworks?: Array<{ key: string }>
}
type ControlMappingEntry = {
  framework: string
  control_ids: string[]
  notes?: string | null
}
type ConnectorMappingEntry = {
  connector: string
  instance: string
  node?: string | null
  mappings: ControlMappingEntry[]
}
type ControlMappingsResponse = {
  items: ConnectorMappingEntry[]
}
type InventoryAsset = {
  asset_id: string
  name?: string | null
  asset_type?: string | null
}
type InventoryAssetsResponse = { items: InventoryAsset[]; count: number }
type GlpiAssetEndpoint = {
  endpoint: string
  asset_type: string
  tag?: string | null
}
type GlpiConnectorConfig = {
  asset_id?: string | null
  base_url: string
  app_token: string
  user_token: string
  verify_tls: boolean
  page_size: number
  max_pages: number
  server_endpoint: string
  asset_name_filter?: string
  asset_endpoints?: GlpiAssetEndpoint[]
  include_tickets?: boolean
  include_changes?: boolean
  ticket_endpoint?: string
  change_endpoint?: string
  event_mappings?: ConnectorEventMapping[]
}
type VCenterConnectorInstance = {
  name: string
  asset_id?: string | null
  base_url: string
  username: string
  password: string
  verify_tls: boolean
  include_vms: boolean
  include_hosts: boolean
  include_clusters: boolean
  include_tasks: boolean
  include_vm_hardware: boolean
  task_max: number
  task_since_hours: number
  tags: string[]
  event_mappings?: ConnectorEventMapping[]
}
type PowerStoreConnectorInstance = {
  name: string
  asset_id?: string | null
  base_url: string
  username: string
  password: string
  verify_tls: boolean
  max_items: number
  tags: string[]
  event_mappings?: ConnectorEventMapping[]
}
type VCenterConnectorConfigList = { items: VCenterConnectorInstance[] }
type PowerStoreConnectorConfigList = { items: PowerStoreConnectorInstance[] }
type ConnectorDebugResponse = {
  source?: string | null
  counts: Record<string, number>
  samples?: Record<string, string[]>
  matches?: ConnectorDebugMatch[]
  error?: string | null
}

type ConnectorDebugMatch = { name: string; count: number }

type PaloAltoDebugResponse = {
  source?: string | null
  counts: Record<string, number>
  samples?: Record<string, string[]>
  matches?: ConnectorDebugMatch[]
  error?: string | null
}
type VeeamEnterpriseManagerConnectorConfig = {
  asset_id?: string | null
  base_url: string
  username: string
  password: string
  verify_tls: boolean
  // Optional Veeam Backup & Replication REST API (port 9419) — needed for
  // tape jobs + repository (Data Domain) immutability, which Enterprise
  // Manager doesn't expose. Leave blank for an all-in-one install (the
  // backend derives <EM-host>:9419 and reuses the EM credentials); set
  // these when the B&R server is a DIFFERENT host or needs its own account.
  bnr_url?: string
  bnr_username?: string
  bnr_password?: string
  backup_sessions_endpoint: string
  backup_task_sessions_endpoint: string
  restore_sessions_endpoint: string
  max_items: number
  event_mappings?: ConnectorEventMapping[]
}
type GitHubConnectorConfig = {
  asset_id?: string | null
  base_url: string
  token: string
  repositories: string[]
  verify_tls: boolean
  include_pull_requests: boolean
  include_workflows: boolean
  include_security_alerts: boolean
  max_items: number
  lookback_days: number
}
type GitLabConnectorConfig = {
  asset_id?: string | null
  base_url: string
  token: string
  projects: string[]
  verify_tls: boolean
  include_merge_requests: boolean
  include_pipelines: boolean
  include_vulnerabilities: boolean
  max_items: number
  lookback_days: number
}
type ServiceNowConnectorConfig = {
  asset_id?: string | null
  instance: string
  username: string
  password: string
  tables: string[]
}
type BambooHrConnectorConfig = {
  asset_id?: string | null
  base_url: string
  api_key: string
  verify_tls: boolean
  max_items: number
}
type WorkdayConnectorConfig = {
  asset_id?: string | null
  base_url: string
  username: string
  password: string
  report_path: string
  verify_tls: boolean
  max_items: number
}
type JiraConnectorConfig = {
  asset_id?: string | null
  base_url: string
  username: string
  api_token: string
  password: string
  api_version: string
  jql?: string | null
  projects: string[]
  verify_tls: boolean
  include_changes: boolean
  include_security: boolean
  max_items: number
}
type AwsPostureConnectorConfig = {
  asset_id?: string | null
  region: string
  access_key?: string | null
  secret_key?: string | null
  session_token?: string | null
  max_items: number
}
type AzurePostureConnectorConfig = {
  asset_id?: string | null
  tenant_id: string
  client_id: string
  client_secret: string
  subscription_id: string
  verify_tls: boolean
  max_items: number
}
type GcpPostureConnectorConfig = {
  asset_id?: string | null
  organization_id: string
  access_token: string
  verify_tls: boolean
  max_items: number
}
type PaloAltoAuthMode = 'api_key' | 'password'
type PaloAltoClusterConfig = {
  name: string
  active_url: string
  passive_url?: string | null
  description?: string | null
  active_asset_id?: string | null
  passive_asset_id?: string | null
}
type PaloAltoEventKind = 'change_event' | 'resilience_signal'
type PaloAltoEventMatchField = 'change_type' | 'signal_type' | 'log_type' | 'subtype' | 'contains'
type PaloAltoEventMapping = {
  name: string
  event_kind: PaloAltoEventKind
  match_field: PaloAltoEventMatchField
  match_value: string
  finding_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  score_delta?: number | null
  enabled: boolean
}
type ConnectorEventKind = 'change_event' | 'resilience_signal' | 'recovery_job'
type ConnectorEventMatchField =
  | 'change_type'
  | 'signal_type'
  | 'job_type'
  | 'status'
  | 'log_type'
  | 'subtype'
  | 'contains'
type ConnectorEventMapping = {
  name: string
  event_kind: ConnectorEventKind
  match_field: ConnectorEventMatchField
  match_value: string
  match_signal_type?: string | null
  finding_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  score_delta?: number | null
  enabled: boolean
}
type PaloAltoConnectorInstance = {
  name: string
  asset_id?: string | null
  auth_mode: PaloAltoAuthMode
  api_key: string
  username: string
  password: string
  verify_tls: boolean
  ha_only_logs: boolean
  include_system_logs: boolean
  include_config_logs: boolean
  log_max: number
  log_since_hours: number
  log_since_time?: string | null
  clusters: PaloAltoClusterConfig[]
  event_mappings: PaloAltoEventMapping[]
}
type DellDataDomainConnectorInstance = {
  name: string
  asset_id?: string | null
  url: string
  username: string
  password: string
  api_base?: string | null
  verify_tls: boolean
  event_mappings: ConnectorEventMapping[]
}
type PaloAltoConnectorConfigList = { items?: PaloAltoConnectorInstance[] }
type DellDataDomainConnectorConfigList = { items: DellDataDomainConnectorInstance[] }
type DnacConnectorConfig = {
  asset_id?: string | null
  base_url: string
  username: string
  password: string
  verify_tls: boolean
  include_audit_logs: boolean
  include_events: boolean
  page_size: number
  log_max: number
  log_since_hours: number
  event_mappings: ConnectorEventMapping[]
}
type RestconfConnectorConfig = {
  asset_id?: string | null
  base_url: string
  username: string
  password: string
  verify_tls: boolean
  include_inventory: boolean
  include_running_config: boolean
  include_ha_state: boolean
  inventory_endpoint?: string | null
  ha_endpoint?: string | null
  running_config_endpoint?: string | null
}
type NetconfConnectorConfig = {
  asset_id?: string | null
  host: string
  username: string
  password: string
  port: number
  hostkey_verify: boolean
  device_type: string
  include_inventory: boolean
  include_running_config: boolean
  include_ha_state: boolean
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort()
}

function normalizeInstanceNames(values: Array<string | null | undefined>): string[] {
  const names = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)
  return uniqueSorted(names)
}

function connectorInstanceSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const CONNECTOR_CATEGORIES: Record<string, string> = {
  service_now: 'ITSM / CMDB',
  glpi: 'ITSM / CMDB',
  cmdb: 'ITSM / CMDB',
  vcenter: 'Virtualisation and Servers',
  powerstore: 'Storage',
  dell_enterprise_manager: 'Backup',
  dell_datadomain: 'Storage',
  veeam_enterprise_manager: 'Backup',
  aws: 'Cloud',
  aws_posture: 'Cloud',
  azure_posture: 'Cloud',
  gcp_posture: 'Cloud',
  bamboohr: 'HRIS',
  workday: 'HRIS',
  jira: 'Ticketing',
  github: 'CI/CD',
  gitlab: 'CI/CD',
  azure_ad: 'Identity',
  okta: 'Identity',
  m365: 'Identity',
  sentinel: 'SIEM',
  siem: 'SIEM',
  change_auditor: 'Change',
  quest_change_auditor: 'Change',
  quest_intrust: 'Change',
  tenable: 'Vulnerability',
  qualys: 'Vulnerability',
  palo_alto: 'Network',
  cisco_dnac: 'Network',
  dnac: 'Network',
  catalyst: 'Network',
  cisco_restconf: 'Network',
  restconf: 'Network',
  cisco_netconf: 'Network',
  netconf: 'Network',
  documents: 'Documents',
  wiki: 'Documents',
  sharepoint_ad: 'Documents',
}

const ASSET_REQUIRED_CATEGORIES = new Set([
  'Virtualisation and Servers',
  'Storage',
  'Network',
  'Backup',
  'Infrastructure',
  'Resilience',
  'Cloud',
])
const ASSET_BINDING_OPTIONAL_CONNECTORS = new Set(['powerstore'])
const ASSET_FETCH_STEP = 200
const EVENT_KIND_LABELS: Record<ConnectorEventKind, string> = {
  change_event: 'Change event',
  resilience_signal: 'Resilience signal',
  recovery_job: 'Recovery job',
}
const EVENT_MATCH_FIELD_LABELS: Record<ConnectorEventMatchField, string> = {
  change_type: 'Change type',
  signal_type: 'Signal type',
  job_type: 'Job type',
  status: 'Status',
  log_type: 'Log type',
  subtype: 'Log subtype',
  contains: 'Contains text',
}
const EVENT_MATCH_FIELDS_BY_KIND: Record<ConnectorEventKind, ConnectorEventMatchField[]> = {
  change_event: ['change_type', 'status', 'log_type', 'subtype', 'contains'],
  resilience_signal: ['signal_type', 'status', 'log_type', 'subtype', 'contains'],
  recovery_job: ['job_type', 'status', 'log_type', 'subtype', 'contains'],
}
const EVENT_KINDS_BY_CONNECTOR: Record<
  | 'glpi'
  | 'vcenter'
  | 'powerstore'
  | 'veeam_enterprise_manager'
  | 'dnac'
  | 'dell_datadomain',
  ConnectorEventKind[]
> = {
  glpi: ['change_event', 'resilience_signal'],
  vcenter: ['change_event'],
  powerstore: ['resilience_signal'],
  veeam_enterprise_manager: ['resilience_signal', 'recovery_job'],
  dnac: ['change_event', 'resilience_signal'],
  dell_datadomain: ['resilience_signal'],
}
const PALO_ALTO_DEFAULT_EVENT_MAPPINGS: PaloAltoEventMapping[] = [
  {
    name: 'HA role change',
    event_kind: 'resilience_signal',
    match_field: 'signal_type',
    match_value: 'ha_role_change',
    finding_type: 'resilience',
    severity: 'high',
    score_delta: null,
    enabled: true,
  },
  {
    name: 'HA config not synchronized',
    event_kind: 'resilience_signal',
    match_field: 'signal_type',
    match_value: 'config_not_synced',
    finding_type: 'resilience',
    severity: 'high',
    score_delta: null,
    enabled: true,
  },
  {
    name: 'Auth server down',
    event_kind: 'resilience_signal',
    match_field: 'signal_type',
    match_value: 'auth_server_down',
    finding_type: 'resilience',
    severity: 'critical',
    score_delta: null,
    enabled: true,
  },
  {
    name: 'HA failover (log text)',
    event_kind: 'change_event',
    match_field: 'contains',
    match_value: 'ha|failover|failback|active|passive|state change',
    finding_type: 'resilience',
    severity: 'high',
    score_delta: null,
    enabled: true,
  },
]
const VCENTER_DEFAULT_EVENT_MAPPINGS: ConnectorEventMapping[] = [
  {
    name: 'vCenter task failed',
    event_kind: 'change_event',
    match_field: 'status',
    match_value: 'error|failed',
    finding_type: 'change',
    severity: 'high',
    score_delta: null,
    enabled: true,
  },
  {
    name: 'vCenter task warning',
    event_kind: 'change_event',
    match_field: 'status',
    match_value: 'warning',
    finding_type: 'change',
    severity: 'medium',
    score_delta: null,
    enabled: true,
  },
  {
    name: 'vCenter task canceled',
    event_kind: 'change_event',
    match_field: 'status',
    match_value: 'canceled|cancelled|aborted',
    finding_type: 'change',
    severity: 'medium',
    score_delta: null,
    enabled: true,
  },
  {
    name: 'vCenter task timeout/disconnect',
    event_kind: 'change_event',
    match_field: 'contains',
    match_value: 'timeout|timed out|not responding|disconnected|inaccessible',
    finding_type: 'change',
    severity: 'medium',
    score_delta: null,
    enabled: true,
  },
]
const POWERSTORE_DEFAULT_EVENT_MAPPINGS: ConnectorEventMapping[] = [
  {
    name: 'PowerStore replication failed',
    event_kind: 'resilience_signal',
    match_field: 'status',
    match_value: 'error',
    finding_type: 'resilience',
    severity: 'high',
    score_delta: null,
    enabled: true,
  },
  {
    name: 'PowerStore replication degraded',
    event_kind: 'resilience_signal',
    match_field: 'status',
    match_value: 'degraded',
    finding_type: 'resilience',
    severity: 'medium',
    score_delta: null,
    enabled: true,
  },
  {
    name: 'PowerStore replication unknown',
    event_kind: 'resilience_signal',
    match_field: 'status',
    match_value: 'unknown',
    match_signal_type: 'replication_status',
    finding_type: 'resilience',
    severity: 'medium',
    score_delta: null,
    enabled: true,
  },
  {
    name: 'PowerStore immutability missing',
    event_kind: 'resilience_signal',
    match_field: 'status',
    match_value: 'missing',
    match_signal_type: 'immutable_snapshots',
    finding_type: 'resilience',
    severity: 'medium',
    score_delta: null,
    enabled: true,
  },
]
const DNAC_DEFAULT_EVENT_MAPPINGS: ConnectorEventMapping[] = [
  {
    name: 'DNAC HA role change',
    event_kind: 'resilience_signal',
    match_field: 'signal_type',
    match_value: 'ha_role_change',
    finding_type: 'resilience',
    severity: 'high',
    score_delta: null,
    enabled: true,
  },
  {
    name: 'DNAC maintenance upgrade',
    event_kind: 'change_event',
    match_field: 'change_type',
    match_value: 'maintenance_upgrade',
    finding_type: 'change',
    severity: 'medium',
    score_delta: null,
    enabled: true,
  },
  {
    name: 'DNAC maintenance restart',
    event_kind: 'change_event',
    match_field: 'change_type',
    match_value: 'maintenance_restart',
    finding_type: 'change',
    severity: 'medium',
    score_delta: null,
    enabled: true,
  },
  {
    name: 'DNAC maintenance change',
    event_kind: 'change_event',
    match_field: 'change_type',
    match_value: 'maintenance_change',
    finding_type: 'change',
    severity: 'low',
    score_delta: null,
    enabled: true,
  },
]
const DATADOMAIN_DEFAULT_EVENT_MAPPINGS: ConnectorEventMapping[] = [
  {
    name: 'Data Domain degraded/failed signal',
    event_kind: 'resilience_signal',
    match_field: 'status',
    match_value: 'error|degraded',
    finding_type: 'resilience',
    severity: 'high',
    score_delta: null,
    enabled: true,
  },
]
const VEEAM_ENTERPRISE_MANAGER_DEFAULT_EVENT_MAPPINGS: ConnectorEventMapping[] = [
  {
    name: 'Backup sessions degraded/failed',
    event_kind: 'resilience_signal',
    match_field: 'status',
    match_value: 'error|degraded|warning',
    finding_type: 'resilience',
    severity: 'high',
    score_delta: null,
    enabled: true,
  },
  {
    name: 'Restore sessions degraded/failed',
    event_kind: 'recovery_job',
    match_field: 'status',
    match_value: 'error|degraded|warning',
    finding_type: 'recovery',
    severity: 'high',
    score_delta: null,
    enabled: true,
  },
]

const defaultEventFindingType = (kind: ConnectorEventKind) => {
  if (kind === 'change_event') return 'change'
  if (kind === 'recovery_job') return 'recovery'
  return 'resilience'
}

const buildDefaultEventMapping = (kind: ConnectorEventKind): ConnectorEventMapping => ({
  name: '',
  event_kind: kind,
  match_field: EVENT_MATCH_FIELDS_BY_KIND[kind][0],
  match_value: '',
  finding_type: defaultEventFindingType(kind),
  severity: 'medium',
  score_delta: null,
  enabled: true,
})

const buildPaloAltoDefaultMappings = () =>
  PALO_ALTO_DEFAULT_EVENT_MAPPINGS.map((mapping) => ({ ...mapping }))
const buildDefaultPaloAltoCluster = (name = 'cluster-1'): PaloAltoClusterConfig => ({
  name,
  active_url: '',
  passive_url: '',
  description: '',
  active_asset_id: '',
  passive_asset_id: '',
})
const buildDefaultPaloAltoInstance = (
  name: string,
  assetId: string,
): PaloAltoConnectorInstance => ({
  name,
  asset_id: assetId,
  auth_mode: 'api_key',
  api_key: '',
  username: '',
  password: '',
  verify_tls: true,
  ha_only_logs: true,
  include_system_logs: true,
  include_config_logs: true,
  log_max: 200,
  log_since_hours: 168,
  log_since_time: '',
  clusters: [buildDefaultPaloAltoCluster(`${name}-cluster-1`)],
  event_mappings: buildPaloAltoDefaultMappings(),
})
const buildVeeamEnterpriseManagerDefaultMappings = () =>
  VEEAM_ENTERPRISE_MANAGER_DEFAULT_EVENT_MAPPINGS.map((mapping) => ({ ...mapping }))
const buildVcenterDefaultMappings = () =>
  VCENTER_DEFAULT_EVENT_MAPPINGS.map((mapping) => ({ ...mapping }))
const buildPowerstoreDefaultMappings = () =>
  POWERSTORE_DEFAULT_EVENT_MAPPINGS.map((mapping) => ({ ...mapping }))
const buildDnacDefaultMappings = () =>
  DNAC_DEFAULT_EVENT_MAPPINGS.map((mapping) => ({ ...mapping }))
const buildDatadomainDefaultMappings = () =>
  DATADOMAIN_DEFAULT_EVENT_MAPPINGS.map((mapping) => ({ ...mapping }))

const normalizeEventMapping = (
  mapping: ConnectorEventMapping,
  nextKind?: ConnectorEventKind,
): ConnectorEventMapping => {
  const kind = nextKind ?? mapping.event_kind
  const allowedFields = EVENT_MATCH_FIELDS_BY_KIND[kind]
  const matchField = allowedFields.includes(mapping.match_field)
    ? mapping.match_field
    : allowedFields[0]
  return { ...mapping, event_kind: kind, match_field: matchField }
}

const normalizeEventMappings = (mappings?: ConnectorEventMapping[]) =>
  (mappings ?? []).map((mapping) => normalizeEventMapping(mapping))

const renderDebugCounts = (debug?: ConnectorDebugResponse | null) => {
  const {
    t
  } = useI18n();

  if (!debug) return null
  const entries = Object.entries(debug.counts ?? {})
  const samples = debug.samples ?? {}
  const matches = debug.matches ?? []
  const sampleEntries = Object.entries(samples)
  return (
    <div className="mt-3 rounded-md border border-[#274266] bg-[#0d1a2b] p-3 text-sm text-slate-50">
      <div className="text-xs uppercase text-slate-300">{t('Debug snapshot', 'Debug snapshot')}</div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        {entries.length ? (
          entries.map(([key, value]) => (
            <div key={key}>
              {key}: {value}
            </div>
          ))
        ) : (
          <div>{t('No counts available.', 'No counts available.')}</div>
        )}
      </div>
      {sampleEntries.length ? (
        <div className="mt-3">
          <div className="text-xs uppercase text-slate-300">{t('Samples', 'Samples')}</div>
          <div className="mt-1 grid gap-2 text-xs text-slate-200 md:grid-cols-2">
            {sampleEntries.map(([key, values]) => (
              <div key={`debug-sample-${key}`}>
                {key}: {(values ?? []).slice(0, 8).join(', ') || 'n/a'}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {matches.length ? (
        <div className="mt-3">
          <div className="text-xs uppercase text-slate-300">{t('Mapping matches', 'Mapping matches')}</div>
          <div className="mt-1 text-xs text-slate-200">
            {matches.map((match) => (
              <div key={`debug-match-${match.name}`}>
                {match.name}: {match.count}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {debug.error ? <div className="mt-2 text-amber-200">{t('Error:', 'Error:')} {debug.error}</div> : null}
    </div>
  );
}

const renderPaloAltoDebug = (debug?: PaloAltoDebugResponse | null) => {
  const {
    t
  } = useI18n();

  if (!debug) return null
  const samples = debug.samples ?? {}
  const matches = debug.matches ?? []
  const sampleEntries = Object.entries(samples)
  return (
    <div className="mt-3 rounded-md border border-[#274266] bg-[#0d1a2b] p-3 text-sm text-slate-50">
      <div className="text-xs uppercase text-slate-300">{t('Debug snapshot', 'Debug snapshot')}</div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        {Object.entries(debug.counts ?? {}).map(([key, value]) => (
          <div key={`palo-count-${key}`}>
            {key}: {value}
          </div>
        ))}
      </div>
      {sampleEntries.length ? (
        <div className="mt-3">
          <div className="text-xs uppercase text-slate-300">{t('Samples', 'Samples')}</div>
          <div className="mt-1 grid gap-2 text-xs text-slate-200 md:grid-cols-2">
            {sampleEntries.map(([key, values]) => (
              <div key={`palo-sample-${key}`}>
                {key}: {(values ?? []).slice(0, 8).join(', ') || 'n/a'}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {matches.length ? (
        <div className="mt-3">
          <div className="text-xs uppercase text-slate-300">{t('Mapping matches', 'Mapping matches')}</div>
          <div className="mt-1 text-xs text-slate-200">
            {matches.map((match) => (
              <div key={`palo-match-${match.name}`}>
                {match.name}: {match.count}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {debug.error ? <div className="mt-2 text-amber-200">{t('Error:', 'Error:')} {debug.error}</div> : null}
    </div>
  );
}

const requiresAssetBinding = (name: string) => {
  const base = name.split(':')[0]
  if (ASSET_BINDING_OPTIONAL_CONNECTORS.has(base)) return false
  const category = CONNECTOR_CATEGORIES[base] ?? CONNECTOR_CATEGORIES[name] ?? 'Other'
  return ASSET_REQUIRED_CATEGORIES.has(category)
}

const healthText = (value: unknown) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

const healthNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const healthBool = (value: unknown) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', 'yes', '1', 'ok', 'healthy'].includes(normalized)) return true
    if (['false', 'no', '0', 'error', 'failed'].includes(normalized)) return false
  }
  return undefined
}

const healthIssueText = (value: unknown) => {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const row = value as Record<string, unknown>
  return (
    healthText(row.message) ||
    healthText(row.detail) ||
    healthText(row.field) ||
    Object.entries(row)
      .filter(([, item]) => item !== null && item !== undefined && healthText(item))
      .map(([key, item]) => `${key}: ${healthText(item)}`)
      .join(', ')
  )
}

const healthErrorText = (value: ConnectorLastError | null | undefined) => healthIssueText(value)

const healthTimeLabel = (value: string | null | undefined) => {
  const text = healthText(value)
  return text || '-'
}

const healthCountLabel = (value: unknown) => {
  const number = healthNumber(value)
  return number === null ? '0' : String(Math.trunc(number))
}

const healthDurationLabel = (value: unknown) => {
  const seconds = healthNumber(value)
  if (seconds === null) return '-'
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

const healthStateClass = (ok: boolean | undefined) => {
  if (ok === true) return 'bg-emerald-500/20 text-emerald-200'
  if (ok === false) return 'bg-amber-500/20 text-amber-200'
  return 'bg-slate-500/20 text-slate-200'
}

export function ConnectorsPage() {
  const {
    t
  } = useI18n();

  const [data, setData] = useState<ConnectorsResponse | null>(null)
  const connectorsLoadInFlightRef = useRef(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [config, setConfig] = useState<ConnectorConfigResponse | null>(null)
  const [configError, setConfigError] = useState<ApiError | null>(null)
  const [assetOptions, setAssetOptions] = useState<InventoryAsset[]>([])
  const [assetError, setAssetError] = useState<string | null>(null)
  const [assetFetchLimit, setAssetFetchLimit] = useState(ASSET_FETCH_STEP)
  const [assetTotal, setAssetTotal] = useState<number | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [selectedConnector, setSelectedConnector] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [glpi, setGlpi] = useState<GlpiConnectorConfig | null>(null)
  const [glpiSaving, setGlpiSaving] = useState(false)
  const [glpiMessage, setGlpiMessage] = useState<string | null>(null)
  const [glpiTesting, setGlpiTesting] = useState(false)
  const [vcenterConfigs, setVcenterConfigs] = useState<VCenterConnectorInstance[]>([])
  const [vcenterSelected, setVcenterSelected] = useState('')
  const [vcenterNewName, setVcenterNewName] = useState('')
  const [vcenterSaving, setVcenterSaving] = useState(false)
  const [vcenterMessage, setVcenterMessage] = useState<string | null>(null)
  const [vcenterTesting, setVcenterTesting] = useState(false)
  const [vcenterDebugging, setVcenterDebugging] = useState(false)
  const [vcenterDebug, setVcenterDebug] = useState<ConnectorDebugResponse | null>(null)
  const [powerstoreConfigs, setPowerstoreConfigs] = useState<PowerStoreConnectorInstance[]>([])
  const [powerstoreSelected, setPowerstoreSelected] = useState('')
  const [powerstoreNewName, setPowerstoreNewName] = useState('')
  const [powerstoreSaving, setPowerstoreSaving] = useState(false)
  const [powerstoreMessage, setPowerstoreMessage] = useState<string | null>(null)
  const [powerstoreTesting, setPowerstoreTesting] = useState(false)
  const [powerstoreDebugging, setPowerstoreDebugging] = useState(false)
  const [powerstoreDebug, setPowerstoreDebug] = useState<ConnectorDebugResponse | null>(null)
  const [dellDataDomainDebugging, setDellDataDomainDebugging] = useState(false)
  const [dellDataDomainDebug, setDellDataDomainDebug] = useState<ConnectorDebugResponse | null>(null)
  const [dnacDebugging, setDnacDebugging] = useState(false)
  const [dnacDebug, setDnacDebug] = useState<ConnectorDebugResponse | null>(null)
  const [veeamEnterpriseManager, setVeeamEnterpriseManager] =
    useState<VeeamEnterpriseManagerConnectorConfig | null>(null)
  const [veeamEnterpriseManagerSaving, setVeeamEnterpriseManagerSaving] = useState(false)
  const [veeamEnterpriseManagerMessage, setVeeamEnterpriseManagerMessage] = useState<string | null>(null)
  const [veeamEnterpriseManagerTesting, setVeeamEnterpriseManagerTesting] = useState(false)
  const [veeamEnterpriseManagerDebugging, setVeeamEnterpriseManagerDebugging] = useState(false)
  const [veeamEnterpriseManagerDebug, setVeeamEnterpriseManagerDebug] = useState<{
    backup_sessions: {
      endpoint?: string | null
      status_code?: number | null
      count: number
      error?: string | null
      samples?: Record<string, string[]>
      matches?: Array<{
        name: string
        event_kind: string
        match_field: string
        match_value: string
        count: number
      }>
    }
    backup_task_sessions: {
      endpoint?: string | null
      status_code?: number | null
      count: number
      error?: string | null
      samples?: Record<string, string[]>
      matches?: Array<{
        name: string
        event_kind: string
        match_field: string
        match_value: string
        count: number
      }>
    }
    restore_sessions: {
      endpoint?: string | null
      status_code?: number | null
      count: number
      error?: string | null
      samples?: Record<string, string[]>
      matches?: Array<{
        name: string
        event_kind: string
        match_field: string
        match_value: string
        count: number
      }>
    }
    normalized?: {
      resilience_signals: number
      recovery_jobs: number
      task_sessions: number
    }
  } | null>(null)
  const [github, setGithub] = useState<GitHubConnectorConfig | null>(null)
  const [githubRepositories, setGithubRepositories] = useState('')
  const [githubSaving, setGithubSaving] = useState(false)
  const [githubMessage, setGithubMessage] = useState<string | null>(null)
  const [githubTesting, setGithubTesting] = useState(false)
  const [gitlab, setGitlab] = useState<GitLabConnectorConfig | null>(null)
  const [gitlabProjects, setGitlabProjects] = useState('')
  const [gitlabSaving, setGitlabSaving] = useState(false)
  const [gitlabMessage, setGitlabMessage] = useState<string | null>(null)
  const [gitlabTesting, setGitlabTesting] = useState(false)
  const [serviceNow, setServiceNow] = useState<ServiceNowConnectorConfig | null>(null)
  const [serviceNowSaving, setServiceNowSaving] = useState(false)
  const [serviceNowMessage, setServiceNowMessage] = useState<string | null>(null)
  const [serviceNowTables, setServiceNowTables] = useState('')
  const [bambooHr, setBambooHr] = useState<BambooHrConnectorConfig | null>(null)
  const [bambooHrSaving, setBambooHrSaving] = useState(false)
  const [bambooHrMessage, setBambooHrMessage] = useState<string | null>(null)
  const [bambooHrTesting, setBambooHrTesting] = useState(false)
  const [workday, setWorkday] = useState<WorkdayConnectorConfig | null>(null)
  const [workdaySaving, setWorkdaySaving] = useState(false)
  const [workdayMessage, setWorkdayMessage] = useState<string | null>(null)
  const [workdayTesting, setWorkdayTesting] = useState(false)
  const [jira, setJira] = useState<JiraConnectorConfig | null>(null)
  const [jiraProjects, setJiraProjects] = useState('')
  const [jiraSaving, setJiraSaving] = useState(false)
  const [jiraMessage, setJiraMessage] = useState<string | null>(null)
  const [jiraTesting, setJiraTesting] = useState(false)
  const [awsPosture, setAwsPosture] = useState<AwsPostureConnectorConfig | null>(null)
  const [awsPostureSaving, setAwsPostureSaving] = useState(false)
  const [awsPostureMessage, setAwsPostureMessage] = useState<string | null>(null)
  const [awsPostureTesting, setAwsPostureTesting] = useState(false)
  const [azurePosture, setAzurePosture] = useState<AzurePostureConnectorConfig | null>(null)
  const [azurePostureSaving, setAzurePostureSaving] = useState(false)
  const [azurePostureMessage, setAzurePostureMessage] = useState<string | null>(null)
  const [azurePostureTesting, setAzurePostureTesting] = useState(false)
  const [gcpPosture, setGcpPosture] = useState<GcpPostureConnectorConfig | null>(null)
  const [gcpPostureSaving, setGcpPostureSaving] = useState(false)
  const [gcpPostureMessage, setGcpPostureMessage] = useState<string | null>(null)
  const [gcpPostureTesting, setGcpPostureTesting] = useState(false)
  const [genericTestMessage, setGenericTestMessage] = useState<string | null>(null)
  const [genericTesting, setGenericTesting] = useState(false)
  const [paloAltoConfigs, setPaloAltoConfigs] = useState<PaloAltoConnectorInstance[]>([])
  const [paloAltoSelected, setPaloAltoSelected] = useState('')
  const [paloAltoNewName, setPaloAltoNewName] = useState('')
  const [paloAltoSaving, setPaloAltoSaving] = useState(false)
  const [paloAltoMessage, setPaloAltoMessage] = useState<string | null>(null)
  const [paloAltoTesting, setPaloAltoTesting] = useState(false)
  const [paloAltoDebugging, setPaloAltoDebugging] = useState(false)
  const [paloAltoDebug, setPaloAltoDebug] = useState<PaloAltoDebugResponse | null>(null)
  const [paloAltoMappingsExpanded, setPaloAltoMappingsExpanded] = useState<Record<string, boolean>>({})
  const [dellDataDomainConfigs, setDellDataDomainConfigs] = useState<DellDataDomainConnectorInstance[]>([])
  const [dellDataDomainSelected, setDellDataDomainSelected] = useState('')
  const [dellDataDomainNewName, setDellDataDomainNewName] = useState('')
  const [dellDataDomainSaving, setDellDataDomainSaving] = useState(false)
  const [dellDataDomainMessage, setDellDataDomainMessage] = useState<string | null>(null)
  const [dellDataDomainTesting, setDellDataDomainTesting] = useState(false)
  const [dnac, setDnac] = useState<DnacConnectorConfig | null>(null)
  const [dnacSaving, setDnacSaving] = useState(false)
  const [dnacMessage, setDnacMessage] = useState<string | null>(null)
  const [dnacTesting, setDnacTesting] = useState(false)
  const [restconf, setRestconf] = useState<RestconfConnectorConfig | null>(null)
  const [restconfSaving, setRestconfSaving] = useState(false)
  const [restconfMessage, setRestconfMessage] = useState<string | null>(null)
  const [restconfTesting, setRestconfTesting] = useState(false)
  const [netconf, setNetconf] = useState<NetconfConnectorConfig | null>(null)
  const [netconfSaving, setNetconfSaving] = useState(false)
  const [netconfMessage, setNetconfMessage] = useState<string | null>(null)
  const [netconfTesting, setNetconfTesting] = useState(false)
  const [healthSortKey, setHealthSortKey] = useState<HealthSortKey>('name')
  const [healthSortDir, setHealthSortDir] = useState<'asc' | 'desc'>('asc')
  const [healthFilters, setHealthFilters] = useState({
    name: '',
    category: '',
    status: '',
    last_run: '',
    success: '',
    validation: '',
    signals: '',
  })

  const categorizedAvailable = (config?.available ?? []).map((name) => ({
    name,
    category: CONNECTOR_CATEGORIES[name] ?? 'Other',
  }))
  const groupedAvailable = categorizedAvailable.reduce<Record<string, string[]>>((acc, item) => {
    acc[item.category] = acc[item.category] || []
    acc[item.category].push(item.name)
    return acc
  }, {})

  const connectorCategory = (name: string) =>
    CONNECTOR_CATEGORIES[name] ?? CONNECTOR_CATEGORIES[name.split(':')[0]] ?? 'Other'
  const isEnabledConnectorName = useCallback((name: string) => {
    if (selected.includes(name)) return true
    const base = name.split(':')[0]
    return selected.includes(base)
  }, [selected])
  const veeamEnterpriseManagerEnabled = selected.includes('veeam_enterprise_manager')
  const configuredPaloAltoHealthNames = useMemo(
    () =>
      new Set(
        paloAltoConfigs
          .map((item) => connectorInstanceSlug(item.name))
          .filter(Boolean)
          .map((instance) => `palo_alto:${instance}`),
      ),
    [paloAltoConfigs],
  )
  const configuredHealth = useMemo(() => {
    const items = (data?.connectors ?? [])
      .filter((c) => isEnabledConnectorName(c.name))
      .filter((c) => {
        const normalized = c.name.toLowerCase()
        if (normalized === 'palo_alto') {
          return false
        }
        if (normalized.startsWith('palo_alto:')) {
          return configuredPaloAltoHealthNames.has(normalized)
        }
        return true
      })
    const hasPaloInstances = items.some((c) => c.name.startsWith('palo_alto:'))
    if (hasPaloInstances) {
      return items.filter((c) => c.name !== 'palo_alto')
    }
    return items
  }, [configuredPaloAltoHealthNames, data?.connectors, isEnabledConnectorName])
  const filteredHealth = useMemo(() => {
    const normalize = (value: unknown) => String(value ?? '').toLowerCase()
    const filtered = configuredHealth.filter((c) => {
      if (healthFilters.name && !normalize(c.name).includes(healthFilters.name.toLowerCase())) {
        return false
      }
      if (
        healthFilters.category &&
        !normalize(c.category ?? connectorCategory(c.name)).includes(healthFilters.category.toLowerCase())
      ) {
        return false
      }
      if (healthFilters.status && !normalize(c.status).includes(healthFilters.status.toLowerCase())) {
        return false
      }
      if (healthFilters.last_run && !normalize(c.last_run).includes(healthFilters.last_run.toLowerCase())) {
        return false
      }
      const successFail = `${c.success_count ?? 0}/${c.failure_count ?? 0}`
      if (healthFilters.success && !normalize(successFail).includes(healthFilters.success.toLowerCase())) {
        return false
      }
      if (
        healthFilters.validation &&
        !normalize(
          [
            c.validation_issue_count,
            ...(c.validation_issues ?? []).map((issue) => healthIssueText(issue)),
          ].join(' '),
        ).includes(healthFilters.validation.toLowerCase())
      ) {
        return false
      }
      const alertText = [
        ...(c.alerts ?? []).flatMap((alert) => [alert.key, alert.message, alert.level]),
        c.ha_status,
        c.sla?.ha_status,
        c.sla?.freshness_ok,
        c.sla?.provenance_ok,
        ...(c.partial_failures ?? []).map((item) => healthIssueText(item)),
        healthErrorText(c.last_error),
      ].join(' ')
      if (healthFilters.signals && !normalize(alertText).includes(healthFilters.signals.toLowerCase())) {
        return false
      }
      return true
    })
    return filtered.sort((a, b) => {
      const direction = healthSortDir === 'asc' ? 1 : -1
      if (healthSortKey === 'last_run') {
        const aTime = Date.parse(a.last_run ?? '') || 0
        const bTime = Date.parse(b.last_run ?? '') || 0
        return (aTime - bTime) * direction
      }
      if (healthSortKey === 'success') {
        const aSuccess = a.success_count ?? 0
        const bSuccess = b.success_count ?? 0
        if (aSuccess !== bSuccess) return (aSuccess - bSuccess) * direction
        const aFail = a.failure_count ?? 0
        const bFail = b.failure_count ?? 0
        return (aFail - bFail) * direction
      }
      if (healthSortKey === 'validation') {
        return ((a.validation_issue_count ?? 0) - (b.validation_issue_count ?? 0)) * direction
      }
      if (healthSortKey === 'signals') {
        return ((a.alerts?.length ?? 0) - (b.alerts?.length ?? 0)) * direction
      }
      if (healthSortKey === 'category') {
        return String(a.category ?? connectorCategory(a.name)).localeCompare(String(b.category ?? connectorCategory(b.name))) * direction
      }
      const aValue = String((a as Record<string, unknown>)[healthSortKey] ?? '').toLowerCase()
      const bValue = String((b as Record<string, unknown>)[healthSortKey] ?? '').toLowerCase()
      return aValue.localeCompare(bValue) * direction
    })
  }, [configuredHealth, healthFilters, healthSortKey, healthSortDir])
  const groupedHealth = useMemo(() => {
    return filteredHealth.reduce<Record<string, ConnectorStatus[]>>((acc, connector) => {
      const category = connector.category ?? connectorCategory(connector.name)
      acc[category] = acc[category] || []
      acc[category].push(connector)
      return acc
    }, {})
  }, [filteredHealth])
  const sortedHealthCategories = useMemo(() => {
    return Object.entries(groupedHealth).sort((a, b) => a[0].localeCompare(b[0]))
  }, [groupedHealth])
  const [expandedHealth, setExpandedHealth] = useState<Record<string, boolean>>({})
  const [expandedReplicationGroups, setExpandedReplicationGroups] = useState<
    Record<string, Record<string, boolean>>
  >({})
  const [expandedReplicationVolumes, setExpandedReplicationVolumes] = useState<Record<string, boolean>>({})
  const [expandedBackupWeeks, setExpandedBackupWeeks] = useState<Record<string, boolean>>({})
  const [expandedBackupDates, setExpandedBackupDates] = useState<Record<string, boolean>>({})
  const toggleHealthExpanded = (name: string) => {
    setExpandedHealth((prev) => ({ ...prev, [name]: !prev[name] }))
  }
  const toggleReplicationGroup = (connectorName: string, groupKey: string) => {
    setExpandedReplicationGroups((prev) => {
      const connectorGroups = prev[connectorName] ?? {}
      return {
        ...prev,
        [connectorName]: {
          ...connectorGroups,
          [groupKey]: !connectorGroups[groupKey],
        },
      }
    })
  }
  const toggleReplicationVolume = (key: string) => {
    setExpandedReplicationVolumes((prev) => ({ ...prev, [key]: !prev[key] }))
  }
  const toggleBackupWeek = (key: string) => {
    setExpandedBackupWeeks((prev) => ({ ...prev, [key]: !prev[key] }))
  }
  const toggleBackupDate = (key: string) => {
    setExpandedBackupDates((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const statusColor = (status?: string) => {
    if (!status) return 'bg-slate-600'
    const s = status.toLowerCase()
    if (['ok', 'healthy', 'up', 'ready', 'running'].includes(s)) return 'bg-emerald-500'
    if (['degraded', 'warning', 'warn'].includes(s)) return 'bg-amber-400'
    if (['error', 'failed', 'down'].includes(s)) return 'bg-rose-500'
    return 'bg-slate-500'
  }

  const alertBadgeClass = (level?: string) => {
    if (!level) return 'bg-slate-500/20 text-slate-200'
    const normalized = level.toLowerCase()
    if (normalized === 'error') return 'bg-rose-500/20 text-rose-200'
    if (normalized === 'warning') return 'bg-amber-500/20 text-amber-200'
    return 'bg-slate-500/20 text-slate-200'
  }

  const replicationBadgeClass = (status?: string) => {
    const normalized = (status ?? '').toLowerCase()
    if (['error', 'failed', 'critical'].includes(normalized)) return 'bg-rose-500/20 text-rose-200'
    if (['degraded', 'warning'].includes(normalized)) return 'bg-amber-500/20 text-amber-200'
    if (['ok', 'healthy', 'enabled', 'running'].includes(normalized))
      return 'bg-emerald-500/20 text-emerald-200'
    return 'bg-slate-500/20 text-slate-200'
  }

  const backupTimestamp = (value?: string | null) => {
    if (!value) return Number.NEGATIVE_INFINITY
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
  }

  const backupDateLabel = (value?: string | null) => {
    if (!value) return 'unknown'
    const parsed = Date.parse(value)
    if (Number.isNaN(parsed)) return 'unknown'
    return new Date(parsed).toISOString().slice(0, 10)
  }

  const backupWeekLabel = (value?: string | null) => {
    if (!value) return 'unknown'
    const parsed = Date.parse(value)
    if (Number.isNaN(parsed)) return 'unknown'
    const date = new Date(parsed)
    const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    const day = utcDate.getUTCDay() || 7
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day)
    const weekYear = utcDate.getUTCFullYear()
    const yearStart = new Date(Date.UTC(weekYear, 0, 1))
    const week = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
    return `${weekYear}-W${String(week).padStart(2, '0')}`
  }

  const groupVmBackupsByWeek = (entries: VmLastBackupStatus[], maxItems = 20) => {
    const sorted = [...entries].sort(
      (a, b) => backupTimestamp(b.last_success) - backupTimestamp(a.last_success),
    )
    const grouped = new Map<string, Map<string, VmLastBackupStatus[]>>()
    const weekOrder: string[] = []
    const dateOrder: Record<string, string[]> = {}
    const weekSet = new Set<string>()
    let shown = 0
    for (const entry of sorted) {
      if (shown >= maxItems) break
      const label = backupDateLabel(entry.last_success)
      const week = backupWeekLabel(entry.last_success)
      if (!weekSet.has(week)) {
        weekSet.add(week)
        weekOrder.push(week)
        dateOrder[week] = []
        grouped.set(week, new Map<string, VmLastBackupStatus[]>())
      }
      const weekMap = grouped.get(week) as Map<string, VmLastBackupStatus[]>
      const dates = dateOrder[week]
      if (!weekMap.has(label)) {
        weekMap.set(label, [])
        dates.push(label)
      }
      weekMap.get(label)?.push(entry)
      shown += 1
    }
    const groups = weekOrder.map((week) => {
      const weekMap = grouped.get(week) as Map<string, VmLastBackupStatus[]>
      const dates = (dateOrder[week] || []).map((date) => ({
        date,
        items: weekMap.get(date) ?? [],
      }))
      return {
        week,
        dates,
        count: dates.reduce((total, date) => total + date.items.length, 0),
      }
    })
    const remaining = Math.max(0, entries.length - shown)
    return { weeks: groups, remaining }
  }

  const remoteSystemBadgeClass = (mode?: string) => {
    const normalized = (mode ?? '').toLowerCase()
    if (normalized === 'sync') return 'bg-sky-500/20 text-sky-200'
    if (normalized === 'async') return 'bg-indigo-500/20 text-indigo-200'
    return 'bg-slate-500/20 text-slate-200'
  }

  const replicationGroupModeLabel = (group: ReplicationVolumeGroupStatus) => {
    const mode = (group.replication_mode ?? '').toLowerCase()
    if (!mode || mode === 'unknown') return null
    if (mode === 'sync') return 'sync'
    if (mode === 'async') {
      const role = (group.replication_role ?? '').toLowerCase()
      if (role === 'source' || role === 'destination') return `async ${role}`
      if (role === 'mixed') return 'async mixed'
      return 'async'
    }
    return mode
  }

  const haBadgeClass = (status?: string, configured?: boolean) => {
    if (configured === false) return 'bg-rose-500/20 text-rose-200'
    const normalized = (status ?? '').toLowerCase()
    if (normalized === 'error') return 'bg-rose-500/20 text-rose-200'
    if (['degraded', 'warning'].includes(normalized)) return 'bg-amber-500/20 text-amber-200'
    if (['ok', 'healthy'].includes(normalized)) return 'bg-emerald-500/20 text-emerald-200'
    return 'bg-slate-500/20 text-slate-200'
  }


  const parseServiceNowTables = () =>
    serviceNowTables
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

  const parseGitHubRepositories = () =>
    githubRepositories
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)

  const parseGitLabProjects = () =>
    gitlabProjects
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)

  const parseJiraProjects = () =>
    jiraProjects
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)

  const formatApiError = (err: ApiError) => {
    const body = err.bodyText?.trim()
    if (!body) return err.message
    try {
      const parsed = JSON.parse(body) as { detail?: string }
      if (parsed?.detail) return parsed.detail
    } catch {
      // ignore JSON parsing errors
    }
    return body
  }

  const assetOptionLabel = (asset: InventoryAsset) => {
    const name = asset.name?.trim() ?? ''
    const assetType = asset.asset_type?.trim() ?? ''
    if (name && assetType) return `${name} (${assetType})`
    if (name) return name
    if (assetType) return `${asset.asset_id} (${assetType})`
    return asset.asset_id
  }

  const sortedAssets = useMemo(() => {
    const items = [...assetOptions]
    items.sort((a, b) => assetOptionLabel(a).localeCompare(assetOptionLabel(b)))
    return items
  }, [assetOptions])

  const defaultAssetId = sortedAssets[0]?.asset_id ?? ''

  const AssetSelect = ({
    value,
    onChange,
    helpText,
    label,
  }: {
    value: string | null | undefined
    onChange: (next: string) => void
    helpText?: string
    label?: string
  }) => {
    const {
      t
    } = useI18n();

    const [query, setQuery] = useState('')
    const selectId = useId()
    const inputId = `${selectId}-filter`
    const listId = `${selectId}-list`

    const filteredAssets = (() => {
      const normalized = query.trim().toLowerCase()
      const base = normalized
        ? sortedAssets.filter((asset) => {
            const label = assetOptionLabel(asset).toLowerCase()
            const id = asset.asset_id.toLowerCase()
            return label.includes(normalized) || id.includes(normalized)
          })
        : sortedAssets

      if (value && !base.some((asset) => asset.asset_id === value)) {
        const selected = sortedAssets.find((asset) => asset.asset_id === value)
        if (selected) {
          return [selected, ...base]
        }
      }

      return base
    })()

    const singleMatch = filteredAssets.length === 1 ? filteredAssets[0] : null

    return (
      <div className="space-y-2 md:col-span-2">
        <div className="flex items-center gap-2">
          <Label>{label ?? 'Asset binding'}</Label>
          {helpText ? <HelpTip text={helpText} /> : null}
        </div>
        <input
          className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !singleMatch) return
            e.preventDefault()
            onChange(singleMatch.asset_id)
          }}
          placeholder={t('Filter by name or asset ID...', 'Filter by name or asset ID...')}
          id={inputId}
          name={inputId}
        />
        <select
          className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          id={listId}
          name={listId}
        >
          <option value="">{t('Select asset...', 'Select asset...')}</option>
          {filteredAssets.map((asset) => (
            <option key={asset.asset_id} value={asset.asset_id}>
              {assetOptionLabel(asset)}
            </option>
          ))}
        </select>
        {query && singleMatch ? (
          <p className="text-xs text-slate-300">
            {t('Press Enter to select', 'Press Enter to select')} {assetOptionLabel(singleMatch)}.
                      </p>
        ) : null}
        {assetTotal !== null ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span>
              {assetOptions.length}of {assetTotal} {t('assets loaded', 'assets loaded')}
            </span>
          </div>
        ) : null}
        {assetError ? <p className="text-xs text-rose-200">{assetError}</p> : null}
        {!sortedAssets.length && !assetError ? (
          <p className="text-xs text-amber-200">{t(
            'No inventory assets found. Create one first.',
            'No inventory assets found. Create one first.'
          )}</p>
        ) : null}
        {sortedAssets.length > 0 && !filteredAssets.length && !assetError ? (
          <p className="text-xs text-amber-200">{t('No assets match the filter.', 'No assets match the filter.')}</p>
        ) : null}
      </div>
    );
  }

  const defaultGlpiAssetEndpoints = (serverEndpoint?: string): GlpiAssetEndpoint[] => {
    const endpoints: GlpiAssetEndpoint[] = [
      { endpoint: 'Computer', asset_type: 'computer', tag: 'computer' },
      { endpoint: 'NetworkEquipment', asset_type: 'network_device', tag: 'network' },
    ]
    if (serverEndpoint) {
      endpoints.push({ endpoint: serverEndpoint, asset_type: 'server', tag: 'server' })
    }
    return endpoints
  }

  const validateEventMappings = (mappings?: ConnectorEventMapping[]) => {
    const invalid = (mappings ?? []).find((mapping) => mapping.enabled && !mapping.match_value?.trim())
    if (invalid) return 'Each enabled event mapping needs a match value.'
    return null
  }

  const validateGlpi = (payload: GlpiConnectorConfig | null) => {
    if (!payload) return 'GLPI settings are missing.'
    if (!payload.base_url?.trim()) return 'Base URL is required.'
    if (!payload.app_token?.trim()) return 'App token is required.'
    if (!payload.user_token?.trim()) return 'User token is required.'
    if (payload.asset_endpoints?.length) {
      const invalid = payload.asset_endpoints.find(
        (item) => !item.endpoint?.trim() || !item.asset_type?.trim(),
      )
      if (invalid) return 'Each asset endpoint needs an endpoint and asset type.'
    }
    const mappingError = validateEventMappings(payload.event_mappings)
    if (mappingError) return mappingError
    return null
  }

  const validateVcenter = (payload: VCenterConnectorInstance | null) => {
    if (!payload) return 'vCenter settings are missing.'
    if (requiresAssetBinding('vcenter') && !payload.asset_id?.trim()) {
      return 'Asset binding is required.'
    }
    if (!payload.name?.trim()) return 'Instance name is required.'
    if (!payload.base_url?.trim()) return 'Base URL is required.'
    if (!payload.username?.trim()) return 'Username is required.'
    if (!payload.password?.trim()) return 'Password is required.'
    const mappingError = validateEventMappings(payload.event_mappings)
    if (mappingError) return mappingError
    return null
  }

  const validatePowerstore = (payload: PowerStoreConnectorInstance | null) => {
    if (!payload) return 'PowerStore settings are missing.'
    if (requiresAssetBinding('powerstore') && !payload.asset_id?.trim()) {
      return 'Asset binding is required.'
    }
    if (!payload.name?.trim()) return 'Instance name is required.'
    if (!payload.base_url?.trim()) return 'Base URL is required.'
    if (!payload.username?.trim()) return 'Username is required.'
    if (!payload.password?.trim()) return 'Password is required.'
    const mappingError = validateEventMappings(payload.event_mappings)
    if (mappingError) return mappingError
    return null
  }

  const validateVeeamEnterpriseManager = (payload: VeeamEnterpriseManagerConnectorConfig | null) => {
    if (!payload) return 'Veeam Enterprise Manager settings are missing.'
    if (requiresAssetBinding('veeam_enterprise_manager') && !payload.asset_id?.trim()) {
      return 'Asset binding is required.'
    }
    if (!payload.base_url?.trim()) return 'Base URL is required.'
    if (!payload.username?.trim()) return 'Username is required.'
    if (!payload.password?.trim()) return 'Password is required.'
    const mappingError = validateEventMappings(payload.event_mappings)
    if (mappingError) return mappingError
    return null
  }

  const validateGitHub = (payload: GitHubConnectorConfig | null) => {
    if (!payload) return 'GitHub settings are missing.'
    if (!payload.base_url?.trim()) return 'Base URL is required.'
    if (!payload.token?.trim()) return 'Token is required.'
    if (parseGitHubRepositories().length === 0) return 'At least one repository is required.'
    return null
  }

  const validateGitLab = (payload: GitLabConnectorConfig | null) => {
    if (!payload) return 'GitLab settings are missing.'
    if (!payload.base_url?.trim()) return 'Base URL is required.'
    if (!payload.token?.trim()) return 'Token is required.'
    if (parseGitLabProjects().length === 0) return 'At least one project is required.'
    return null
  }

  const validateServiceNow = (payload: ServiceNowConnectorConfig | null) => {
    if (!payload) return 'ServiceNow settings are missing.'
    if (!payload.instance?.trim()) return 'Instance is required.'
    if (!payload.username?.trim()) return 'Username is required.'
    if (!payload.password?.trim()) return 'Password is required.'
    if (parseServiceNowTables().length === 0) return 'At least one table is required.'
    return null
  }

  const validateBambooHr = (payload: BambooHrConnectorConfig | null) => {
    if (!payload) return 'BambooHR settings are missing.'
    if (!payload.base_url?.trim()) return 'Base URL is required.'
    if (!payload.api_key?.trim()) return 'API key is required.'
    return null
  }

  const validateWorkday = (payload: WorkdayConnectorConfig | null) => {
    if (!payload) return 'Workday settings are missing.'
    if (!payload.base_url?.trim()) return 'Base URL is required.'
    if (!payload.username?.trim()) return 'Username is required.'
    if (!payload.password?.trim()) return 'Password is required.'
    if (!payload.report_path?.trim()) return 'Report path is required.'
    return null
  }

  const validateJira = (payload: JiraConnectorConfig | null) => {
    if (!payload) return 'Jira settings are missing.'
    if (!payload.base_url?.trim()) return 'Base URL is required.'
    if (!payload.username?.trim()) return 'Username is required.'
    if (!payload.api_token?.trim() && !payload.password?.trim()) {
      return 'API token or password is required.'
    }
    return null
  }

  const validateAwsPosture = (payload: AwsPostureConnectorConfig | null) => {
    if (!payload) return 'AWS posture settings are missing.'
    if (requiresAssetBinding('aws_posture') && !payload.asset_id?.trim()) {
      return 'Asset binding is required.'
    }
    if (!payload.region?.trim()) return 'Region is required.'
    return null
  }

  const validateAzurePosture = (payload: AzurePostureConnectorConfig | null) => {
    if (!payload) return 'Azure posture settings are missing.'
    if (requiresAssetBinding('azure_posture') && !payload.asset_id?.trim()) {
      return 'Asset binding is required.'
    }
    if (!payload.tenant_id?.trim()) return 'Tenant ID is required.'
    if (!payload.client_id?.trim()) return 'Client ID is required.'
    if (!payload.client_secret?.trim()) return 'Client secret is required.'
    if (!payload.subscription_id?.trim()) return 'Subscription ID is required.'
    return null
  }

  const validateGcpPosture = (payload: GcpPostureConnectorConfig | null) => {
    if (!payload) return 'GCP posture settings are missing.'
    if (requiresAssetBinding('gcp_posture') && !payload.asset_id?.trim()) {
      return 'Asset binding is required.'
    }
    if (!payload.organization_id?.trim()) return 'Organization ID is required.'
    if (!payload.access_token?.trim()) return 'Access token is required.'
    return null
  }

  const validatePaloAlto = (payload: PaloAltoConnectorInstance | null) => {
    if (!payload) return 'Palo Alto settings are missing.'
    if (requiresAssetBinding('palo_alto')) {
      const instanceAssetId = payload.asset_id?.trim()
      if (!instanceAssetId) {
        const missingNode = payload.clusters.find((cluster) => {
          if (!cluster.active_asset_id?.trim()) return true
          if (cluster.passive_url?.trim() && !cluster.passive_asset_id?.trim()) return true
          return false
        })
        if (missingNode) {
          return 'Asset binding is required for each cluster node.'
        }
      }
    }
    if (!payload.name?.trim()) return 'Instance name is required.'
    if (payload.auth_mode === 'api_key' && !payload.api_key?.trim()) return 'API key is required.'
    if (payload.auth_mode === 'password') {
      if (!payload.username?.trim()) return 'Username is required.'
      if (!payload.password?.trim()) return 'Password is required.'
    }
    if (!payload.clusters.length) return 'At least one cluster is required.'
    const missing = payload.clusters.find(
      (cluster) => !cluster.name?.trim() || !cluster.active_url?.trim(),
    )
    if (missing) return 'Each cluster needs a name and active URL.'
    const invalidMapping = payload.event_mappings?.find(
      (mapping) => mapping.enabled && !mapping.match_value?.trim(),
    )
    if (invalidMapping) return 'Each enabled event mapping needs a match value.'
    return null
  }

  const validateDellDataDomain = (payload: DellDataDomainConnectorInstance | null) => {
    if (!payload) return 'Dell Data Domain settings are missing.'
    if (requiresAssetBinding('dell_datadomain') && !payload.asset_id?.trim()) {
      return 'Asset binding is required.'
    }
    if (!payload.name?.trim()) return 'Instance name is required.'
    if (!payload.url?.trim()) return 'Base URL is required.'
    if (!payload.username?.trim()) return 'Username is required.'
    if (!payload.password?.trim()) return 'Password is required.'
    return null
  }

  const validateDnac = (payload: DnacConnectorConfig | null) => {
    if (!payload) return 'DNA Center settings are missing.'
    if (requiresAssetBinding('dnac') && !payload.asset_id?.trim()) {
      return 'Asset binding is required.'
    }
    if (!payload.base_url?.trim()) return 'Base URL is required.'
    if (!payload.username?.trim()) return 'Username is required.'
    if (!payload.password?.trim()) return 'Password is required.'
    return null
  }

  const validateRestconf = (payload: RestconfConnectorConfig | null) => {
    if (!payload) return 'RESTCONF settings are missing.'
    if (requiresAssetBinding('restconf') && !payload.asset_id?.trim()) {
      return 'Asset binding is required.'
    }
    if (!payload.base_url?.trim()) return 'Base URL is required.'
    if (!payload.username?.trim()) return 'Username is required.'
    if (!payload.password?.trim()) return 'Password is required.'
    return null
  }

  const validateNetconf = (payload: NetconfConnectorConfig | null) => {
    if (!payload) return 'NETCONF settings are missing.'
    if (requiresAssetBinding('netconf') && !payload.asset_id?.trim()) {
      return 'Asset binding is required.'
    }
    if (!payload.host?.trim()) return 'Host is required.'
    if (!payload.username?.trim()) return 'Username is required.'
    if (!payload.password?.trim()) return 'Password is required.'
    return null
  }

  const updateGlpiAssetEndpoint = (index: number, patch: Partial<GlpiAssetEndpoint>) => {
    setGlpi((prev) => {
      if (!prev) return prev
      const current = prev.asset_endpoints ?? []
      const next = [...current]
      const existing = next[index] ?? { endpoint: '', asset_type: '', tag: '' }
      next[index] = { ...existing, ...patch }
      return { ...prev, asset_endpoints: next }
    })
  }

  const addGlpiAssetEndpoint = () => {
    setGlpi((prev) => {
      if (!prev) return prev
      const current = prev.asset_endpoints ?? []
      return {
        ...prev,
        asset_endpoints: [...current, { endpoint: '', asset_type: '', tag: '' }],
      }
    })
  }

  const removeGlpiAssetEndpoint = (index: number) => {
    setGlpi((prev) => {
      if (!prev) return prev
      const current = prev.asset_endpoints ?? []
      if (!current.length) return prev
      const next = current.filter((_, idx) => idx !== index)
      return { ...prev, asset_endpoints: next }
    })
  }

  const addGlpiEventMapping = () => {
    setGlpi((prev) => {
      if (!prev) return prev
      const current = prev.event_mappings ?? []
      const [defaultKind] = EVENT_KINDS_BY_CONNECTOR.glpi
      const newMapping = buildDefaultEventMapping(defaultKind)
      return { ...prev, event_mappings: [...current, newMapping] }
    })
  }

  const updateGlpiEventMapping = (index: number, patch: Partial<ConnectorEventMapping>) => {
    setGlpi((prev) => {
      if (!prev) return prev
      const current = prev.event_mappings ?? []
      const next = current.map((mapping, idx) => {
        if (idx !== index) return mapping
        const merged = { ...mapping, ...patch } as ConnectorEventMapping
        const nextKind = patch.event_kind ?? merged.event_kind
        return normalizeEventMapping(merged, nextKind)
      })
      return { ...prev, event_mappings: next }
    })
  }

  const removeGlpiEventMapping = (index: number) => {
    setGlpi((prev) => {
      if (!prev) return prev
      const next = (prev.event_mappings ?? []).filter((_, idx) => idx !== index)
      return { ...prev, event_mappings: next }
    })
  }

  useEffect(() => {
    let cancelled = false
    async function loadStatuses() {
      if (connectorsLoadInFlightRef.current) return
      connectorsLoadInFlightRef.current = true
      setError(null)
      try {
        const result = await apiJson<ConnectorsResponse>('/connectors')
        if (!cancelled) {
          setData(result)
        }
      } catch (e) {
        if (!cancelled) setError(e as ApiError)
      } finally {
        connectorsLoadInFlightRef.current = false
      }
    }
    async function boot() {
      await loadStatuses()
      if (cancelled) return
      try {
        await apiFetch('/connectors/data?refresh=true')
      } catch {
        // ignore refresh failures; keep latest persisted telemetry view
      }
      if (!cancelled) await loadStatuses()
    }
    void boot()
    const onSnapshotRefreshed = () => {
      void loadStatuses()
    }
    window.addEventListener('connectors:snapshot-refreshed', onSnapshotRefreshed)
    return () => {
      cancelled = true
      window.removeEventListener('connectors:snapshot-refreshed', onSnapshotRefreshed)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setAssetError(null)
      try {
        const result = await apiJson<InventoryAssetsResponse>(
          `/inventory/assets?limit=${assetFetchLimit}`,
        )
        if (!cancelled) {
          setAssetOptions(result.items ?? [])
          setAssetTotal(result.count ?? null)
          if (result.count && result.count > assetFetchLimit) {
            setAssetFetchLimit(result.count)
          }
        }
      } catch (e) {
        if (!cancelled) setAssetError((e as ApiError).message)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [assetFetchLimit])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<GlpiConnectorConfig>('/config/connectors/glpi')
        if (!cancelled) {
          const assetEndpoints = result.asset_endpoints?.length
            ? result.asset_endpoints
            : defaultGlpiAssetEndpoints(result.server_endpoint)
          const eventMappings = normalizeEventMappings(result.event_mappings)
          setGlpi({ ...result, event_mappings: eventMappings, asset_endpoints: assetEndpoints })
        }
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<VCenterConnectorConfigList>('/config/connectors/vcenter')
        if (!cancelled) {
          const items: VCenterConnectorInstance[] = (result.items ?? []).map((item) => ({
            ...item,
            event_mappings: normalizeEventMappings(item.event_mappings),
          }))
          setVcenterConfigs(items)
          setVcenterSelected((current) =>
            items.length && !items.find((item) => item.name === current) ? items[0].name : current,
          )
        }
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<PowerStoreConnectorConfigList>('/config/connectors/powerstore')
        if (!cancelled) {
          const items: PowerStoreConnectorInstance[] = (result.items ?? []).map((item) => ({
            ...item,
            event_mappings: normalizeEventMappings(item.event_mappings),
          }))
          setPowerstoreConfigs(items)
          setPowerstoreSelected((current) =>
            items.length && !items.find((item) => item.name === current) ? items[0].name : current,
          )
        }
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<VeeamEnterpriseManagerConnectorConfig>(
          '/config/connectors/veeam_enterprise_manager',
        )
        if (!cancelled) {
          const eventMappings = normalizeEventMappings(result.event_mappings)
          setVeeamEnterpriseManager({ ...result, event_mappings: eventMappings })
        }
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<GitHubConnectorConfig>('/config/connectors/github')
        if (!cancelled) {
          setGithub(result)
          setGithubRepositories((result.repositories ?? []).join(', '))
        }
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<GitLabConnectorConfig>('/config/connectors/gitlab')
        if (!cancelled) {
          setGitlab(result)
          setGitlabProjects((result.projects ?? []).join(', '))
        }
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<PaloAltoConnectorConfigList>('/config/connectors/palo_alto')
        if (!cancelled) {
          const hasSavedItems = Object.prototype.hasOwnProperty.call(result, 'items')
          const items: PaloAltoConnectorInstance[] = (result.items ?? []).map((item) => ({
            ...item,
            ha_only_logs: item.ha_only_logs ?? true,
            clusters: (item.clusters?.length ? item.clusters : [buildDefaultPaloAltoCluster(`${item.name}-cluster-1`)]).map(
              (cluster, index) => ({
                ...cluster,
                name: cluster.name?.trim() || `${item.name}-cluster-${index + 1}`,
                active_asset_id: cluster.active_asset_id ?? '',
                passive_asset_id: cluster.passive_asset_id ?? '',
              }),
            ),
            event_mappings: item.event_mappings ?? [],
            log_since_time: item.log_since_time ?? '',
          }))
          if (hasSavedItems) {
            setPaloAltoConfigs(items)
            setPaloAltoSelected((current) =>
              items.find((item) => item.name === current) ? current : items[0]?.name ?? '',
            )
            return
          }
        }
        const connectors = await apiJson<ConnectorsResponse>('/connectors')
        const connectorList = connectors.connectors ?? []
        if (cancelled) return
        const fallbackNames = connectorList
          .map((connector) => connector.name)
          .filter((name) => name.startsWith('palo_alto:'))
          .map((name) => name.split(':')[1])
          .filter((name): name is string => Boolean(name && name.trim()))
        if (fallbackNames.length) {
          const fallbackItems: PaloAltoConnectorInstance[] = fallbackNames.map((name) => ({
            ...buildDefaultPaloAltoInstance(name, ''),
            event_mappings: [],
          }))
          setPaloAltoConfigs(fallbackItems)
          setPaloAltoSelected(fallbackItems[0].name)
          setPaloAltoMessage(
            'Loaded Palo Alto instances from runtime status. Please re-enter credentials and cluster URLs, then save.',
          )
          return
        }
        const defaultItem = buildDefaultPaloAltoInstance('default', '')
        setPaloAltoConfigs([defaultItem])
        setPaloAltoSelected(defaultItem.name)
        setPaloAltoMessage('Enter the firewall management IP address or URL, then save the Palo Alto instance.')
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (selectedConnector !== 'palo_alto') return
    if (!paloAltoSelected && paloAltoConfigs.length) {
      setPaloAltoSelected(paloAltoConfigs[0].name)
    }
  }, [selectedConnector, paloAltoConfigs, paloAltoSelected])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<ServiceNowConnectorConfig>('/config/connectors/service_now')
        if (!cancelled) {
          setServiceNow(result)
          setServiceNowTables((result.tables ?? []).join(', '))
        }
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<BambooHrConnectorConfig>('/config/connectors/bamboohr')
        if (!cancelled) setBambooHr(result)
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<WorkdayConnectorConfig>('/config/connectors/workday')
        if (!cancelled) setWorkday(result)
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<JiraConnectorConfig>('/config/connectors/jira')
        if (!cancelled) {
          setJira(result)
          setJiraProjects((result.projects ?? []).join(', '))
        }
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<AwsPostureConnectorConfig>('/config/connectors/aws_posture')
        if (!cancelled) setAwsPosture(result)
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<AzurePostureConnectorConfig>('/config/connectors/azure_posture')
        if (!cancelled) setAzurePosture(result)
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<GcpPostureConnectorConfig>('/config/connectors/gcp_posture')
        if (!cancelled) setGcpPosture(result)
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<DellDataDomainConnectorConfigList>(
          '/config/connectors/dell_datadomain',
        )
        if (!cancelled) {
          const items: DellDataDomainConnectorInstance[] = (result.items ?? []).map((item) => ({
            ...item,
            event_mappings: normalizeEventMappings(item.event_mappings),
          }))
          setDellDataDomainConfigs(items)
          setDellDataDomainSelected((current) =>
            items.length && !items.find((item) => item.name === current) ? items[0].name : current,
          )
        }
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<DnacConnectorConfig>('/config/connectors/dnac')
        if (!cancelled) {
          const event_mappings = normalizeEventMappings(result.event_mappings)
          setDnac({ ...result, event_mappings })
        }
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<RestconfConnectorConfig>('/config/connectors/restconf')
        if (!cancelled) setRestconf(result)
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<NetconfConnectorConfig>('/config/connectors/netconf')
        if (!cancelled) setNetconf(result)
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setConfigError(null)
      try {
        const result = await apiJson<ConnectorConfigResponse>('/config/connectors')
        if (!cancelled) {
          setConfig(result)
          setSelected(result.enabled ?? [])
        }
      } catch (e) {
        if (!cancelled) setConfigError(e as ApiError)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  function addConnector(name: string) {
    if (!name) return
    setSelected((prev) => {
      if (prev.includes(name)) return prev
      return [...prev, name]
    })
  }

  function setConnectorEnabled(name: string, enabled: boolean) {
    const normalized = name.trim().toLowerCase()
    if (!normalized) return
    setSelected((prev) => {
      if (enabled) {
        return prev.includes(normalized) ? prev : [...prev, normalized]
      }
      return prev.filter((item) => item !== normalized)
    })
  }

  const resolveConnectorInstances = (connector: string) => {
    const normalized = connector.trim().toLowerCase()
    let instances: string[] = []
    if (normalized === 'vcenter') {
      instances = normalizeInstanceNames(vcenterConfigs.map((item) => item.name))
    } else if (normalized === 'powerstore') {
      instances = normalizeInstanceNames(powerstoreConfigs.map((item) => item.name))
    } else if (normalized === 'palo_alto') {
      instances = normalizeInstanceNames(paloAltoConfigs.map((item) => item.name))
    } else if (normalized === 'dell_datadomain') {
      instances = normalizeInstanceNames(dellDataDomainConfigs.map((item) => item.name))
    }
    return instances.length ? instances : ['default']
  }

  const ensureBaselineMappings = async (connectors: string[]) => {
    const targets = uniqueSorted(connectors.map((name) => name.trim().toLowerCase()).filter(Boolean))
    if (!targets.length) return false
    try {
      const frameworkResponse = await apiJson<FrameworkConfigResponse>('/config/frameworks')
      const frameworkKeys = uniqueSorted([
        ...(frameworkResponse.enabled ?? []),
        ...(frameworkResponse.frameworks ?? []).map((framework) => framework.key).filter(Boolean),
      ])
      if (!frameworkKeys.length) return false

      const mappingsResponse = await apiJson<ControlMappingsResponse>('/config/control-mappings')
      const items = Array.isArray(mappingsResponse.items) ? mappingsResponse.items : []
      const createBaseline = () =>
        frameworkKeys.map((framework) => ({ framework, control_ids: [], notes: '' }))

      let changed = false
      targets.forEach((connector) => {
        resolveConnectorInstances(connector).forEach((instance) => {
          const index = items.findIndex(
            (entry) =>
              entry.connector === connector &&
              entry.instance === instance &&
              (!entry.node || entry.node === '__all__'),
          )
          if (index === -1) {
            items.push({ connector, instance, mappings: createBaseline() })
            changed = true
            return
          }
          const entry = items[index]
          if (!Array.isArray(entry.mappings) || entry.mappings.length === 0) {
            entry.mappings = createBaseline()
            changed = true
          }
        })
      })

      if (!changed) return false
      await apiFetch('/config/control-mappings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      return true
    } catch (err) {
      console.warn('Failed to seed baseline control mappings.', err)
      return false
    }
  }

  async function saveConfig() {
    setSaving(true)
    setSaveMessage(null)
    try {
      const response = await apiFetch('/config/connectors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connector_sources: selected }),
      })
      const result = (await response.json()) as ConnectorConfigResponse
      setConfig(result)
      setSelected(result.enabled ?? [])
      const baselineUpdated = await ensureBaselineMappings(result.enabled ?? [])
      setSaveMessage(
        baselineUpdated
          ? 'Connector configuration saved. Baseline mappings created.'
          : 'Connector configuration saved.',
      )
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setSaveMessage(`Failed to save: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function saveGlpi() {
    const validationError = validateGlpi(glpi)
    if (validationError) {
      setGlpiMessage(validationError)
      return
    }
    setGlpiSaving(true)
    setGlpiMessage(null)
    try {
      const response = await apiFetch('/config/connectors/glpi', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(glpi),
      })
      const result = (await response.json()) as GlpiConnectorConfig
      const assetEndpoints = result.asset_endpoints?.length
        ? result.asset_endpoints
        : defaultGlpiAssetEndpoints(result.server_endpoint)
      const eventMappings = normalizeEventMappings(result.event_mappings)
      setGlpi({ ...result, event_mappings: eventMappings, asset_endpoints: assetEndpoints })
      setGlpiMessage('GLPI settings saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setGlpiMessage(`Failed to save: ${err.message}`)
    } finally {
      setGlpiSaving(false)
    }
  }

  async function deleteGlpi() {
    if (!window.confirm('Delete GLPI configuration?')) return
    setGlpiSaving(true)
    setGlpiMessage(null)
    try {
      const response = await apiFetch('/config/connectors/glpi', { method: 'DELETE' })
      const result = (await response.json()) as GlpiConnectorConfig
      const assetEndpoints = result.asset_endpoints?.length
        ? result.asset_endpoints
        : defaultGlpiAssetEndpoints(result.server_endpoint)
      const eventMappings = normalizeEventMappings(result.event_mappings)
      setGlpi({ ...result, event_mappings: eventMappings, asset_endpoints: assetEndpoints })
      setGlpiMessage('GLPI configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setGlpiMessage(`Failed to delete: ${err.message}`)
    } finally {
      setGlpiSaving(false)
    }
  }

  async function saveServiceNow() {
    const validationError = validateServiceNow(serviceNow)
    if (validationError) {
      setServiceNowMessage(validationError)
      return
    }
    setServiceNowSaving(true)
    setServiceNowMessage(null)
    const tables = parseServiceNowTables()
    try {
      const response = await apiFetch('/config/connectors/service_now', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...serviceNow, tables }),
      })
      const result = (await response.json()) as ServiceNowConnectorConfig
      setServiceNow(result)
      setServiceNowTables((result.tables ?? []).join(', '))
      setServiceNowMessage('ServiceNow settings saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setServiceNowMessage(`Failed to save: ${err.message}`)
    } finally {
      setServiceNowSaving(false)
    }
  }

  async function deleteServiceNow() {
    if (!window.confirm('Delete ServiceNow configuration?')) return
    setServiceNowSaving(true)
    setServiceNowMessage(null)
    try {
      const response = await apiFetch('/config/connectors/service_now', { method: 'DELETE' })
      const result = (await response.json()) as ServiceNowConnectorConfig
      setServiceNow(result)
      setServiceNowTables((result.tables ?? []).join(', '))
      setServiceNowMessage('ServiceNow configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setServiceNowMessage(`Failed to delete: ${err.message}`)
    } finally {
      setServiceNowSaving(false)
    }
  }

  async function saveBambooHr() {
    const validationError = validateBambooHr(bambooHr)
    if (validationError) {
      setBambooHrMessage(validationError)
      return
    }
    if (!bambooHr) return
    setBambooHrSaving(true)
    setBambooHrMessage(null)
    try {
      const response = await apiFetch('/config/connectors/bamboohr', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bambooHr),
      })
      const result = (await response.json()) as BambooHrConnectorConfig
      setBambooHr(result)
      setBambooHrMessage('BambooHR settings saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setBambooHrMessage(`Failed to save: ${err.message}`)
    } finally {
      setBambooHrSaving(false)
    }
  }

  async function deleteBambooHr() {
    if (!window.confirm('Delete BambooHR configuration?')) return
    setBambooHrSaving(true)
    setBambooHrMessage(null)
    try {
      const response = await apiFetch('/config/connectors/bamboohr', { method: 'DELETE' })
      const result = (await response.json()) as BambooHrConnectorConfig
      setBambooHr(result)
      setBambooHrMessage('BambooHR configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setBambooHrMessage(`Failed to delete: ${err.message}`)
    } finally {
      setBambooHrSaving(false)
    }
  }

  async function testBambooHr() {
    const validationError = validateBambooHr(bambooHr)
    if (validationError) {
      setBambooHrMessage(validationError)
      return
    }
    if (!bambooHr) return
    setBambooHrTesting(true)
    setBambooHrMessage(null)
    try {
      await apiFetch('/config/connectors/bamboohr/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bambooHr),
      })
      setBambooHrMessage('BambooHR connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setBambooHrMessage(`Connection failed: ${err.message}`)
    } finally {
      setBambooHrTesting(false)
    }
  }

  async function saveWorkday() {
    const validationError = validateWorkday(workday)
    if (validationError) {
      setWorkdayMessage(validationError)
      return
    }
    if (!workday) return
    setWorkdaySaving(true)
    setWorkdayMessage(null)
    try {
      const response = await apiFetch('/config/connectors/workday', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workday),
      })
      const result = (await response.json()) as WorkdayConnectorConfig
      setWorkday(result)
      setWorkdayMessage('Workday settings saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setWorkdayMessage(`Failed to save: ${err.message}`)
    } finally {
      setWorkdaySaving(false)
    }
  }

  async function deleteWorkday() {
    if (!window.confirm('Delete Workday configuration?')) return
    setWorkdaySaving(true)
    setWorkdayMessage(null)
    try {
      const response = await apiFetch('/config/connectors/workday', { method: 'DELETE' })
      const result = (await response.json()) as WorkdayConnectorConfig
      setWorkday(result)
      setWorkdayMessage('Workday configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setWorkdayMessage(`Failed to delete: ${err.message}`)
    } finally {
      setWorkdaySaving(false)
    }
  }

  async function testWorkday() {
    const validationError = validateWorkday(workday)
    if (validationError) {
      setWorkdayMessage(validationError)
      return
    }
    if (!workday) return
    setWorkdayTesting(true)
    setWorkdayMessage(null)
    try {
      await apiFetch('/config/connectors/workday/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workday),
      })
      setWorkdayMessage('Workday connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setWorkdayMessage(`Connection failed: ${err.message}`)
    } finally {
      setWorkdayTesting(false)
    }
  }

  async function saveJira() {
    const validationError = validateJira(jira)
    if (validationError) {
      setJiraMessage(validationError)
      return
    }
    if (!jira) return
    setJiraSaving(true)
    setJiraMessage(null)
    try {
      const payload = {
        ...jira,
        api_version: jira.api_version?.trim() || '3',
        projects: parseJiraProjects(),
      }
      const response = await apiFetch('/config/connectors/jira', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = (await response.json()) as JiraConnectorConfig
      setJira(result)
      setJiraProjects((result.projects ?? []).join(', '))
      setJiraMessage('Jira settings saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setJiraMessage(`Failed to save: ${err.message}`)
    } finally {
      setJiraSaving(false)
    }
  }

  async function deleteJira() {
    if (!window.confirm('Delete Jira configuration?')) return
    setJiraSaving(true)
    setJiraMessage(null)
    try {
      const response = await apiFetch('/config/connectors/jira', { method: 'DELETE' })
      const result = (await response.json()) as JiraConnectorConfig
      setJira(result)
      setJiraProjects((result.projects ?? []).join(', '))
      setJiraMessage('Jira configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setJiraMessage(`Failed to delete: ${err.message}`)
    } finally {
      setJiraSaving(false)
    }
  }

  async function testJira() {
    const validationError = validateJira(jira)
    if (validationError) {
      setJiraMessage(validationError)
      return
    }
    if (!jira) return
    setJiraTesting(true)
    setJiraMessage(null)
    try {
      const payload = {
        ...jira,
        api_version: jira.api_version?.trim() || '3',
        projects: parseJiraProjects(),
      }
      await apiFetch('/config/connectors/jira/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setJiraMessage('Jira connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setJiraMessage(`Connection failed: ${err.message}`)
    } finally {
      setJiraTesting(false)
    }
  }

  async function saveAwsPosture() {
    const validationError = validateAwsPosture(awsPosture)
    if (validationError) {
      setAwsPostureMessage(validationError)
      return
    }
    if (!awsPosture) return
    setAwsPostureSaving(true)
    setAwsPostureMessage(null)
    try {
      const payload = {
        ...awsPosture,
        access_key: awsPosture.access_key?.trim() || null,
        secret_key: awsPosture.secret_key?.trim() || null,
        session_token: awsPosture.session_token?.trim() || null,
      }
      const response = await apiFetch('/config/connectors/aws_posture', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = (await response.json()) as AwsPostureConnectorConfig
      setAwsPosture(result)
      setAwsPostureMessage('AWS posture settings saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setAwsPostureMessage(`Failed to save: ${err.message}`)
    } finally {
      setAwsPostureSaving(false)
    }
  }

  async function deleteAwsPosture() {
    if (!window.confirm('Delete AWS posture configuration?')) return
    setAwsPostureSaving(true)
    setAwsPostureMessage(null)
    try {
      const response = await apiFetch('/config/connectors/aws_posture', { method: 'DELETE' })
      const result = (await response.json()) as AwsPostureConnectorConfig
      setAwsPosture(result)
      setAwsPostureMessage('AWS posture configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setAwsPostureMessage(`Failed to delete: ${err.message}`)
    } finally {
      setAwsPostureSaving(false)
    }
  }

  async function testAwsPosture() {
    const validationError = validateAwsPosture(awsPosture)
    if (validationError) {
      setAwsPostureMessage(validationError)
      return
    }
    if (!awsPosture) return
    setAwsPostureTesting(true)
    setAwsPostureMessage(null)
    try {
      const payload = {
        ...awsPosture,
        access_key: awsPosture.access_key?.trim() || null,
        secret_key: awsPosture.secret_key?.trim() || null,
        session_token: awsPosture.session_token?.trim() || null,
      }
      await apiFetch('/config/connectors/aws_posture/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setAwsPostureMessage('AWS posture connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setAwsPostureMessage(`Connection failed: ${err.message}`)
    } finally {
      setAwsPostureTesting(false)
    }
  }

  async function saveAzurePosture() {
    const validationError = validateAzurePosture(azurePosture)
    if (validationError) {
      setAzurePostureMessage(validationError)
      return
    }
    if (!azurePosture) return
    setAzurePostureSaving(true)
    setAzurePostureMessage(null)
    try {
      const response = await apiFetch('/config/connectors/azure_posture', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(azurePosture),
      })
      const result = (await response.json()) as AzurePostureConnectorConfig
      setAzurePosture(result)
      setAzurePostureMessage('Azure posture settings saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setAzurePostureMessage(`Failed to save: ${err.message}`)
    } finally {
      setAzurePostureSaving(false)
    }
  }

  async function deleteAzurePosture() {
    if (!window.confirm('Delete Azure posture configuration?')) return
    setAzurePostureSaving(true)
    setAzurePostureMessage(null)
    try {
      const response = await apiFetch('/config/connectors/azure_posture', { method: 'DELETE' })
      const result = (await response.json()) as AzurePostureConnectorConfig
      setAzurePosture(result)
      setAzurePostureMessage('Azure posture configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setAzurePostureMessage(`Failed to delete: ${err.message}`)
    } finally {
      setAzurePostureSaving(false)
    }
  }

  async function testAzurePosture() {
    const validationError = validateAzurePosture(azurePosture)
    if (validationError) {
      setAzurePostureMessage(validationError)
      return
    }
    if (!azurePosture) return
    setAzurePostureTesting(true)
    setAzurePostureMessage(null)
    try {
      await apiFetch('/config/connectors/azure_posture/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(azurePosture),
      })
      setAzurePostureMessage('Azure posture connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setAzurePostureMessage(`Connection failed: ${err.message}`)
    } finally {
      setAzurePostureTesting(false)
    }
  }

  async function saveGcpPosture() {
    const validationError = validateGcpPosture(gcpPosture)
    if (validationError) {
      setGcpPostureMessage(validationError)
      return
    }
    if (!gcpPosture) return
    setGcpPostureSaving(true)
    setGcpPostureMessage(null)
    try {
      const response = await apiFetch('/config/connectors/gcp_posture', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gcpPosture),
      })
      const result = (await response.json()) as GcpPostureConnectorConfig
      setGcpPosture(result)
      setGcpPostureMessage('GCP posture settings saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setGcpPostureMessage(`Failed to save: ${err.message}`)
    } finally {
      setGcpPostureSaving(false)
    }
  }

  async function deleteGcpPosture() {
    if (!window.confirm('Delete GCP posture configuration?')) return
    setGcpPostureSaving(true)
    setGcpPostureMessage(null)
    try {
      const response = await apiFetch('/config/connectors/gcp_posture', { method: 'DELETE' })
      const result = (await response.json()) as GcpPostureConnectorConfig
      setGcpPosture(result)
      setGcpPostureMessage('GCP posture configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setGcpPostureMessage(`Failed to delete: ${err.message}`)
    } finally {
      setGcpPostureSaving(false)
    }
  }

  async function testGcpPosture() {
    const validationError = validateGcpPosture(gcpPosture)
    if (validationError) {
      setGcpPostureMessage(validationError)
      return
    }
    if (!gcpPosture) return
    setGcpPostureTesting(true)
    setGcpPostureMessage(null)
    try {
      await apiFetch('/config/connectors/gcp_posture/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gcpPosture),
      })
      setGcpPostureMessage('GCP posture connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setGcpPostureMessage(`Connection failed: ${err.message}`)
    } finally {
      setGcpPostureTesting(false)
    }
  }

  async function savePaloAlto() {
    const invalid = paloAltoConfigs.find((item) => validatePaloAlto(item))
    if (invalid) {
      setPaloAltoMessage(`Fix ${invalid.name}: ${validatePaloAlto(invalid)}`)
      return
    }
    setPaloAltoSaving(true)
    setPaloAltoMessage(null)
    try {
      const response = await apiFetch('/config/connectors/palo_alto', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: paloAltoConfigs }),
      })
      const result = (await response.json()) as PaloAltoConnectorConfigList
      const items = result.items ?? []
      setPaloAltoConfigs(items)
      setPaloAltoSelected((current) =>
        items.find((item) => item.name === current) ? current : items[0]?.name ?? '',
      )
      setPaloAltoMessage('Palo Alto instances saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setPaloAltoMessage(`Failed to save: ${formatApiError(err)}`)
    } finally {
      setPaloAltoSaving(false)
    }
  }

  async function deletePaloAlto() {
    if (!currentPaloAlto) return
    if (!window.confirm(`Delete Palo Alto instance "${currentPaloAlto.name}"?`)) return
    const next = paloAltoConfigs.filter((item) => item.name !== currentPaloAlto.name)
    setPaloAltoSaving(true)
    setPaloAltoMessage(null)
    try {
      const response = await apiFetch('/config/connectors/palo_alto', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next }),
      })
      const result = (await response.json()) as PaloAltoConnectorConfigList
      const items = result.items ?? []
      setPaloAltoConfigs(items)
      setPaloAltoSelected(items[0]?.name ?? '')
      setPaloAltoMessage(
        items.length ? 'Palo Alto instance deleted.' : 'Palo Alto instance deleted. No instances configured.',
      )
    } catch (e) {
      const err = e as ApiError
      setPaloAltoMessage(`Failed to delete: ${err.message}`)
    } finally {
      setPaloAltoSaving(false)
    }
  }

  async function deletePaloAltoByName(instanceName: string) {
    const target = paloAltoConfigs.find((item) => item.name === instanceName)
    if (!target) return
    if (!window.confirm(`Delete Palo Alto instance "${instanceName}"?`)) return
    const next = paloAltoConfigs.filter((item) => item.name !== instanceName)
    setPaloAltoSaving(true)
    setPaloAltoMessage(null)
    try {
      const response = await apiFetch('/config/connectors/palo_alto', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next }),
      })
      const result = (await response.json()) as PaloAltoConnectorConfigList
      const items = result.items ?? []
      setPaloAltoConfigs(items)
      setPaloAltoSelected(items[0]?.name ?? '')
      setPaloAltoMessage(
        items.length ? 'Palo Alto instance deleted.' : 'Palo Alto instance deleted. No instances configured.',
      )
    } catch (e) {
      const err = e as ApiError
      setPaloAltoMessage(`Failed to delete: ${err.message}`)
    } finally {
      setPaloAltoSaving(false)
    }
  }

  async function testGenericConnector(name: string) {
    setGenericTesting(true)
    setGenericTestMessage(null)
    try {
      await apiFetch(`/config/connectors/${name}/test`, { method: 'POST' })
      setGenericTestMessage(`${name} connection test succeeded.`)
    } catch (e) {
      const err = e as ApiError
      setGenericTestMessage(`Connection failed: ${err.message}`)
    } finally {
      setGenericTesting(false)
    }
  }

  async function testPaloAlto() {
    const validationError = validatePaloAlto(currentPaloAlto)
    if (validationError) {
      setPaloAltoMessage(validationError)
      return
    }
    if (!currentPaloAlto) return
    setPaloAltoTesting(true)
    setPaloAltoMessage(null)
    try {
      await apiFetch('/config/connectors/palo_alto/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentPaloAlto),
      })
      setPaloAltoMessage('Palo Alto connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setPaloAltoMessage(`Connection failed: ${err.message}`)
    } finally {
      setPaloAltoTesting(false)
    }
  }

  async function debugPaloAlto() {
    const validationError = validatePaloAlto(currentPaloAlto)
    if (validationError) {
      setPaloAltoMessage(validationError)
      return
    }
    if (!currentPaloAlto) return
    setPaloAltoDebugging(true)
    setPaloAltoMessage(null)
    try {
      const response = await apiFetch('/config/connectors/palo_alto/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentPaloAlto),
      })
      const result = (await response.json()) as PaloAltoDebugResponse
      setPaloAltoDebug(result)
      setPaloAltoMessage('Palo Alto debug completed.')
    } catch (e) {
      const err = e as ApiError
      setPaloAltoMessage(`Debug failed: ${err.message}`)
    } finally {
      setPaloAltoDebugging(false)
    }
  }

  async function saveDellDataDomain() {
    const invalid = dellDataDomainConfigs.find((item) => validateDellDataDomain(item))
    if (invalid) {
      setDellDataDomainMessage(`Fix ${invalid.name}: ${validateDellDataDomain(invalid)}`)
      return
    }
    setDellDataDomainSaving(true)
    setDellDataDomainMessage(null)
    try {
      const response = await apiFetch('/config/connectors/dell_datadomain', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: dellDataDomainConfigs }),
      })
      const result = (await response.json()) as DellDataDomainConnectorConfigList
      setDellDataDomainConfigs(result.items ?? [])
      if (
        result.items?.length &&
        !result.items.find((item) => item.name === dellDataDomainSelected)
      ) {
        setDellDataDomainSelected(result.items[0].name)
      }
      setDellDataDomainMessage('Dell Data Domain instances saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setDellDataDomainMessage(`Failed to save: ${err.message}`)
    } finally {
      setDellDataDomainSaving(false)
    }
  }

  async function deleteDellDataDomain() {
    if (!currentDellDataDomain) return
    if (!window.confirm(`Delete Data Domain instance "${currentDellDataDomain.name}"?`)) return
    const next = dellDataDomainConfigs.filter((item) => item.name !== currentDellDataDomain.name)
    setDellDataDomainSaving(true)
    setDellDataDomainMessage(null)
    try {
      const response = await apiFetch('/config/connectors/dell_datadomain', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next }),
      })
      const result = (await response.json()) as DellDataDomainConnectorConfigList
      setDellDataDomainConfigs(result.items ?? [])
      setDellDataDomainSelected(result.items?.[0]?.name ?? '')
      setDellDataDomainMessage('Dell Data Domain instance deleted.')
    } catch (e) {
      const err = e as ApiError
      setDellDataDomainMessage(`Failed to delete: ${err.message}`)
    } finally {
      setDellDataDomainSaving(false)
    }
  }

  async function deleteDellDataDomainByName(instanceName: string) {
    const target = dellDataDomainConfigs.find((item) => item.name === instanceName)
    if (!target) return
    if (!window.confirm(`Delete Data Domain instance "${instanceName}"?`)) return
    const next = dellDataDomainConfigs.filter((item) => item.name !== instanceName)
    setDellDataDomainSaving(true)
    setDellDataDomainMessage(null)
    try {
      const response = await apiFetch('/config/connectors/dell_datadomain', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next }),
      })
      const result = (await response.json()) as DellDataDomainConnectorConfigList
      setDellDataDomainConfigs(result.items ?? [])
      setDellDataDomainSelected(result.items?.[0]?.name ?? '')
      setDellDataDomainMessage('Dell Data Domain instance deleted.')
    } catch (e) {
      const err = e as ApiError
      setDellDataDomainMessage(`Failed to delete: ${err.message}`)
    } finally {
      setDellDataDomainSaving(false)
    }
  }

  async function testDellDataDomain() {
    const validationError = validateDellDataDomain(currentDellDataDomain)
    if (validationError) {
      setDellDataDomainMessage(validationError)
      return
    }
    if (!currentDellDataDomain) return
    setDellDataDomainTesting(true)
    setDellDataDomainMessage(null)
    try {
      await apiFetch('/config/connectors/dell_datadomain/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentDellDataDomain),
      })
      setDellDataDomainMessage('Dell Data Domain connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setDellDataDomainMessage(`Connection failed: ${err.message}`)
    } finally {
      setDellDataDomainTesting(false)
    }
  }

  async function debugDellDataDomain() {
    const validationError = validateDellDataDomain(currentDellDataDomain)
    if (validationError) {
      setDellDataDomainMessage(validationError)
      return
    }
    if (!currentDellDataDomain) return
    setDellDataDomainDebugging(true)
    setDellDataDomainMessage(null)
    try {
      const response = await apiFetch('/config/connectors/dell_datadomain/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentDellDataDomain),
      })
      const result = (await response.json()) as ConnectorDebugResponse
      setDellDataDomainDebug(result)
      setDellDataDomainMessage('Dell Data Domain debug completed.')
    } catch (e) {
      const err = e as ApiError
      setDellDataDomainMessage(`Debug failed: ${err.message}`)
    } finally {
      setDellDataDomainDebugging(false)
    }
  }

  const currentVcenter = vcenterConfigs.find((item) => item.name === vcenterSelected) ?? null
  const currentPowerstore =
    powerstoreConfigs.find((item) => item.name === powerstoreSelected) ?? null
  const currentPaloAlto =
    paloAltoConfigs.find((item) => item.name === paloAltoSelected) ?? null
  const paloAltoMappingsOpen = currentPaloAlto ? !!paloAltoMappingsExpanded[currentPaloAlto.name] : false
  const currentDellDataDomain =
    dellDataDomainConfigs.find((item) => item.name === dellDataDomainSelected) ?? null

  function updatePaloAltoInstance(name: string, patch: Partial<PaloAltoConnectorInstance>) {
    setPaloAltoConfigs((prev) =>
      prev.map((item) => (item.name === name ? { ...item, ...patch } : item)),
    )
  }

  function loadPaloAltoDefaultMappings() {
    if (!currentPaloAlto) return
    updatePaloAltoInstance(currentPaloAlto.name, {
      event_mappings: buildPaloAltoDefaultMappings(),
    })
    setPaloAltoMappingsExpanded((prev) => ({ ...prev, [currentPaloAlto.name]: true }))
    setPaloAltoMessage('Default HA mappings loaded.')
  }

  function addPaloAltoInstance() {
    const name = paloAltoNewName.trim()
    if (!name) {
      setPaloAltoMessage('Instance name is required.')
      return
    }
    if (paloAltoConfigs.find((item) => item.name === name)) {
      setPaloAltoMessage('Instance name already exists.')
      return
    }
    const newItem = buildDefaultPaloAltoInstance(name, defaultAssetId)
    setPaloAltoConfigs((prev) => [...prev, newItem])
    setPaloAltoSelected(name)
    setPaloAltoNewName('')
  }

  function updateDellDataDomainInstance(
    name: string,
    patch: Partial<DellDataDomainConnectorInstance>,
  ) {
    setDellDataDomainConfigs((prev) =>
      prev.map((item) => (item.name === name ? { ...item, ...patch } : item)),
    )
  }

  function loadDellDataDomainDefaultMappings() {
    if (!currentDellDataDomain) return
    updateDellDataDomainInstance(currentDellDataDomain.name, {
      event_mappings: buildDatadomainDefaultMappings(),
    })
    setDellDataDomainMessage('Default Data Domain mappings loaded.')
  }

  function addDellDataDomainInstance() {
    const name = dellDataDomainNewName.trim()
    if (!name) {
      setDellDataDomainMessage('Instance name is required.')
      return
    }
    if (dellDataDomainConfigs.find((item) => item.name === name)) {
      setDellDataDomainMessage('Instance name already exists.')
      return
    }
    const newItem: DellDataDomainConnectorInstance = {
      name,
      asset_id: defaultAssetId,
      url: '',
      username: '',
      password: '',
      api_base: '',
      verify_tls: true,
      event_mappings: buildDatadomainDefaultMappings(),
    }
    setDellDataDomainConfigs((prev) => [...prev, newItem])
    setDellDataDomainSelected(name)
    setDellDataDomainNewName('')
  }

  function updateVcenterInstance(name: string, patch: Partial<VCenterConnectorInstance>) {
    setVcenterConfigs((prev) =>
      prev.map((item) => (item.name === name ? { ...item, ...patch } : item)),
    )
  }

  function addVcenterInstance() {
    const name = vcenterNewName.trim()
    if (!name) {
      setVcenterMessage('Instance name is required.')
      return
    }
    if (vcenterConfigs.find((item) => item.name === name)) {
      setVcenterMessage('Instance name already exists.')
      return
    }
    const newItem: VCenterConnectorInstance = {
      name,
      asset_id: defaultAssetId,
      base_url: '',
      username: '',
      password: '',
      verify_tls: true,
      include_vms: true,
      include_hosts: true,
      include_clusters: true,
      include_tasks: true,
      include_vm_hardware: true,
      task_max: 200,
      task_since_hours: 168,
      tags: [],
      event_mappings: buildVcenterDefaultMappings(),
    }
    setVcenterConfigs((prev) => [...prev, newItem])
    setVcenterSelected(name)
    setVcenterNewName('')
  }

  function addVcenterEventMapping() {
    if (!currentVcenter) return
    const [defaultKind] = EVENT_KINDS_BY_CONNECTOR.vcenter
    const newMapping = buildDefaultEventMapping(defaultKind)
    const next = [...(currentVcenter.event_mappings ?? []), newMapping]
    updateVcenterInstance(currentVcenter.name, { event_mappings: next })
  }

  function updateVcenterEventMapping(index: number, patch: Partial<ConnectorEventMapping>) {
    if (!currentVcenter) return
    const next = (currentVcenter.event_mappings ?? []).map((mapping, idx) => {
      if (idx !== index) return mapping
      const merged = { ...mapping, ...patch } as ConnectorEventMapping
      const nextKind = patch.event_kind ?? merged.event_kind
      return normalizeEventMapping(merged, nextKind)
    })
    updateVcenterInstance(currentVcenter.name, { event_mappings: next })
  }

  function removeVcenterEventMapping(index: number) {
    if (!currentVcenter) return
    const next = (currentVcenter.event_mappings ?? []).filter((_, idx) => idx !== index)
    updateVcenterInstance(currentVcenter.name, { event_mappings: next })
  }

  function addDellDataDomainEventMapping() {
    if (!currentDellDataDomain) return
    const newMapping = buildDefaultEventMapping('resilience_signal')
    const next = [...(currentDellDataDomain.event_mappings ?? []), newMapping]
    updateDellDataDomainInstance(currentDellDataDomain.name, { event_mappings: next })
  }

  function updateDellDataDomainEventMapping(index: number, patch: Partial<ConnectorEventMapping>) {
    if (!currentDellDataDomain) return
    const next = (currentDellDataDomain.event_mappings ?? []).map((mapping, idx) => {
      if (idx !== index) return mapping
      const merged = { ...mapping, ...patch } as ConnectorEventMapping
      const nextKind = patch.event_kind ?? merged.event_kind
      return normalizeEventMapping(merged, nextKind)
    })
    updateDellDataDomainInstance(currentDellDataDomain.name, { event_mappings: next })
  }

  function removeDellDataDomainEventMapping(index: number) {
    if (!currentDellDataDomain) return
    const next = (currentDellDataDomain.event_mappings ?? []).filter((_, idx) => idx !== index)
    updateDellDataDomainInstance(currentDellDataDomain.name, { event_mappings: next })
  }

  function loadVcenterDefaultMappings() {
    if (!currentVcenter) return
    updateVcenterInstance(currentVcenter.name, { event_mappings: buildVcenterDefaultMappings() })
    setVcenterMessage('Default vCenter mappings loaded.')
  }

  async function saveVcenter() {
    const invalid = vcenterConfigs.find((item) => validateVcenter(item))
    if (invalid) {
      setVcenterMessage(`Fix ${invalid.name}: ${validateVcenter(invalid)}`)
      return
    }
    setVcenterSaving(true)
    setVcenterMessage(null)
    try {
      const response = await apiFetch('/config/connectors/vcenter', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: vcenterConfigs }),
      })
      const result = (await response.json()) as VCenterConnectorConfigList
      const items: VCenterConnectorInstance[] = (result.items ?? []).map((item) => ({
        ...item,
        event_mappings: normalizeEventMappings(item.event_mappings),
      }))
      setVcenterConfigs(items)
      if (items.length && !items.find((item) => item.name === vcenterSelected)) {
        setVcenterSelected(items[0].name)
      }
      setVcenterMessage('vCenter instances saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setVcenterMessage(`Failed to save: ${err.message}`)
    } finally {
      setVcenterSaving(false)
    }
  }

  async function deleteVcenter() {
    if (!currentVcenter) return
    if (!window.confirm(`Delete vCenter instance "${currentVcenter.name}"?`)) return
    const next = vcenterConfigs.filter((item) => item.name !== currentVcenter.name)
    setVcenterSaving(true)
    setVcenterMessage(null)
    try {
      const response = await apiFetch('/config/connectors/vcenter', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next }),
      })
      const result = (await response.json()) as VCenterConnectorConfigList
      const items: VCenterConnectorInstance[] = (result.items ?? []).map((item) => ({
        ...item,
        event_mappings: normalizeEventMappings(item.event_mappings),
      }))
      setVcenterConfigs(items)
      setVcenterSelected(items[0]?.name ?? '')
      setVcenterMessage('vCenter instance deleted.')
    } catch (e) {
      const err = e as ApiError
      setVcenterMessage(`Failed to delete: ${err.message}`)
    } finally {
      setVcenterSaving(false)
    }
  }

  async function deleteVcenterByName(instanceName: string) {
    const target = vcenterConfigs.find((item) => item.name === instanceName)
    if (!target) return
    if (!window.confirm(`Delete vCenter instance "${instanceName}"?`)) return
    const next = vcenterConfigs.filter((item) => item.name !== instanceName)
    setVcenterSaving(true)
    setVcenterMessage(null)
    try {
      const response = await apiFetch('/config/connectors/vcenter', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next }),
      })
      const result = (await response.json()) as VCenterConnectorConfigList
      const items: VCenterConnectorInstance[] = (result.items ?? []).map((item) => ({
        ...item,
        event_mappings: normalizeEventMappings(item.event_mappings),
      }))
      setVcenterConfigs(items)
      setVcenterSelected(items[0]?.name ?? '')
      setVcenterMessage('vCenter instance deleted.')
    } catch (e) {
      const err = e as ApiError
      setVcenterMessage(`Failed to delete: ${err.message}`)
    } finally {
      setVcenterSaving(false)
    }
  }

  async function testVcenter() {
    const validationError = validateVcenter(currentVcenter)
    if (validationError) {
      setVcenterMessage(validationError)
      return
    }
    if (!currentVcenter) return
    setVcenterTesting(true)
    setVcenterMessage(null)
    try {
      await apiFetch('/config/connectors/vcenter/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentVcenter),
      })
      setVcenterMessage('vCenter connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setVcenterMessage(`Connection failed: ${err.message}`)
    } finally {
      setVcenterTesting(false)
    }
  }

  async function debugVcenter() {
    const validationError = validateVcenter(currentVcenter)
    if (validationError) {
      setVcenterMessage(validationError)
      return
    }
    if (!currentVcenter) return
    setVcenterDebugging(true)
    setVcenterMessage(null)
    try {
      const response = await apiFetch('/config/connectors/vcenter/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentVcenter),
      })
      const result = (await response.json()) as ConnectorDebugResponse
      setVcenterDebug(result)
      setVcenterMessage('vCenter debug completed.')
    } catch (e) {
      const err = e as ApiError
      setVcenterMessage(`Debug failed: ${err.message}`)
    } finally {
      setVcenterDebugging(false)
    }
  }

  function updatePowerstoreInstance(name: string, patch: Partial<PowerStoreConnectorInstance>) {
    setPowerstoreConfigs((prev) =>
      prev.map((item) => (item.name === name ? { ...item, ...patch } : item)),
    )
  }

  function addPowerstoreInstance() {
    const name = powerstoreNewName.trim()
    if (!name) {
      setPowerstoreMessage('Instance name is required.')
      return
    }
    if (powerstoreConfigs.find((item) => item.name === name)) {
      setPowerstoreMessage('Instance name already exists.')
      return
    }
    const newItem: PowerStoreConnectorInstance = {
      name,
      asset_id: defaultAssetId,
      base_url: '',
      username: '',
      password: '',
      verify_tls: true,
      max_items: 200,
      tags: [],
      event_mappings: buildPowerstoreDefaultMappings(),
    }
    setPowerstoreConfigs((prev) => [...prev, newItem])
    setPowerstoreSelected(name)
    setPowerstoreNewName('')
  }

  function addPowerstoreEventMapping() {
    if (!currentPowerstore) return
    const [defaultKind] = EVENT_KINDS_BY_CONNECTOR.powerstore
    const newMapping = buildDefaultEventMapping(defaultKind)
    const next = [...(currentPowerstore.event_mappings ?? []), newMapping]
    updatePowerstoreInstance(currentPowerstore.name, { event_mappings: next })
  }

  function updatePowerstoreEventMapping(index: number, patch: Partial<ConnectorEventMapping>) {
    if (!currentPowerstore) return
    const next = (currentPowerstore.event_mappings ?? []).map((mapping, idx) => {
      if (idx !== index) return mapping
      const merged = { ...mapping, ...patch } as ConnectorEventMapping
      const nextKind = patch.event_kind ?? merged.event_kind
      return normalizeEventMapping(merged, nextKind)
    })
    updatePowerstoreInstance(currentPowerstore.name, { event_mappings: next })
  }

  function removePowerstoreEventMapping(index: number) {
    if (!currentPowerstore) return
    const next = (currentPowerstore.event_mappings ?? []).filter((_, idx) => idx !== index)
    updatePowerstoreInstance(currentPowerstore.name, { event_mappings: next })
  }

  function loadPowerstoreDefaultMappings() {
    if (!currentPowerstore) return
    updatePowerstoreInstance(currentPowerstore.name, { event_mappings: buildPowerstoreDefaultMappings() })
    setPowerstoreMessage('Default PowerStore mappings loaded.')
  }

  function addDnacEventMapping() {
    if (!dnac) return
    const [defaultKind] = EVENT_KINDS_BY_CONNECTOR.dnac
    const newMapping = buildDefaultEventMapping(defaultKind)
    const next = [...(dnac.event_mappings ?? []), newMapping]
    setDnac({ ...dnac, event_mappings: next })
  }

  function updateDnacEventMapping(index: number, patch: Partial<ConnectorEventMapping>) {
    if (!dnac) return
    const next = (dnac.event_mappings ?? []).map((mapping, idx) => {
      if (idx !== index) return mapping
      const merged = { ...mapping, ...patch } as ConnectorEventMapping
      const nextKind = patch.event_kind ?? merged.event_kind
      return normalizeEventMapping(merged, nextKind)
    })
    setDnac({ ...dnac, event_mappings: next })
  }

  function removeDnacEventMapping(index: number) {
    if (!dnac) return
    const next = (dnac.event_mappings ?? []).filter((_, idx) => idx !== index)
    setDnac({ ...dnac, event_mappings: next })
  }

  function addVeeamEnterpriseManagerEventMapping() {
    if (!veeamEnterpriseManager) return
    const [defaultKind] = EVENT_KINDS_BY_CONNECTOR.veeam_enterprise_manager
    const newMapping = buildDefaultEventMapping(defaultKind)
    const next = [...(veeamEnterpriseManager.event_mappings ?? []), newMapping]
    setVeeamEnterpriseManager({ ...veeamEnterpriseManager, event_mappings: next })
  }

  function updateVeeamEnterpriseManagerEventMapping(index: number, patch: Partial<ConnectorEventMapping>) {
    if (!veeamEnterpriseManager) return
    const next = (veeamEnterpriseManager.event_mappings ?? []).map((mapping, idx) => {
      if (idx !== index) return mapping
      const merged = { ...mapping, ...patch } as ConnectorEventMapping
      const nextKind = patch.event_kind ?? merged.event_kind
      return normalizeEventMapping(merged, nextKind)
    })
    setVeeamEnterpriseManager({ ...veeamEnterpriseManager, event_mappings: next })
  }

  function removeVeeamEnterpriseManagerEventMapping(index: number) {
    if (!veeamEnterpriseManager) return
    const next = (veeamEnterpriseManager.event_mappings ?? []).filter((_, idx) => idx !== index)
    setVeeamEnterpriseManager({ ...veeamEnterpriseManager, event_mappings: next })
  }

  function loadVeeamEnterpriseManagerDefaultMappings() {
    if (!veeamEnterpriseManager) return
    setVeeamEnterpriseManager({
      ...veeamEnterpriseManager,
      event_mappings: buildVeeamEnterpriseManagerDefaultMappings(),
    })
    setVeeamEnterpriseManagerMessage('Default Veeam Enterprise Manager mappings loaded.')
  }

  const renderEventMappings = ({
    connectorKey,
    title,
    helpText,
    mappings,
    onAdd,
    onLoadDefaults,
    onUpdate,
    onRemove,
  }: {
    connectorKey: keyof typeof EVENT_KINDS_BY_CONNECTOR
    title: string
    helpText: string
    mappings: ConnectorEventMapping[] | undefined
    onAdd: () => void
    onLoadDefaults?: () => void
    onUpdate: (index: number, patch: Partial<ConnectorEventMapping>) => void
    onRemove: (index: number) => void
  }) => {
    const {
      t
    } = useI18n();

    const allowedKinds = EVENT_KINDS_BY_CONNECTOR[connectorKey]
    return (
      <div className="space-y-3 md:col-span-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label>{title}</Label>
            <HelpTip text={helpText} />
          </div>
          <div className="flex flex-wrap gap-2">
            {onLoadDefaults ? <Button onClick={onLoadDefaults}>{t('Load defaults', 'Load defaults')}</Button> : null}
            <Button onClick={onAdd}>{t('Add mapping', 'Add mapping')}</Button>
          </div>
        </div>
        {mappings?.length ? (
          <div className="space-y-4">
            {mappings.map((mapping, index) => {
              const {
                t
              } = useI18n();

              const currentKind = mapping.event_kind ?? allowedKinds[0]
              const kindOptions = Array.from(new Set([...allowedKinds, currentKind]))
              const matchFields =
                EVENT_MATCH_FIELDS_BY_KIND[currentKind] ?? EVENT_MATCH_FIELDS_BY_KIND.change_event
              const currentMatchField = matchFields.includes(mapping.match_field)
                ? mapping.match_field
                : matchFields[0]
              return (
                <div
                  key={`event-mapping-${connectorKey}-${index}`}
                  className="rounded-lg border border-[#274266] p-3"
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{t('Mapping name', 'Mapping name')}</Label>
                      <input
                        className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                        value={mapping.name ?? ''}
                        onChange={(e) => onUpdate(index, { name: e.target.value })}
                        placeholder={t('HA role change', 'HA role change')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('Event kind', 'Event kind')}</Label>
                      <select
                        className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                        value={currentKind}
                        onChange={(e) =>
                          onUpdate(index, { event_kind: e.target.value as ConnectorEventKind })
                        }
                      >
                        {kindOptions.map((kind) => (
                          <option key={kind} value={kind}>
                            {EVENT_KIND_LABELS[kind] ?? kind}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('Match field', 'Match field')}</Label>
                      <select
                        className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                        value={currentMatchField ?? ''}
                        onChange={(e) =>
                          onUpdate(index, { match_field: e.target.value as ConnectorEventMatchField })
                        }
                      >
                        {matchFields.map((field) => (
                          <option key={field} value={field}>
                            {EVENT_MATCH_FIELD_LABELS[field] ?? field}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('Match value', 'Match value')}</Label>
                      <input
                        className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                        value={mapping.match_value ?? ''}
                        onChange={(e) => onUpdate(index, { match_value: e.target.value })}
                        placeholder="ha_role_change"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('Finding type', 'Finding type')}</Label>
                      <input
                        className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                        value={mapping.finding_type ?? ''}
                        onChange={(e) => onUpdate(index, { finding_type: e.target.value })}
                        placeholder="resilience"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('Severity', 'Severity')}</Label>
                      <select
                        className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                        value={mapping.severity ?? 'medium'}
                        onChange={(e) =>
                          onUpdate(index, {
                            severity: e.target.value as ConnectorEventMapping['severity'],
                          })
                        }
                      >
                        <option value="low">{t('Low', 'Low')}</option>
                        <option value="medium">{t('Medium', 'Medium')}</option>
                        <option value="high">{t('High', 'High')}</option>
                        <option value="critical">{t('Critical', 'Critical')}</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('Score delta', 'Score delta')}</Label>
                      <input
                        type="number"
                        className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                        value={mapping.score_delta ?? ''}
                        onChange={(e) =>
                          onUpdate(index, {
                            score_delta: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        placeholder={t('Optional override', 'Optional override')}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-50">
                      <input
                        type="checkbox"
                        checked={mapping.enabled ?? true}
                        onChange={(e) => onUpdate(index, { enabled: e.target.checked })}
                      />
                      {t('Enabled', 'Enabled')}
                    </label>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button onClick={() => onRemove(index)}>{t('Remove mapping', 'Remove mapping')}</Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-50">{t('No event mappings configured yet.', 'No event mappings configured yet.')}</p>
        )}
      </div>
    );
  }

  async function savePowerstore() {
    const invalid = powerstoreConfigs.find((item) => validatePowerstore(item))
    if (invalid) {
      setPowerstoreMessage(`Fix ${invalid.name}: ${validatePowerstore(invalid)}`)
      return
    }
    setPowerstoreSaving(true)
    setPowerstoreMessage(null)
    try {
      const response = await apiFetch('/config/connectors/powerstore', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: powerstoreConfigs }),
      })
      const result = (await response.json()) as PowerStoreConnectorConfigList
      const items: PowerStoreConnectorInstance[] = (result.items ?? []).map((item) => ({
        ...item,
        event_mappings: normalizeEventMappings(item.event_mappings),
      }))
      setPowerstoreConfigs(items)
      if (items.length && !items.find((item) => item.name === powerstoreSelected)) {
        setPowerstoreSelected(items[0].name)
      }
      setPowerstoreMessage('PowerStore instances saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setPowerstoreMessage(`Failed to save: ${err.message}`)
    } finally {
      setPowerstoreSaving(false)
    }
  }

  async function deletePowerstore() {
    if (!currentPowerstore) return
    if (!window.confirm(`Delete PowerStore instance "${currentPowerstore.name}"?`)) return
    const next = powerstoreConfigs.filter((item) => item.name !== currentPowerstore.name)
    setPowerstoreSaving(true)
    setPowerstoreMessage(null)
    try {
      const response = await apiFetch('/config/connectors/powerstore', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next }),
      })
      const result = (await response.json()) as PowerStoreConnectorConfigList
      const items: PowerStoreConnectorInstance[] = (result.items ?? []).map((item) => ({
        ...item,
        event_mappings: normalizeEventMappings(item.event_mappings),
      }))
      setPowerstoreConfigs(items)
      setPowerstoreSelected(items[0]?.name ?? '')
      setPowerstoreMessage('PowerStore instance deleted.')
    } catch (e) {
      const err = e as ApiError
      setPowerstoreMessage(`Failed to delete: ${err.message}`)
    } finally {
      setPowerstoreSaving(false)
    }
  }

  async function deletePowerstoreByName(instanceName: string) {
    const target = powerstoreConfigs.find((item) => item.name === instanceName)
    if (!target) return
    if (!window.confirm(`Delete PowerStore instance "${instanceName}"?`)) return
    const next = powerstoreConfigs.filter((item) => item.name !== instanceName)
    setPowerstoreSaving(true)
    setPowerstoreMessage(null)
    try {
      const response = await apiFetch('/config/connectors/powerstore', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next }),
      })
      const result = (await response.json()) as PowerStoreConnectorConfigList
      const items: PowerStoreConnectorInstance[] = (result.items ?? []).map((item) => ({
        ...item,
        event_mappings: normalizeEventMappings(item.event_mappings),
      }))
      setPowerstoreConfigs(items)
      setPowerstoreSelected(items[0]?.name ?? '')
      setPowerstoreMessage('PowerStore instance deleted.')
    } catch (e) {
      const err = e as ApiError
      setPowerstoreMessage(`Failed to delete: ${err.message}`)
    } finally {
      setPowerstoreSaving(false)
    }
  }

  async function testPowerstore() {
    const validationError = validatePowerstore(currentPowerstore)
    if (validationError) {
      setPowerstoreMessage(validationError)
      return
    }
    if (!currentPowerstore) return
    setPowerstoreTesting(true)
    setPowerstoreMessage(null)
    try {
      await apiFetch('/config/connectors/powerstore/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentPowerstore),
      })
      setPowerstoreMessage('PowerStore connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setPowerstoreMessage(`Connection failed: ${err.message}`)
    } finally {
      setPowerstoreTesting(false)
    }
  }

  async function debugPowerstore() {
    const validationError = validatePowerstore(currentPowerstore)
    if (validationError) {
      setPowerstoreMessage(validationError)
      return
    }
    if (!currentPowerstore) return
    setPowerstoreDebugging(true)
    setPowerstoreMessage(null)
    try {
      const response = await apiFetch('/config/connectors/powerstore/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentPowerstore),
      })
      const result = (await response.json()) as ConnectorDebugResponse
      setPowerstoreDebug(result)
      setPowerstoreMessage('PowerStore debug completed.')
    } catch (e) {
      const err = e as ApiError
      setPowerstoreMessage(`Debug failed: ${err.message}`)
    } finally {
      setPowerstoreDebugging(false)
    }
  }

  async function saveVeeamEnterpriseManager() {
    const validationError = validateVeeamEnterpriseManager(veeamEnterpriseManager)
    if (validationError) {
      setVeeamEnterpriseManagerMessage(validationError)
      return
    }
    setVeeamEnterpriseManagerSaving(true)
    setVeeamEnterpriseManagerMessage(null)
    try {
      const response = await apiFetch('/config/connectors/veeam_enterprise_manager', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(veeamEnterpriseManager),
      })
      const result = (await response.json()) as VeeamEnterpriseManagerConnectorConfig
      const eventMappings = normalizeEventMappings(result.event_mappings)
      setVeeamEnterpriseManager({ ...result, event_mappings: eventMappings })
      setVeeamEnterpriseManagerMessage('Veeam Enterprise Manager settings saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setVeeamEnterpriseManagerMessage(`Failed to save: ${err.message}`)
    } finally {
      setVeeamEnterpriseManagerSaving(false)
    }
  }

  async function deleteVeeamEnterpriseManager() {
    if (!window.confirm('Delete Veeam Enterprise Manager configuration?')) return
    setVeeamEnterpriseManagerSaving(true)
    setVeeamEnterpriseManagerMessage(null)
    try {
      const response = await apiFetch('/config/connectors/veeam_enterprise_manager', { method: 'DELETE' })
      const result = (await response.json()) as VeeamEnterpriseManagerConnectorConfig
      const eventMappings = normalizeEventMappings(result.event_mappings)
      setVeeamEnterpriseManager({ ...result, event_mappings: eventMappings })
      setVeeamEnterpriseManagerMessage('Veeam Enterprise Manager configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setVeeamEnterpriseManagerMessage(`Failed to delete: ${err.message}`)
    } finally {
      setVeeamEnterpriseManagerSaving(false)
    }
  }

  async function testVeeamEnterpriseManager() {
    const validationError = validateVeeamEnterpriseManager(veeamEnterpriseManager)
    if (validationError) {
      setVeeamEnterpriseManagerMessage(validationError)
      return
    }
    setVeeamEnterpriseManagerTesting(true)
    setVeeamEnterpriseManagerMessage(null)
    try {
      await apiFetch('/config/connectors/veeam_enterprise_manager/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(veeamEnterpriseManager),
      })
      setVeeamEnterpriseManagerMessage('Veeam Enterprise Manager connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setVeeamEnterpriseManagerMessage(`Connection failed: ${err.message}`)
    } finally {
      setVeeamEnterpriseManagerTesting(false)
    }
  }

  async function debugVeeamEnterpriseManager() {
    const validationError = validateVeeamEnterpriseManager(veeamEnterpriseManager)
    if (validationError) {
      setVeeamEnterpriseManagerMessage(validationError)
      return
    }
    setVeeamEnterpriseManagerDebugging(true)
    setVeeamEnterpriseManagerMessage(null)
    try {
      const response = await apiFetch('/config/connectors/veeam_enterprise_manager/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(veeamEnterpriseManager),
      })
      const result = (await response.json()) as {
        backup_sessions: {
          endpoint?: string | null
          status_code?: number | null
          count: number
          error?: string | null
          samples?: Record<string, string[]>
          matches?: Array<{
            name: string
            event_kind: string
            match_field: string
            match_value: string
            count: number
          }>
        }
        backup_task_sessions: {
          endpoint?: string | null
          status_code?: number | null
          count: number
          error?: string | null
          samples?: Record<string, string[]>
          matches?: Array<{
            name: string
            event_kind: string
            match_field: string
            match_value: string
            count: number
          }>
        }
        restore_sessions: {
          endpoint?: string | null
          status_code?: number | null
          count: number
          error?: string | null
          samples?: Record<string, string[]>
          matches?: Array<{
            name: string
            event_kind: string
            match_field: string
            match_value: string
            count: number
          }>
        }
        normalized?: {
          resilience_signals: number
          recovery_jobs: number
          task_sessions: number
        }
      }
      setVeeamEnterpriseManagerDebug(result)
      setVeeamEnterpriseManagerMessage('Veeam Enterprise Manager debug completed.')
    } catch (e) {
      const err = e as ApiError
      setVeeamEnterpriseManagerMessage(`Debug failed: ${err.message}`)
    } finally {
      setVeeamEnterpriseManagerDebugging(false)
    }
  }

  async function saveGithub() {
    const validationError = validateGitHub(github)
    if (validationError) {
      setGithubMessage(validationError)
      return
    }
    if (!github) return
    setGithubSaving(true)
    setGithubMessage(null)
    try {
      const payload = { ...github, repositories: parseGitHubRepositories() }
      const response = await apiFetch('/config/connectors/github', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = (await response.json()) as GitHubConnectorConfig
      setGithub(result)
      setGithubRepositories((result.repositories ?? []).join(', '))
      setGithubMessage('GitHub settings saved.')
      await saveConfig()
    } catch (e) {
      const err = e as ApiError
      setGithubMessage(`Failed to save: ${err.message}`)
    } finally {
      setGithubSaving(false)
    }
  }

  async function deleteGithub() {
    if (!window.confirm('Delete GitHub configuration?')) return
    setGithubSaving(true)
    setGithubMessage(null)
    try {
      const response = await apiFetch('/config/connectors/github', { method: 'DELETE' })
      const result = (await response.json()) as GitHubConnectorConfig
      setGithub(result)
      setGithubRepositories((result.repositories ?? []).join(', '))
      setGithubMessage('GitHub configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setGithubMessage(`Failed to delete: ${err.message}`)
    } finally {
      setGithubSaving(false)
    }
  }

  async function testGithub() {
    const validationError = validateGitHub(github)
    if (validationError) {
      setGithubMessage(validationError)
      return
    }
    if (!github) return
    setGithubTesting(true)
    setGithubMessage(null)
    try {
      const payload = { ...github, repositories: parseGitHubRepositories() }
      await apiFetch('/config/connectors/github/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setGithubMessage('GitHub connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setGithubMessage(`Connection failed: ${err.message}`)
    } finally {
      setGithubTesting(false)
    }
  }

  async function saveGitlab() {
    const validationError = validateGitLab(gitlab)
    if (validationError) {
      setGitlabMessage(validationError)
      return
    }
    if (!gitlab) return
    setGitlabSaving(true)
    setGitlabMessage(null)
    try {
      const payload = { ...gitlab, projects: parseGitLabProjects() }
      const response = await apiFetch('/config/connectors/gitlab', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = (await response.json()) as GitLabConnectorConfig
      setGitlab(result)
      setGitlabProjects((result.projects ?? []).join(', '))
      setGitlabMessage('GitLab settings saved.')
      await saveConfig()
    } catch (e) {
      const err = e as ApiError
      setGitlabMessage(`Failed to save: ${err.message}`)
    } finally {
      setGitlabSaving(false)
    }
  }

  async function deleteGitlab() {
    if (!window.confirm('Delete GitLab configuration?')) return
    setGitlabSaving(true)
    setGitlabMessage(null)
    try {
      const response = await apiFetch('/config/connectors/gitlab', { method: 'DELETE' })
      const result = (await response.json()) as GitLabConnectorConfig
      setGitlab(result)
      setGitlabProjects((result.projects ?? []).join(', '))
      setGitlabMessage('GitLab configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setGitlabMessage(`Failed to delete: ${err.message}`)
    } finally {
      setGitlabSaving(false)
    }
  }

  async function testGitlab() {
    const validationError = validateGitLab(gitlab)
    if (validationError) {
      setGitlabMessage(validationError)
      return
    }
    if (!gitlab) return
    setGitlabTesting(true)
    setGitlabMessage(null)
    try {
      const payload = { ...gitlab, projects: parseGitLabProjects() }
      await apiFetch('/config/connectors/gitlab/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setGitlabMessage('GitLab connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setGitlabMessage(`Connection failed: ${err.message}`)
    } finally {
      setGitlabTesting(false)
    }
  }

  async function saveDnac() {
    const validationError = validateDnac(dnac)
    if (validationError) {
      setDnacMessage(validationError)
      return
    }
    setDnacSaving(true)
    setDnacMessage(null)
    try {
      const response = await apiFetch('/config/connectors/dnac', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dnac),
      })
      const result = (await response.json()) as DnacConnectorConfig
      setDnac(result)
      setDnacMessage('DNA Center settings saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setDnacMessage(`Failed to save: ${err.message}`)
    } finally {
      setDnacSaving(false)
    }
  }

  async function deleteDnac() {
    if (!window.confirm('Delete DNA Center configuration?')) return
    setDnacSaving(true)
    setDnacMessage(null)
    try {
      const response = await apiFetch('/config/connectors/dnac', { method: 'DELETE' })
      const result = (await response.json()) as DnacConnectorConfig
      setDnac(result)
      setDnacMessage('DNA Center configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setDnacMessage(`Failed to delete: ${err.message}`)
    } finally {
      setDnacSaving(false)
    }
  }

  async function testDnac() {
    const validationError = validateDnac(dnac)
    if (validationError) {
      setDnacMessage(validationError)
      return
    }
    setDnacTesting(true)
    setDnacMessage(null)
    try {
      await apiFetch('/config/connectors/dnac/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dnac),
      })
      setDnacMessage('DNA Center connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setDnacMessage(`Connection failed: ${err.message}`)
    } finally {
      setDnacTesting(false)
    }
  }

  function loadDnacDefaultMappings() {
    if (!dnac) return
    setDnac({ ...dnac, event_mappings: buildDnacDefaultMappings() })
    setDnacMessage('Default DNA Center mappings loaded.')
  }

  async function debugDnac() {
    const validationError = validateDnac(dnac)
    if (validationError) {
      setDnacMessage(validationError)
      return
    }
    setDnacDebugging(true)
    setDnacMessage(null)
    try {
      const response = await apiFetch('/config/connectors/dnac/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dnac),
      })
      const result = (await response.json()) as ConnectorDebugResponse
      setDnacDebug(result)
      setDnacMessage('DNA Center debug completed.')
    } catch (e) {
      const err = e as ApiError
      setDnacMessage(`Debug failed: ${err.message}`)
    } finally {
      setDnacDebugging(false)
    }
  }

  async function saveRestconf() {
    const validationError = validateRestconf(restconf)
    if (validationError) {
      setRestconfMessage(validationError)
      return
    }
    setRestconfSaving(true)
    setRestconfMessage(null)
    try {
      const response = await apiFetch('/config/connectors/restconf', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restconf),
      })
      const result = (await response.json()) as RestconfConnectorConfig
      setRestconf(result)
      setRestconfMessage('RESTCONF settings saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setRestconfMessage(`Failed to save: ${err.message}`)
    } finally {
      setRestconfSaving(false)
    }
  }

  async function deleteRestconf() {
    if (!window.confirm('Delete RESTCONF configuration?')) return
    setRestconfSaving(true)
    setRestconfMessage(null)
    try {
      const response = await apiFetch('/config/connectors/restconf', { method: 'DELETE' })
      const result = (await response.json()) as RestconfConnectorConfig
      setRestconf(result)
      setRestconfMessage('RESTCONF configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setRestconfMessage(`Failed to delete: ${err.message}`)
    } finally {
      setRestconfSaving(false)
    }
  }

  async function testRestconf() {
    const validationError = validateRestconf(restconf)
    if (validationError) {
      setRestconfMessage(validationError)
      return
    }
    setRestconfTesting(true)
    setRestconfMessage(null)
    try {
      await apiFetch('/config/connectors/restconf/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restconf),
      })
      setRestconfMessage('RESTCONF connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setRestconfMessage(`Connection failed: ${err.message}`)
    } finally {
      setRestconfTesting(false)
    }
  }

  async function saveNetconf() {
    const validationError = validateNetconf(netconf)
    if (validationError) {
      setNetconfMessage(validationError)
      return
    }
    setNetconfSaving(true)
    setNetconfMessage(null)
    try {
      const response = await apiFetch('/config/connectors/netconf', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(netconf),
      })
      const result = (await response.json()) as NetconfConnectorConfig
      setNetconf(result)
      setNetconfMessage('NETCONF settings saved.')
      await saveConfig()
      setSelectedConnector('')
    } catch (e) {
      const err = e as ApiError
      setNetconfMessage(`Failed to save: ${err.message}`)
    } finally {
      setNetconfSaving(false)
    }
  }

  async function deleteNetconf() {
    if (!window.confirm('Delete NETCONF configuration?')) return
    setNetconfSaving(true)
    setNetconfMessage(null)
    try {
      const response = await apiFetch('/config/connectors/netconf', { method: 'DELETE' })
      const result = (await response.json()) as NetconfConnectorConfig
      setNetconf(result)
      setNetconfMessage('NETCONF configuration deleted.')
    } catch (e) {
      const err = e as ApiError
      setNetconfMessage(`Failed to delete: ${err.message}`)
    } finally {
      setNetconfSaving(false)
    }
  }

  async function testNetconf() {
    const validationError = validateNetconf(netconf)
    if (validationError) {
      setNetconfMessage(validationError)
      return
    }
    setNetconfTesting(true)
    setNetconfMessage(null)
    try {
      await apiFetch('/config/connectors/netconf/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(netconf),
      })
      setNetconfMessage('NETCONF connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setNetconfMessage(`Connection failed: ${err.message}`)
    } finally {
      setNetconfTesting(false)
    }
  }

  async function testGlpi() {
    const validationError = validateGlpi(glpi)
    if (validationError) {
      setGlpiMessage(validationError)
      return
    }
    setGlpiTesting(true)
    setGlpiMessage(null)
    try {
      await apiFetch('/config/connectors/glpi/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(glpi),
      })
      setGlpiMessage('GLPI connection succeeded.')
    } catch (e) {
      const err = e as ApiError
      setGlpiMessage(`Connection failed: ${err.message}`)
    } finally {
      setGlpiTesting(false)
    }
  }

  const isDeletableConnector = (name: string) =>
    [
      'glpi',
      'github',
      'gitlab',
      'service_now',
      'bamboohr',
      'workday',
      'jira',
      'aws_posture',
      'azure_posture',
      'gcp_posture',
      'palo_alto',
      'dell_datadomain',
      'veeam_enterprise_manager',
      'dnac',
      'cisco_dnac',
      'catalyst',
      'restconf',
      'cisco_restconf',
      'netconf',
      'cisco_netconf',
    ].includes(name)

  const deleteConnectorConfig = async (name: string) => {
    const [base, instance] = name.split(':')
    switch (base) {
      case 'glpi':
        await deleteGlpi()
        break
      case 'github':
        await deleteGithub()
        break
      case 'gitlab':
        await deleteGitlab()
        break
      case 'service_now':
        await deleteServiceNow()
        break
      case 'bamboohr':
        await deleteBambooHr()
        break
      case 'workday':
        await deleteWorkday()
        break
      case 'jira':
        await deleteJira()
        break
      case 'aws_posture':
        await deleteAwsPosture()
        break
      case 'azure_posture':
        await deleteAzurePosture()
        break
      case 'gcp_posture':
        await deleteGcpPosture()
        break
      case 'palo_alto':
        if (instance) {
          await deletePaloAltoByName(instance)
        } else {
          await deletePaloAlto()
        }
        break
      case 'dell_datadomain':
        if (instance) {
          await deleteDellDataDomainByName(instance)
        } else {
          await deleteDellDataDomain()
        }
        break
      case 'veeam_enterprise_manager':
        await deleteVeeamEnterpriseManager()
        break
      case 'vcenter':
        if (instance) {
          await deleteVcenterByName(instance)
        } else {
          await deleteVcenter()
        }
        break
      case 'powerstore':
        if (instance) {
          await deletePowerstoreByName(instance)
        } else {
          await deletePowerstore()
        }
        break
      case 'dnac':
      case 'cisco_dnac':
      case 'catalyst':
        await deleteDnac()
        break
      case 'restconf':
      case 'cisco_restconf':
        await deleteRestconf()
        break
      case 'netconf':
      case 'cisco_netconf':
        await deleteNetconf()
        break
      default:
        break
    }
  }

  function addPaloAltoCluster() {
    if (!currentPaloAlto) return
    const nextIndex = currentPaloAlto.clusters.length + 1
    updatePaloAltoInstance(currentPaloAlto.name, {
      clusters: [...currentPaloAlto.clusters, buildDefaultPaloAltoCluster(`${currentPaloAlto.name}-cluster-${nextIndex}`)],
    })
  }

  function addPaloAltoEventMapping() {
    if (!currentPaloAlto) return
    const newMapping: PaloAltoEventMapping = {
      name: '',
      event_kind: 'change_event',
      match_field: 'change_type',
      match_value: '',
      finding_type: 'resilience',
      severity: 'medium',
      score_delta: null,
      enabled: true,
    }
    const next = [
      ...(currentPaloAlto.event_mappings ?? []),
      newMapping,
    ]
    updatePaloAltoInstance(currentPaloAlto.name, { event_mappings: next })
    setPaloAltoMappingsExpanded((prev) => ({ ...prev, [currentPaloAlto.name]: true }))
  }

  function updatePaloAltoEventMapping(index: number, patch: Partial<PaloAltoEventMapping>) {
    if (!currentPaloAlto) return
    const next = (currentPaloAlto.event_mappings ?? []).map((mapping, idx) =>
      idx === index ? { ...mapping, ...patch } : mapping,
    )
    updatePaloAltoInstance(currentPaloAlto.name, { event_mappings: next })
  }

  function removePaloAltoEventMapping(index: number) {
    if (!currentPaloAlto) return
    const next = (currentPaloAlto.event_mappings ?? []).filter((_, idx) => idx !== index)
    updatePaloAltoInstance(currentPaloAlto.name, { event_mappings: next })
  }

  function updatePaloAltoCluster(index: number, patch: Partial<PaloAltoClusterConfig>) {
    if (!currentPaloAlto) return
    const clusters = currentPaloAlto.clusters.map((cluster, idx) =>
      idx === index ? { ...cluster, ...patch } : cluster,
    )
    updatePaloAltoInstance(currentPaloAlto.name, { clusters })
  }

  function removePaloAltoCluster(index: number) {
    if (!currentPaloAlto) return
    const clusters = currentPaloAlto.clusters.filter((_, idx) => idx !== index)
    updatePaloAltoInstance(currentPaloAlto.name, { clusters })
  }

  function selectConnectorForEdit(name: string) {
    const raw = name.trim()
    const directPalo =
      paloAltoConfigs.find((item) => item.name === raw) ??
      paloAltoConfigs.find((item) => item.name.toLowerCase() === raw.toLowerCase())
    if (directPalo) {
      setSelectedConnector('palo_alto')
      setPaloAltoSelected(directPalo.name)
      return
    }

    const directVcenter =
      vcenterConfigs.find((item) => item.name === raw) ??
      vcenterConfigs.find((item) => item.name.toLowerCase() === raw.toLowerCase())
    if (directVcenter) {
      setSelectedConnector('vcenter')
      setVcenterSelected(directVcenter.name)
      return
    }

    const directPowerstore =
      powerstoreConfigs.find((item) => item.name === raw) ??
      powerstoreConfigs.find((item) => item.name.toLowerCase() === raw.toLowerCase())
    if (directPowerstore) {
      setSelectedConnector('powerstore')
      setPowerstoreSelected(directPowerstore.name)
      return
    }

    const directDataDomain =
      dellDataDomainConfigs.find((item) => item.name === raw) ??
      dellDataDomainConfigs.find((item) => item.name.toLowerCase() === raw.toLowerCase())
    if (directDataDomain) {
      setSelectedConnector('dell_datadomain')
      setDellDataDomainSelected(directDataDomain.name)
      return
    }

    const [base, ...rest] = raw.split(':')
    const instance = rest.join(':')
    setSelectedConnector(base)
    if (base === 'vcenter' && instance) {
      setVcenterSelected(instance)
    }
    if (base === 'powerstore' && instance) {
      setPowerstoreSelected(instance)
    }
    if (base === 'palo_alto' && instance) {
      const match =
        paloAltoConfigs.find((item) => item.name === instance) ??
        paloAltoConfigs.find((item) => item.name.toLowerCase() === instance.toLowerCase())
      setPaloAltoSelected(match?.name ?? instance)
    }
    if (base === 'palo_alto' && !instance && paloAltoConfigs.length) {
      setPaloAltoSelected(paloAltoConfigs[0].name)
    }
    if (base === 'dell_datadomain' && instance) {
      setDellDataDomainSelected(instance)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <PageTitle>{t('Connectors', 'Connectors')}</PageTitle>
        <HelpTip text={'Enable connectors and configure credentials (GLPI, ServiceNow, Palo Alto, Cisco). Save, then test connections before running ingestion.'} />
      </div>
      <p className="text-sm text-slate-50">
        {t(
          'Choose which data sources are enabled and configure credentials for each connector below.',
          'Choose which data sources are enabled and configure credentials for each connector below.'
        )}
      </p>
      {error ? <ErrorBox title={error.message} detail={error.bodyText} /> : null}
      {configError ? <ErrorBox title={configError.message} detail={configError.bodyText} /> : null}
      <Card>
        <div className="flex items-center gap-2">
          <Label>{t('Connector selection', 'Connector selection')}</Label>
          <HelpTip text={'Pick a connector to configure. Selection enables it for ingestion.'} />
        </div>
        <p className="mt-2 text-sm text-slate-50">
          {t(
            'Choose which connectors are enabled for ingestion. Changes apply to new runs.',
            'Choose which connectors are enabled for ingestion. Changes apply to new runs.'
          )}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            className="rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
            value={selectedConnector}
            onChange={(e) => {
              const name = e.target.value
              setSelectedConnector(name)
              addConnector(name)
            }}
          >
            <option value="">{t('Select a connector...', 'Select a connector...')}</option>
            {Object.entries(groupedAvailable).map(([category, names]) => (
              <optgroup key={category} label={category}>
                {names.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {!config?.available?.length ? (
            <span className="text-sm text-slate-50">{t('No connectors available.', 'No connectors available.')}</span>
          ) : null}
        </div>
      </Card>
      {selectedConnector &&
      selectedConnector !== 'glpi' &&
      selectedConnector !== 'vcenter' &&
      selectedConnector !== 'powerstore' &&
      selectedConnector !== 'veeam_enterprise_manager' &&
      selectedConnector !== 'github' &&
      selectedConnector !== 'gitlab' &&
      selectedConnector !== 'service_now' &&
      selectedConnector !== 'bamboohr' &&
      selectedConnector !== 'workday' &&
      selectedConnector !== 'jira' &&
      selectedConnector !== 'aws_posture' &&
      selectedConnector !== 'azure_posture' &&
      selectedConnector !== 'gcp_posture' &&
      selectedConnector !== 'palo_alto' &&
      selectedConnector !== 'dell_datadomain' &&
      selectedConnector !== 'dnac' &&
      selectedConnector !== 'cisco_dnac' &&
      selectedConnector !== 'catalyst' &&
      selectedConnector !== 'restconf' &&
      selectedConnector !== 'cisco_restconf' &&
      selectedConnector !== 'netconf' &&
      selectedConnector !== 'cisco_netconf' ? (
        <Card>
          <Label>{selectedConnector} configuration</Label>
          <p className="mt-2 text-sm text-slate-50">
            {connectorCategory(selectedConnector)} {t(
              'connector. Save to enable and test connectivity if supported.',
              'connector. Save to enable and test connectivity if supported.'
            )}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={saveConfig} disabled={saving}>
              {saving ? 'Saving...' : 'Save selection'}
            </Button>
            <Button onClick={() => testGenericConnector(selectedConnector)} disabled={genericTesting}>
              {genericTesting ? 'Testing...' : 'Test connection'}
            </Button>
            {saveMessage ? <span className="text-sm text-slate-50">{saveMessage}</span> : null}
            {genericTestMessage ? <span className="text-sm text-slate-50">{genericTestMessage}</span> : null}
          </div>
        </Card>
      ) : null}
      {selectedConnector === 'dell_datadomain' ? (
        <Card>
          <Label>{t('Dell Data Domain instances', 'Dell Data Domain instances')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure Dell Data Domain credentials to collect resilience and backup signals.',
              'Configure Dell Data Domain credentials to collect resilience and backup signals.'
            )}
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>{t('Instance', 'Instance')}</Label>
              <select
                className="rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                value={dellDataDomainSelected}
                onChange={(e) => setDellDataDomainSelected(e.target.value)}
              >
                <option value="">{t('Select instance...', 'Select instance...')}</option>
                {dellDataDomainConfigs.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t('New instance name', 'New instance name')}</Label>
              <input
                className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                value={dellDataDomainNewName}
                onChange={(e) => setDellDataDomainNewName(e.target.value)}
                placeholder="datadomain-primary"
              />
            </div>
            <Button onClick={addDellDataDomainInstance}>{t('Add instance', 'Add instance')}</Button>
          </div>
          {currentDellDataDomain ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <AssetSelect
                value={currentDellDataDomain.asset_id}
                onChange={(value) =>
                  updateDellDataDomainInstance(currentDellDataDomain.name, { asset_id: value })
                }
                helpText="Required. Bind this connector to an inventory asset."
              />
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Base URL', 'Base URL')}</Label>
                  <HelpTip text={'Data Domain API URL. Example: https://dd.example.com:3009.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={currentDellDataDomain.url ?? ''}
                  onChange={(e) =>
                    updateDellDataDomainInstance(currentDellDataDomain.name, { url: e.target.value })
                  }
                  placeholder="https://dd.example.com:3009"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('API base override', 'API base override')}</Label>
                  <HelpTip
                    text={
                      'Optional full REST base (ex: https://dd.example.com:3009/rest/v1.0) if the default path differs.'
                    }
                  />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={currentDellDataDomain.api_base ?? ''}
                  onChange={(e) =>
                    updateDellDataDomainInstance(currentDellDataDomain.name, { api_base: e.target.value })
                  }
                  placeholder="https://dd.example.com:3009/rest/v1.0"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Username', 'Username')}</Label>
                  <HelpTip text={'Data Domain API username.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={currentDellDataDomain.username ?? ''}
                  onChange={(e) =>
                    updateDellDataDomainInstance(currentDellDataDomain.name, { username: e.target.value })
                  }
                  placeholder="api-user"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Password', 'Password')}</Label>
                  <HelpTip text={'Data Domain API password.'} />
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={currentDellDataDomain.password ?? ''}
                  onChange={(e) =>
                    updateDellDataDomainInstance(currentDellDataDomain.name, { password: e.target.value })
                  }
                  placeholder="password"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-50 md:col-span-2">
                <input
                  type="checkbox"
                  checked={currentDellDataDomain.verify_tls ?? true}
                  onChange={(e) =>
                    updateDellDataDomainInstance(currentDellDataDomain.name, { verify_tls: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                />
                <span className="flex items-center gap-2">
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                  <HelpTip text={'Disable only for self-signed lab appliances.'} />
                </span>
              </label>
              {renderEventMappings({
                connectorKey: 'dell_datadomain',
                title: 'Event mappings',
                helpText: 'Map Data Domain backup/replication signals into findings.',
                mappings: currentDellDataDomain.event_mappings ?? [],
                onLoadDefaults: loadDellDataDomainDefaultMappings,
                onAdd: addDellDataDomainEventMapping,
                onUpdate: updateDellDataDomainEventMapping,
                onRemove: removeDellDataDomainEventMapping,
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('No Data Domain instance selected.', 'No Data Domain instance selected.')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={saveDellDataDomain}
              disabled={
                dellDataDomainSaving || !dellDataDomainConfigs.length
              }
            >
              {dellDataDomainSaving ? 'Saving...' : 'Save Data Domain instances'}
            </Button>
            <Button
              onClick={testDellDataDomain}
              disabled={
                dellDataDomainTesting || !currentDellDataDomain
              }
            >
              {dellDataDomainTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <Button
              onClick={debugDellDataDomain}
              disabled={
                dellDataDomainDebugging || !currentDellDataDomain
              }
            >
              {dellDataDomainDebugging ? 'Debugging...' : 'Debug fetch'}
            </Button>
            <DangerButton onClick={deleteDellDataDomain} disabled={dellDataDomainSaving}>
              {t('Delete instance', 'Delete instance')}
            </DangerButton>
            {dellDataDomainMessage ? (
              <span className="text-sm text-slate-50">{dellDataDomainMessage}</span>
            ) : null}
          </div>
          {renderDebugCounts(dellDataDomainDebug)}
        </Card>
      ) : null}
      {['dnac', 'cisco_dnac', 'catalyst'].includes(selectedConnector) ? (
        <Card>
          <Label>{t('Cisco DNA Center settings', 'Cisco DNA Center settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure DNA Center credentials to pull inventory and maintenance history.',
              'Configure DNA Center credentials to pull inventory and maintenance history.'
            )}
          </p>
          {dnac ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <AssetSelect
                value={dnac.asset_id}
                onChange={(value) => setDnac({ ...dnac, asset_id: value })}
                helpText="Required. Bind this connector to an inventory asset."
              />
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Base URL', 'Base URL')}</Label>
                  <HelpTip text={'DNA Center URL. Example: https://dnac.example.com'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={dnac.base_url ?? ''}
                  onChange={(e) => setDnac({ ...dnac, base_url: e.target.value })}
                  placeholder="https://dnac.example.com"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Username', 'Username')}</Label>
                  <HelpTip text={'DNA Center username.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={dnac.username ?? ''}
                  onChange={(e) => setDnac({ ...dnac, username: e.target.value })}
                  placeholder="admin"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Password', 'Password')}</Label>
                  <HelpTip text={'DNA Center password.'} />
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={dnac.password ?? ''}
                  onChange={(e) => setDnac({ ...dnac, password: e.target.value })}
                  placeholder="password"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('TLS verification', 'TLS verification')}</Label>
                  <HelpTip text={'Disable only for lab environments.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={dnac.verify_tls ?? true}
                    onChange={(e) => setDnac({ ...dnac, verify_tls: e.target.checked })}
                  />
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Audit logs', 'Audit logs')}</Label>
                  <HelpTip text={'Include audit log history in maintenance events.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={dnac.include_audit_logs ?? true}
                    onChange={(e) => setDnac({ ...dnac, include_audit_logs: e.target.checked })}
                  />
                  {t('Include audit logs', 'Include audit logs')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Events', 'Events')}</Label>
                  <HelpTip text={'Include event stream history for role changes.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={dnac.include_events ?? true}
                    onChange={(e) => setDnac({ ...dnac, include_events: e.target.checked })}
                  />
                  {t('Include events', 'Include events')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Page size', 'Page size')}</Label>
                  <HelpTip text={'Inventory page size.'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={dnac.page_size ?? 200}
                  onChange={(e) => setDnac({ ...dnac, page_size: Number(e.target.value || 0) })}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Max log entries', 'Max log entries')}</Label>
                  <HelpTip text={'Limit audit/event log entries.'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={dnac.log_max ?? 200}
                  onChange={(e) => setDnac({ ...dnac, log_max: Number(e.target.value || 0) })}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('History window (hours)', 'History window (hours)')}</Label>
                  <HelpTip text={'Ignore log entries older than this window.'} />
                </div>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={dnac.log_since_hours ?? 168}
                  onChange={(e) => setDnac({ ...dnac, log_since_hours: Number(e.target.value || 0) })}
                />
              </div>
              {renderEventMappings({
                connectorKey: 'dnac',
                title: 'Event mappings',
                helpText: 'Map DNA Center maintenance and HA signals into findings.',
                mappings: dnac.event_mappings ?? [],
                onLoadDefaults: loadDnacDefaultMappings,
                onAdd: addDnacEventMapping,
                onUpdate: updateDnacEventMapping,
                onRemove: removeDnacEventMapping,
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('Loading DNA Center settings...', 'Loading DNA Center settings...')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={saveDnac} disabled={dnacSaving || !dnac || Boolean(validateDnac(dnac))}>
              {dnacSaving ? 'Saving...' : 'Save DNA Center settings'}
            </Button>
            <Button onClick={testDnac} disabled={dnacTesting || !dnac || Boolean(validateDnac(dnac))}>
              {dnacTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <Button onClick={debugDnac} disabled={dnacDebugging || !dnac || Boolean(validateDnac(dnac))}>
              {dnacDebugging ? 'Debugging...' : 'Debug fetch'}
            </Button>
            <DangerButton onClick={deleteDnac} disabled={dnacSaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {dnacMessage ? <span className="text-sm text-slate-50">{dnacMessage}</span> : null}
          </div>
          {renderDebugCounts(dnacDebug)}
        </Card>
      ) : null}
      {['restconf', 'cisco_restconf'].includes(selectedConnector) ? (
        <Card>
          <Label>{t('Cisco RESTCONF settings', 'Cisco RESTCONF settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure RESTCONF credentials for Catalyst state snapshots.',
              'Configure RESTCONF credentials for Catalyst state snapshots.'
            )}
          </p>
          {restconf ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <AssetSelect
                value={restconf.asset_id}
                onChange={(value) => setRestconf({ ...restconf, asset_id: value })}
                helpText="Required. Bind this connector to an inventory asset."
              />
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Base URL', 'Base URL')}</Label>
                  <HelpTip text={'Device RESTCONF base URL. Example: https://switch.example.com'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={restconf.base_url ?? ''}
                  onChange={(e) => setRestconf({ ...restconf, base_url: e.target.value })}
                  placeholder="https://switch.example.com"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Username', 'Username')}</Label>
                  <HelpTip text={'RESTCONF username.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={restconf.username ?? ''}
                  onChange={(e) => setRestconf({ ...restconf, username: e.target.value })}
                  placeholder="admin"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Password', 'Password')}</Label>
                  <HelpTip text={'RESTCONF password.'} />
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={restconf.password ?? ''}
                  onChange={(e) => setRestconf({ ...restconf, password: e.target.value })}
                  placeholder="password"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('TLS verification', 'TLS verification')}</Label>
                  <HelpTip text={'Disable only for lab environments.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={restconf.verify_tls ?? true}
                    onChange={(e) => setRestconf({ ...restconf, verify_tls: e.target.checked })}
                  />
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Inventory snapshot', 'Inventory snapshot')}</Label>
                  <HelpTip text={'Collect hardware inventory via RESTCONF.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={restconf.include_inventory ?? true}
                    onChange={(e) => setRestconf({ ...restconf, include_inventory: e.target.checked })}
                  />
                  {t('Include inventory', 'Include inventory')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Running config snapshot', 'Running config snapshot')}</Label>
                  <HelpTip text={'Hash running configuration for traceability.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={restconf.include_running_config ?? true}
                    onChange={(e) => setRestconf({ ...restconf, include_running_config: e.target.checked })}
                  />
                  {t('Include running config', 'Include running config')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('HA state', 'HA state')}</Label>
                  <HelpTip text={'Collect redundancy state if supported.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={restconf.include_ha_state ?? true}
                    onChange={(e) => setRestconf({ ...restconf, include_ha_state: e.target.checked })}
                  />
                  {t('Include HA state', 'Include HA state')}
                </label>
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Inventory endpoint', 'Inventory endpoint')}</Label>
                  <HelpTip text={'Optional override for inventory endpoint.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={restconf.inventory_endpoint ?? ''}
                  onChange={(e) =>
                    setRestconf({ ...restconf, inventory_endpoint: e.target.value })
                  }
                  placeholder={t('/restconf/data/...', '/restconf/data/...')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('HA endpoint', 'HA endpoint')}</Label>
                  <HelpTip text={'Optional override for HA endpoint.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={restconf.ha_endpoint ?? ''}
                  onChange={(e) => setRestconf({ ...restconf, ha_endpoint: e.target.value })}
                  placeholder={t('/restconf/data/...', '/restconf/data/...')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Running config endpoint', 'Running config endpoint')}</Label>
                  <HelpTip text={'Optional override for running config endpoint.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={restconf.running_config_endpoint ?? ''}
                  onChange={(e) =>
                    setRestconf({ ...restconf, running_config_endpoint: e.target.value })
                  }
                  placeholder={t('/restconf/data/...', '/restconf/data/...')}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('Loading RESTCONF settings...', 'Loading RESTCONF settings...')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={saveRestconf}
              disabled={restconfSaving || !restconf || Boolean(validateRestconf(restconf))}
            >
              {restconfSaving ? 'Saving...' : 'Save RESTCONF settings'}
            </Button>
            <Button
              onClick={testRestconf}
              disabled={restconfTesting || !restconf || Boolean(validateRestconf(restconf))}
            >
              {restconfTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <DangerButton onClick={deleteRestconf} disabled={restconfSaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {restconfMessage ? <span className="text-sm text-slate-50">{restconfMessage}</span> : null}
          </div>
        </Card>
      ) : null}
      {['netconf', 'cisco_netconf'].includes(selectedConnector) ? (
        <Card>
          <Label>{t('Cisco NETCONF settings', 'Cisco NETCONF settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure NETCONF credentials for Catalyst state snapshots.',
              'Configure NETCONF credentials for Catalyst state snapshots.'
            )}
          </p>
          {netconf ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <AssetSelect
                value={netconf.asset_id}
                onChange={(value) => setNetconf({ ...netconf, asset_id: value })}
                helpText="Required. Bind this connector to an inventory asset."
              />
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Host', 'Host')}</Label>
                  <HelpTip text={'Device hostname or IP for NETCONF.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={netconf.host ?? ''}
                  onChange={(e) => setNetconf({ ...netconf, host: e.target.value })}
                  placeholder={t('switch.example.com', 'switch.example.com')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Username', 'Username')}</Label>
                  <HelpTip text={'NETCONF username.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={netconf.username ?? ''}
                  onChange={(e) => setNetconf({ ...netconf, username: e.target.value })}
                  placeholder="admin"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Password', 'Password')}</Label>
                  <HelpTip text={'NETCONF password.'} />
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={netconf.password ?? ''}
                  onChange={(e) => setNetconf({ ...netconf, password: e.target.value })}
                  placeholder="password"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Port', 'Port')}</Label>
                  <HelpTip text={'NETCONF port (default 830).'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={netconf.port ?? 830}
                  onChange={(e) => setNetconf({ ...netconf, port: Number(e.target.value || 0) })}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Device type', 'Device type')}</Label>
                  <HelpTip text={'NETCONF device type (ncclient).'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={netconf.device_type ?? 'csr'}
                  onChange={(e) => setNetconf({ ...netconf, device_type: e.target.value })}
                  placeholder="csr"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Host key verification', 'Host key verification')}</Label>
                  <HelpTip text={'Enable only if host keys are managed.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={netconf.hostkey_verify ?? false}
                    onChange={(e) => setNetconf({ ...netconf, hostkey_verify: e.target.checked })}
                  />
                  {t('Verify host key', 'Verify host key')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Inventory snapshot', 'Inventory snapshot')}</Label>
                  <HelpTip text={'Collect hardware inventory via NETCONF.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={netconf.include_inventory ?? true}
                    onChange={(e) => setNetconf({ ...netconf, include_inventory: e.target.checked })}
                  />
                  {t('Include inventory', 'Include inventory')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Running config snapshot', 'Running config snapshot')}</Label>
                  <HelpTip text={'Hash running configuration for traceability.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={netconf.include_running_config ?? true}
                    onChange={(e) =>
                      setNetconf({ ...netconf, include_running_config: e.target.checked })
                    }
                  />
                  {t('Include running config', 'Include running config')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('HA state', 'HA state')}</Label>
                  <HelpTip text={'Collect redundancy state if supported.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={netconf.include_ha_state ?? true}
                    onChange={(e) => setNetconf({ ...netconf, include_ha_state: e.target.checked })}
                  />
                  {t('Include HA state', 'Include HA state')}
                </label>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('Loading NETCONF settings...', 'Loading NETCONF settings...')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={saveNetconf}
              disabled={netconfSaving || !netconf || Boolean(validateNetconf(netconf))}
            >
              {netconfSaving ? 'Saving...' : 'Save NETCONF settings'}
            </Button>
            <Button
              onClick={testNetconf}
              disabled={netconfTesting || !netconf || Boolean(validateNetconf(netconf))}
            >
              {netconfTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <DangerButton onClick={deleteNetconf} disabled={netconfSaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {netconfMessage ? <span className="text-sm text-slate-50">{netconfMessage}</span> : null}
          </div>
        </Card>
      ) : null}
      {selectedConnector === 'vcenter' ? (
        <Card>
          <Label>{t('vCenter instances', 'vCenter instances')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure one or more vCenter instances to ingest inventory and tasks (as change events).',
              'Configure one or more vCenter instances to ingest inventory and tasks (as change events).'
            )}
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>{t('Instance', 'Instance')}</Label>
              <select
                className="rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                value={vcenterSelected}
                onChange={(e) => setVcenterSelected(e.target.value)}
              >
                <option value="">{t('Select instance...', 'Select instance...')}</option>
                {vcenterConfigs.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t('New instance name', 'New instance name')}</Label>
              <input
                className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                value={vcenterNewName}
                onChange={(e) => setVcenterNewName(e.target.value)}
                placeholder="vcenter-primary"
              />
            </div>
            <Button onClick={addVcenterInstance}>{t('Add instance', 'Add instance')}</Button>
          </div>
          {currentVcenter ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <AssetSelect
                value={currentVcenter.asset_id}
                onChange={(value) => updateVcenterInstance(currentVcenter.name, { asset_id: value })}
                helpText="Required. Bind this connector to an inventory asset."
              />
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Base URL', 'Base URL')}</Label>
                  <HelpTip text={'vCenter URL. Example: https://vcenter.example.com'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={currentVcenter.base_url ?? ''}
                  onChange={(e) => updateVcenterInstance(currentVcenter.name, { base_url: e.target.value })}
                  placeholder="https://vcenter.example.com"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Username', 'Username')}</Label>
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={currentVcenter.username ?? ''}
                  onChange={(e) => updateVcenterInstance(currentVcenter.name, { username: e.target.value })}
                  placeholder="user@domain"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Password', 'Password')}</Label>
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={currentVcenter.password ?? ''}
                  onChange={(e) => updateVcenterInstance(currentVcenter.name, { password: e.target.value })}
                  placeholder="password"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Tasks', 'Tasks')}</Label>
                  <HelpTip text={'Tasks are ingested as change events.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={currentVcenter.include_tasks ?? true}
                    onChange={(e) => updateVcenterInstance(currentVcenter.name, { include_tasks: e.target.checked })}
                  />
                  {t('Include tasks', 'Include tasks')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('VM hardware', 'VM hardware')}</Label>
                  <HelpTip text={'Collect CPU, memory, disk IDs, and datastore mapping for VMs.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={currentVcenter.include_vm_hardware ?? true}
                    onChange={(e) =>
                      updateVcenterInstance(currentVcenter.name, { include_vm_hardware: e.target.checked })
                    }
                  />
                  {t('Include VM hardware & disks', 'Include VM hardware & disks')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Verify TLS', 'Verify TLS')}</Label>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={currentVcenter.verify_tls ?? true}
                    onChange={(e) => updateVcenterInstance(currentVcenter.name, { verify_tls: e.target.checked })}
                  />
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                </label>
              </div>
              {renderEventMappings({
                connectorKey: 'vcenter',
                title: 'Event mappings',
                helpText: 'Map vCenter tasks into control findings.',
                mappings: currentVcenter.event_mappings ?? [],
                onLoadDefaults: loadVcenterDefaultMappings,
                onAdd: addVcenterEventMapping,
                onUpdate: updateVcenterEventMapping,
                onRemove: removeVcenterEventMapping,
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('No vCenter instance selected.', 'No vCenter instance selected.')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={saveVcenter} disabled={vcenterSaving || !vcenterConfigs.length}>
              {vcenterSaving ? 'Saving...' : 'Save vCenter instances'}
            </Button>
            <Button onClick={testVcenter} disabled={vcenterTesting || !currentVcenter}>
              {vcenterTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <Button onClick={debugVcenter} disabled={vcenterDebugging || !currentVcenter}>
              {vcenterDebugging ? 'Debugging...' : 'Debug fetch'}
            </Button>
            <DangerButton onClick={deleteVcenter} disabled={vcenterSaving || !currentVcenter}>
              {t('Delete instance', 'Delete instance')}
            </DangerButton>
            {vcenterMessage ? <span className="text-sm text-slate-50">{vcenterMessage}</span> : null}
          </div>
          {renderDebugCounts(vcenterDebug)}
        </Card>
      ) : null}
      {selectedConnector === 'powerstore' ? (
        <Card>
          <Label>{t('PowerStore instances', 'PowerStore instances')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure one or more PowerStore arrays to ingest replication health and immutability signals.',
              'Configure one or more PowerStore arrays to ingest replication health and immutability signals.'
            )}
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>{t('Instance', 'Instance')}</Label>
              <select
                className="rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                value={powerstoreSelected}
                onChange={(e) => setPowerstoreSelected(e.target.value)}
              >
                <option value="">{t('Select instance...', 'Select instance...')}</option>
                {powerstoreConfigs.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t('New instance name', 'New instance name')}</Label>
              <input
                className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                value={powerstoreNewName}
                onChange={(e) => setPowerstoreNewName(e.target.value)}
                placeholder="powerstore-primary"
              />
            </div>
            <Button onClick={addPowerstoreInstance}>{t('Add instance', 'Add instance')}</Button>
          </div>
          {currentPowerstore ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <AssetSelect
                value={currentPowerstore.asset_id}
                onChange={(value) => updatePowerstoreInstance(currentPowerstore.name, { asset_id: value })}
                helpText="Required. Bind this connector to an inventory asset."
              />
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Base URL', 'Base URL')}</Label>
                  <HelpTip text={'PowerStore management URL. Example: https://powerstore.example.com'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={currentPowerstore.base_url ?? ''}
                  onChange={(e) =>
                    updatePowerstoreInstance(currentPowerstore.name, { base_url: e.target.value })
                  }
                  placeholder="https://powerstore.example.com"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Username', 'Username')}</Label>
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={currentPowerstore.username ?? ''}
                  onChange={(e) =>
                    updatePowerstoreInstance(currentPowerstore.name, { username: e.target.value })
                  }
                  placeholder="api-user"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Password', 'Password')}</Label>
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={currentPowerstore.password ?? ''}
                  onChange={(e) =>
                    updatePowerstoreInstance(currentPowerstore.name, { password: e.target.value })
                  }
                  placeholder="password"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Verify TLS', 'Verify TLS')}</Label>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={currentPowerstore.verify_tls ?? true}
                    onChange={(e) =>
                      updatePowerstoreInstance(currentPowerstore.name, { verify_tls: e.target.checked })
                    }
                  />
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                </label>
              </div>
              {renderEventMappings({
                connectorKey: 'powerstore',
                title: 'Event mappings',
                helpText: 'Map PowerStore replication and immutability signals into findings.',
                mappings: currentPowerstore.event_mappings ?? [],
                onLoadDefaults: loadPowerstoreDefaultMappings,
                onAdd: addPowerstoreEventMapping,
                onUpdate: updatePowerstoreEventMapping,
                onRemove: removePowerstoreEventMapping,
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('No PowerStore instance selected.', 'No PowerStore instance selected.')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={savePowerstore} disabled={powerstoreSaving || !powerstoreConfigs.length}>
              {powerstoreSaving ? 'Saving...' : 'Save PowerStore instances'}
            </Button>
            <Button onClick={testPowerstore} disabled={powerstoreTesting || !currentPowerstore}>
              {powerstoreTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <Button onClick={debugPowerstore} disabled={powerstoreDebugging || !currentPowerstore}>
              {powerstoreDebugging ? 'Debugging...' : 'Debug fetch'}
            </Button>
            <DangerButton onClick={deletePowerstore} disabled={powerstoreSaving || !currentPowerstore}>
              {t('Delete instance', 'Delete instance')}
            </DangerButton>
            {powerstoreMessage ? <span className="text-sm text-slate-50">{powerstoreMessage}</span> : null}
          </div>
          {renderDebugCounts(powerstoreDebug)}
        </Card>
      ) : null}
      {selectedConnector === 'veeam_enterprise_manager' ? (
        <Card>
          <Label>{t('Veeam Enterprise Manager settings', 'Veeam Enterprise Manager settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure Veeam Enterprise Manager to ingest backup sessions, restore sessions, and VM last\n            successful backups.',
              'Configure Veeam Enterprise Manager to ingest backup sessions, restore sessions, and VM last\n            successful backups.'
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-50">
              <input
                type="checkbox"
                checked={veeamEnterpriseManagerEnabled}
                onChange={(e) => setConnectorEnabled('veeam_enterprise_manager', e.target.checked)}
              />
              {t('Enabled for ingestion', 'Enabled for ingestion')}
            </label>
            <Button onClick={saveConfig} disabled={saving}>
              {saving ? 'Saving...' : 'Save selection'}
            </Button>
          </div>
          {veeamEnterpriseManager ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <AssetSelect
                value={veeamEnterpriseManager.asset_id}
                onChange={(value) => setVeeamEnterpriseManager({ ...veeamEnterpriseManager, asset_id: value })}
                helpText="Required. Bind this connector to an inventory asset."
              />
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Base URL', 'Base URL')}</Label>
                  <HelpTip text={'Enterprise Manager API base URL. Example: https://veeam-em.example.com:9398'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={veeamEnterpriseManager.base_url ?? ''}
                  onChange={(e) => setVeeamEnterpriseManager({ ...veeamEnterpriseManager, base_url: e.target.value })}
                  placeholder="https://veeam-em.example.com:9398"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Username', 'Username')}</Label>
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={veeamEnterpriseManager.username ?? ''}
                  onChange={(e) => setVeeamEnterpriseManager({ ...veeamEnterpriseManager, username: e.target.value })}
                  placeholder="api-user"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Password', 'Password')}</Label>
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={veeamEnterpriseManager.password ?? ''}
                  onChange={(e) => setVeeamEnterpriseManager({ ...veeamEnterpriseManager, password: e.target.value })}
                  placeholder="password"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Verify TLS', 'Verify TLS')}</Label>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={veeamEnterpriseManager.verify_tls ?? true}
                    onChange={(e) =>
                      setVeeamEnterpriseManager({ ...veeamEnterpriseManager, verify_tls: e.target.checked })
                    }
                  />
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('B&R server URL (optional)', 'B&R server URL (optional)')}</Label>
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={veeamEnterpriseManager.bnr_url ?? ''}
                  onChange={(e) => setVeeamEnterpriseManager({ ...veeamEnterpriseManager, bnr_url: e.target.value })}
                  placeholder="https://vbr-server.acme.internal:9419"
                />
                <p className="text-xs text-slate-400">
                  {t(
                    'Veeam Backup & Replication REST API (9419) — required for tape jobs + Data Domain immutability, which Enterprise Manager does not expose. Leave blank if B&R is on the same host as EM (auto-detected). Set this when B&R is a separate server.',
                    'Veeam Backup & Replication REST API (9419) — required for tape jobs + Data Domain immutability, which Enterprise Manager does not expose. Leave blank if B&R is on the same host as EM (auto-detected). Set this when B&R is a separate server.',
                  )}
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('B&R username (optional)', 'B&R username (optional)')}</Label>
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={veeamEnterpriseManager.bnr_username ?? ''}
                  onChange={(e) => setVeeamEnterpriseManager({ ...veeamEnterpriseManager, bnr_username: e.target.value })}
                  placeholder="AUXIA\\svc-veeam (blank = reuse EM username)"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('B&R password (optional)', 'B&R password (optional)')}</Label>
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={veeamEnterpriseManager.bnr_password ?? ''}
                  onChange={(e) => setVeeamEnterpriseManager({ ...veeamEnterpriseManager, bnr_password: e.target.value })}
                  placeholder={t('blank = reuse EM password', 'blank = reuse EM password')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Backup sessions endpoint', 'Backup sessions endpoint')}</Label>
                  <HelpTip text={'Endpoint path for backup sessions. Example: /api/backupSessions'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={veeamEnterpriseManager.backup_sessions_endpoint ?? ''}
                  onChange={(e) =>
                    setVeeamEnterpriseManager({
                      ...veeamEnterpriseManager,
                      backup_sessions_endpoint: e.target.value,
                    })
                  }
                  placeholder="/api/backupSessions"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Backup task sessions endpoint', 'Backup task sessions endpoint')}</Label>
                  <HelpTip text={'Endpoint path for backup task sessions. Example: /api/query?type=BackupTaskSession&format=Entities'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={veeamEnterpriseManager.backup_task_sessions_endpoint ?? ''}
                  onChange={(e) =>
                    setVeeamEnterpriseManager({
                      ...veeamEnterpriseManager,
                      backup_task_sessions_endpoint: e.target.value,
                    })
                  }
                  placeholder={t(
                    '/api/query?type=BackupTaskSession&format=Entities',
                    '/api/query?type=BackupTaskSession&format=Entities'
                  )}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Restore sessions endpoint', 'Restore sessions endpoint')}</Label>
                  <HelpTip text={'Endpoint path for restore sessions. Example: /api/restoreSessions'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={veeamEnterpriseManager.restore_sessions_endpoint ?? ''}
                  onChange={(e) =>
                    setVeeamEnterpriseManager({
                      ...veeamEnterpriseManager,
                      restore_sessions_endpoint: e.target.value,
                    })
                  }
                  placeholder="/api/restoreSessions"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Max items', 'Max items')}</Label>
                  <HelpTip text={'Maximum items to fetch per endpoint.'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={veeamEnterpriseManager.max_items ?? 200}
                  onChange={(e) =>
                    setVeeamEnterpriseManager({
                      ...veeamEnterpriseManager,
                      max_items: Number(e.target.value || 0),
                    })
                  }
                />
              </div>
              {renderEventMappings({
                connectorKey: 'veeam_enterprise_manager',
                title: 'Event mappings',
                helpText: 'Map Veeam Enterprise Manager sessions into findings.',
                mappings: veeamEnterpriseManager.event_mappings ?? [],
                onLoadDefaults: loadVeeamEnterpriseManagerDefaultMappings,
                onAdd: addVeeamEnterpriseManagerEventMapping,
                onUpdate: updateVeeamEnterpriseManagerEventMapping,
                onRemove: removeVeeamEnterpriseManagerEventMapping,
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t(
              'Loading Veeam Enterprise Manager settings...',
              'Loading Veeam Enterprise Manager settings...'
            )}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={saveVeeamEnterpriseManager}
              disabled={
                veeamEnterpriseManagerSaving ||
                !veeamEnterpriseManager ||
                Boolean(validateVeeamEnterpriseManager(veeamEnterpriseManager))
              }
            >
              {veeamEnterpriseManagerSaving ? 'Saving...' : 'Save Veeam Enterprise Manager settings'}
            </Button>
            <Button
              onClick={testVeeamEnterpriseManager}
              disabled={
                veeamEnterpriseManagerTesting ||
                !veeamEnterpriseManager ||
                Boolean(validateVeeamEnterpriseManager(veeamEnterpriseManager))
              }
            >
              {veeamEnterpriseManagerTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <Button
              onClick={debugVeeamEnterpriseManager}
              disabled={
                veeamEnterpriseManagerDebugging ||
                !veeamEnterpriseManager ||
                Boolean(validateVeeamEnterpriseManager(veeamEnterpriseManager))
              }
            >
              {veeamEnterpriseManagerDebugging ? 'Debugging...' : 'Debug fetch'}
            </Button>
            <DangerButton onClick={deleteVeeamEnterpriseManager} disabled={veeamEnterpriseManagerSaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {veeamEnterpriseManagerMessage ? (
              <span className="text-sm text-slate-50">{veeamEnterpriseManagerMessage}</span>
            ) : null}
          </div>
          {veeamEnterpriseManagerDebug ? (
            <div className="mt-4 rounded-md border border-[#274266] bg-[#0d1a2b] p-3 text-sm text-slate-50">
              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <div className="text-xs uppercase text-slate-300">{t('Backup sessions', 'Backup sessions')}</div>
                  <div>{t('Endpoint:', 'Endpoint:')} {veeamEnterpriseManagerDebug.backup_sessions.endpoint ?? 'n/a'}</div>
                  <div>{t('Status:', 'Status:')} {veeamEnterpriseManagerDebug.backup_sessions.status_code ?? 'n/a'}</div>
                  <div>{t('Count:', 'Count:')} {veeamEnterpriseManagerDebug.backup_sessions.count}</div>
                  {veeamEnterpriseManagerDebug.backup_sessions.error ? (
                    <div>{t('Error:', 'Error:')} {veeamEnterpriseManagerDebug.backup_sessions.error}</div>
                  ) : null}
                </div>
                <div>
                  <div className="text-xs uppercase text-slate-300">{t('Backup task sessions', 'Backup task sessions')}</div>
                  <div>{t('Endpoint:', 'Endpoint:')} {veeamEnterpriseManagerDebug.backup_task_sessions.endpoint ?? 'n/a'}</div>
                  <div>{t('Status:', 'Status:')} {veeamEnterpriseManagerDebug.backup_task_sessions.status_code ?? 'n/a'}</div>
                  <div>{t('Count:', 'Count:')} {veeamEnterpriseManagerDebug.backup_task_sessions.count}</div>
                  {veeamEnterpriseManagerDebug.backup_task_sessions.error ? (
                    <div>{t('Error:', 'Error:')} {veeamEnterpriseManagerDebug.backup_task_sessions.error}</div>
                  ) : null}
                </div>
                <div>
                  <div className="text-xs uppercase text-slate-300">{t('Restore sessions', 'Restore sessions')}</div>
                  <div>{t('Endpoint:', 'Endpoint:')} {veeamEnterpriseManagerDebug.restore_sessions.endpoint ?? 'n/a'}</div>
                  <div>{t('Status:', 'Status:')} {veeamEnterpriseManagerDebug.restore_sessions.status_code ?? 'n/a'}</div>
                  <div>{t('Count:', 'Count:')} {veeamEnterpriseManagerDebug.restore_sessions.count}</div>
                  {veeamEnterpriseManagerDebug.restore_sessions.error ? (
                    <div>{t('Error:', 'Error:')} {veeamEnterpriseManagerDebug.restore_sessions.error}</div>
                  ) : null}
                </div>
              </div>
              {veeamEnterpriseManagerDebug.normalized ? (
                <div className="mt-3">
                  <div className="text-xs uppercase text-slate-300">{t('Normalized', 'Normalized')}</div>
                  <div className="mt-1 grid gap-2 text-xs text-slate-200 md:grid-cols-3">
                    <div>{t('resilience_signals:', 'resilience_signals:')} {veeamEnterpriseManagerDebug.normalized.resilience_signals}</div>
                    <div>{t('recovery_jobs:', 'recovery_jobs:')} {veeamEnterpriseManagerDebug.normalized.recovery_jobs}</div>
                    <div>{t('task_sessions:', 'task_sessions:')} {veeamEnterpriseManagerDebug.normalized.task_sessions}</div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}
      {selectedConnector === 'github' ? (
        <Card>
          <Label>{t('GitHub settings', 'GitHub settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure GitHub API access and repository scope (comma or newline separated).',
              'Configure GitHub API access and repository scope (comma or newline separated).'
            )}
          </p>
          {github ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Base URL', 'Base URL')}</Label>
                  <HelpTip text={'GitHub API base URL. Example: https://api.github.com'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={github.base_url ?? ''}
                  onChange={(e) => setGithub({ ...github, base_url: e.target.value })}
                  placeholder="https://api.github.com"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Token', 'Token')}</Label>
                  <HelpTip text={'Personal access token with repo + security_events scopes.'} />
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={github.token ?? ''}
                  onChange={(e) => setGithub({ ...github, token: e.target.value })}
                  placeholder={t('ghp_...', 'ghp_...')}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Repositories', 'Repositories')}</Label>
                  <HelpTip text={'owner/repo list separated by commas or new lines.'} />
                </div>
                <textarea
                  className="min-h-[96px] w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={githubRepositories}
                  onChange={(e) => setGithubRepositories(e.target.value)}
                  placeholder={t('acme/app, acme/platform', 'acme/app, acme/platform')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Verify TLS', 'Verify TLS')}</Label>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={github.verify_tls ?? true}
                    onChange={(e) => setGithub({ ...github, verify_tls: e.target.checked })}
                  />
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Pull requests', 'Pull requests')}</Label>
                  <HelpTip text={'Include pull request updates as change events.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={github.include_pull_requests ?? true}
                    onChange={(e) =>
                      setGithub({ ...github, include_pull_requests: e.target.checked })
                    }
                  />
                  {t('Include PRs', 'Include PRs')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Workflow runs', 'Workflow runs')}</Label>
                  <HelpTip text={'Include GitHub Actions workflow runs.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={github.include_workflows ?? true}
                    onChange={(e) => setGithub({ ...github, include_workflows: e.target.checked })}
                  />
                  {t('Include workflows', 'Include workflows')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Security alerts', 'Security alerts')}</Label>
                  <HelpTip text={'Include code scanning and Dependabot alerts.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={github.include_security_alerts ?? false}
                    onChange={(e) =>
                      setGithub({ ...github, include_security_alerts: e.target.checked })
                    }
                  />
                  {t('Include alerts', 'Include alerts')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Lookback days', 'Lookback days')}</Label>
                  <HelpTip text={'Limit items to recent updates.'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={github.lookback_days ?? 30}
                  onChange={(e) => setGithub({ ...github, lookback_days: Number(e.target.value || 0) })}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Max items', 'Max items')}</Label>
                  <HelpTip text={'Maximum items per endpoint.'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={github.max_items ?? 200}
                  onChange={(e) => setGithub({ ...github, max_items: Number(e.target.value || 0) })}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('Loading GitHub settings...', 'Loading GitHub settings...')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={saveGithub}
              disabled={githubSaving || !github || Boolean(validateGitHub(github))}
            >
              {githubSaving ? 'Saving...' : 'Save GitHub settings'}
            </Button>
            <Button
              onClick={testGithub}
              disabled={githubTesting || !github || Boolean(validateGitHub(github))}
            >
              {githubTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <DangerButton onClick={deleteGithub} disabled={githubSaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {githubMessage ? <span className="text-sm text-slate-50">{githubMessage}</span> : null}
          </div>
        </Card>
      ) : null}
      {selectedConnector === 'gitlab' ? (
        <Card>
          <Label>{t('GitLab settings', 'GitLab settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure GitLab API access and projects (comma or newline separated).',
              'Configure GitLab API access and projects (comma or newline separated).'
            )}
          </p>
          {gitlab ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Base URL', 'Base URL')}</Label>
                  <HelpTip text={'GitLab API base URL. Example: https://gitlab.com/api/v4'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={gitlab.base_url ?? ''}
                  onChange={(e) => setGitlab({ ...gitlab, base_url: e.target.value })}
                  placeholder="https://gitlab.com/api/v4"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Token', 'Token')}</Label>
                  <HelpTip text={'GitLab personal access token with read_api scope.'} />
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={gitlab.token ?? ''}
                  onChange={(e) => setGitlab({ ...gitlab, token: e.target.value })}
                  placeholder={t('glpat-...', 'glpat-...')}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Projects', 'Projects')}</Label>
                  <HelpTip text={'Group/project paths separated by commas or new lines.'} />
                </div>
                <textarea
                  className="min-h-[96px] w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={gitlabProjects}
                  onChange={(e) => setGitlabProjects(e.target.value)}
                  placeholder={t('group/app, group/platform', 'group/app, group/platform')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Verify TLS', 'Verify TLS')}</Label>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={gitlab.verify_tls ?? true}
                    onChange={(e) => setGitlab({ ...gitlab, verify_tls: e.target.checked })}
                  />
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Merge requests', 'Merge requests')}</Label>
                  <HelpTip text={'Include merge request updates as change events.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={gitlab.include_merge_requests ?? true}
                    onChange={(e) =>
                      setGitlab({ ...gitlab, include_merge_requests: e.target.checked })
                    }
                  />
                  {t('Include MRs', 'Include MRs')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Pipelines', 'Pipelines')}</Label>
                  <HelpTip text={'Include pipeline runs for resilience signals.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={gitlab.include_pipelines ?? true}
                    onChange={(e) => setGitlab({ ...gitlab, include_pipelines: e.target.checked })}
                  />
                  {t('Include pipelines', 'Include pipelines')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Vulnerabilities', 'Vulnerabilities')}</Label>
                  <HelpTip text={'Include GitLab security findings.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={gitlab.include_vulnerabilities ?? false}
                    onChange={(e) =>
                      setGitlab({ ...gitlab, include_vulnerabilities: e.target.checked })
                    }
                  />
                  {t('Include vulnerabilities', 'Include vulnerabilities')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Lookback days', 'Lookback days')}</Label>
                  <HelpTip text={'Limit items to recent updates.'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={gitlab.lookback_days ?? 30}
                  onChange={(e) => setGitlab({ ...gitlab, lookback_days: Number(e.target.value || 0) })}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Max items', 'Max items')}</Label>
                  <HelpTip text={'Maximum items per endpoint.'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={gitlab.max_items ?? 200}
                  onChange={(e) => setGitlab({ ...gitlab, max_items: Number(e.target.value || 0) })}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('Loading GitLab settings...', 'Loading GitLab settings...')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={saveGitlab}
              disabled={gitlabSaving || !gitlab || Boolean(validateGitLab(gitlab))}
            >
              {gitlabSaving ? 'Saving...' : 'Save GitLab settings'}
            </Button>
            <Button
              onClick={testGitlab}
              disabled={gitlabTesting || !gitlab || Boolean(validateGitLab(gitlab))}
            >
              {gitlabTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <DangerButton onClick={deleteGitlab} disabled={gitlabSaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {gitlabMessage ? <span className="text-sm text-slate-50">{gitlabMessage}</span> : null}
          </div>
        </Card>
      ) : null}
      {selectedConnector === 'bamboohr' ? (
        <Card>
          <Label>{t('BambooHR settings', 'BambooHR settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure BambooHR API access to ingest employee directory data.',
              'Configure BambooHR API access to ingest employee directory data.'
            )}
          </p>
          {bambooHr ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Base URL', 'Base URL')}</Label>
                  <HelpTip text={'BambooHR base URL. Example: https://acme.bamboohr.com'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={bambooHr.base_url ?? ''}
                  onChange={(e) => setBambooHr({ ...bambooHr, base_url: e.target.value })}
                  placeholder="https://acme.bamboohr.com"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('API key', 'API key')}</Label>
                  <HelpTip text={'BambooHR API key (Basic auth username).' } />
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={bambooHr.api_key ?? ''}
                  onChange={(e) => setBambooHr({ ...bambooHr, api_key: e.target.value })}
                  placeholder="api-key"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Verify TLS', 'Verify TLS')}</Label>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={bambooHr.verify_tls ?? true}
                    onChange={(e) => setBambooHr({ ...bambooHr, verify_tls: e.target.checked })}
                  />
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Max items', 'Max items')}</Label>
                  <HelpTip text={'Maximum employees to fetch.'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={bambooHr.max_items ?? 200}
                  onChange={(e) => setBambooHr({ ...bambooHr, max_items: Number(e.target.value || 0) })}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('Loading BambooHR settings...', 'Loading BambooHR settings...')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={saveBambooHr}
              disabled={bambooHrSaving || !bambooHr || Boolean(validateBambooHr(bambooHr))}
            >
              {bambooHrSaving ? 'Saving...' : 'Save BambooHR settings'}
            </Button>
            <Button
              onClick={testBambooHr}
              disabled={bambooHrTesting || !bambooHr || Boolean(validateBambooHr(bambooHr))}
            >
              {bambooHrTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <DangerButton onClick={deleteBambooHr} disabled={bambooHrSaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {bambooHrMessage ? <span className="text-sm text-slate-50">{bambooHrMessage}</span> : null}
          </div>
        </Card>
      ) : null}
      {selectedConnector === 'workday' ? (
        <Card>
          <Label>{t('Workday settings', 'Workday settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure Workday Report-as-a-Service access to ingest employee data.',
              'Configure Workday Report-as-a-Service access to ingest employee data.'
            )}
          </p>
          {workday ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Base URL', 'Base URL')}</Label>
                  <HelpTip text={'Workday tenant base URL. Example: https://wd5.myworkday.com'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={workday.base_url ?? ''}
                  onChange={(e) => setWorkday({ ...workday, base_url: e.target.value })}
                  placeholder="https://wd5.myworkday.com"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Report path', 'Report path')}</Label>
                  <HelpTip text={'Report path or full URL for Workday RaaS.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={workday.report_path ?? ''}
                  onChange={(e) => setWorkday({ ...workday, report_path: e.target.value })}
                  placeholder={t(
                    'ccx/service/customreport/tenant/report?format=json',
                    'ccx/service/customreport/tenant/report?format=json'
                  )}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Username', 'Username')}</Label>
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={workday.username ?? ''}
                  onChange={(e) => setWorkday({ ...workday, username: e.target.value })}
                  placeholder={t('integration.user', 'integration.user')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Password', 'Password')}</Label>
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={workday.password ?? ''}
                  onChange={(e) => setWorkday({ ...workday, password: e.target.value })}
                  placeholder="password"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Verify TLS', 'Verify TLS')}</Label>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={workday.verify_tls ?? true}
                    onChange={(e) => setWorkday({ ...workday, verify_tls: e.target.checked })}
                  />
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Max items', 'Max items')}</Label>
                  <HelpTip text={'Maximum employees to fetch.'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={workday.max_items ?? 200}
                  onChange={(e) => setWorkday({ ...workday, max_items: Number(e.target.value || 0) })}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('Loading Workday settings...', 'Loading Workday settings...')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={saveWorkday}
              disabled={workdaySaving || !workday || Boolean(validateWorkday(workday))}
            >
              {workdaySaving ? 'Saving...' : 'Save Workday settings'}
            </Button>
            <Button
              onClick={testWorkday}
              disabled={workdayTesting || !workday || Boolean(validateWorkday(workday))}
            >
              {workdayTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <DangerButton onClick={deleteWorkday} disabled={workdaySaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {workdayMessage ? <span className="text-sm text-slate-50">{workdayMessage}</span> : null}
          </div>
        </Card>
      ) : null}
      {selectedConnector === 'jira' ? (
        <Card>
          <Label>{t('Jira settings', 'Jira settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure Jira API access to ingest issues as change or security events.',
              'Configure Jira API access to ingest issues as change or security events.'
            )}
          </p>
          {jira ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Base URL', 'Base URL')}</Label>
                  <HelpTip text={'Jira site URL. Example: https://acme.atlassian.net'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={jira.base_url ?? ''}
                  onChange={(e) => setJira({ ...jira, base_url: e.target.value })}
                  placeholder="https://acme.atlassian.net"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Username', 'Username')}</Label>
                  <HelpTip text={'Jira account email or username.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={jira.username ?? ''}
                  onChange={(e) => setJira({ ...jira, username: e.target.value })}
                  placeholder={t('user@example.com', 'user@example.com')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('API token', 'API token')}</Label>
                  <HelpTip text={'Atlassian API token (preferred).' } />
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={jira.api_token ?? ''}
                  onChange={(e) => setJira({ ...jira, api_token: e.target.value })}
                  placeholder="api-token"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Password', 'Password')}</Label>
                  <HelpTip text={'Optional basic auth password if no API token.'} />
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={jira.password ?? ''}
                  onChange={(e) => setJira({ ...jira, password: e.target.value })}
                  placeholder="password"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('API version', 'API version')}</Label>
                  <HelpTip text={'Jira REST API version (2 or 3).'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={jira.api_version ?? '3'}
                  onChange={(e) => setJira({ ...jira, api_version: e.target.value })}
                  placeholder="3"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Projects', 'Projects')}</Label>
                  <HelpTip text={'Project keys separated by commas or new lines (optional).'} />
                </div>
                <textarea
                  className="min-h-[96px] w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={jiraProjects}
                  onChange={(e) => setJiraProjects(e.target.value)}
                  placeholder={t('SEC, OPS', 'SEC, OPS')}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>JQL</Label>
                  <HelpTip text={'Optional JQL override for issue selection.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={jira.jql ?? ''}
                  onChange={(e) => setJira({ ...jira, jql: e.target.value })}
                  placeholder={t(
                    'project in (SEC) order by updated desc',
                    'project in (SEC) order by updated desc'
                  )}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Verify TLS', 'Verify TLS')}</Label>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={jira.verify_tls ?? true}
                    onChange={(e) => setJira({ ...jira, verify_tls: e.target.checked })}
                  />
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Include change issues', 'Include change issues')}</Label>
                  <HelpTip text={'Add change events for non-security issues.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={jira.include_changes ?? true}
                    onChange={(e) => setJira({ ...jira, include_changes: e.target.checked })}
                  />
                  {t('Include change issues', 'Include change issues')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Include security issues', 'Include security issues')}</Label>
                  <HelpTip text={'Add security events for incident/security issues.'} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={jira.include_security ?? true}
                    onChange={(e) => setJira({ ...jira, include_security: e.target.checked })}
                  />
                  {t('Include security issues', 'Include security issues')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Max items', 'Max items')}</Label>
                  <HelpTip text={'Maximum issues to fetch per run.'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={jira.max_items ?? 200}
                  onChange={(e) => setJira({ ...jira, max_items: Number(e.target.value || 0) })}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('Loading Jira settings...', 'Loading Jira settings...')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={saveJira} disabled={jiraSaving || !jira || Boolean(validateJira(jira))}>
              {jiraSaving ? 'Saving...' : 'Save Jira settings'}
            </Button>
            <Button onClick={testJira} disabled={jiraTesting || !jira || Boolean(validateJira(jira))}>
              {jiraTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <DangerButton onClick={deleteJira} disabled={jiraSaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {jiraMessage ? <span className="text-sm text-slate-50">{jiraMessage}</span> : null}
          </div>
        </Card>
      ) : null}
      {selectedConnector === 'aws_posture' ? (
        <Card>
          <Label>{t('AWS posture settings', 'AWS posture settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure AWS Security Hub access to ingest posture findings.',
              'Configure AWS Security Hub access to ingest posture findings.'
            )}
          </p>
          {awsPosture ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <AssetSelect
                value={awsPosture.asset_id}
                onChange={(value) => setAwsPosture({ ...awsPosture, asset_id: value })}
                helpText="Required. Bind this connector to an inventory asset."
              />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Region', 'Region')}</Label>
                  <HelpTip text={'AWS region where Security Hub is enabled.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={awsPosture.region ?? ''}
                  onChange={(e) => setAwsPosture({ ...awsPosture, region: e.target.value })}
                  placeholder="us-east-1"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Access key', 'Access key')}</Label>
                  <HelpTip text={'Optional. Leave blank to use IAM role credentials.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={awsPosture.access_key ?? ''}
                  onChange={(e) => setAwsPosture({ ...awsPosture, access_key: e.target.value })}
                  placeholder={t('AKIA...', 'AKIA...')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Secret key', 'Secret key')}</Label>
                  <HelpTip text={'Optional. Required if access key is set.'} />
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={awsPosture.secret_key ?? ''}
                  onChange={(e) => setAwsPosture({ ...awsPosture, secret_key: e.target.value })}
                  placeholder="secret"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Session token', 'Session token')}</Label>
                  <HelpTip text={'Optional session token for temporary credentials.'} />
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={awsPosture.session_token ?? ''}
                  onChange={(e) => setAwsPosture({ ...awsPosture, session_token: e.target.value })}
                  placeholder="session-token"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Max items', 'Max items')}</Label>
                  <HelpTip text={'Maximum findings to fetch.'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={awsPosture.max_items ?? 200}
                  onChange={(e) => setAwsPosture({ ...awsPosture, max_items: Number(e.target.value || 0) })}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('Loading AWS posture settings...', 'Loading AWS posture settings...')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={saveAwsPosture}
              disabled={awsPostureSaving || !awsPosture || Boolean(validateAwsPosture(awsPosture))}
            >
              {awsPostureSaving ? 'Saving...' : 'Save AWS posture settings'}
            </Button>
            <Button
              onClick={testAwsPosture}
              disabled={awsPostureTesting || !awsPosture || Boolean(validateAwsPosture(awsPosture))}
            >
              {awsPostureTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <DangerButton onClick={deleteAwsPosture} disabled={awsPostureSaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {awsPostureMessage ? <span className="text-sm text-slate-50">{awsPostureMessage}</span> : null}
          </div>
        </Card>
      ) : null}
      {selectedConnector === 'azure_posture' ? (
        <Card>
          <Label>{t('Azure posture settings', 'Azure posture settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure Defender for Cloud access to ingest assessment posture signals.',
              'Configure Defender for Cloud access to ingest assessment posture signals.'
            )}
          </p>
          {azurePosture ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <AssetSelect
                value={azurePosture.asset_id}
                onChange={(value) => setAzurePosture({ ...azurePosture, asset_id: value })}
                helpText="Required. Bind this connector to an inventory asset."
              />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Tenant ID', 'Tenant ID')}</Label>
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={azurePosture.tenant_id ?? ''}
                  onChange={(e) => setAzurePosture({ ...azurePosture, tenant_id: e.target.value })}
                  placeholder="tenant-id"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Client ID', 'Client ID')}</Label>
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={azurePosture.client_id ?? ''}
                  onChange={(e) => setAzurePosture({ ...azurePosture, client_id: e.target.value })}
                  placeholder="client-id"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Client secret', 'Client secret')}</Label>
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={azurePosture.client_secret ?? ''}
                  onChange={(e) => setAzurePosture({ ...azurePosture, client_secret: e.target.value })}
                  placeholder="secret"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Subscription ID', 'Subscription ID')}</Label>
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={azurePosture.subscription_id ?? ''}
                  onChange={(e) =>
                    setAzurePosture({ ...azurePosture, subscription_id: e.target.value })
                  }
                  placeholder="subscription-id"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Verify TLS', 'Verify TLS')}</Label>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={azurePosture.verify_tls ?? true}
                    onChange={(e) =>
                      setAzurePosture({ ...azurePosture, verify_tls: e.target.checked })
                    }
                  />
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Max items', 'Max items')}</Label>
                  <HelpTip text={'Maximum assessments to fetch.'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={azurePosture.max_items ?? 200}
                  onChange={(e) =>
                    setAzurePosture({ ...azurePosture, max_items: Number(e.target.value || 0) })
                  }
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('Loading Azure posture settings...', 'Loading Azure posture settings...')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={saveAzurePosture}
              disabled={azurePostureSaving || !azurePosture || Boolean(validateAzurePosture(azurePosture))}
            >
              {azurePostureSaving ? 'Saving...' : 'Save Azure posture settings'}
            </Button>
            <Button
              onClick={testAzurePosture}
              disabled={azurePostureTesting || !azurePosture || Boolean(validateAzurePosture(azurePosture))}
            >
              {azurePostureTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <DangerButton onClick={deleteAzurePosture} disabled={azurePostureSaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {azurePostureMessage ? <span className="text-sm text-slate-50">{azurePostureMessage}</span> : null}
          </div>
        </Card>
      ) : null}
      {selectedConnector === 'gcp_posture' ? (
        <Card>
          <Label>{t('GCP posture settings', 'GCP posture settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure Security Command Center access to ingest posture findings.',
              'Configure Security Command Center access to ingest posture findings.'
            )}
          </p>
          {gcpPosture ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <AssetSelect
                value={gcpPosture.asset_id}
                onChange={(value) => setGcpPosture({ ...gcpPosture, asset_id: value })}
                helpText="Required. Bind this connector to an inventory asset."
              />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Organization ID', 'Organization ID')}</Label>
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={gcpPosture.organization_id ?? ''}
                  onChange={(e) => setGcpPosture({ ...gcpPosture, organization_id: e.target.value })}
                  placeholder="123456789012"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Access token', 'Access token')}</Label>
                  <HelpTip text={'OAuth access token for Security Command Center.'} />
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={gcpPosture.access_token ?? ''}
                  onChange={(e) => setGcpPosture({ ...gcpPosture, access_token: e.target.value })}
                  placeholder={t('ya29...', 'ya29...')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Verify TLS', 'Verify TLS')}</Label>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-50">
                  <input
                    type="checkbox"
                    checked={gcpPosture.verify_tls ?? true}
                    onChange={(e) => setGcpPosture({ ...gcpPosture, verify_tls: e.target.checked })}
                  />
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Max items', 'Max items')}</Label>
                  <HelpTip text={'Maximum findings to fetch.'} />
                </div>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={gcpPosture.max_items ?? 200}
                  onChange={(e) =>
                    setGcpPosture({ ...gcpPosture, max_items: Number(e.target.value || 0) })
                  }
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('Loading GCP posture settings...', 'Loading GCP posture settings...')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={saveGcpPosture}
              disabled={gcpPostureSaving || !gcpPosture || Boolean(validateGcpPosture(gcpPosture))}
            >
              {gcpPostureSaving ? 'Saving...' : 'Save GCP posture settings'}
            </Button>
            <Button
              onClick={testGcpPosture}
              disabled={gcpPostureTesting || !gcpPosture || Boolean(validateGcpPosture(gcpPosture))}
            >
              {gcpPostureTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <DangerButton onClick={deleteGcpPosture} disabled={gcpPostureSaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {gcpPostureMessage ? <span className="text-sm text-slate-50">{gcpPostureMessage}</span> : null}
          </div>
        </Card>
      ) : null}
      {selectedConnector === 'glpi' ? (
        <Card>
          <Label>{t('GLPI settings', 'GLPI settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure GLPI credentials for the selected connector.',
              'Configure GLPI credentials for the selected connector.'
            )}
          </p>
          {glpi ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Base URL', 'Base URL')}</Label>
                  <HelpTip text={'GLPI API base URL including /apirest.php.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={glpi.base_url ?? ''}
                  onChange={(e) => setGlpi({ ...glpi, base_url: e.target.value })}
                  placeholder="https://glpi.example.com/apirest.php"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('App token', 'App token')}</Label>
                  <HelpTip text={'GLPI application token for API access.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={glpi.app_token ?? ''}
                  onChange={(e) => setGlpi({ ...glpi, app_token: e.target.value })}
                  placeholder="app-token"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('User token', 'User token')}</Label>
                  <HelpTip text={'GLPI user token with asset read permissions.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={glpi.user_token ?? ''}
                  onChange={(e) => setGlpi({ ...glpi, user_token: e.target.value })}
                  placeholder="user-token"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Server endpoint', 'Server endpoint')}</Label>
                  <HelpTip text={'GLPI item type for servers. Example: Server.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={glpi.server_endpoint ?? ''}
                  onChange={(e) => setGlpi({ ...glpi, server_endpoint: e.target.value })}
                  placeholder={t('Server', 'Server')}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Asset name filter', 'Asset name filter')}</Label>
                  <HelpTip text={'Optional. Comma-separated name fragments to include.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={glpi.asset_name_filter ?? ''}
                  onChange={(e) => setGlpi({ ...glpi, asset_name_filter: e.target.value })}
                  placeholder={t('db-, core-, firewall', 'db-, core-, firewall')}
                />
              </div>
              <div className="space-y-3 md:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Label>{t('Asset endpoints', 'Asset endpoints')}</Label>
                      <HelpTip text={'Define which GLPI item types to ingest as assets.'} />
                    </div>
                    <Button onClick={addGlpiAssetEndpoint}>{t('Add endpoint', 'Add endpoint')}</Button>
                  </div>
                  <div className="grid gap-3">
                    {(glpi.asset_endpoints ?? []).map((endpoint, index) => {
                      const {
                        t
                      } = useI18n();

                      return (
                        <div
                          key={`glpi-endpoint-${index}`}
                          className="grid gap-3 rounded-lg border border-[#274266] p-3 md:grid-cols-3"
                        >
                          <div className="space-y-2">
                            <Label>{t('Endpoint', 'Endpoint')}</Label>
                            <input
                              className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                              value={endpoint.endpoint ?? ''}
                              onChange={(e) => updateGlpiAssetEndpoint(index, { endpoint: e.target.value })}
                              placeholder={t('Computer', 'Computer')}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t('Asset type', 'Asset type')}</Label>
                            <input
                              className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                              value={endpoint.asset_type ?? ''}
                              onChange={(e) => updateGlpiAssetEndpoint(index, { asset_type: e.target.value })}
                              placeholder="network_device"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t('Tag', 'Tag')}</Label>
                            <input
                              className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                              value={endpoint.tag ?? ''}
                              onChange={(e) => updateGlpiAssetEndpoint(index, { tag: e.target.value })}
                              placeholder="network"
                            />
                          </div>
                          <div className="md:col-span-3">
                            <div className="flex justify-end">
                              <Button onClick={() => removeGlpiAssetEndpoint(index)}>{t('Remove', 'Remove')}</Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {!(glpi.asset_endpoints ?? []).length ? (
                      <p className="text-sm text-slate-50">
                        {t(
                          'No asset endpoints configured. Add at least one GLPI item type to ingest.',
                          'No asset endpoints configured. Add at least one GLPI item type to ingest.'
                        )}
                      </p>
                    ) : null}
                  </div>
                </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Evidence types', 'Evidence types')}</Label>
                  <HelpTip text={'Enable optional ITSM evidence ingestion (changes and/or tickets).'} />
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-50">
                    <input
                      type="checkbox"
                      checked={glpi.include_changes ?? true}
                      onChange={(e) => setGlpi({ ...glpi, include_changes: e.target.checked })}
                    />
                    {t('Include Changes (as change events)', 'Include Changes (as change events)')}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-50">
                    <input
                      type="checkbox"
                      checked={glpi.include_tickets ?? false}
                      onChange={(e) => setGlpi({ ...glpi, include_tickets: e.target.checked })}
                    />
                    {t('Include Tickets (as incidents)', 'Include Tickets (as incidents)')}
                  </label>
                </div>
              </div>
              {renderEventMappings({
                connectorKey: 'glpi',
                title: 'Event mappings',
                helpText: 'Map GLPI changes and tickets into findings.',
                mappings: glpi.event_mappings ?? [],
                onAdd: addGlpiEventMapping,
                onUpdate: updateGlpiEventMapping,
                onRemove: removeGlpiEventMapping,
              })}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Page size', 'Page size')}</Label>
                  <HelpTip text={'Batch size for API pagination. Example: 200.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={glpi.page_size ?? 200}
                  onChange={(e) => setGlpi({ ...glpi, page_size: Number(e.target.value) || 0 })}
                  placeholder="200"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Max pages', 'Max pages')}</Label>
                  <HelpTip text={'Max pages to fetch per run. Example: 10.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={glpi.max_pages ?? 10}
                  onChange={(e) => setGlpi({ ...glpi, max_pages: Number(e.target.value) || 0 })}
                  placeholder="10"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-50">
                <input
                  type="checkbox"
                  checked={glpi.verify_tls ?? true}
                  onChange={(e) => setGlpi({ ...glpi, verify_tls: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                />
                <span className="flex items-center gap-2">
                  {t('Verify TLS certificates', 'Verify TLS certificates')}
                  <HelpTip text={'Disable only for self-signed lab instances.'} />
                </span>
              </label>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('Loading GLPI settings...', 'Loading GLPI settings...')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={saveGlpi}
              disabled={glpiSaving || !glpi || Boolean(validateGlpi(glpi))}
            >
              {glpiSaving ? 'Saving...' : 'Save GLPI settings'}
            </Button>
            <Button
              onClick={testGlpi}
              disabled={glpiTesting || !glpi || Boolean(validateGlpi(glpi))}
            >
              {glpiTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <DangerButton onClick={deleteGlpi} disabled={glpiSaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {glpiMessage ? <span className="text-sm text-slate-50">{glpiMessage}</span> : null}
          </div>
        </Card>
      ) : null}
      {selectedConnector === 'service_now' ? (
        <Card>
          <Label>{t('ServiceNow settings', 'ServiceNow settings')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure ServiceNow CMDB credentials and tables (comma-separated).',
              'Configure ServiceNow CMDB credentials and tables (comma-separated).'
            )}
          </p>
          {serviceNow ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Instance', 'Instance')}</Label>
                  <HelpTip text={'ServiceNow instance name (subdomain). Example: acme.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={serviceNow.instance ?? ''}
                  onChange={(e) => setServiceNow({ ...serviceNow, instance: e.target.value })}
                  placeholder="your-instance"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Username', 'Username')}</Label>
                  <HelpTip text={'ServiceNow user with CMDB read access.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={serviceNow.username ?? ''}
                  onChange={(e) => setServiceNow({ ...serviceNow, username: e.target.value })}
                  placeholder="username"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Password', 'Password')}</Label>
                  <HelpTip text={'ServiceNow password or API token.'} />
                </div>
                <input
                  type="password"
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={serviceNow.password ?? ''}
                  onChange={(e) => setServiceNow({ ...serviceNow, password: e.target.value })}
                  placeholder="password"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Tables', 'Tables')}</Label>
                  <HelpTip text={'Comma-separated CMDB tables. Example: cmdb_ci, cmdb_ci_server.'} />
                </div>
                <input
                  className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                  value={serviceNowTables}
                  onChange={(e) => setServiceNowTables(e.target.value)}
                  placeholder={t(
                    'cmdb_ci, cmdb_ci_server, cmdb_ci_network, cmdb_ci_appl',
                    'cmdb_ci, cmdb_ci_server, cmdb_ci_network, cmdb_ci_appl'
                  )}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('Loading ServiceNow settings...', 'Loading ServiceNow settings...')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={saveServiceNow}
              disabled={serviceNowSaving || !serviceNow || Boolean(validateServiceNow(serviceNow))}
            >
              {serviceNowSaving ? 'Saving...' : 'Save ServiceNow settings'}
            </Button>
            <DangerButton onClick={deleteServiceNow} disabled={serviceNowSaving}>
              {t('Delete configuration', 'Delete configuration')}
            </DangerButton>
            {serviceNowMessage ? <span className="text-sm text-slate-50">{serviceNowMessage}</span> : null}
          </div>
        </Card>
      ) : null}
      {selectedConnector === 'palo_alto' ? (
        <Card>
          <Label>{t('Palo Alto (PAN-OS) instances', 'Palo Alto (PAN-OS) instances')}</Label>
          <p className="mt-2 text-sm text-slate-50">
            {t(
              'Configure one or more Palo Alto firewall pairs. Use one cluster per active/passive pair.',
              'Configure one or more Palo Alto firewall pairs. Use one cluster per active/passive pair.'
            )}
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>{t('Instance', 'Instance')}</Label>
              <select
                className="rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                value={paloAltoSelected}
                onChange={(e) => setPaloAltoSelected(e.target.value)}
              >
                <option value="">{t('Select instance...', 'Select instance...')}</option>
                {paloAltoConfigs.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t('New instance name', 'New instance name')}</Label>
              <input
                className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                value={paloAltoNewName}
                onChange={(e) => setPaloAltoNewName(e.target.value)}
                placeholder="pa-edge-a"
              />
            </div>
            <Button onClick={addPaloAltoInstance}>{t('Add instance', 'Add instance')}</Button>
          </div>
          {currentPaloAlto ? (
            <div key={`palo-alto-editor-${currentPaloAlto.name}`} className="mt-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('Instance name', 'Instance name')}</Label>
                  <input
                    className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                    value={currentPaloAlto.name}
                    readOnly
                    autoComplete="off"
                  />
                </div>
                <AssetSelect
                  value={currentPaloAlto.asset_id}
                  onChange={(value) =>
                    updatePaloAltoInstance(currentPaloAlto.name, { asset_id: value })
                  }
                  helpText="Optional if each cluster node is bound below; used as the default asset for all nodes."
                />
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>{t('Auth mode', 'Auth mode')}</Label>
                    <HelpTip text={'Choose API key or username/password for PAN-OS.'} />
                  </div>
                  <select
                    className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                    value={currentPaloAlto.auth_mode ?? 'api_key'}
                    autoComplete="off"
                    onChange={(e) =>
                      updatePaloAltoInstance(currentPaloAlto.name, {
                        auth_mode: e.target.value as PaloAltoAuthMode,
                      })
                    }
                  >
                    <option value="api_key">{t('API key', 'API key')}</option>
                    <option value="password">{t('Username + password', 'Username + password')}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>{t('Verify TLS', 'Verify TLS')}</Label>
                    <HelpTip text={'Validate firewall TLS certificates.'} />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-50">
                    <input
                      type="checkbox"
                      checked={currentPaloAlto.verify_tls ?? true}
                      onChange={(e) =>
                        updatePaloAltoInstance(currentPaloAlto.name, { verify_tls: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                    />
                    <span>{t('Validate firewall certificates', 'Validate firewall certificates')}</span>
                  </label>
                </div>
                {currentPaloAlto.auth_mode === 'api_key' ? (
                  <div className="space-y-2 md:col-span-2">
                    <div className="flex items-center gap-2">
                      <Label>{t('API key', 'API key')}</Label>
                      <HelpTip text={'PAN-OS API key generated on the firewall.'} />
                    </div>
                    <input
                      className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                      value={currentPaloAlto.api_key ?? ''}
                      autoComplete="new-password"
                      onChange={(e) =>
                        updatePaloAltoInstance(currentPaloAlto.name, { api_key: e.target.value })
                      }
                      placeholder={t('key...', 'key...')}
                    />
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label>{t('Username', 'Username')}</Label>
                        <HelpTip text={'PAN-OS admin username.'} />
                      </div>
                      <input
                        className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                        value={currentPaloAlto.username ?? ''}
                        autoComplete="off"
                        onChange={(e) =>
                          updatePaloAltoInstance(currentPaloAlto.name, { username: e.target.value })
                        }
                        placeholder="admin"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label>{t('Password', 'Password')}</Label>
                        <HelpTip text={'PAN-OS admin password.'} />
                      </div>
                      <input
                        type="password"
                        className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                        value={currentPaloAlto.password ?? ''}
                        autoComplete="new-password"
                        onChange={(e) =>
                          updatePaloAltoInstance(currentPaloAlto.name, { password: e.target.value })
                        }
                        placeholder="password"
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>{t('Log collection', 'Log collection')}</Label>
                  <HelpTip text={'Control which PAN-OS logs are pulled for maintenance and HA history.'} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm text-slate-50">
                    <input
                      type="checkbox"
                      checked={currentPaloAlto.ha_only_logs ?? true}
                      onChange={(e) =>
                        updatePaloAltoInstance(currentPaloAlto.name, {
                          ha_only_logs: e.target.checked,
                        })
                      }
                    />
                    {t(
                      'HA-only query first (auto fallback to broader query)',
                      'HA-only query first (auto fallback to broader query)'
                    )}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-50">
                    <input
                      type="checkbox"
                      checked={currentPaloAlto.include_system_logs ?? true}
                      onChange={(e) =>
                        updatePaloAltoInstance(currentPaloAlto.name, {
                          include_system_logs: e.target.checked,
                        })
                      }
                    />
                    {t('Include system logs', 'Include system logs')}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-50">
                    <input
                      type="checkbox"
                      checked={currentPaloAlto.include_config_logs ?? true}
                      onChange={(e) =>
                        updatePaloAltoInstance(currentPaloAlto.name, {
                          include_config_logs: e.target.checked,
                        })
                      }
                    />
                    {t('Include config logs', 'Include config logs')}
                  </label>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label>{t('Max log entries', 'Max log entries')}</Label>
                      <HelpTip text={'Maximum log entries to fetch per node.'} />
                    </div>
                    <input
                      type="number"
                      min={1}
                      className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                      value={currentPaloAlto.log_max ?? 200}
                      autoComplete="off"
                      onChange={(e) =>
                        updatePaloAltoInstance(currentPaloAlto.name, {
                          log_max: Number(e.target.value || 0),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label>{t('History window (hours)', 'History window (hours)')}</Label>
                      <HelpTip text={'Ignore log entries older than this window.'} />
                    </div>
                    <input
                      type="number"
                      min={0}
                      className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                      value={currentPaloAlto.log_since_hours ?? 168}
                      autoComplete="off"
                      onChange={(e) =>
                        updatePaloAltoInstance(currentPaloAlto.name, {
                          log_since_hours: Number(e.target.value || 0),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label>{t('Log since time (optional)', 'Log since time (optional)')}</Label>
                      <HelpTip text={'Override history window with a specific start time. Format: YYYY-MM-DD HH:MM:SS.'} />
                    </div>
                    <input
                      type="datetime-local"
                      className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                      value={currentPaloAlto.log_since_time ?? ''}
                      autoComplete="off"
                      onChange={(e) =>
                        updatePaloAltoInstance(currentPaloAlto.name, {
                          log_since_time: e.target.value,
                        })
                      }
                    />
                    <div className="text-xs text-slate-400">{t(
                      'Leave blank to use the history window.',
                      'Leave blank to use the history window.'
                    )}</div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label>{t('Clusters', 'Clusters')}</Label>
                    <HelpTip text={'Add one entry per active/passive firewall pair. Enter a management IP, hostname, or full URL.'} />
                  </div>
                  <Button onClick={addPaloAltoCluster}>{t('Add cluster', 'Add cluster')}</Button>
                </div>
                <div className="text-xs text-slate-300">
                  {t(
                    'Enter the PAN-OS management IP/hostname or full base URL. The collector calls the PAN-OS API endpoint at /api/.',
                    'Enter the PAN-OS management IP/hostname or full base URL. The collector calls the PAN-OS API endpoint at /api/.'
                  )}
                </div>
                {currentPaloAlto.clusters.length ? (
                  <div className="space-y-4">
                    {currentPaloAlto.clusters.map((cluster, index) => {
                      const {
                        t
                      } = useI18n();

                      return (
                        <div
                          key={`palo-alto-cluster-${currentPaloAlto.name}-${index}`}
                          className="rounded-lg border border-[#274266] p-3"
                        >
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Label>{t('Cluster name', 'Cluster name')}</Label>
                                <HelpTip text={'Friendly name for the firewall pair. Example: DC1-Edge.'} />
                              </div>
                              <input
                                className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                                value={cluster.name ?? ''}
                                autoComplete="off"
                                onChange={(e) => updatePaloAltoCluster(index, { name: e.target.value })}
                                placeholder={t('Primary DC', 'Primary DC')}
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Label>{t('Active firewall IP or URL', 'Active firewall IP or URL')}</Label>
                                <HelpTip text={'Management IP, hostname, or URL for the active node. Plain IPs and hostnames use HTTPS.'} />
                              </div>
                              <input
                                className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                                value={cluster.active_url ?? ''}
                                autoComplete="off"
                                onChange={(e) => updatePaloAltoCluster(index, { active_url: e.target.value })}
                                placeholder="10.0.0.10 or https://fw-active.example.com"
                              />
                            </div>
                            <AssetSelect
                              value={cluster.active_asset_id}
                              label={t('Active node asset', 'Active node asset')}
                              helpText="Bind the active firewall to an inventory asset. Required if the instance asset is empty."
                              onChange={(value) =>
                                updatePaloAltoCluster(index, { active_asset_id: value })
                              }
                            />
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Label>{t('Passive firewall IP or URL', 'Passive firewall IP or URL')}</Label>
                                <HelpTip text={'Optional standby node management IP, hostname, or URL. Plain IPs and hostnames use HTTPS.'} />
                              </div>
                              <input
                                className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                                value={cluster.passive_url ?? ''}
                                autoComplete="off"
                                onChange={(e) => updatePaloAltoCluster(index, { passive_url: e.target.value })}
                                placeholder="10.0.0.11 or https://fw-passive.example.com"
                              />
                            </div>
                            <AssetSelect
                              value={cluster.passive_asset_id}
                              label={t('Passive node asset', 'Passive node asset')}
                              helpText="Bind the passive firewall to an inventory asset. Required if a passive URL is set and the instance asset is empty."
                              onChange={(value) =>
                                updatePaloAltoCluster(index, { passive_asset_id: value })
                              }
                            />
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Label>{t('Description', 'Description')}</Label>
                                <HelpTip text={'Short description for this firewall pair.'} />
                              </div>
                              <input
                                className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                                value={cluster.description ?? ''}
                                autoComplete="off"
                                onChange={(e) => updatePaloAltoCluster(index, { description: e.target.value })}
                                placeholder={t('Active/passive pair in DC1', 'Active/passive pair in DC1')}
                              />
                            </div>
                          </div>
                          <div className="mt-3 flex justify-end">
                            <Button onClick={() => removePaloAltoCluster(index)}>{t('Remove cluster', 'Remove cluster')}</Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-50">{t('No clusters configured yet.', 'No clusters configured yet.')}</p>
                )}
              </div>

              <div className="rounded-lg border border-[#274266] bg-[#0d1a2b]/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Label>{t('Advanced event mappings', 'Advanced event mappings')}</Label>
                    <HelpTip text={'Map Palo Alto events into findings and scoring for this instance.'} />
                    <span className="text-xs text-slate-400">
                      {currentPaloAlto.event_mappings?.length ?? 0} configured
                    </span>
                  </div>
                  <button
                    type="button"
                    className="rounded-md border border-[#274266] bg-[#12233d] px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-[#18365f]"
                    aria-expanded={paloAltoMappingsOpen}
                    onClick={() =>
                      setPaloAltoMappingsExpanded((prev) => ({
                        ...prev,
                        [currentPaloAlto.name]: !paloAltoMappingsOpen,
                      }))
                    }
                  >
                    {paloAltoMappingsOpen ? 'Hide mappings' : 'Show mappings'}
                  </button>
                </div>
                {paloAltoMappingsOpen ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={loadPaloAltoDefaultMappings}>{t('Load defaults', 'Load defaults')}</Button>
                      <Button onClick={addPaloAltoEventMapping}>{t('Add mapping', 'Add mapping')}</Button>
                    </div>
                    {currentPaloAlto.event_mappings?.length ? (
                      <div className="space-y-4">
                        {currentPaloAlto.event_mappings.map((mapping, index) => {
                          const {
                            t
                          } = useI18n();

                          return (
                            <div key={`palo-alto-mapping-${currentPaloAlto.name}-${index}`} className="rounded-lg border border-[#274266] p-3">
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-2">
                                  <Label>{t('Mapping name', 'Mapping name')}</Label>
                                  <input
                                    className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                                    value={mapping.name ?? ''}
                                    onChange={(e) =>
                                      updatePaloAltoEventMapping(index, { name: e.target.value })
                                    }
                                    placeholder={t('HA role change', 'HA role change')}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>{t('Event kind', 'Event kind')}</Label>
                                  <select
                                    className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                                    value={mapping.event_kind ?? 'change_event'}
                                    onChange={(e) =>
                                      updatePaloAltoEventMapping(index, {
                                        event_kind: e.target.value as PaloAltoEventKind,
                                      })
                                    }
                                  >
                                    <option value="change_event">{t('Change event', 'Change event')}</option>
                                    <option value="resilience_signal">{t('Resilience signal', 'Resilience signal')}</option>
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <Label>{t('Match field', 'Match field')}</Label>
                                  <select
                                    className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                                    value={mapping.match_field ?? 'change_type'}
                                    onChange={(e) =>
                                      updatePaloAltoEventMapping(index, {
                                        match_field: e.target.value as PaloAltoEventMatchField,
                                      })
                                    }
                                  >
                                    <option value="change_type">{t('Change type', 'Change type')}</option>
                                    <option value="signal_type">{t('Signal type', 'Signal type')}</option>
                                    <option value="log_type">{t('Log type', 'Log type')}</option>
                                    <option value="subtype">{t('Log subtype', 'Log subtype')}</option>
                                    <option value="contains">{t('Contains text', 'Contains text')}</option>
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <Label>{t('Match value', 'Match value')}</Label>
                                  <input
                                    className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                                    value={mapping.match_value ?? ''}
                                    onChange={(e) =>
                                      updatePaloAltoEventMapping(index, { match_value: e.target.value })
                                    }
                                    placeholder="ha_role_change"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>{t('Finding type', 'Finding type')}</Label>
                                  <input
                                    className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                                    value={mapping.finding_type ?? ''}
                                    onChange={(e) =>
                                      updatePaloAltoEventMapping(index, { finding_type: e.target.value })
                                    }
                                    placeholder="resilience"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>{t('Severity', 'Severity')}</Label>
                                  <select
                                    className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                                    value={mapping.severity ?? 'medium'}
                                    onChange={(e) =>
                                      updatePaloAltoEventMapping(index, {
                                        severity: e.target.value as PaloAltoEventMapping['severity'],
                                      })
                                    }
                                  >
                                    <option value="low">{t('Low', 'Low')}</option>
                                    <option value="medium">{t('Medium', 'Medium')}</option>
                                    <option value="high">{t('High', 'High')}</option>
                                    <option value="critical">{t('Critical', 'Critical')}</option>
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <Label>{t('Score delta', 'Score delta')}</Label>
                                  <input
                                    type="number"
                                    className="w-full rounded-md border border-[#274266] bg-[#0d1a2b] px-3 py-2 text-sm text-slate-50"
                                    value={mapping.score_delta ?? ''}
                                    onChange={(e) =>
                                      updatePaloAltoEventMapping(index, {
                                        score_delta: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    placeholder={t('Optional override', 'Optional override')}
                                  />
                                </div>
                                <label className="flex items-center gap-2 text-sm text-slate-50">
                                  <input
                                    type="checkbox"
                                    checked={mapping.enabled ?? true}
                                    onChange={(e) =>
                                      updatePaloAltoEventMapping(index, { enabled: e.target.checked })
                                    }
                                  />
                                  {t('Enabled', 'Enabled')}
                                </label>
                              </div>
                              <div className="mt-3 flex justify-end">
                                <Button onClick={() => removePaloAltoEventMapping(index)}>{t('Remove mapping', 'Remove mapping')}</Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-50">{t('No event mappings configured yet.', 'No event mappings configured yet.')}</p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-50">{t('No Palo Alto instance selected.', 'No Palo Alto instance selected.')}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={savePaloAlto} disabled={paloAltoSaving || !paloAltoConfigs.length}>
              {paloAltoSaving ? 'Saving...' : 'Save Palo Alto instances'}
            </Button>
            <Button onClick={testPaloAlto} disabled={paloAltoTesting || !currentPaloAlto}>
              {paloAltoTesting ? 'Testing...' : 'Test connection'}
            </Button>
            <Button onClick={debugPaloAlto} disabled={paloAltoDebugging || !currentPaloAlto}>
              {paloAltoDebugging ? 'Debugging...' : 'Debug fetch'}
            </Button>
            <DangerButton onClick={deletePaloAlto} disabled={paloAltoSaving || !currentPaloAlto}>
              {t('Delete instance', 'Delete instance')}
            </DangerButton>
            {paloAltoMessage ? <span className="text-sm text-slate-50">{paloAltoMessage}</span> : null}
          </div>
          {renderPaloAltoDebug(paloAltoDebug)}
        </Card>
      ) : null}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label>{t('Connector health', 'Connector health')}</Label>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200">
            <span className="text-slate-300">{t('Sort', 'Sort')}</span>
            <select
              className="rounded border border-[#274266] bg-[#0d1a2b] px-2 py-1 text-xs text-slate-200"
              value={healthSortKey}
              onChange={(e) => setHealthSortKey(e.target.value as HealthSortKey)}
              aria-label={t('Sort connectors by', 'Sort connectors by')}
            >
              <option value="name">{t('Name', 'Name')}</option>
              <option value="category">{t('Category', 'Category')}</option>
              <option value="status">{t('Status', 'Status')}</option>
              <option value="last_run">{t('Last run', 'Last run')}</option>
              <option value="success">{t('Success', 'Success')}</option>
              <option value="validation">{t('Validation issues', 'Validation issues')}</option>
              <option value="signals">{t('Signals', 'Signals')}</option>
            </select>
            <button
              type="button"
              className="rounded border border-[#274266] bg-[#0d1a2b] px-2 py-1 text-xs text-slate-200"
              onClick={() => setHealthSortDir(healthSortDir === 'asc' ? 'desc' : 'asc')}
            >
              {healthSortDir === 'asc' ? 'Asc' : 'Desc'}
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="w-full rounded border border-[#274266] bg-[#0d1a2b] px-2 py-1 text-xs text-slate-200"
            name="health-filter-name"
            value={healthFilters.name}
            onChange={(e) => setHealthFilters({ ...healthFilters, name: e.target.value })}
            placeholder={t('Filter name', 'Filter name')}
            aria-label={t('Filter connector name', 'Filter connector name')}
          />
          <input
            className="w-full rounded border border-[#274266] bg-[#0d1a2b] px-2 py-1 text-xs text-slate-200"
            name="health-filter-category"
            value={healthFilters.category}
            onChange={(e) => setHealthFilters({ ...healthFilters, category: e.target.value })}
            placeholder={t('Filter category', 'Filter category')}
            aria-label={t('Filter connector category', 'Filter connector category')}
          />
          <input
            className="w-full rounded border border-[#274266] bg-[#0d1a2b] px-2 py-1 text-xs text-slate-200"
            name="health-filter-status"
            value={healthFilters.status}
            onChange={(e) => setHealthFilters({ ...healthFilters, status: e.target.value })}
            placeholder={t('Filter status', 'Filter status')}
            aria-label={t('Filter connector status', 'Filter connector status')}
          />
          <input
            className="w-full rounded border border-[#274266] bg-[#0d1a2b] px-2 py-1 text-xs text-slate-200"
            name="health-filter-last-run"
            value={healthFilters.last_run}
            onChange={(e) => setHealthFilters({ ...healthFilters, last_run: e.target.value })}
            placeholder={t('Filter last run', 'Filter last run')}
            aria-label={t('Filter last run', 'Filter last run')}
          />
          <input
            className="w-full rounded border border-[#274266] bg-[#0d1a2b] px-2 py-1 text-xs text-slate-200"
            name="health-filter-success"
            value={healthFilters.success}
            onChange={(e) => setHealthFilters({ ...healthFilters, success: e.target.value })}
            placeholder={t('Filter success/fail', 'Filter success/fail')}
            aria-label={t('Filter success fail', 'Filter success fail')}
          />
          <input
            className="w-full rounded border border-[#274266] bg-[#0d1a2b] px-2 py-1 text-xs text-slate-200"
            name="health-filter-validation"
            value={healthFilters.validation}
            onChange={(e) => setHealthFilters({ ...healthFilters, validation: e.target.value })}
            placeholder={t('Filter validation issues', 'Filter validation issues')}
            aria-label={t('Filter validation issues', 'Filter validation issues')}
          />
          <input
            className="w-full rounded border border-[#274266] bg-[#0d1a2b] px-2 py-1 text-xs text-slate-200"
            name="health-filter-signals"
            value={healthFilters.signals}
            onChange={(e) => setHealthFilters({ ...healthFilters, signals: e.target.value })}
            placeholder={t('Filter signals', 'Filter signals')}
            aria-label={t('Filter signals', 'Filter signals')}
          />
        </div>
        <div className="mt-4 space-y-4">
          {sortedHealthCategories.map(([category, connectors]) => (
            <div key={category} className="rounded-lg border border-[#1f365a] bg-[#0d1a2b]/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-50">{category}</h3>
                  <p className="text-xs text-slate-300">{connectors.length} connectors</p>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                  {connectors.map((connector) => {
                    const {
                      t
                    } = useI18n();

                    const isExpanded = !!expandedHealth[connector.name]
                    const alerts = connector.alerts ?? []
                    const successCount = connector.success_count ?? 0
                    const failureCount = connector.failure_count ?? 0
                    const replicationVolumes = connector.replication_volumes ?? []
                    const replicationGroups = connector.replication_volume_groups ?? []
                    const remoteSystems = connector.remote_systems ?? []
                    const vmLastBackups = connector.vm_last_backups ?? []
                    const vmBackupGroups = groupVmBackupsByWeek(vmLastBackups)
                    const fallbackGroupStatus = (volumes: ReplicationVolumeStatus[]) => {
                      const statuses = volumes.map((volume) => (volume.status ?? '').toLowerCase())
                      if (statuses.some((status) => ['error', 'failed', 'critical'].includes(status))) return 'error'
                      if (statuses.some((status) => ['degraded', 'warning'].includes(status))) return 'degraded'
                      if (statuses.some((status) => ['ok', 'healthy', 'enabled', 'running'].includes(status)))
                        return 'ok'
                      return 'unknown'
                    }
                    const replicationGroupItems =
                      replicationGroups.length > 0
                        ? replicationGroups
                        : replicationVolumes.length
                          ? [
                              {
                                id: `${connector.name}-replication`,
                                name: 'Replicated volumes',
                                status: fallbackGroupStatus(replicationVolumes),
                                volumes: replicationVolumes,
                              },
                            ]
                          : []
                    const sla = connector.sla ?? {}
                    const slaOverallOk = healthBool(sla.overall_ok)
                    const freshnessOk = healthBool(sla.freshness_ok)
                    const provenanceOk = healthBool(sla.provenance_ok)
                    const ageHours = healthNumber(sla.age_hours)
                    const freshnessHours = healthNumber(sla.freshness_hours)
                    const provenanceHashes =
                      healthNumber(sla.provenance_input_hashes) ??
                      connector.provenance_input_hashes ??
                      connector.input_hash_count ??
                      0
                    const partialFailures = connector.partial_failures ?? []
                    const validationIssues = connector.validation_issues ?? []
                    const lastErrorText = healthErrorText(connector.last_error)
                    const haConfigured =
                      typeof connector.ha_configured === 'boolean'
                        ? connector.ha_configured
                        : healthBool(sla.ha_configured)
                    const haStatus =
                      connector.ha_status ??
                      (healthText(sla.ha_status) || (haConfigured === false ? 'not_configured' : 'unknown'))
                    const showHaStatus =
                      haConfigured !== undefined ||
                      haStatus !== 'unknown' ||
                      connector.name.startsWith('palo_alto') ||
                      connector.name.startsWith('powerstore') ||
                      connector.name.startsWith('dell_datadomain')
                    const haLabel = haConfigured === false ? 'HA not configured' : `HA ${haStatus}`
                    return (
                      <div key={connector.name} className="rounded-md border border-[#1f365a] bg-[#0b1524] p-3">
                        <button
                          type="button"
                          className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
                          onClick={() => toggleHealthExpanded(connector.name)}
                          aria-expanded={isExpanded}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`h-2 w-2 rounded-full ${statusColor(connector.status)}`} />
                            <div>
                              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-50">
                                <span>{connector.name}</span>
                                {showHaStatus ? (
                                  <span className={`rounded px-2 py-0.5 text-[11px] ${haBadgeClass(haStatus, haConfigured)}`}>
                                    {haLabel}
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-xs text-slate-300">{connector.status ?? 'unknown'}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
                            <span>
                              {t('Last run:', 'Last run:')} <span className="font-mono">{connector.last_run ?? '-'}</span>
                            </span>
                            <span>{t('Signals:', 'Signals:')} {alerts.length}</span>
                            <span className="text-slate-200">{isExpanded ? 'Hide details' : 'View details'}</span>
                          </div>
                        </button>
                        {!isExpanded && connector.name.startsWith('powerstore') ? (
                          <div className="mt-2 grid gap-2 text-xs text-slate-200 sm:grid-cols-2">
                            <div>
                              <div className="text-[11px] uppercase text-slate-400">{t('Replication groups', 'Replication groups')}</div>
                              {replicationGroupItems.length ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {replicationGroupItems.slice(0, 4).map((group, index) => {
                                    const groupLabel =
                                      group.name?.trim() || group.id?.trim() || `group-${index + 1}`
                                    const groupStatus = group.status ?? 'unknown'
                                    const groupVolumes = group.volumes ?? []
                                    const groupModeLabel = replicationGroupModeLabel(group)
                                    const label =
                                      groupVolumes.length > 0
                                        ? `${groupLabel} (${groupVolumes.length})`
                                        : groupLabel
                                    const summary = groupModeLabel
                                      ? `${label}: ${groupModeLabel} (${groupStatus})`
                                      : `${label}: ${groupStatus}`
                                    return (
                                      <span
                                        key={`${connector.name}-repgroup-compact-${label}-${index}`}
                                        title={summary}
                                        className={`rounded px-2 py-0.5 text-[11px] ${replicationBadgeClass(
                                          groupStatus,
                                        )}`}
                                      >
                                        {summary}
                                      </span>
                                    )
                                  })}
                                  {replicationGroupItems.length > 4 ? (
                                    <span className="rounded px-2 py-0.5 text-[11px] text-slate-300">
                                      +{replicationGroupItems.length - 4} more
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="mt-1 inline-block text-xs text-slate-300">
                                  {t('No replication groups reported', 'No replication groups reported')}
                                </span>
                              )}
                            </div>
                            <div>
                              <div className="text-[11px] uppercase text-slate-400">{t('Remote systems', 'Remote systems')}</div>
                              {remoteSystems.length ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {remoteSystems.slice(0, 3).map((system, index) => {
                                    const label =
                                      system.name?.trim() || system.id?.trim() || `remote-${index + 1}`
                                    const modes = system.replication_modes ?? []
                                    const modeText = modes.length ? modes.join('/') : 'unknown'
                                    const status = system.status ?? 'unknown'
                                    return (
                                      <span
                                        key={`${connector.name}-remote-compact-${label}-${index}`}
                                        title={label}
                                        className={`rounded px-2 py-0.5 text-[11px] ${remoteSystemBadgeClass(
                                          modes[0],
                                        )}`}
                                      >
                                        {label}: {modeText} ({status})
                                      </span>
                                    )
                                  })}
                                  {remoteSystems.length > 3 ? (
                                    <span className="rounded px-2 py-0.5 text-[11px] text-slate-300">
                                      +{remoteSystems.length - 3} more
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="mt-1 inline-block text-xs text-slate-300">
                                  {t('No remote systems reported', 'No remote systems reported')}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : null}
                        {isExpanded ? (
                          <div className="mt-3 grid gap-3 text-xs text-slate-200 sm:grid-cols-2 lg:grid-cols-3">
                            {showHaStatus ? (
                              <div>
                                <div className="text-[11px] uppercase text-slate-400">{t('HA status', 'HA status')}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <span className={`rounded px-2 py-0.5 text-[11px] ${haBadgeClass(haStatus, haConfigured)}`}>
                                    {haLabel}
                                  </span>
                                  <span className="text-slate-300">
                                    {t('configured:', 'configured:')} {haConfigured === undefined ? 'unknown' : haConfigured ? 'yes' : 'no'}
                                  </span>
                                </div>
                              </div>
                            ) : null}
                            <div>
                              <div className="text-[11px] uppercase text-slate-400">{t('SLA overall', 'SLA overall')}</div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                <span className={`rounded px-2 py-0.5 text-[11px] ${healthStateClass(slaOverallOk)}`}>
                                  overall {slaOverallOk === undefined ? 'unknown' : slaOverallOk ? 'ok' : 'check'}
                                </span>
                                <span className={`rounded px-2 py-0.5 text-[11px] ${healthStateClass(freshnessOk)}`}>
                                  freshness {freshnessOk === undefined ? 'unknown' : freshnessOk ? 'ok' : 'stale'}
                                </span>
                                <span className={`rounded px-2 py-0.5 text-[11px] ${healthStateClass(provenanceOk)}`}>
                                  provenance {provenanceOk === undefined ? 'unknown' : provenanceOk ? 'ok' : 'missing'}
                                </span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase text-slate-400">{t('Freshness', 'Freshness')}</div>
                              <div className="mt-1">
                                age {ageHours === null ? 'n/a' : `${ageHours}h`}
                                {freshnessHours === null ? '' : ` / target ${freshnessHours}h`}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase text-slate-400">{t('Provenance hashes', 'Provenance hashes')}</div>
                              <div className="mt-1">{healthCountLabel(provenanceHashes)}</div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase text-slate-400">{t('Success / Fail', 'Success / Fail')}</div>
                              <div className="mt-1">
                                {successCount}/{failureCount}
                                {connector.partial_failure_count ? ` / partial ${connector.partial_failure_count}` : ''}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase text-slate-400">{t('Validation issues', 'Validation issues')}</div>
                              <div className="mt-1">{connector.validation_issue_count ?? validationIssues.length}</div>
                              {connector.last_validation ? (
                                <div className="mt-1 font-mono text-[11px] text-slate-400">
                                  {connector.last_validation}
                                </div>
                              ) : null}
                            </div>
                            <div>
                              <div className="text-[11px] uppercase text-slate-400">{t('Last run', 'Last run')}</div>
                              <div className="mt-1 font-mono">{healthTimeLabel(connector.last_run)}</div>
                              <div className="mt-1 text-slate-400">
                                duration {healthDurationLabel(connector.last_duration_seconds)}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase text-slate-400">{t('Last success', 'Last success')}</div>
                              <div className="mt-1 font-mono">{healthTimeLabel(connector.last_success)}</div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase text-slate-400">{t('Last provenance', 'Last provenance')}</div>
                              <div className="mt-1 font-mono">{healthTimeLabel(connector.last_provenance)}</div>
                            </div>
                            {lastErrorText ? (
                              <div className="sm:col-span-2 lg:col-span-3">
                                <div className="text-[11px] uppercase text-slate-400">{t('Last error', 'Last error')}</div>
                                <div className="mt-1 rounded border border-rose-500/30 bg-rose-500/10 p-2 text-rose-100">
                                  {lastErrorText}
                                </div>
                              </div>
                            ) : null}
                            {validationIssues.length ? (
                              <div className="sm:col-span-2 lg:col-span-3">
                                <div className="text-[11px] uppercase text-slate-400">{t('Validation details', 'Validation details')}</div>
                                <div className="mt-1 space-y-1">
                                  {validationIssues.slice(0, 5).map((issue, index) => (
                                    <div
                                      key={`${connector.name}-validation-${index}`}
                                      className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-100"
                                    >
                                      {healthIssueText(issue)}
                                    </div>
                                  ))}
                                  {validationIssues.length > 5 ? (
                                    <span className="text-[11px] text-slate-400">
                                      +{validationIssues.length - 5} more
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                            {partialFailures.length ? (
                              <div className="sm:col-span-2 lg:col-span-3">
                                <div className="text-[11px] uppercase text-slate-400">{t('Partial failures', 'Partial failures')}</div>
                                <div className="mt-1 space-y-1">
                                  {partialFailures.slice(0, 5).map((failure, index) => (
                                    <div
                                      key={`${connector.name}-partial-${index}`}
                                      className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-100"
                                    >
                                      {healthIssueText(failure)}
                                    </div>
                                  ))}
                                  {partialFailures.length > 5 ? (
                                    <span className="text-[11px] text-slate-400">
                                      +{partialFailures.length - 5} more
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                            {connector.change_detected ? (
                              <div className="sm:col-span-2 lg:col-span-3">
                                <div className="text-[11px] uppercase text-slate-400">{t('Source changes', 'Source changes')}</div>
                                <div className="mt-1 text-slate-200">
                                  {connector.last_change_count ?? connector.last_change_keys?.length ?? 0} change(s)
                                  {connector.last_change_at ? ` at ${connector.last_change_at}` : ''}
                                </div>
                                {connector.last_change_keys?.length ? (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {connector.last_change_keys.slice(0, 8).map((key) => (
                                      <span key={`${connector.name}-change-${key}`} className="rounded bg-slate-500/20 px-2 py-0.5 text-[11px] text-slate-200">
                                        {key}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            <div className="sm:col-span-2 lg:col-span-3">
                              <div className="text-[11px] uppercase text-slate-400">{t('Signals', 'Signals')}</div>
                              {alerts.length ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {alerts.map((alert, index) => (
                                    <span
                                      key={`${connector.name}-${alert.key}-${index}`}
                                      title={alert.message}
                                      className={`rounded px-2 py-0.5 text-[11px] ${alertBadgeClass(alert.level)}`}
                                    >
                                      {alert.key}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="mt-1 inline-block text-xs text-slate-300">ok</span>
                              )}
                            </div>
                              {connector.name.startsWith('veeam_enterprise_manager') ? (
                                <div className="sm:col-span-2 lg:col-span-3">
                                  <div className="text-[11px] uppercase text-slate-400">
                                    {t('VM last successful backups', 'VM last successful backups')}
                                  </div>
                                  {vmLastBackups.length ? (
                                    <div className="mt-2 space-y-2">
                                      {vmBackupGroups.weeks.map((group, groupIndex) => {
                                        const weekKey = `${connector.name}-vmbackup-week-${group.week}`
                                        const weekExpanded =
                                          expandedBackupWeeks[weekKey] ?? groupIndex === 0
                                        return (
                                          <div key={weekKey} className="rounded border border-[#1f365a] bg-[#0b1626] p-2">
                                            <button
                                              type="button"
                                              className="flex w-full items-center justify-between text-left text-[11px] uppercase tracking-wide text-slate-300"
                                              onClick={() => toggleBackupWeek(weekKey)}
                                              aria-expanded={weekExpanded}
                                            >
                                              <span>{group.week}</span>
                                              <span className="text-[10px] text-slate-400">
                                                {group.count} backups
                                              </span>
                                            </button>
                                            {weekExpanded ? (
                                              <div className="mt-2 space-y-2">
                                                {group.dates.map((dateGroup, dateIndex) => {
                                                  const dateKey = `${weekKey}-${dateGroup.date}`
                                                  const dateExpanded =
                                                    expandedBackupDates[dateKey] ?? dateIndex === 0
                                                  return (
                                                    <div key={dateKey}>
                                                      <button
                                                        type="button"
                                                        className="flex w-full items-center justify-between text-left text-[10px] text-slate-400"
                                                        onClick={() => toggleBackupDate(dateKey)}
                                                        aria-expanded={dateExpanded}
                                                      >
                                                        <span className="uppercase">{dateGroup.date}</span>
                                                        <span>{dateGroup.items.length}</span>
                                                      </button>
                                                      {dateExpanded ? (
                                                        <div className="mt-1 flex flex-wrap gap-1">
                                                          {dateGroup.items.map((entry, index) => {
                                                            const label =
                                                              entry.name?.trim() || `vm-${index + 1}`
                                                            const status = entry.status ?? 'unknown'
                                                            const plan = entry.job_name?.trim() || 'n/a'
                                                            const lastBackup = entry.last_success?.trim() || 'n/a'
                                                            const lastRecovery = entry.last_recovery?.trim() || 'n/a'
                                                            return (
                                                              <span
                                                                key={`${dateKey}-${label}-${index}`}
                                                                className={`rounded px-2 py-0.5 text-[11px] ${replicationBadgeClass(
                                                                  status,
                                                                )}`}
                                                                title={`${label} | Plan: ${plan} | Last backup: ${lastBackup} | Last recovery: ${lastRecovery}`}
                                                              >
                                                                {label}
                                                              </span>
                                                            )
                                                          })}
                                                        </div>
                                                      ) : null}
                                                    </div>
                                                  )
                                                })}
                                              </div>
                                            ) : null}
                                          </div>
                                        )
                                      })}
                                      {vmBackupGroups.remaining > 0 ? (
                                        <span className="rounded px-2 py-0.5 text-[11px] text-slate-300">
                                          +{vmBackupGroups.remaining} more
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : (
                                    <span className="mt-1 inline-block text-xs text-slate-300">
                                      {t('No VM backup history reported', 'No VM backup history reported')}
                                    </span>
                                  )}
                                </div>
                              ) : null}
                              {connector.name.startsWith('powerstore') ? (
                                <div className="sm:col-span-2 lg:col-span-3">
                                  <div className="text-[11px] uppercase text-slate-400">{t('Replication groups', 'Replication groups')}</div>
                                  {replicationGroupItems.length ? (
                                    <div className="mt-2 space-y-2">
                                      {replicationGroupItems.map((group, groupIndex) => {
                                        const {
                                          t
                                        } = useI18n();

                                        const groupKey =
                                          group.id?.trim() || group.name?.trim() || `group-${groupIndex + 1}`
                                        const isGroupExpanded =
                                          !!expandedReplicationGroups[connector.name]?.[groupKey]
                                        const groupLabel =
                                          group.name?.trim() || group.id?.trim() || `group-${groupIndex + 1}`
                                        const groupStatus = group.status ?? 'unknown'
                                        const groupVolumes = group.volumes ?? []
                                        const groupModeLabel = replicationGroupModeLabel(group)
                                        const groupMode = (group.replication_mode ?? '').toLowerCase()
                                        return (
                                          <div
                                            key={`${connector.name}-repgroup-${groupKey}`}
                                            className="rounded border border-[#1f365a] bg-[#0b1626] p-2"
                                          >
                                            <button
                                              type="button"
                                              className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                                              onClick={() => toggleReplicationGroup(connector.name, groupKey)}
                                              aria-expanded={isGroupExpanded}
                                            >
                                              <div className="flex items-center gap-2">
                                                <span
                                                  className={`rounded px-2 py-0.5 text-[11px] ${replicationBadgeClass(
                                                    groupStatus,
                                                  )}`}
                                                >
                                                  {groupStatus}
                                                </span>
                                                {groupModeLabel ? (
                                                  <span
                                                    className={`rounded px-2 py-0.5 text-[11px] ${remoteSystemBadgeClass(
                                                      groupMode,
                                                    )}`}
                                                  >
                                                    {groupModeLabel}
                                                  </span>
                                                ) : null}
                                                <span className="text-xs font-semibold text-slate-100">
                                                  {groupLabel}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                                                <span>{groupVolumes.length} volumes</span>
                                                <span>{isGroupExpanded ? 'Hide volumes' : 'View volumes'}</span>
                                              </div>
                                            </button>
                                            {isGroupExpanded ? (
                                              <div className="mt-2">
                                                {groupVolumes.length ? (
                                                  <div className="flex flex-wrap gap-2">
                                                    {groupVolumes.slice(0, 20).map((volume, index) => {
                                                      const {
                                                        t
                                                      } = useI18n();

                                                      const label =
                                                        volume.name?.trim() ||
                                                        volume.id?.trim() ||
                                                        `volume-${index + 1}`
                                                      const status = volume.status ?? 'unknown'
                                                      const hosts = volume.hosts ?? []
                                                      const hostCount = hosts.length
                                                      const hostGroups = volume.host_groups ?? []
                                                      const hostGroupCount = hostGroups.length
                                                      const volumeKey = `${connector.name}:${groupKey}:${
                                                        volume.id ?? label
                                                      }`
                                                      const isVolumeExpanded = !!expandedReplicationVolumes[volumeKey]
                                                      return (
                                                        <div
                                                          key={`${connector.name}-repvol-${groupKey}-${label}-${index}`}
                                                          className="flex flex-col"
                                                        >
                                                          <button
                                                            type="button"
                                                            onClick={() => toggleReplicationVolume(volumeKey)}
                                                            aria-expanded={isVolumeExpanded}
                                                            title={label}
                                                            className={`rounded px-2 py-0.5 text-left text-[11px] ${replicationBadgeClass(
                                                              status,
                                                            )}`}
                                                          >
                                                            {label}: {status}
                                                          </button>
                                                          {isVolumeExpanded ? (
                                                            <div className="ml-2 mt-1 text-[11px] text-slate-300">
                                                              {hostCount || hostGroupCount ? (
                                                                <div className="space-y-1">
                                                                  {hostCount ? (
                                                                    <div>{t('Hosts:', 'Hosts:')} {hosts.join(', ')}</div>
                                                                  ) : null}
                                                                  {hostGroupCount ? (
                                                                    <div>{t('Host groups:', 'Host groups:')} {hostGroups.join(', ')}</div>
                                                                  ) : null}
                                                                </div>
                                                              ) : (
                                                                'No host mappings'
                                                              )}
                                                            </div>
                                                          ) : null}
                                                        </div>
                                                      );
                                                    })}
                                                    {groupVolumes.length > 20 ? (
                                                      <span className="rounded px-2 py-0.5 text-[11px] text-slate-300">
                                                        +{groupVolumes.length - 20} more
                                                      </span>
                                                    ) : null}
                                                  </div>
                                                ) : (
                                                  <span className="inline-block text-xs text-slate-300">
                                                    {t('No volumes reported', 'No volumes reported')}
                                                  </span>
                                                )}
                                              </div>
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <span className="mt-1 inline-block text-xs text-slate-300">
                                      {t('No replication groups reported', 'No replication groups reported')}
                                    </span>
                                  )}
                                </div>
                              ) : null}
                              {connector.name.startsWith('powerstore') ? (
                                <div className="sm:col-span-2 lg:col-span-3">
                                  <div className="text-[11px] uppercase text-slate-400">
                                    {t('Remote systems', 'Remote systems')}
                                  </div>
                                  {remoteSystems.length ? (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {remoteSystems.slice(0, 12).map((system, index) => {
                                        const label =
                                          system.name?.trim() || system.id?.trim() || `remote-${index + 1}`
                                        const modes = system.replication_modes ?? []
                                        const modeText = modes.length ? modes.join('/') : 'unknown'
                                        const status = system.status ?? 'unknown'
                                        return (
                                          <span
                                            key={`${connector.name}-remote-${label}-${index}`}
                                            className={`rounded px-2 py-0.5 text-[11px] ${remoteSystemBadgeClass(
                                              modes[0],
                                            )}`}
                                          >
                                            {label}: {modeText} ({status})
                                          </span>
                                        )
                                      })}
                                      {remoteSystems.length > 12 ? (
                                        <span className="rounded px-2 py-0.5 text-[11px] text-slate-300">
                                          +{remoteSystems.length - 12} more
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : (
                                    <span className="mt-1 inline-block text-xs text-slate-300">
                                      {t('No remote systems reported', 'No remote systems reported')}
                                    </span>
                                  )}
                                </div>
                              ) : null}
                              <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
                                <Button onClick={() => selectConnectorForEdit(connector.name)}>{t('Edit', 'Edit')}</Button>
                                {isDeletableConnector(connector.name) ? (
                                  <DangerButton
                                    onClick={() => {
                                    void deleteConnectorConfig(connector.name)
                                  }}
                                >
                                    {t('Delete config', 'Delete config')}
                                  </DangerButton>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
          {!filteredHealth.length ? (
            <div className="rounded-lg border border-[#1f365a] bg-[#0d1a2b]/40 p-4 text-sm text-slate-50">
              {t('No configured connectors reported.', 'No configured connectors reported.')}
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
