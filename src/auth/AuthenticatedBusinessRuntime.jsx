import React from 'react'

import BusinessRuntimeBoundary from './BusinessRuntimeBoundary.jsx'

export default function AuthenticatedBusinessRuntime({
  actorId,
  onLogout,
  buildId,
  children,
}) {
  return (
    <BusinessRuntimeBoundary key={actorId} onLogout={onLogout} buildId={buildId}>
      {children}
    </BusinessRuntimeBoundary>
  )
}
