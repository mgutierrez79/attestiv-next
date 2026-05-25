'use client'

// Real brand marks for the 8 pilot connectors.
//
// Five come from simple-icons (CC0): Palo Alto Networks, VMware (vCenter),
// Dell (PowerStore + DataDomain), Veeam, Dynatrace. Two — Zabbix and
// GLPI — are not in simple-icons, so we render a brand-coloured wordmark
// inside a 24×24 viewBox to match.
//
// All marks are single-color paths designed to render at the brand's
// accent hex over a tinted background, matching the connector card
// aesthetic on the registry page.

import {
  siDell,
  siDynatrace,
  siPaloaltonetworks,
  siVeeam,
  siVmware,
} from 'simple-icons'

type LogoSpec = {
  hex: string
  // Full-color brand watermark served from /public/connectors. When
  // present it wins over the monochrome SVG path — these are the real
  // vendor marks shipped with the design system.
  png?: string
  // Either an SVG path (24×24 viewBox) or arbitrary inline SVG content.
  path?: string
  inline?: 'zabbix' | 'glpi'
}

// One entry per registered connector name (must match the backend
// `connector.name` values surfaced by /v1/connectors). `png` is the
// full-color brand mark (preferred); `path`/`inline` are the monochrome
// fallbacks used when no PNG ships for that vendor.
const LOGOS: Record<string, LogoSpec> = {
  palo_alto:                { hex: siPaloaltonetworks.hex, png: 'palo-alto.png', path: siPaloaltonetworks.path },
  vcenter:                  { hex: siVmware.hex,           png: 'vcenter.png',   path: siVmware.path },
  powerstore:               { hex: siDell.hex,             png: 'dell.png',      path: siDell.path },
  dell_datadomain:          { hex: siDell.hex,             png: 'dell.png',      path: siDell.path },
  veeam_enterprise_manager: { hex: siVeeam.hex,            png: 'veeam.png',     path: siVeeam.path },
  dynatrace:                { hex: siDynatrace.hex,        path: siDynatrace.path },
  zabbix:                   { hex: 'D40000',               inline: 'zabbix' },
  glpi:                     { hex: 'F77B0F',               png: 'glpi.png',      inline: 'glpi' },
  advens_mysoc:             { hex: '1A1A18',               png: 'mysoc.png' },
}

// Aliases for keys that appear in other call sites (wizard form values,
// onboarding hints) but resolve to the same brand. Keeps the registry
// keys canonical and avoids per-page logo maps.
const ALIASES: Record<string, string> = {
  palo_alto_panorama: 'palo_alto',
  palo_alto_firewall: 'palo_alto',
  dell_powerstore: 'powerstore',
  vmware_vcenter: 'vcenter',
  veeam_em: 'veeam_enterprise_manager',
  mysoc: 'advens_mysoc',
}

function canonical(name: string): string {
  return ALIASES[name] ?? name
}

export function hasConnectorLogo(name: string): boolean {
  return canonical(name) in LOGOS
}

export function connectorBrandHex(name: string): string | null {
  const spec = LOGOS[canonical(name)]
  return spec ? `#${spec.hex}` : null
}

export function ConnectorLogo({
  name,
  size = 22,
}: {
  name: string
  size?: number
}) {
  const spec = LOGOS[canonical(name)]
  if (!spec) {
    return (
      <i
        className="ti ti-plug"
        aria-hidden="true"
        style={{ fontSize: size, color: 'var(--color-text-secondary)' }}
      />
    )
  }
  const fill = `#${spec.hex}`
  // Full-color brand watermark wins when one ships for this vendor.
  if (spec.png) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/connectors/${spec.png}`}
        alt=""
        width={size}
        height={size}
        aria-hidden="true"
        style={{ display: 'block', objectFit: 'contain' }}
      />
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {spec.path ? <path d={spec.path} fill={fill} /> : null}
      {spec.inline === 'zabbix' ? (
        <text
          x="12"
          y="18.5"
          textAnchor="middle"
          fontFamily="-apple-system, system-ui, Segoe UI, sans-serif"
          fontWeight={800}
          fontSize={20}
          fill={fill}
        >
          Z
        </text>
      ) : null}
      {spec.inline === 'glpi' ? (
        <text
          x="12"
          y="16.5"
          textAnchor="middle"
          fontFamily="-apple-system, system-ui, Segoe UI, sans-serif"
          fontWeight={800}
          fontSize={9}
          fill={fill}
          letterSpacing={-0.4}
        >
          GLPI
        </text>
      ) : null}
    </svg>
  )
}
