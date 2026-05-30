import { AttestivROIPage } from '@/views/AttestivROIPage'

// /management/roi is a MANAGEMENT view — the financial impact
// engine's output. Intentionally outside the /audit/* namespace so
// audit pre-packet generators don't pull it in and so auditor tokens
// can't reach it (see docs/audit-management-boundary.md).
export default function Page() {
  return <AttestivROIPage />
}
