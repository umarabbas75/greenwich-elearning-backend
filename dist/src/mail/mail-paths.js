"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appHome = exports.studentRegistrationFormView = exports.studentCourseFormPage = exports.advisorRegistrationReview = exports.adminIssuedCertificates = exports.adminContactInbox = exports.adminAssignmentSubmissions = exports.studentAssignmentDetail = exports.adminFeedback = exports.assessmentGrade = exports.forumThread = exports.studentCourseFeedback = exports.certificateVerify = exports.studentCourseDetail = exports.studentCoursesList = void 0;
const mail_layout_1 = require("./templates/mail-layout");
function studentCoursesList() {
    return `${mail_layout_1.BRAND.website}/studentCourses`;
}
exports.studentCoursesList = studentCoursesList;
function studentCourseDetail(courseId) {
    return `${mail_layout_1.BRAND.website}/studentCourses/${encodeURIComponent(courseId)}`;
}
exports.studentCourseDetail = studentCourseDetail;
function certificateVerify(certificateId) {
    return `${mail_layout_1.BRAND.website}/certificates/verify/${encodeURIComponent(certificateId)}`;
}
exports.certificateVerify = certificateVerify;
function studentCourseFeedback(courseId) {
    return `${mail_layout_1.BRAND.website}/studentCourses/${encodeURIComponent(courseId)}/feedback`;
}
exports.studentCourseFeedback = studentCourseFeedback;
function forumThread(threadId) {
    return `${mail_layout_1.BRAND.website}/forum/${encodeURIComponent(threadId)}`;
}
exports.forumThread = forumThread;
function assessmentGrade(attemptId) {
    return `${mail_layout_1.BRAND.website}/assessment/grade/${encodeURIComponent(attemptId)}`;
}
exports.assessmentGrade = assessmentGrade;
function adminFeedback() {
    return `${mail_layout_1.BRAND.website}/feedback`;
}
exports.adminFeedback = adminFeedback;
function studentAssignmentDetail(assignmentId) {
    return `${mail_layout_1.BRAND.website}/assignments/${encodeURIComponent(assignmentId)}`;
}
exports.studentAssignmentDetail = studentAssignmentDetail;
function adminAssignmentSubmissions(assignmentId) {
    return `${mail_layout_1.BRAND.website}/admin/assignments/${encodeURIComponent(assignmentId)}/submissions`;
}
exports.adminAssignmentSubmissions = adminAssignmentSubmissions;
function adminContactInbox() {
    return `${mail_layout_1.BRAND.website}/contact-us`;
}
exports.adminContactInbox = adminContactInbox;
function adminIssuedCertificates() {
    return `${mail_layout_1.BRAND.website}/admin/certificates`;
}
exports.adminIssuedCertificates = adminIssuedCertificates;
function advisorRegistrationReview(args) {
    const params = new URLSearchParams({
        viewOnly: '1',
        courseId: args.courseId,
        formId: 'registration-form',
        courseFormId: args.courseFormId,
    });
    return `${mail_layout_1.BRAND.website}/user/${encodeURIComponent(args.userId)}/forms/course-booking-form/advisor-review?${params.toString()}`;
}
exports.advisorRegistrationReview = advisorRegistrationReview;
function studentCourseFormPage(courseId) {
    return `${mail_layout_1.BRAND.website}/studentCourses/${encodeURIComponent(courseId)}/course-form-page`;
}
exports.studentCourseFormPage = studentCourseFormPage;
function studentRegistrationFormView(courseId) {
    const params = new URLSearchParams({
        viewOnly: '1',
        courseId,
    });
    return `${mail_layout_1.BRAND.website}/studentCourses/${encodeURIComponent(courseId)}/course-form-page/forms/course-booking-form?${params.toString()}`;
}
exports.studentRegistrationFormView = studentRegistrationFormView;
function appHome() {
    return mail_layout_1.BRAND.website;
}
exports.appHome = appHome;
//# sourceMappingURL=mail-paths.js.map