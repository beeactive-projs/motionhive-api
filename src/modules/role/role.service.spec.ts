import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';

import { RoleService } from './role.service';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import {
  makeModelMock,
  type ModelMock,
} from '../../../test/helpers/sequelize-mocks';

/**
 * A role row scoped to a group (what accepting a group invitation writes)
 * must never count as a platform role: a group invitation once made its
 * invitee a global SUPER_ADMIN, because these reads ignored `group_id`.
 */
describe('RoleService, platform roles vs group roles', () => {
  let service: RoleService;
  let roleModel: ModelMock;
  let userRoleModel: ModelMock;

  beforeEach(async () => {
    roleModel = makeModelMock();
    userRoleModel = makeModelMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: getModelToken(Role), useValue: roleModel },
        { provide: getModelToken(Permission), useValue: makeModelMock() },
        { provide: getModelToken(UserRole), useValue: userRoleModel },
      ],
    }).compile();
    service = moduleRef.get(RoleService);
  });

  it('reads only platform roles when no group is named', async () => {
    userRoleModel.findAll.mockResolvedValue([]);

    await service.getUserRoles('user-1');

    expect(userRoleModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', groupId: null } }),
    );
  });

  it("checks a guard's roles against platform roles only", async () => {
    roleModel.findAll.mockResolvedValue([{ id: 'role-super' }]);
    userRoleModel.count.mockResolvedValue(0);

    const allowed = await service.userHasAnyRole('user-1', ['SUPER_ADMIN']);

    expect(allowed).toBe(false);
    expect(userRoleModel.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', roleId: ['role-super'], groupId: null },
    });
  });

  it('checks one role against platform roles only', async () => {
    roleModel.findOne.mockResolvedValue({ id: 'role-coach' });
    userRoleModel.findOne.mockResolvedValue(null);

    await service.userHasRole('user-1', 'INSTRUCTOR');

    expect(userRoleModel.findOne).toHaveBeenCalledWith({
      where: { userId: 'user-1', roleId: 'role-coach', groupId: null },
    });
  });

  it('still reads the roles in a group when one is named', async () => {
    userRoleModel.findAll.mockResolvedValue([]);

    await service.getUserRoles('user-1', 'group-1');

    expect(userRoleModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', groupId: 'group-1' },
      }),
    );
  });
});
