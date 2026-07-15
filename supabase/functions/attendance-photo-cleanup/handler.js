import { createAdminClient as createDefaultAdminClient } from '../_shared/clients.ts'
import { jsonResponse } from '../_shared/responses.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CANDIDATE_KEYS = ['bucketId', 'objectPath', 'photoId']
const encoder = new TextEncoder()

function runtimeEnvironment(name) {
  return globalThis.Deno?.env?.get?.(name) ?? globalThis.process?.env?.[name]
}

function safeJson(status, body) {
  return jsonResponse(body, status)
}

function constantTimeEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) {
    return false
  }
  const actualBytes = encoder.encode(actual)
  const expectedBytes = encoder.encode(expected)
  let difference = actualBytes.length ^ expectedBytes.length
  const length = Math.max(actualBytes.length, expectedBytes.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0)
  }
  return difference === 0
}

function hasGatewayBearer(request) {
  return /^Bearer [^\s,]+$/u.test(request.headers.get('authorization') ?? '')
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validCandidate(value) {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value).sort()
  if (
    keys.length !== CANDIDATE_KEYS.length ||
    keys.some((key, index) => key !== CANDIDATE_KEYS[index]) ||
    value.bucketId !== 'erp-attendance-photos' ||
    typeof value.photoId !== 'string' ||
    !UUID.test(value.photoId) ||
    typeof value.objectPath !== 'string'
  ) {
    return false
  }

  const [employeeId, sessionId, workPointId, pathPhotoId, phase, ...extra] =
    value.objectPath.split('/')
  return extra.length === 0 &&
    UUID.test(employeeId ?? '') &&
    UUID.test(sessionId ?? '') &&
    UUID.test(workPointId ?? '') &&
    UUID.test(pathPhotoId ?? '') &&
    pathPhotoId === value.photoId &&
    (phase === 'before' || phase === 'after')
}

function verifiedRemoval(data, objectPath) {
  if (!Array.isArray(data)) return false
  if (data.length === 0) return true
  return data.length === 1 && isPlainObject(data[0]) &&
    data[0].name === objectPath
}

export function createAttendancePhotoCleanupHandler(dependencies = {}) {
  const getEnv = dependencies.getEnv ?? runtimeEnvironment
  const cleanupSecret = Object.hasOwn(dependencies, 'cleanupSecret')
    ? dependencies.cleanupSecret
    : getEnv('ATTENDANCE_CLEANUP_SECRET')
  const createAdminClient = dependencies.createAdminClient ??
    createDefaultAdminClient
  const claimLimit = Object.hasOwn(dependencies, 'claimLimit')
    ? dependencies.claimLimit
    : 100
  const hasValidCleanupSecret = typeof cleanupSecret === 'string' &&
    cleanupSecret.length > 0 && cleanupSecret === cleanupSecret.trim()

  return async function attendancePhotoCleanupHandler(request) {
    if (request.method !== 'POST') {
      return safeJson(405, { code: 'METHOD_NOT_ALLOWED' })
    }
    if (!hasGatewayBearer(request)) {
      return safeJson(401, { code: 'UNAUTHORIZED' })
    }
    if (!hasValidCleanupSecret) {
      return safeJson(503, { code: 'CLEANUP_UNAVAILABLE' })
    }
    if (!constantTimeEqual(
      request.headers.get('x-attendance-cleanup-secret'),
      cleanupSecret,
    )) return safeJson(401, { code: 'UNAUTHORIZED' })
    if (!Number.isInteger(claimLimit) || claimLimit < 1 || claimLimit > 500) {
      return safeJson(503, { code: 'CLEANUP_UNAVAILABLE' })
    }

    try {
      const admin = await createAdminClient()
      const claim = await admin.rpc(
        'claim_attendance_photo_cleanup_secure',
        { p_limit: claimLimit },
      )
      if (
        claim?.error || !Array.isArray(claim?.data) ||
        claim.data.length > claimLimit
      ) {
        return safeJson(503, { code: 'CLEANUP_UNAVAILABLE' })
      }

      let deleted = 0
      let failed = 0
      for (const candidate of claim.data) {
        if (!validCandidate(candidate)) {
          failed += 1
          continue
        }
        try {
          const removal = await admin.storage
            .from(candidate.bucketId)
            .remove([candidate.objectPath])
          if (removal?.error || !verifiedRemoval(
            removal?.data,
            candidate.objectPath,
          )) {
            failed += 1
            continue
          }
          const completion = await admin.rpc(
            'complete_attendance_photo_cleanup_secure',
            { p_photo_id: candidate.photoId },
          )
          if (completion?.error || completion?.data !== true) failed += 1
          else deleted += 1
        } catch {
          failed += 1
        }
      }

      return safeJson(200, {
        claimed: claim.data.length,
        deleted,
        failed,
      })
    } catch {
      return safeJson(503, { code: 'CLEANUP_UNAVAILABLE' })
    }
  }
}
