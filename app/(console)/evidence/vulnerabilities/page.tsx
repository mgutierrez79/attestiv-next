import { Suspense } from 'react'

import { AttestivVulnerabilitiesPage } from '@/views/AttestivVulnerabilitiesPage'

// useSearchParams() inside AttestivVulnerabilitiesPage (the ?q /
// ?severity / ?source / ?kev filter deep-links from the asset detail
// card) requires a Suspense boundary under Next.js 16's static
// prerender. The fallback is null because the page renders its own
// Skeleton rows while loading.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <AttestivVulnerabilitiesPage />
    </Suspense>
  )
}
