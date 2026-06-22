import { Suspense } from 'react'

import { AttestivRemediationPage } from '@/views/AttestivRemediationPage'

// useSearchParams() inside AttestivRemediationPage (the ?task=<id>
// deep-link from the control "How did I pass?" breakdown panel) requires
// a Suspense boundary on the route under Next.js 16's static prerender,
// otherwise the build aborts with "useSearchParams() should be wrapped
// in a suspense boundary". Fallback is null — the page renders its own
// loading state during its fetch effect.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <AttestivRemediationPage />
    </Suspense>
  )
}
