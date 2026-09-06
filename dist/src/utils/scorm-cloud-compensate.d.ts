import { Logger } from '@nestjs/common';
import { ScormCloudClient } from '../scorm-cloud/scorm-cloud.client';
export declare function compensateCloudRegistration(cloud: ScormCloudClient, registrationId: string, logger: Logger): Promise<void>;
