import { CertificateIssuedAdminMail, CertificateIssuedMail } from '../mail.types';
import { RenderedEmail } from './mail-layout';
export declare function renderCertificateIssued(mail: CertificateIssuedMail): RenderedEmail;
export declare function renderCertificateIssuedAdmin(mail: CertificateIssuedAdminMail): RenderedEmail;
