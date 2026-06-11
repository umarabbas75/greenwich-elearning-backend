import { CourseCompletedMail, FeedbackReceivedAdminMail, FeedbackReceivedMail, FeedbackRequestMail, PendingFeedbackOutstandingMail } from '../mail.types';
import { RenderedEmail } from './mail-layout';
export declare function renderCourseCompleted(mail: CourseCompletedMail): RenderedEmail;
export declare function renderFeedbackRequest(mail: FeedbackRequestMail): RenderedEmail;
export declare function renderPendingFeedbackOutstanding(mail: PendingFeedbackOutstandingMail): RenderedEmail;
export declare function renderFeedbackReminder(mail: FeedbackRequestMail): RenderedEmail;
export declare function renderFeedbackReceived(mail: FeedbackReceivedMail): RenderedEmail;
export declare function renderFeedbackReceivedAdmin(mail: FeedbackReceivedAdminMail): RenderedEmail;
