import { Module } from '@nestjs/common';
import { ScormCloudClient } from './scorm-cloud.client';

/**
 * Leaf: Cloud HTTP only. Imported by ScormModule (launch/import) and
 * UserModule (GDPR DeleteRegistration). Neither feature module imports the other.
 */
@Module({
  providers: [ScormCloudClient],
  exports: [ScormCloudClient],
})
export class ScormCloudModule {}
