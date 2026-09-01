export interface CertificatePdfData {
    learnerName: string;
    courseTitle: string;
    issuedAt: Date;
    certificateId: string;
    verifyUrl: string;
    scorePct?: number | null;
}
export declare function renderCertificatePdf(data: CertificatePdfData): Promise<Uint8Array>;
