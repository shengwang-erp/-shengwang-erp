export function hasActiveContractRevenueRows(rows, projectId) {
  const normalizedProjectId = String(projectId || '').trim()
  if (!normalizedProjectId || !Array.isArray(rows)) {
    return false
  }

  return rows.some((row) => {
    if (String(row?.projectId || '').trim() !== normalizedProjectId) {
      return false
    }
    const status = row?.statusCode || row?.status || 'active'
    return status !== 'void' && status !== 'deleted'
  })
}
