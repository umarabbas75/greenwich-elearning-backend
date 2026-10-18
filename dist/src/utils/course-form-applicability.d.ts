export declare function formAppliesToEnrollment(formCreatedAt: Date, enrolledAt: Date | null | undefined): boolean;
type CourseFormAnchors = {
    createdAt: Date;
    requiredSince: Date;
    detachedWindows: unknown;
};
export declare function courseFormAttachedForEnrollment(form: Omit<CourseFormAnchors, 'requiredSince'>, enrolledAt: Date | null | undefined): boolean;
export declare function courseFormAppliesToEnrollment(form: CourseFormAnchors, enrolledAt: Date | null | undefined): boolean;
export {};
