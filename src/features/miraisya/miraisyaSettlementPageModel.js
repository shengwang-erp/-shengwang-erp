export function buildSettlementSelectionSummary(candidates, selectedIds) {
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : [])
  const rows = (Array.isArray(candidates) ? candidates : []).filter((candidate) =>
    selected.has(candidate.projectId)
  )
  const incompleteSources = [...new Set(rows.flatMap((candidate) =>
    Array.isArray(candidate.incompleteSources) ? candidate.incompleteSources : []
  ))]
  const summary = rows.reduce((result, candidate) => ({
    selectedCount: result.selectedCount + 1,
    carriedForwardCount: result.carriedForwardCount + (candidate.carriedForward ? 1 : 0),
    taxExclusiveAmount: result.taxExclusiveAmount + candidate.taxExclusiveAmount,
    taxAmount: result.taxAmount + candidate.taxAmount,
    taxInclusiveAmount: result.taxInclusiveAmount + candidate.taxInclusiveAmount,
    totalCostAmount: result.totalCostAmount + candidate.costAmount,
  }), {
    selectedCount: 0,
    carriedForwardCount: 0,
    taxExclusiveAmount: 0,
    taxAmount: 0,
    taxInclusiveAmount: 0,
    totalCostAmount: 0,
  })
  return {
    ...summary,
    marginAmount: summary.taxExclusiveAmount - summary.totalCostAmount,
    incompleteSources,
    canCreateDraft: summary.selectedCount > 0 && incompleteSources.length === 0 &&
      rows.every((candidate) => candidate.costComplete === true),
  }
}
