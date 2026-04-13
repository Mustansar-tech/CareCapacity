import { storage } from '../storage';
import { logger } from '../infrastructure/logger';

let latestExportBuffer: Buffer | null = null;

export function getLatestExportBuffer(): Buffer | null {
  return latestExportBuffer;
}

export function setLatestExportBuffer(buf: Buffer): void {
  latestExportBuffer = buf;
}

const guaranteedBufferByBranch: Map<string, Buffer> = new Map();

// Monotonically-increasing version counter per branch.
// Incremented whenever the GH buffer is updated — used to invalidate the
// visits parse cache in visits.controller.ts.
const guaranteedBufferVersion: Map<string, number> = new Map();

export function setLatestGuaranteedBuffer(branchId: string, buffer: Buffer): void {
  logger.debug('Storing GH buffer', { branchId, bytes: buffer.length });
  guaranteedBufferByBranch.set(branchId, buffer);
  guaranteedBufferVersion.set(branchId, (guaranteedBufferVersion.get(branchId) ?? 0) + 1);
}

export function getGuaranteedBufferVersion(branchId: string): number {
  return guaranteedBufferVersion.get(branchId) ?? 0;
}

export async function getLatestGuaranteedBuffer(branchId: string): Promise<Buffer | null> {
  logger.debug('Retrieving GH buffer', { branchId });

  let buffer = guaranteedBufferByBranch.get(branchId) || null;

  if (!buffer) {
    logger.debug('GH buffer not in memory, checking database', { branchId });
    try {
      const upload = await storage.getLatestBranchUpload(branchId, 'guaranteedHours');
      if (upload) {
        buffer = Buffer.from(upload.fileBuffer, 'base64');
        guaranteedBufferByBranch.set(branchId, buffer);
        // Only bump the version once per cold-load so the visits cache stays valid
        // across requests while the buffer remains unchanged.
        if (!guaranteedBufferVersion.has(branchId)) {
          guaranteedBufferVersion.set(branchId, 1);
        }
        logger.debug('Retrieved GH buffer from database and cached', { branchId, bytes: buffer.length });
      }
    } catch (dbError) {
      logger.error('Failed to retrieve GH buffer from database', dbError);
    }
  }

  logger.debug('GH buffer retrieval result', { branchId, bytes: buffer ? buffer.length : 0, found: !!buffer });
  return buffer;
}
