import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '@nestjs/passport';
import { AssignmentController } from './assignment.controller';

// `cJwt` accepts learners as well as admins. These routes grade, list every
// learner's submissions, or delete assignments with all their submissions, so
// a learner token must never reach them.
describe('AssignmentController admin routes', () => {
  const adminOnly: Array<keyof AssignmentController> = [
    'assignedToMe',
    'review',
    'createAssignment',
    'adminCreatedAssignments',
    'deleteAssignment',
    'updateAssignment',
    'getAssignmentSubmissions',
  ];

  it.each(adminOnly)('%s only accepts admin tokens', (method) => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AssignmentController.prototype[method],
    );
    expect(guards).toEqual([AuthGuard('jwt')]);
  });
});
