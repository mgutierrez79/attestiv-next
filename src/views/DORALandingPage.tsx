'use client';
// DORA-first landing page — public-facing /dora route.
//
// Audience: EU bank / insurer / investment firm IT + risk + ICT
// third-party. Sister to /gxp; same shape, different evidence map.
//
// What this page does:
//   1. State the claim: an evidence pipeline + signed audit packet
//      that maps to the DORA articles your supervisor will name.
//   2. Map platform capabilities to specific DORA articles. Each
//      capability is a real route or signed artifact today.
//   3. Convert with the pre-packet download (existing customers) or
//      the trust-center (prospects verifying offline).

import Link from 'next/link'
import { AttestivLogo } from '../components/AttestivLayout'

export function DORALandingPage() {
  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/" style={brandLinkStyle}>
          <span style={brandLogoBoxStyle}>
            <AttestivLogo />
          </span>
          <span style={brandLabelStyle}>Attestiv</span>
        </Link>
        <nav style={navStyle}>
          <Link href="/gxp" style={navLinkStyle}>GxP</Link>
          <Link href="/trust-center" style={navLinkStyle}>Trust center</Link>
          <Link href="/login" style={ctaLinkStyle}>Open console →</Link>
        </nav>
      </header>

      <section style={heroStyle}>
        <div style={heroBadgeStyle}>DORA · Reg. (EU) 2022/2554</div>
        <h1 style={h1Style}>
          A DORA evidence pipeline that ships your auditor a signed packet they verify offline.
        </h1>
        <p style={leadStyle}>
          DORA didn&apos;t ask for slideware. Articles 5–17 ask for evidence
          of an ICT risk management framework; Articles 17–19 ask for
          incident classification under a 24h / 72h / 30d clock;
          Article 28 asks for a Register of Information your supervisor
          can pull. Attestiv generates each of those as machine-readable,
          signed artifacts — and bundles them for a third-party auditor.
        </p>
        <div style={ctaRowStyle}>
          <Link href="/audit/prepacket?framework=dora" style={primaryButtonStyle}>
            Generate a signed DORA packet
          </Link>
          <Link href="/trust-center" style={secondaryButtonStyle}>
            Verify a manifest →
          </Link>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>What the platform produces for a DORA scope</h2>
        <p style={sectionLeadStyle}>
          Each card below maps to a specific DORA article and a real
          route in the console. The pre-packet is the same evidence,
          frozen at a point in time, signed, and ready for offline
          verification.
        </p>
        <div style={gridStyle}>
          <Feature
            title="ICT risk register"
            clause="Art.5 / Art.6 — ICT risk mgmt framework"
            body="Per-tenant risk register with auto-creation from scoring transitions. Severity weighting, owner assignment, and policy-attachment links so every risk traces back to the control it derives from."
            link="/risks"
          />
          <Feature
            title="Incident detector + 24h/72h/30d clock"
            clause="Art.17 / Art.18 / Art.19"
            body="Four built-in incident triggers fire automatically from connector signals (HA failover, signature mismatch, DLQ saturation, evidence-emission stall). Pre-filled notification templates with deadline countdowns for initial / intermediate / final reports."
            link="/incidents"
          />
          <Feature
            title="Third-party Register of Information"
            clause="Art.28 — Third-party arrangements"
            body="Each third-party arrangement is captured with core-1.1 RoI fields (provider, function, criticality, support country, exit-strategy reference). Exportable as CSV or JSON when your supervisor asks for the register."
            link="/third-parties"
          />
          <Feature
            title="Concentration-risk calculation"
            clause="Art.29 — Concentration of ICT services"
            body="Site Registry computes geographic proximity and provider concentration across critical functions. Triggers a scoring re-evaluation when a new CCR creates a new concentration band."
            link="/sites"
          />
          <Feature
            title="DR testing with approval gates"
            clause="Art.24 — Digital operational resilience testing"
            body="Scheduled DR runs require a single-use approval token (24h TTL, maintenance window). Run records carry RTO/RPO, approver chain, and evidence of which dependencies recovered in which order."
            link="/dr"
          />
          <Feature
            title="ICT business continuity"
            clause="Art.11 / Art.12 — Response and recovery"
            body="App Registry's cascade-impact engine ranks dependencies for recovery; Site Registry's recovery order enforces invariants like NTP-before-AD. Verifiable order, not a wishlist."
            link="/apps"
          />
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>What goes into a DORA pre-packet</h2>
        <ol style={orderedListStyle}>
          <li>
            <strong>framework_summary.json</strong> — DORA&apos;s overall
            score plus PASS / REVIEW / WARN / FAIL counts.
          </li>
          <li>
            <strong>controls.csv</strong> — every DORA control, one
            row each: status, score, weight, evidence count, last
            evaluation timestamp.
          </li>
          <li>
            <strong>gaps.csv</strong> — only the non-passing controls
            with the finding code your auditor will reference and a
            remediation hint.
          </li>
          <li>
            <strong>remediation_open.json</strong> — open tasks tied to
            the gap controls, with owner, priority, due date. The work
            in flight.
          </li>
          <li>
            <strong>Signed manifest + public keys.</strong> Ed25519
            over the manifest, with the public key embedded in the
            packet so verification needs no network access to the
            platform.
          </li>
        </ol>
        <p style={callOutStyle}>
          The supervisor (or the bank&apos;s external auditor) downloads
          the zip, verifies it offline against the embedded public key,
          and walks into the engagement already knowing the answer to
          &quot;what&apos;s outstanding?&quot; — not still building the inventory.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>What this isn&apos;t</h2>
        <ul style={listStyle}>
          <li>
            A replacement for your ICT risk policy document or your
            internal-audit working papers — the platform produces
            evidence; humans still set policy.
          </li>
          <li>
            A SIEM or an XDR. If you need security-event correlation,
            Attestiv reads from your existing SOC (or your SOC
            provider — pilots run with Advens for example) and
            produces the compliance evidence side.
          </li>
          <li>
            A TLPT vendor (Art.25). The platform records that a test
            happened and what the scope was; the test itself is run
            by your accredited red team.
          </li>
        </ul>
      </section>

      <section style={ctaSectionStyle}>
        <h2 style={ctaH2Style}>Walk into your next DORA review with the answer pre-built</h2>
        <p style={ctaCopyStyle}>
          A working tenant can produce a real, signed DORA packet
          right now. If you don&apos;t have one yet, the trust-center page
          publishes a sample manifest you can verify with the
          platform&apos;s published Ed25519 key.
        </p>
        <div style={ctaRowStyle}>
          <Link href="/audit/prepacket?framework=dora" style={primaryButtonStyle}>
            Download a DORA packet
          </Link>
          <Link href="/trust-center" style={secondaryButtonStyle}>
            See the trust center
          </Link>
        </div>
      </section>

      <footer style={footerStyle}>
        <span>© Attestiv — compliantly-go pilot build</span>
        <span style={{ flex: 1 }} />
        <Link href="/gxp" style={footerLinkStyle}>GxP scope</Link>
        <Link href="/trust-center" style={footerLinkStyle}>Trust center</Link>
        <Link href="/login" style={footerLinkStyle}>Console login</Link>
      </footer>
    </div>
  )
}

function Feature({ title, clause, body, link }: { title: string; clause: string; body: string; link: string }) {
  return (
    <Link href={link} style={featureCardStyle}>
      <div style={{ fontSize: 11, color: 'var(--color-brand-blue)', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}>
        {clause}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 6 }}>{title}</div>
      <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55, marginTop: 6, marginBottom: 0 }}>
        {body}
      </p>
    </Link>
  )
}

const pageStyle: React.CSSProperties = {
  background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)',
  minHeight: '100vh',
  fontFamily: 'inherit',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 18,
  padding: '14px 32px',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
}

const brandLinkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  textDecoration: 'none',
  color: 'var(--color-text-primary)',
}

const brandLabelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: 0.2,
}

const brandLogoBoxStyle: React.CSSProperties = {
  display: 'inline-flex',
  width: 28,
  height: 28,
  alignItems: 'center',
  justifyContent: 'center',
}

const navStyle: React.CSSProperties = {
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  fontSize: 13,
}

const navLinkStyle: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
  textDecoration: 'none',
}

const ctaLinkStyle: React.CSSProperties = {
  ...navLinkStyle,
  color: 'var(--color-brand-blue)',
  fontWeight: 600,
}

const heroStyle: React.CSSProperties = {
  maxWidth: 880,
  margin: '0 auto',
  padding: '80px 32px 60px',
  textAlign: 'left',
}

const heroBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  color: 'var(--color-brand-blue)',
  padding: '4px 10px',
  border: '0.5px solid var(--color-brand-blue)',
  borderRadius: 999,
  marginBottom: 24,
}

const h1Style: React.CSSProperties = {
  fontSize: 38,
  lineHeight: 1.15,
  fontWeight: 700,
  margin: 0,
  letterSpacing: -0.5,
}

const leadStyle: React.CSSProperties = {
  fontSize: 16,
  lineHeight: 1.55,
  color: 'var(--color-text-secondary)',
  marginTop: 18,
  marginBottom: 28,
  maxWidth: 700,
}

const ctaRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
}

const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '10px 18px',
  background: 'var(--color-brand-blue)',
  color: '#fff',
  borderRadius: 'var(--border-radius-md)',
  textDecoration: 'none',
  fontSize: 13.5,
  fontWeight: 500,
}

const secondaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '10px 18px',
  border: '0.5px solid var(--color-border-secondary)',
  color: 'var(--color-text-primary)',
  borderRadius: 'var(--border-radius-md)',
  textDecoration: 'none',
  fontSize: 13.5,
  fontWeight: 500,
}

const sectionStyle: React.CSSProperties = {
  maxWidth: 880,
  margin: '0 auto',
  padding: '40px 32px',
  borderTop: '0.5px solid var(--color-border-tertiary)',
}

const h2Style: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
  margin: 0,
  letterSpacing: -0.3,
}

const sectionLeadStyle: React.CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.6,
  color: 'var(--color-text-secondary)',
  marginTop: 10,
  marginBottom: 24,
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 14,
}

const featureCardStyle: React.CSSProperties = {
  display: 'block',
  padding: 16,
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 'var(--border-radius-lg)',
  textDecoration: 'none',
  color: 'var(--color-text-primary)',
  background: 'var(--color-background-primary)',
}

const orderedListStyle: React.CSSProperties = {
  paddingLeft: 22,
  marginTop: 12,
  marginBottom: 0,
  lineHeight: 1.7,
  fontSize: 13.5,
  color: 'var(--color-text-secondary)',
}

const listStyle: React.CSSProperties = {
  paddingLeft: 22,
  marginTop: 12,
  marginBottom: 0,
  lineHeight: 1.7,
  fontSize: 13.5,
  color: 'var(--color-text-secondary)',
}

const callOutStyle: React.CSSProperties = {
  fontSize: 13.5,
  fontStyle: 'italic',
  color: 'var(--color-text-secondary)',
  marginTop: 18,
  paddingLeft: 12,
  borderLeft: '2px solid var(--color-brand-blue)',
}

const ctaSectionStyle: React.CSSProperties = {
  maxWidth: 880,
  margin: '40px auto 80px',
  padding: '32px',
  background: 'var(--color-background-secondary)',
  borderRadius: 'var(--border-radius-lg)',
}

const ctaH2Style: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  margin: 0,
}

const ctaCopyStyle: React.CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.6,
  color: 'var(--color-text-secondary)',
  marginTop: 10,
  marginBottom: 18,
}

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 18,
  padding: '20px 32px',
  borderTop: '0.5px solid var(--color-border-tertiary)',
  fontSize: 12,
  color: 'var(--color-text-tertiary)',
}

const footerLinkStyle: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
  textDecoration: 'none',
}
