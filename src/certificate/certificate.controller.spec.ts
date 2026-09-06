import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { CertificateController } from './certificate.controller';

describe('CertificateController public verify contract', () => {
  it('exposes GET verify/:certificateId without an auth guard', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, CertificateController.prototype.verify),
    ).toBe('verify/:certificateId');
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        CertificateController.prototype.verify,
      ),
    ).toBeUndefined();
  });
});
