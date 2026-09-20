interface Variant {
    panel: string;
    panelBox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    globeArt: string;
    globe: {
        x: number;
        y: number;
        size: number;
    };
    leafBase: {
        x: number;
        y: number;
    };
    leafScale: number;
    globeUnderBorder: boolean;
    emblemWords: {
        x: number;
        y: number;
        size: number;
        lineGap: number;
    };
    emblemRule: {
        x: number;
        y: number;
    };
    output: string;
}
export declare function buildTemplate(v: Variant): Promise<Uint8Array>;
export {};
