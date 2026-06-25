'use client';
// GxP-first landing page — public-facing /gxp route.
//
// Audience: pharma / biotech / medical-device IT + quality compliance.
// What this page does:
//   1. State the single sharp claim ("signed, audit-ready evidence
//      across your GxP-validated systems").
//   2. Map the platform's actual capabilities to specific GMP Annex 11
//      and 21 CFR Part 11 clauses — every capability links to a real
//      route or signed artifact in the console.
//   3. Convert with a CTA that's NOT a contact form — it's the
//      audit pre-packet download, the same artifact an external
//      QA auditor would verify offline.
//
// Deliberately not marketing-fluff. The auditor reads this page too.

import Link from 'next/link'
import { AttestivLogo } from '../components/AttestivLayout'

export function GxPLandingPage() {
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
          <Link href="/dora" style={navLinkStyle}>DORA</Link>
          <Link href="/trust-center" style={navLinkStyle}>Trust center</Link>
          <Link href="/login" style={ctaLinkStyle}>Open console →</Link>
        </nav>
      </header>

      <section style={heroStyle}>
        <div style={heroBadgeStyle}>GxP · GMP Annex 11 · 21 CFR Part 11</div>
        <h1 style={h1Style}>
          Signed, audit-ready evidence across your GxP-validated systems.
        </h1>
        <p style={leadStyle}>
          A computer-systems validation team shouldn&apos;t spend six weeks
          re-assembling the same screenshots every audit cycle. Attestiv
          continuously collects evidence from your MES, LIMS, historian,
          domain controllers, and storage — then ships an external
          auditor a single signed packet they verify offline.
        </p>
        <div style={ctaRowStyle}>
          <Link href="/audit/prepacket" style={primaryButtonStyle}>
            Generate a signed packet
          </Link>
          <Link href="/trust-center" style={secondaryButtonStyle}>
            Verify a manifest →
          </Link>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>What the platform produces for a GxP scope</h2>
        <p style={sectionLeadStyle}>
          Every line below is a capability you can hit today against
          a tenant&apos;s validated systems — not a roadmap promise. Click
          through to see what the auditor would see.
        </p>
        <div style={gridStyle}>
          <Feature
            title="GxP scope filter"
            clause="Annex 11 §4 — Validation"
            body="Only validated applications score against GxP controls. Non-validated apps are excluded by scope rule, so a GxP score reflects ONLY the systems whose validation status the tenant declared."
            link="/scoring"
          />
          <Feature
            title="Immutable audit trail"
            clause="Annex 11 §9 / Part 11 §11.10(e)"
            body="Audit log writes are guarded by a Postgres trigger that refuses updates and deletes. Operators can read; nobody can rewrite. Signed per-event with the same Ed25519 key that signs the evidence."
            link="/audit"
          />
          <Feature
            title="Electronic-signature surrogate"
            clause="Part 11 §11.50 / §11.70"
            body="Every evidence envelope is sealed with an Ed25519 detached signature plus a manifest binding the signature to the underlying record. Public key published at /v1/public/keys — the auditor verifies offline."
            link="/evidence/verify"
          />
          <Feature
            title="500ms NTP ceiling"
            clause="Annex 11 §10 — System security / time"
            body="Site Registry enforces a hard 500ms drift ceiling on time sync. A GxP-validated site that breaches it fails the time-control check independent of any other signal."
            link="/sites"
          />
          <Feature
            title="DR with approval gate"
            clause="Annex 11 §16 / Part 11 §11.10(d)"
            body="Every DR run has a single-use approval token with a 24h TTL and a maintenance-window constraint. Servers reject runs outside the window — the change-control envelope is enforced, not advisory."
            link="/dr"
          />
          <Feature
            title="Periodic review evidence"
            clause="Annex 11 §11 — Periodic evaluation"
            body="Scoring engine re-evaluates every framework hourly against fresh evidence. The audit packet includes the per-control evaluated_at timestamp so the auditor can see the cadence isn't manual."
            link="/scoring/trend"
          />
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>What the auditor walks away with</h2>
        <ol style={orderedListStyle}>
          <li>
            <strong>A signed zip.</strong> Manifest with per-file SHA256.
            Ed25519 signature over the manifest. Public-key block so
            verification happens offline with no network access to your
            platform.
          </li>
          <li>
            <strong>controls.csv.</strong> Every GxP control on one row:
            status, score, weight, evidence count, evaluation timestamp.
          </li>
          <li>
            <strong>gaps.csv.</strong> Only the non-passing rows, with
            the finding code, description, and remediation hint. This is
            the row set the auditor reads first.
          </li>
          <li>
            <strong>remediation_open.json.</strong> Open and in-progress
            tasks tied to the controls in gaps.csv — the work currently
            in flight, with owner, priority, and due date.
          </li>
        </ol>
        <p style={callOutStyle}>
          The auditor opens the packet on their laptop, runs the
          verification recipe in the bundled README, and reads the
          posture in under fifteen minutes. They arrive at the
          walkthrough already knowing what to ask about — not still
          searching the index.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>What this isn&apos;t</h2>
        <ul style={listStyle}>
          <li>A replacement for your validation master plan or your IQ/OQ/PQ deliverables.</li>
          <li>A document-management system. Existing controlled-document libraries stay where they are; Attestiv reads metadata, not full text.</li>
          <li>An auditor. A human still has to read the gaps and decide what&apos;s a finding vs an observation — the platform just makes the evidence verifiable.</li>
        </ul>
      </section>

      <section style={ctaSectionStyle}>
        <h2 style={ctaH2Style}>See it on your own scope</h2>
        <p style={ctaCopyStyle}>
          A working tenant can produce a real, signed GxP packet in
          one click. If you don&apos;t have a tenant yet, the trust-center
          page below has a public sample manifest you can verify with
          the platform&apos;s published key.
        </p>
        <div style={ctaRowStyle}>
          <Link href="/audit/prepacket" style={primaryButtonStyle}>
            Open the packet downloader
          </Link>
          <Link href="/trust-center" style={secondaryButtonStyle}>
            See the trust center
          </Link>
        </div>
      </section>

      <footer style={footerStyle}>
        <span>© Attestiv — compliantly-go pilot build</span>
        <span style={{ flex: 1 }} />
        <Link href="/dora" style={footerLinkStyle}>DORA scope</Link>
        <Link href="/trust-center" style={footerLinkStyle}>Trust center</Link>
        <Link href="/login" style={footerLinkStyle}>Console login</Link>
      </footer>
    </div>
  )
}

function Feature({ title, clause, body, link }: { title: string; clause: string; body: string; link: string }) {
  return (
    <Link href={link} style={featureCardStyle}>
      <div style={{ fontSize: 11, color: 'var(--color-status-amber-mid)', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}>
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
  color: 'var(--color-status-amber-mid)',
  padding: '4px 10px',
  border: '0.5px solid var(--color-status-amber-mid)',
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
