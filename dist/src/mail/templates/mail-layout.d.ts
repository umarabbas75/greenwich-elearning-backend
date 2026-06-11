export interface RenderedEmail {
    subject: string;
    html: string;
    text: string;
}
export declare const BRAND: {
    readonly name: "Greenwich Training & Consulting";
    readonly logoUrl: "https://res.cloudinary.com/dp9urvlsz/image/upload/v1780840754/greenwich_logo_s9mgyc.png";
    readonly primary: "#344e41";
    readonly primaryDark: "#2a3f34";
    readonly footerLink: "#a7c4b5";
    readonly text: "#3f3f46";
    readonly heading: "#1f2933";
    readonly muted: "#71717a";
    readonly bg: "#f4f5f7";
    readonly card: "#ffffff";
    readonly website: "https://www.greenwichtc-elearning.com";
};
export declare const ADMIN_EMAIL = "umarabbas75@gmail.com";
export declare function escapeHtml(value: string): string;
export declare function layout(args: {
    heading: string;
    bodyHtml: string;
    ctaLabel?: string;
    ctaUrl?: string;
}): string;
