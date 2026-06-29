import {
  extractUserPhotoFromMetadata,
  promoteFormPhotoToUserIfMissing,
  userHasGlobalPhoto,
} from './promote-form-photo-to-user';

describe('promote-form-photo-to-user', () => {
  describe('extractUserPhotoFromMetadata', () => {
    it('returns trimmed userPhoto URL', () => {
      expect(
        extractUserPhotoFromMetadata({
          userPhoto: ' https://cdn.example/photo.jpg ',
        }),
      ).toBe('https://cdn.example/photo.jpg');
    });

    it('returns null when missing or empty', () => {
      expect(extractUserPhotoFromMetadata(null)).toBeNull();
      expect(extractUserPhotoFromMetadata({ userPhoto: '  ' })).toBeNull();
    });
  });

  describe('userHasGlobalPhoto', () => {
    it('detects existing photo', () => {
      expect(userHasGlobalPhoto('https://x/y.jpg')).toBe(true);
      expect(userHasGlobalPhoto(null)).toBe(false);
      expect(userHasGlobalPhoto('')).toBe(false);
    });
  });

  describe('promoteFormPhotoToUserIfMissing', () => {
    it('updates user when photo missing', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ photo: null }),
          update: jest.fn().mockResolvedValue({}),
        },
      };

      const result = await promoteFormPhotoToUserIfMissing(
        prisma as any,
        'user-1',
        { userPhoto: 'https://cdn.example/photo.jpg' },
      );

      expect(result.updated).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { photo: 'https://cdn.example/photo.jpg' },
      });
    });

    it('does not overwrite existing global photo', async () => {
      const prisma = {
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ photo: 'https://existing.jpg' }),
          update: jest.fn(),
        },
      };

      const result = await promoteFormPhotoToUserIfMissing(
        prisma as any,
        'user-1',
        { userPhoto: 'https://cdn.example/photo.jpg' },
      );

      expect(result.updated).toBe(false);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
