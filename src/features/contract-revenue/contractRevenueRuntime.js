import { buildProjectRevenueSnapshotCollection } from './contractRevenueCalculations.js'

export function buildProjectRevenueSnapshotsForAccess({
  canViewRevenue,
  projects = [],
  changes = [],
  plans = [],
  receipts = [],
} = {}) {
  if (!canViewRevenue) return new Map()
  return buildProjectRevenueSnapshotCollection(projects, changes, plans, receipts)
}
