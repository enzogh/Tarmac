import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService, SsoAccountLinkRefused } from '../src/auth/auth.service';

type FakeUser = { id: string; email: string; ssoSubject: string | null; isSuperuser: boolean; passwordHash: string | null; [key: string]: unknown };

function serviceWith(users: FakeUser[]) {
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { ssoSubject?: string; email?: string } }) =>
        users.find((user) => (where.ssoSubject ? user.ssoSubject === where.ssoSubject : user.email === where.email)) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
        const user = users.find((candidate) => candidate.id === where.id)!;
        Object.assign(user, data);
        return user;
      },
      create: async ({ data }: { data: Partial<FakeUser> }) => {
        const user = { id: `u${users.length + 1}`, isSuperuser: false, passwordHash: null, ssoSubject: null, ...data } as FakeUser;
        users.push(user);
        return user;
      },
    },
  };
  return new AuthService(prisma as never, {} as never, {} as never, {} as never);
}

const claims = (email: string, emailVerified?: boolean) => ({
  sub: 'authentik-123',
  email,
  internalEmail: null,
  isSuperuser: false,
  canCreateWorkspaces: true,
  emailVerified,
});

test('an SSO login does not take over the local admin account on a matching address', async () => {
  const users: FakeUser[] = [{ id: 'admin', email: 'admin@corp.test', ssoSubject: null, isSuperuser: true, passwordHash: 'hash' }];
  await assert.rejects(serviceWith(users).findOrCreateSsoUser(claims('admin@corp.test')), SsoAccountLinkRefused);
  await assert.rejects(serviceWith(users).findOrCreateSsoUser(claims('admin@corp.test', false)), SsoAccountLinkRefused);
  assert.equal(users[0].ssoSubject, null);
});

test('the link is made when the identity provider vouches for the address', async () => {
  const users: FakeUser[] = [{ id: 'admin', email: 'admin@corp.test', ssoSubject: null, isSuperuser: true, passwordHash: 'hash' }];
  const { user } = await serviceWith(users).findOrCreateSsoUser(claims('admin@corp.test', true));
  assert.equal(user.ssoSubject, 'authentik-123');
});

test('an ordinary account without password is still linked by address', async () => {
  const users: FakeUser[] = [{ id: 'm', email: 'member@corp.test', ssoSubject: null, isSuperuser: false, passwordHash: null }];
  const { user } = await serviceWith(users).findOrCreateSsoUser(claims('member@corp.test'));
  assert.equal(user.id, 'm');
  assert.equal(user.ssoSubject, 'authentik-123');
});

test('an already linked account is found by its SSO subject first', async () => {
  const users: FakeUser[] = [{ id: 'admin', email: 'old@corp.test', ssoSubject: 'authentik-123', isSuperuser: true, passwordHash: 'hash' }];
  const { user } = await serviceWith(users).findOrCreateSsoUser(claims('new@corp.test'));
  assert.equal(user.id, 'admin');
});
