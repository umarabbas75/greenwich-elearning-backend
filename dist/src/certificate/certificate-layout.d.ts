import { RGB } from '@cantoo/pdf-lib';
export interface CertificateFieldLayout {
    yRatio: number;
    fontSize: number;
    maxWidth?: number;
    color: RGB;
    bold?: boolean;
    x?: number;
    align?: 'left' | 'center' | 'right';
}
export interface CertificateQrLayout {
    size: number;
    x: number;
    y: number;
    urlFontSize: number;
    urlGap: number;
    urlMaxWidth: number;
    urlColor: RGB;
}
export declare const CERTIFICATE_LAYOUT: {
    learnerName: {
        yRatio: number;
        fontSize: number;
        maxWidth: number;
        color: RGB;
        bold: true;
    };
    courseTitle: {
        yRatio: number;
        fontSize: number;
        maxWidth: number;
        color: RGB;
        bold: true;
    };
    issuedDate: {
        yRatio: number;
        fontSize: number;
        x: number;
        align: "center";
        color: RGB;
    };
    certificateId: {
        yRatio: number;
        fontSize: number;
        x: number;
        maxWidth: number;
        align: "center";
        color: RGB;
    };
    qr: {
        size: number;
        x: number;
        y: number;
        urlFontSize: number;
        urlGap: number;
        urlMaxWidth: number;
        urlColor: RGB;
    };
};
