import { Router, Request, Response, NextFunction } from 'express'
import { authenticate } from '../middleware/auth.js'
import { requireVerifier, requireAdmin } from '../middleware/rbac.js'
import { recordVerification, listVerifications, VerificationConflictError } from '../services/verifiers.js'
import { createAuditLog } from '../lib/audit-logs.js'
import { AppError } from '../middleware/errorHandler.js'
import { createEvidenceReference, EvidenceReferenceValidationError } from '../services/evidence.js'
import { db } from '../db/knex.js'
import { retryWithBackoff } from '../utils/retry.js'

export const verificationsRouter = Router()

const EVIDENCE_HASH_RE = /^[0-9a-f]{32,128}$/i
const MAX_BATCH_SIZE = 100

function isSerializationError(err: Error): boolean {
  const msg = err.message.toLowerCase()
  return msg.includes('serialization') || msg.includes('could not serialize') || msg.includes('deadlock')
}

verificationsRouter.post('/', authenticate, requireVerifier, async (req: Request, res: Response, next: NextFunction) => {
  const payload = req.user!
  const verifierUserId = payload.userId
  const { targetId, result, disputed, evidenceHash, evidenceReferenceUrl } = req.body as {
    targetId?: string
    result?: 'approved' | 'rejected'
    disputed?: boolean
    evidenceHash?: string
    evidenceReferenceUrl?: string
  }

  if (!targetId || !targetId.trim()) {
    return next(AppError.badRequest('targetId is required'))
  }

  if (result !== 'approved' && result !== 'rejected') {
    return next(AppError.validation("result must be 'approved' or 'rejected'"))
  }

  if (!evidenceHash || !evidenceHash.trim()) {
    return next(AppError.badRequest('evidenceHash is required'))
  }

  const cleanEvidenceHash = evidenceHash.trim().toLowerCase()
  if (!EVIDENCE_HASH_RE.test(cleanEvidenceHash)) {
    return next(AppError.validation('evidenceHash must be a valid hex string (32–128 characters)'))
  }

  if (!evidenceReferenceUrl || !evidenceReferenceUrl.trim()) {
    return next(AppError.badRequest('evidenceReferenceUrl is required'))
  }

  try {
    const cleanTargetId = targetId.trim()

    // Wrap recordVerification + createAuditLog in a single Knex transaction so
    // a crash between the two writes cannot leave the verification row without
    // an audit trail.  createEvidenceReference uses Prisma and cannot join the
    // Knex transaction; it is idempotent (ON CONFLICT DO UPDATE) so it is safe
    // to call after the Knex tx commits.
    const rec = await retryWithBackoff(
      () =>
        db.transaction(async (trx) => {
          const verification = await recordVerification(
            verifierUserId,
            cleanTargetId,
            result,
            !!disputed,
            cleanEvidenceHash,
            trx,
          )

          await createAuditLog(
            {
              actor_user_id: verifierUserId,
              action: 'verification.decision.recorded',
              target_type: 'verification',
              target_id: cleanTargetId,
              metadata: {
                result,
                disputed: !!disputed,
                evidence_hash: cleanEvidenceHash,
              },
            },
            trx,
          )

          return verification
        }),
      undefined,
      isSerializationError,
    )

    const evidenceReference = await createEvidenceReference(
      rec.id,
      evidenceHash.trim(),
      evidenceReferenceUrl.trim(),
    )

    res.status(201).json({ verification: rec, evidenceReference })
  } catch (error: any) {
    if (error?.name === 'VerificationConflictError') {
      return next(AppError.conflict('conflicting verification decision already exists'))
    }

    if (error?.name === 'EvidenceReferenceValidationError') {
      return next(AppError.validation(error.message))
    }

    return next(AppError.internal('failed to record verification decision'))
  }
})

verificationsRouter.get('/', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  const all = await listVerifications()
  res.json({ verifications: all })
})

interface BulkCheckInItem {
  targetId: string
  result: 'approved' | 'rejected'
  disputed?: boolean
  evidenceHash: string
  evidenceReferenceUrl: string
}

interface BulkCheckInResult {
  targetId: string
  success: boolean
  error?: {
    code: string
    message:string
  }
  verification?: {
    id: string
    verifierUserId: string
    targetId: string
    result: 'approved' | 'rejected'
    evidenceHash: string | null
    disputed: boolean
    timestamp: string
  }
  evidenceReference?: {
    id: string
    verificationId: string
    evidenceHash: string
    evidenceReferenceUrl: string
  }
}

interface BulkCheckInResponse {
  results: BulkCheckInResult[]
  summary: {
    total: number
    succeeded: number
    failed: number
  }
}

verificationsRouter.post('/bulk', authenticate, requireVerifier, async (req: Request, res: Response, next: NextFunction) => {
  const payload = req.user!
  const verifierUserId = payload.userId
  const items = req.body as BulkCheckInItem[]

  if (!Array.isArray(items)) {
    return next(AppError.badRequest('Request body must be an array of check-in items'))
  }

  if (items.length === 0) {
    return next(AppError.badRequest('Request body must contain at least one check-in item'))
  }

  if (items.length > MAX_BATCH_SIZE) {
    return next(AppError.badRequest(`Batch size exceeds maximum of ${MAX_BATCH_SIZE}`))
  }

  const results: BulkCheckInResult[] = []
  let succeeded = 0
  let failed = 0

  for (const item of items) {
    const { targetId, result, disputed, evidenceHash, evidenceReferenceUrl } = item

    const itemResult: BulkCheckInResult = {
      targetId,
      success: false,
    }

    try {
      // Validate individual item
      if (!targetId || !targetId.trim()) {
        throw AppError.badRequest('targetId is required')
      }

      if (result !== 'approved' && result !== 'rejected') {
        throw AppError.validation("result must be 'approved' or 'rejected'")
      }

      if (!evidenceHash || !evidenceHash.trim()) {
        throw AppError.badRequest('evidenceHash is required')
      }

      const cleanEvidenceHash = evidenceHash.trim().toLowerCase()
      if (!EVIDENCE_HASH_RE.test(cleanEvidenceHash)) {
        throw AppError.validation('evidenceHash must be a valid hex string (32–128 characters)')
      }

      if (!evidenceReferenceUrl || !evidenceReferenceUrl.trim()) {
        throw AppError.badRequest('evidenceReferenceUrl is required')
      }

      const cleanTargetId = targetId.trim()
      const cleanEvidenceReferenceUrl = evidenceReferenceUrl.trim()

      // Process the verification
      const rec = await retryWithBackoff(
        () =>
          db.transaction(async (trx) => {
            const verification = await recordVerification(
              verifierUserId,
              cleanTargetId,
              result,
              !!disputed,
              cleanEvidenceHash,
              trx,
            )

            await createAuditLog(
              {
                actor_user_id: verifierUserId,
                action: 'verification.decision.recorded',
                target_type: 'verification',
                target_id: cleanTargetId,
                metadata: {
                  result,
                  disputed: !!disputed,
                  evidence_hash: cleanEvidenceHash,
                },
              },
              trx,
            )

            return verification
          }),
        undefined,
        isSerializationError,
      )

      const evidenceReference = await createEvidenceReference(
        rec.id,
        cleanEvidenceHash,
        cleanEvidenceReferenceUrl,
      )

      itemResult.success = true
      itemResult.verification = rec
      itemResult.evidenceReference = evidenceReference
      succeeded++
    } catch (error: any) {
      failed++
      if (error?.name === 'VerificationConflictError') {
        itemResult.error = {
          code: 'CONFLICT',
          message: 'conflicting verification decision already exists',
        }
      } else if (error?.name === 'EvidenceReferenceValidationError') {
        itemResult.error = {
          code: 'VALIDATION_ERROR',
          message: error.message,
        }
      } else if (error instanceof AppError) {
        itemResult.error = {
          code: error.statusCode === 400 ? 'BAD_REQUEST' : error.statusCode === 409 ? 'CONFLICT' : 'INTERNAL_ERROR',
          message: error.message,
        }
      } else {
        itemResult.error = {
          code: 'INTERNAL_ERROR',
          message: 'failed to record verification decision',
        }
      }
    }

    results.push(itemResult)
  }

  const response: BulkCheckInResponse = {
    results,
    summary: {
      total: items.length,
      succeeded,
      failed,
    },
  }

  res.status(200).json(response)
})
