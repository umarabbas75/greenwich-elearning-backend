import {
  extractUserAddressFromMetadata,
  promoteFormAddressToUserIfMissing,
  userHasGlobalAddress,
} from './promote-form-address-to-user';

describe('promote-form-address-to-user', () => {
  describe('extractUserAddressFromMetadata', () => {
    it('prefers explicit address field', () => {
      expect(
        extractUserAddressFromMetadata({
          address: ' 123 Main St ',
          houseStreetNumber: 'ignored',
        }),
      ).toBe('123 Main St');
    });

    it('composes address from registration form fields', () => {
      expect(
        extractUserAddressFromMetadata({
          houseStreetNumber: 'Tehsil birpani district bagh Azad Kashmir',
          mainAddress: 'Tehsil birpani bagh',
          city: 'Bagh Azad Kashmir',
          country: 'Pakistan',
        }),
      ).toBe(
        'Tehsil birpani district bagh Azad Kashmir, Tehsil birpani bagh, Pakistan',
      );
    });

    it('returns null when missing or empty', () => {
      expect(extractUserAddressFromMetadata(null)).toBeNull();
      expect(extractUserAddressFromMetadata({ city: '  ' })).toBeNull();
    });
  });

  describe('userHasGlobalAddress', () => {
    it('detects existing address', () => {
      expect(userHasGlobalAddress('123 Main St')).toBe(true);
      expect(userHasGlobalAddress(null)).toBe(false);
      expect(userHasGlobalAddress('')).toBe(false);
    });
  });

  describe('promoteFormAddressToUserIfMissing', () => {
    it('updates user when address missing', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ address: null }),
          update: jest.fn().mockResolvedValue({}),
        },
      };

      const result = await promoteFormAddressToUserIfMissing(
        prisma as any,
        'user-1',
        {
          houseStreetNumber: '123 Main St',
          city: 'London',
          country: 'UK',
        },
      );

      expect(result.updated).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { address: '123 Main St, London, UK' },
      });
    });

    it('does not overwrite existing global address', async () => {
      const prisma = {
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ address: 'Existing address' }),
          update: jest.fn(),
        },
      };

      const result = await promoteFormAddressToUserIfMissing(
        prisma as any,
        'user-1',
        { address: 'New address' },
      );

      expect(result.updated).toBe(false);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
