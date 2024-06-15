import { google } from 'googleapis';
import * as path from 'path';

const KEYFILEPATH = path.join(__dirname, './client_secret.json'); // Update with your path
const SCOPES = ['https://www.googleapis.com/auth/drive'];

export const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});

export const drive = google.drive({
  version: 'v3',
  auth,
});
