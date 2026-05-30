import { AttestivBoardPackPage } from '@/views/AttestivBoardPackPage'

// /management/board-pack is a MANAGEMENT view. Audit pre-packet
// generators MUST NOT pull from it; auditor tokens cannot reach it
// (SECTION_ROLES.management excludes auditor). See
// docs/audit-management-boundary.md.
export default function Page() {
  return <AttestivBoardPackPage />
}
