import * as multer from 'multer';
import { drive } from './google.config';

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
  },
}).single('file');

export async function uploadToGoogleDrive(file: Express.Multer.File) {
  const { originalname, buffer } = file;
  const response = await drive.files.create({
    requestBody: {
      name: originalname,
      mimeType: file.mimetype,
    },
    media: {
      mimeType: file.mimetype,
      body: Buffer.from(buffer),
    },
  });
  return response.data;
}
