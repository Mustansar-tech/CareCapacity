import { storage } from '../storage';
import { logger } from '../logger';

let latestExportBuffer: Buffer | null = null;

export function getLatestExportBuffer(): Buffer | null {
  return latestExportBuffer;
}

export function setLatestExportBuffer(buf: Buffer): void {
  latestExportBuffer = buf;
}

const guaranteedBufferByBranch: Map<string, Buffer> = new Map();

export function setLatestGuaranteedBuffer(branchId: string, buffer: Buffer): void {
  logger.debug('Storing GH buffer', { branchId, bytes: buffer.length });
  guaranteedBufferByBranch.set(branchId, buffer);
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
        logger.debug('Retrieved GH buffer from database and cached', { branchId, bytes: buffer.length });
      }
    } catch (dbError) {
      logger.error('Failed to retrieve GH buffer from database', dbError);
    }
  }

  logger.debug('GH buffer retrieval result', { branchId, bytes: buffer ? buffer.length : 0, found: !!buffer });
  return buffer;
}
