/// <reference types="node" />
export declare function configureCloudinary(config: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
}): void;
export declare function uploadCertificatePdf(buffer: Buffer, publicId: string): Promise<string>;
