import { v2 as cloudinary } from 'cloudinary';

export function configureCloudinary(config: {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}): void {
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });
}

/** Uploads a PDF buffer to Cloudinary (raw resource) and returns the secure URL. */
export function uploadCertificatePdf(
  buffer: Buffer,
  publicId: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: 'certificates',
        public_id: publicId,
        format: 'pdf',
        overwrite: true,
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          reject(error ?? new Error('Cloudinary upload returned no URL'));
          return;
        }
        resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}
