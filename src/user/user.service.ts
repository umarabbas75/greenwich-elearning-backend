import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, SecurityEventType, User } from '@prisma/client';
import { ResponseDto, BodyDto, BodyUpdateDto, ChangePasswordDto } from '../dto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class UserService {
  private static readonly logger = new Logger(UserService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  /**
   * Best-effort audit of an authenticated self-service password change. Never
   * throws — a logging failure must not fail the password update itself.
   */
  private async recordPasswordChange(userId: string): Promise<void> {
    try {
      await this.prisma.securityEvent.create({
        data: {
          userId,
          type: SecurityEventType.PASSWORD_CHANGED,
          actorId: userId,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      UserService.logger.warn(
        `Failed to record SecurityEvent for password change (user ${userId}): ${message}`,
      );
    }
  }

  async getUser(id: string): Promise<ResponseDto> {
    try {
      const user = await this.prisma.user.findFirst({
        where: { id, deletedAt: null },
        include: {
          UserCourse: {
            include: {
              course: {
                include: {
                  courseForms: {
                    include: {
                      userFormCompletions: {
                        where: { userId: id },
                        select: {
                          isComplete: true,
                          completedAt: true,
                          metadata: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Transform data to group by courses
      const coursesWithForms = user.UserCourse.map((userCourse) => {
        const course = userCourse.course;
        const totalForms = course.courseForms.length;
        const completedForms = course.courseForms.filter(
          (form) =>
            form.userFormCompletions.length > 0 &&
            form.userFormCompletions[0].isComplete,
        ).length;

        return {
          courseId: course.id,
          courseTitle: course.title,
          courseImage: course.image,
          totalForms,
          completedForms,
          forms: course.courseForms.map((form) => ({
            formId: form.formId,
            formName: form.formName,
            isRequired: form.isRequired,
            isComplete: form.userFormCompletions[0]?.isComplete || false,
            completedAt: form.userFormCompletions[0]?.completedAt || null,
            metadata: form.userFormCompletions[0]?.metadata || null,
          })),
        };
      });

      const response = {
        userInfo: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          photo: user.photo,
          role: user.role,
        },
        courses: coursesWithForms,
      };

      return {
        message: 'Successfully fetched user info with course forms',
        statusCode: 200,
        data: response,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error?.message || 'Failed to fetch user information',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
        {
          cause: error,
        },
      );
    }
  }
  async getAllUsers(): Promise<ResponseDto> {
    try {
      const users = await this.prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          UserCourse: {
            include: {
              course: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                },
              },
            },
          },
        },
      });

      if (users.length === 0) {
        throw new Error('No users found');
      }

      // Transform data to make it more user-friendly (optional)
      const transformedUsers = users.map((user) => ({
        ...user,
        courses: user.UserCourse.map((userCourse) => userCourse.course),
      }));

      return {
        message: 'Successfully fetched all users info',
        statusCode: 200,
        data: transformedUsers,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async createUser(body: BodyDto): Promise<ResponseDto> {
    try {
      const isUserExist: User = await this.prisma.user.findUnique({
        where: { email: body?.email },
      });
      if (isUserExist) {
        if (isUserExist.deletedAt) {
          // Email belongs to a soft-deleted user — it stays reserved until the
          // account is purged or restored.
          throw new Error(
            'A previously deleted account is using this email. Restore that account or purge it before re-registering this email.',
          );
        }
        throw new Error('User already exists in the system');
      }
      const password = await argon2.hash(body.password);
      const selfRegistered = body.selfRegistered === true;
      delete body.password;

      const user: User = await this.prisma.user.create({
        data: {
          firstName: body?.firstName,
          lastName: body?.lastName,
          email: body?.email,
          password,
          phone: body.phone,
          role: body.role,
          photo: body?.photo ?? null,
          photoBase64: body?.photoBase64 ?? null,
          // Admin-created accounts get a temporary password the admin chose, so
          // the user must set their own on first login. Self-registered users
          // chose their own password, so no forced change.
          mustChangePassword: !selfRegistered,
        },
      });
      delete user.password;

      // Self-registration → welcome email. Best-effort: never fail account
      // creation on a mail hiccup.
      if (selfRegistered && user.email) {
        try {
          await this.mail.sendWelcome({
            to: user.email,
            userId: user.id,
            firstName: user.firstName,
          });
        } catch (mailErr) {
          const m =
            mailErr instanceof Error ? mailErr.message : String(mailErr);
          UserService.logger.warn(
            `Welcome email failed for user ${user.id}: ${m}`,
          );
        }
      }

      return {
        message: 'Successfully create user record',
        statusCode: 200,
        data: user,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async updateUser(userId: string, body: BodyUpdateDto): Promise<ResponseDto> {
    try {
      const existingUser: User = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!existingUser) {
        throw new Error('User not found');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      const updateUser = {};

      for (const [key, value] of Object.entries(body)) {
        updateUser[key] = value;
      }

      // Save the updated user
      const updatedUser = await this.prisma.user.update({
        where: { id: userId }, // Specify the unique identifier for the user you want to update
        data: updateUser, // Pass the modified user object
      });

      return {
        message: 'Successfully updated user record',
        statusCode: 200,
        data: updatedUser,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async changePassword(
    userId: string,
    body: ChangePasswordDto,
  ): Promise<ResponseDto> {
    try {
      const existingUser: User = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!existingUser) {
        throw new Error('User not found');
      }

      // Verify old password
      const isOldPasswordValid = await argon2.verify(
        existingUser.password, // Hashed old password from the database
        body.oldPassword, // Plain text old password from the request body
      );
      if (!isOldPasswordValid) {
        throw new Error('Old password is incorrect');
      }

      // Save the updated user
      await this.prisma.user.update({
        where: { id: userId }, // Specify the unique identifier for the user you want to update
        data: {
          password: await argon2.hash(body.password),
          passwordChangedAt: new Date(),
        }, // Pass the modified user object
      });
      await this.recordPasswordChange(userId);

      return {
        message: 'Successfully updated user password',
        statusCode: 200,
        data: {},
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async updatePassword(userId: string, body: any): Promise<ResponseDto> {
    try {
      const existingUser = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!existingUser) {
        throw new Error('User not found');
      }

      // Save the updated user with new password
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          password: await argon2.hash(body.password),
          passwordChangedAt: new Date(),
        },
      });
      await this.recordPasswordChange(userId);

      return {
        message: 'Successfully updated user password',
        statusCode: 200,
        data: {},
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  /**
   * Soft delete: marks the user as deleted instead of removing the row.
   * This always succeeds regardless of related records (enrollments, progress,
   * submissions, forum content, etc.) and preserves historical/compliance data.
   * Soft-deleted users are excluded from all reads and cannot log in.
   */
  async deleteUser(id: string): Promise<ResponseDto> {
    try {
      const user = await this.prisma.user.findFirst({
        where: { id, deletedAt: null },
      });
      if (!user?.id) {
        throw new Error('User not found');
      }

      const deletedUser = await this.prisma.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          status: 'inactive',
        },
      });

      return {
        message: 'Successfully deleted user record',
        statusCode: 200,
        data: deletedUser,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  /**
   * Computes the "blast radius" of permanently deleting a user.
   *
   * Two categories:
   *  - cascade:  self-owned records that will be removed together with the user.
   *  - blockers: content this user authored that OTHER users depend on. Any
   *              blocker > 0 means a hard purge is refused — those records must
   *              be reassigned/removed first (a soft delete is always available).
   */
  private async gatherDeletionImpact(id: string) {
    const [
      // ---- cascade (self-owned) ----
      enrollments,
      formCompletions,
      policyCompletions,
      policyItemCompletions,
      feedbackSubmissions,
      lastSeenSections,
      quizProgress,
      courseCompletions,
      favoriteThreads,
      threadSubscriptions,
      todos,
      contactMessages,
      policiesAndProcedures,
      notifications,
      assessmentAttempts,
      ownSubmissions,
      authoredNotifications,
      // ---- blockers (others depend on these) ----
      posts,
      postComments,
      forumThreads,
      forumComments,
      assignmentsCreated,
      assignmentsToReview,
      assessmentsCreated,
      submissionsAssignedToReview,
      submissionsReviewed,
    ] = await this.prisma.$transaction([
      this.prisma.userCourse.count({ where: { userId: id } }),
      this.prisma.userFormCompletion.count({ where: { userId: id } }),
      this.prisma.userPolicyCompletion.count({ where: { userId: id } }),
      this.prisma.userPolicyItemCompletion.count({ where: { userId: id } }),
      this.prisma.courseFeedbackSubmission.count({ where: { userId: id } }),
      this.prisma.lastSeenSection.count({ where: { userId: id } }),
      this.prisma.quizProgress.count({ where: { userId: id } }),
      this.prisma.courseCompletion.count({ where: { userId: id } }),
      this.prisma.favoriteForumThread.count({ where: { userId: id } }),
      this.prisma.threadSubscription.count({ where: { userId: id } }),
      this.prisma.todoItem.count({ where: { userId: id } }),
      this.prisma.contactMessage.count({ where: { userId: id } }),
      this.prisma.policiesAndProcedures.count({ where: { userId: id } }),
      this.prisma.notification.count({ where: { userId: id } }),
      this.prisma.assessmentAttempt.count({ where: { userId: id } }),
      this.prisma.assignmentSubmission.count({ where: { studentId: id } }),
      this.prisma.notification.count({ where: { commenterId: id } }),
      this.prisma.post.count({ where: { userId: id } }),
      this.prisma.comment.count({ where: { userId: id } }),
      this.prisma.forumThread.count({ where: { userId: id } }),
      this.prisma.forumComment.count({ where: { userId: id } }),
      this.prisma.assignment.count({ where: { createdByAdminId: id } }),
      this.prisma.assignment.count({ where: { assignedToAdminId: id } }),
      this.prisma.assessment.count({ where: { createdByAdminId: id } }),
      this.prisma.assignmentSubmission.count({
        where: { assignedToAdminId: id },
      }),
      this.prisma.assignmentSubmission.count({
        where: { reviewedByAdminId: id },
      }),
    ]);

    const cascade = {
      enrollments,
      formCompletions,
      policyCompletions,
      policyItemCompletions,
      feedbackSubmissions,
      lastSeenSections,
      quizProgress,
      courseCompletions,
      favoriteThreads,
      threadSubscriptions,
      todos,
      contactMessages,
      policiesAndProcedures,
      notifications,
      assessmentAttempts,
      assignmentSubmissions: ownSubmissions,
    };

    const blockers = {
      posts,
      postComments,
      forumThreads,
      forumComments,
      assignmentsCreated,
      assignmentsToReview,
      assessmentsCreated,
      submissionsAssignedToReview,
      submissionsReviewed,
    };

    const cascadeTotal = Object.values(cascade).reduce((a, b) => a + b, 0);
    const blockerTotal = Object.values(blockers).reduce((a, b) => a + b, 0);

    return {
      // notifications authored BY this user but owned by others: we null the
      // commenter link rather than delete the recipient's notification.
      commenterReferencesToUnlink: authoredNotifications,
      cascade,
      cascadeTotal,
      blockers,
      blockerTotal,
      canPurge: blockerTotal === 0,
    };
  }

  /**
   * Preview the impact of permanently deleting a user, WITHOUT deleting
   * anything. The frontend shows this in the confirmation dialog so the admin
   * knows exactly what will be removed (and what is blocking a hard purge).
   */
  async getDeletionPreview(id: string): Promise<ResponseDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
        },
      });
      if (!user?.id) {
        throw new Error('User not found');
      }

      const impact = await this.gatherDeletionImpact(id);

      return {
        message: 'Successfully fetched user deletion preview',
        statusCode: 200,
        data: { user, ...impact },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  /**
   * Hard delete (force purge) — admin/GDPR "right to be forgotten".
   *
   * Permanently removes the user AND all of their self-owned records, in a
   * single transaction. If the user authored content other users depend on
   * (forum content, assignments/assessments, or is a reviewer on others'
   * submissions), the purge is REFUSED with the list of blockers — the admin
   * must reassign/remove those first, or use a soft delete instead.
   */
  async purgeUser(id: string): Promise<ResponseDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
      });
      if (!user?.id) {
        throw new Error('User not found');
      }

      const impact = await this.gatherDeletionImpact(id);

      if (!impact.canPurge) {
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error:
              'Cannot permanently delete this user because they authored content other users depend on. Reassign or remove these records first, or use a soft delete instead.',
            blockers: impact.blockers,
          },
          HttpStatus.CONFLICT,
        );
      }

      // Delete all self-owned records, then the user, atomically. Children
      // must be removed before the parent rows they reference.
      await this.prisma.$transaction([
        // unlink notifications this user authored but others own
        this.prisma.notification.updateMany({
          where: { commenterId: id },
          data: { commenterId: null },
        }),
        // course-completion references an attempt; clear the link before
        // deleting attempts/completions
        this.prisma.courseCompletion.deleteMany({ where: { userId: id } }),
        this.prisma.assessmentAttempt.deleteMany({ where: { userId: id } }),
        this.prisma.assignmentSubmission.deleteMany({
          where: { studentId: id },
        }),
        this.prisma.userFormCompletion.deleteMany({ where: { userId: id } }),
        this.prisma.userPolicyItemCompletion.deleteMany({
          where: { userId: id },
        }),
        this.prisma.userPolicyCompletion.deleteMany({ where: { userId: id } }),
        this.prisma.courseFeedbackSubmission.deleteMany({
          where: { userId: id },
        }),
        this.prisma.lastSeenSection.deleteMany({ where: { userId: id } }),
        this.prisma.quizProgress.deleteMany({ where: { userId: id } }),
        this.prisma.favoriteForumThread.deleteMany({ where: { userId: id } }),
        this.prisma.threadSubscription.deleteMany({ where: { userId: id } }),
        this.prisma.todoItem.deleteMany({ where: { userId: id } }),
        this.prisma.contactMessage.deleteMany({ where: { userId: id } }),
        this.prisma.policiesAndProcedures.deleteMany({ where: { userId: id } }),
        this.prisma.notification.deleteMany({ where: { userId: id } }),
        this.prisma.userCourse.deleteMany({ where: { userId: id } }),
        this.prisma.user.delete({ where: { id } }),
      ]);

      return {
        message: 'Successfully purged user record and associated data',
        statusCode: 200,
        data: { user, deleted: impact.cascade },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        // Unexpected foreign-key violation — a relation we didn't account for.
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error:
              'Cannot permanently delete this user because they still have associated records. Use a soft delete instead.',
          },
          HttpStatus.CONFLICT,
        );
      } else {
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error: error?.message || 'Something went wrong',
          },
          HttpStatus.FORBIDDEN,
          {
            cause: error,
          },
        );
      }
    }
  }

  async createUserMessage(body: any, user: User): Promise<ResponseDto> {
    try {
      const contactUsMessage: any = await this.prisma.contactMessage.create({
        data: {
          userId: user.id,
          message: body.message,
          isSeen: false, // Defaults to false when a message is created
        },
      });

      // Email every admin so a contact message is actioned, not just stored.
      // Best-effort: a mail failure must not fail the user's submission.
      try {
        const admins = await this.prisma.user.findMany({
          where: { role: 'admin', deletedAt: null },
          select: { id: true, email: true },
        });
        const senderName = `${user.firstName ?? ''} ${
          user.lastName ?? ''
        }`.trim();
        const recipients = admins.filter((a) => a.email);
        // Throttle to ~2/sec to respect Resend's rate limit (matches the
        // NotificationService dispatch). Sends are best-effort and never throw.
        for (let i = 0; i < recipients.length; i += 2) {
          const batch = recipients.slice(i, i + 2);
          await Promise.all(
            batch.map((admin) =>
              this.mail.sendContactMessage({
                to: admin.email,
                userId: admin.id,
                senderName: senderName || 'A user',
                senderEmail: user.email,
                message: body.message,
              }),
            ),
          );
          if (i + 2 < recipients.length) {
            await new Promise((r) => setTimeout(r, 1100));
          }
        }
      } catch (mailErr) {
        const m = mailErr instanceof Error ? mailErr.message : String(mailErr);
        UserService.logger.warn(`Contact-message email failed: ${m}`);
      }

      return {
        message: 'Successfully sent a message to admin',
        statusCode: 200,
        data: contactUsMessage,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  // async getAllUserMessages(userId: any): Promise<ResponseDto> {
  //   try {
  //     const users = await this.prisma.contactMessage.findMany({
  //       where: {
  //         userId,
  //       },

  //       orderBy: {
  //         createdAt: 'desc',
  //       },
  //     });
  //     if (!(users.length > 0)) {
  //       throw new Error('No user message found');
  //     }
  //     return {
  //       message: 'Successfully fetch all user',
  //       statusCode: 200,
  //       data: users,
  //     };
  //   } catch (error) {
  //     throw new HttpException(
  //       {
  //         status: HttpStatus.FORBIDDEN,
  //         error: error?.message || 'Something went wrong',
  //       },
  //       HttpStatus.FORBIDDEN,
  //       {
  //         cause: error,
  //       },
  //     );
  //   }
  // }

  async getAllUserMessages(userId: any, role: string): Promise<ResponseDto> {
    try {
      const users = await this.prisma.contactMessage.findMany({
        ...(role === 'user' && {
          where: {
            userId: userId,
          },
        }),
        select: {
          id: true,
          createdAt: true,
          isSeen: true,
          message: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
      });
      if (!(users.length > 0)) {
        throw new Error('No Userssdsds found');
      }
      return {
        message: 'Successfully fetch all users info',
        statusCode: 200,
        data: users,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
}
