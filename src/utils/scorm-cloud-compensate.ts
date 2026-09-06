import { Logger } from '@nestjs/common';
import { ScormCloudClient } from '../scorm-cloud/scorm-cloud.client';
import { errorMessage } from './error-message';

export async function compensateCloudRegistration(
  cloud: ScormCloudClient,
  registrationId: string,
  logger: Logger,
): Promise<void> {
  try {
    await cloud.deleteRegistration(registrationId);
  } catch (err) {
    logger.warn(
      `Failed to compensate Cloud registration ${registrationId}: ${errorMessage(err)}`,
    );
  }
}
