import { renderNotificationEmail } from './notification.template';

describe('renderNotificationEmail — registration', () => {
  const reviewed = {
    kind: 'REGISTRATION_REVIEWED' as const,
    to: 'learner@example.com',
    recipientFirstName: 'Muhammad',
    courseTitle: 'NEBOSH IGC',
    courseId: 'course-1',
    registrationStatus: 'Pending' as const,
    comments: 'Use your original passport size photograph.',
  };

  it('asks the learner to update a form that was sent back, linking to the editable form', () => {
    const email = renderNotificationEmail({
      ...reviewed,
      changesRequested: true,
      courseFormId: 'cf-1',
    });

    expect(email.subject).toBe(
      'Action needed: update your registration for NEBOSH IGC',
    );
    expect(email.html).toContain('Update registration');
    expect(email.html).toContain(
      'course-booking-form?courseId=course-1&amp;formId=registration-form&amp;courseFormId=cf-1',
    );
    expect(email.text).toContain(
      'What to change: Use your original passport size photograph.',
    );
    expect(email.text).not.toContain('viewOnly');
  });

  it('keeps the plain review email for an ordinary decision', () => {
    const email = renderNotificationEmail(reviewed);

    expect(email.subject).toBe('Registration update: NEBOSH IGC');
    expect(email.text).toContain('is still pending advisor review');
    expect(email.text).toContain('viewOnly=1');
  });

  it('tells admins when a registration was resubmitted', () => {
    const base = {
      kind: 'REGISTRATION_SUBMITTED' as const,
      to: 'admin@example.com',
      recipientFirstName: 'Admin',
      studentName: 'Muhammad Idrees',
      courseTitle: 'NEBOSH IGC',
      learnerUserId: 'user-1',
      courseId: 'course-1',
      courseFormId: 'cf-1',
    };

    expect(renderNotificationEmail(base).subject).toBe(
      'Registration submitted: NEBOSH IGC',
    );
    const resubmitted = renderNotificationEmail({ ...base, resubmitted: true });
    expect(resubmitted.subject).toBe('Registration resubmitted: NEBOSH IGC');
    expect(resubmitted.text).toContain('has updated and resubmitted');
  });
});
