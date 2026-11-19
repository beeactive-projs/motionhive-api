import { CustomerService } from './customer.service';
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { User } from '../../user/entities/user.entity';
import { StripeService } from './stripe.service';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';

/**
 * A bill sent to an email goes to the account with that email only when the
 * address is proven: an account that merely typed it at sign-up must not
 * receive (and see the card form of) invoices meant for the person who owns it.
 */
describe('CustomerService.getOrCreateGuest', () => {
  function setup(existingUser: Partial<User> | null) {
    const guestRow = {
      id: 'cust-guest',
      userId: null,
      stripeCustomerId: 'cus_guest',
    };
    const stripeCustomerModel = {
      findOne: jest.fn().mockResolvedValue(guestRow),
      create: jest.fn(),
    };
    const userModel = { findOne: jest.fn().mockResolvedValue(existingUser) };
    const service = new CustomerService(
      stripeCustomerModel as unknown as typeof StripeCustomer,
      userModel as unknown as typeof User,
      {} as never,
      {} as unknown as StripeService,
      makeSilentLogger(),
    );
    const forUser = jest
      .spyOn(service, 'getOrCreateForUser')
      .mockResolvedValue({ id: 'cust-user' } as StripeCustomer);
    return { service, forUser, guestRow };
  }

  it('bills the account when its address is verified', async () => {
    const { service, forUser } = setup({ id: 'u-1', isEmailVerified: true });

    const row = await service.getOrCreateGuest('Ana@Example.com', 'Ana');

    expect(forUser).toHaveBeenCalledWith('u-1', undefined);
    expect(row).toEqual({ id: 'cust-user' });
  });

  it('keeps the bill on the email while the account has not proven it', async () => {
    const { service, forUser, guestRow } = setup({
      id: 'u-squatter',
      isEmailVerified: false,
    });

    const row = await service.getOrCreateGuest('ana@example.com', 'Ana');

    expect(forUser).not.toHaveBeenCalled();
    expect(row).toBe(guestRow);
  });
});
