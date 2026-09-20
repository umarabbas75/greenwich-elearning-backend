import { RGB } from '@cantoo/pdf-lib';
export declare const PAGE: {
    readonly width: 1684;
    readonly height: 1190;
};
export declare const OUTPUT_PAGE: {
    readonly width: 842;
    readonly height: 595;
};
export declare const OUTPUT_SCALE: number;
export declare function toPdfY(y: number): number;
export declare const COLORS: {
    green: RGB;
    navy: RGB;
    gold: RGB;
    goldLight: RGB;
    goldDark: RGB;
    line: RGB;
    white: RGB;
};
export declare const BORDER: {
    readonly outer: {
        readonly x: 30;
        readonly y: 30;
        readonly width: 1624;
        readonly height: 1130;
        readonly weight: 3;
    };
    readonly inner: {
        readonly x: 46;
        readonly y: 46;
        readonly width: 1592;
        readonly height: 1098;
        readonly weight: 1.25;
    };
    readonly corner: {
        readonly arm: 74;
        readonly inset: 8;
        readonly weight: 2;
    };
};
export declare const PANEL: {
    readonly x: 46;
    readonly y: 46;
    readonly width: 700;
    readonly height: 1098;
};
export declare const COLUMN: {
    readonly center: 1080;
    readonly width: 780;
};
export type FontKey = 'script' | 'serifBold' | 'serif' | 'sans' | 'sansBold' | 'sansHeavy' | 'sansRegular' | 'sansBoldAlt' | 'serifRegular' | 'serifBoldAlt';
export interface TextBlock {
    y: number;
    size: number;
    font: FontKey;
    color: RGB;
    tracking?: number;
    center?: number;
    maxWidth?: number;
    leading?: number;
}
export declare const FIELDS: {
    learnerName: {
        y: number;
        size: number;
        font: "script";
        color: RGB;
        maxWidth: number;
    };
    courseTitle: {
        y: number;
        size: number;
        font: "serifBold";
        color: RGB;
        tracking: number;
        maxWidth: number;
        leading: number;
    };
    issuedDate: {
        y: number;
        size: number;
        font: "serif";
        color: RGB;
        tracking: number;
        center: number;
        maxWidth: number;
    };
    certificateId: {
        y: number;
        size: number;
        font: "sans";
        color: RGB;
        tracking: number;
        maxWidth: number;
    };
};
export declare const QR: {
    readonly x: 1470;
    readonly y: 856;
    readonly size: 104;
};
export declare const CERTIFICATE_ID_PREFIX = "Certificate No: ";
export declare const STATIC_TEXT: {
    readonly wordmarkTop: {
        readonly x: 944;
        readonly y: 70;
        readonly text: "GREENWICH";
        readonly size: 54;
        readonly font: FontKey;
        readonly color: RGB;
        readonly tracking: 0.005;
    };
    readonly wordmarkBottom: {
        readonly x: 944;
        readonly y: 132;
        readonly text: "TRAINING & CONSULTING";
        readonly size: 25;
        readonly font: FontKey;
        readonly color: RGB;
        readonly tracking: 0.025;
    };
    readonly title: {
        readonly y: 196;
        readonly text: "CERTIFICATE";
        readonly size: 76;
        readonly font: FontKey;
        readonly color: RGB;
        readonly tracking: 0.05;
    };
    readonly subtitle: {
        readonly y: 318;
        readonly text: "OF COMPLETION";
        readonly size: 34;
        readonly font: FontKey;
        readonly color: RGB;
        readonly tracking: 0.26;
    };
    readonly certify: {
        readonly y: 424;
        readonly text: "This is to certify that";
        readonly size: 31;
        readonly font: FontKey;
        readonly color: RGB;
        readonly tracking: 0.02;
    };
    readonly completed: {
        readonly y: 596;
        readonly text: "has successfully completed the training programme in";
        readonly size: 29;
        readonly font: FontKey;
        readonly color: RGB;
        readonly tracking: 0.02;
    };
    readonly citation: {
        readonly y: 772;
        readonly text: "and demonstrated a commitment to professional development and excellence.";
        readonly size: 27;
        readonly font: FontKey;
        readonly color: RGB;
        readonly tracking: 0.02;
        readonly maxWidth: 700;
        readonly leading: 1.35;
    };
    readonly signatureRole: {
        readonly y: 964;
        readonly text: "Director Learning";
        readonly size: 20;
        readonly font: FontKey;
        readonly color: RGB;
        readonly tracking: 0.02;
        readonly center: 870;
    };
    readonly signatureOrg: {
        readonly y: 1004;
        readonly text: "Greenwich Training & Consulting";
        readonly size: 21;
        readonly font: FontKey;
        readonly color: RGB;
        readonly tracking: 0.02;
        readonly center: 870;
    };
    readonly dateLabel: {
        readonly y: 976;
        readonly text: "Date of Issue";
        readonly size: 20;
        readonly font: FontKey;
        readonly color: RGB;
        readonly tracking: 0.02;
        readonly center: 1290;
    };
    readonly qrLabel: {
        readonly y: 972;
        readonly text: "SCAN TO VERIFY";
        readonly size: 14;
        readonly font: FontKey;
        readonly color: RGB;
        readonly tracking: 0.08;
        readonly center: 1522;
    };
    readonly tagline: {
        readonly x: 110;
        readonly y: 662;
        readonly size: 36;
        readonly font: FontKey;
        readonly color: RGB;
        readonly tracking: 0.06;
        readonly leading: 1.5;
        readonly maxWidth: 300;
    };
};
export declare const TAGLINE_LINES: readonly ["KNOWLEDGE", "FOR A SAFER,", "HEALTHIER", "AND MORE", "SUSTAINABLE", "TOMORROW"];
export declare const ORNAMENTS: {
    readonly nameRule: {
        readonly x: 760;
        readonly y: 572;
        readonly width: 640;
        readonly height: 1.6;
    };
    readonly signatureRule: {
        readonly x: 740;
        readonly y: 950;
        readonly width: 260;
        readonly height: 1.4;
    };
    readonly dateRule: {
        readonly x: 1160;
        readonly y: 950;
        readonly width: 260;
        readonly height: 1.4;
    };
    readonly taglineRule: {
        readonly x: 110;
        readonly y: 1020;
        readonly width: 110;
        readonly height: 2;
    };
    readonly emblemRule: {
        readonly x: 1466;
        readonly y: 596;
        readonly width: 74;
        readonly height: 2;
    };
    readonly divider: {
        readonly center: 1080;
        readonly y: 394;
        readonly armLength: 274;
        readonly gap: 66;
    };
    readonly seal: {
        readonly center: 1080;
        readonly y: 940;
        readonly radius: 76;
    };
    readonly globe: {
        readonly x: 1364;
        readonly y: 116;
        readonly size: 268;
    };
    readonly leafBase: {
        readonly x: 1498;
        readonly y: 372;
        readonly height: 210;
    };
    readonly logoMark: {
        readonly x: 840;
        readonly y: 70;
        readonly width: 88;
        readonly height: 86;
    };
    readonly signature: {
        readonly x: 762;
        readonly y: 875;
        readonly width: 216;
        readonly height: 69;
    };
    readonly emblemWords: {
        readonly x: 1466;
        readonly y: 458;
        readonly size: 26;
        readonly lineGap: 38;
    };
};
export declare const CLIENT_PAGE: {
    readonly width: 841.89;
    readonly height: 595.28;
};
export interface FieldSpec {
    baseline: number;
    size: number;
    font: FontKey;
    color: RGB;
    tracking?: number;
    x: number;
    align: 'center' | 'left';
    maxWidth: number;
    maxLines?: number;
    baselineWhenWrapped?: number;
    sizeWhenWrapped?: number;
    leading?: number;
    minSize?: number;
}
export declare const CLIENT_FIELDS: {
    learnerName: {
        baseline: number;
        size: number;
        font: FontKey;
        color: RGB;
        tracking: number;
        x: number;
        align: "center";
        maxWidth: number;
        minSize: number;
    };
    courseTitle: {
        baseline: number;
        size: number;
        font: FontKey;
        color: RGB;
        tracking: number;
        x: number;
        align: "center";
        maxWidth: number;
        maxLines: number;
        baselineWhenWrapped: number;
        sizeWhenWrapped: number;
        leading: number;
        minSize: number;
    };
    certificateId: {
        baseline: number;
        size: number;
        font: FontKey;
        color: RGB;
        x: number;
        align: "left";
        maxWidth: number;
        minSize: number;
    };
    issuedDate: {
        baseline: number;
        size: number;
        font: FontKey;
        color: RGB;
        x: number;
        align: "left";
        maxWidth: number;
        minSize: number;
    };
};
export declare const CLIENT_QR: {
    readonly x: 292.5;
    readonly y: 347;
    readonly size: 52;
};
