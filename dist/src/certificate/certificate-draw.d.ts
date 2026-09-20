import { PDFDocument, PDFFont, PDFPage, RGB } from '@cantoo/pdf-lib';
import { FieldSpec, FontKey, TextBlock } from './certificate-layout';
export type CertificateFonts = Record<FontKey, PDFFont>;
export declare function embedCertificateFonts<K extends FontKey = FontKey>(doc: PDFDocument, keys?: readonly K[]): Promise<Record<K, PDFFont>>;
export declare function measure(text: string, font: PDFFont, size: number, tracking?: number): number;
export declare function fitSize(text: string, font: PDFFont, size: number, maxWidth?: number, tracking?: number, floor?: number): number;
export declare function wrap(text: string, font: PDFFont, size: number, maxWidth: number, tracking?: number, maxLines?: number): string[];
interface DrawOptions {
    anchor?: 'top' | 'baseline';
    text: string;
    font: PDFFont;
    size: number;
    color: RGB;
    tracking?: number;
    center?: number;
    left?: number;
    y: number;
}
export declare function drawLine(page: PDFPage, opts: DrawOptions): void;
export declare function drawBlock(page: PDFPage, text: string, block: TextBlock & {
    center?: number;
}, font: PDFFont, fallbackCenter: number, maxLines?: number): void;
export declare function drawField(page: PDFPage, text: string, spec: FieldSpec, font: PDFFont, pageHeight: number): void;
export {};
