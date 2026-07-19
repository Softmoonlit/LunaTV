/** @jest-environment node */

import { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, saveConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { ConfigConflictError, UserAlreadyExistsError } from '@/lib/types';

import { POST } from '@/app/api/admin/user/route';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: unknown }) => ({
      status: init?.status || 200,
      headers: init?.headers,
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  saveConfig: jest.fn(),
  setCachedConfig: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    mutateUserAtomically: jest.fn(),
  },
}));

const mockedAuth = getAuthInfoFromCookie as jest.MockedFunction<
  typeof getAuthInfoFromCookie
>;
const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
const mockedSaveConfig = saveConfig as jest.MockedFunction<typeof saveConfig>;
const mockedSetCachedConfig = setCachedConfig as jest.MockedFunction<
  typeof setCachedConfig
>;
const mockedMutateUser = db.mutateUserAtomically as jest.MockedFunction<
  typeof db.mutateUserAtomically
>;

function createConfig(): AdminConfig {
  return {
    ConfigVersion: 3,
    ConfigFile: '',
    ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
    SiteConfig: {
      SiteName: '',
      Announcement: '',
      SearchDownstreamMaxPage: 1,
      SiteInterfaceCacheTime: 0,
      DoubanProxyType: '',
      DoubanProxy: '',
      DoubanImageProxyType: '',
      DoubanImageProxy: '',
      DisableYellowFilter: false,
      FluidSearch: false,
      EnableWebLive: false,
    },
    UserConfig: {
      AllowRegister: true,
      Users: [{ username: 'member', role: 'user' }],
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
  };
}

function createRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
  } as Parameters<typeof POST>[0];
}

describe('管理员用户原子操作', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    process.env.USERNAME = 'owner';
    mockedAuth.mockReturnValue({ username: 'owner' });
    mockedGetConfig.mockImplementation(async () => createConfig());
    mockedMutateUser.mockImplementation(async ({ config }) => ({
      ...config,
      ConfigVersion: (config.ConfigVersion || 0) + 1,
    }));
  });

  it('新增用户原子保存配置和密码并刷新缓存', async () => {
    const response = await POST(
      createRequest({
        action: 'add',
        targetUsername: 'new-user',
        targetPassword: 'secret',
        userGroup: 'family',
      })
    );

    expect(response.status).toBe(200);
    expect(mockedMutateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'add',
        username: 'new-user',
        password: 'secret',
        config: expect.objectContaining({
          UserConfig: expect.objectContaining({
            Users: expect.arrayContaining([
              expect.objectContaining({
                username: 'new-user',
                role: 'user',
                tags: ['family'],
              }),
            ]),
          }),
        }),
      })
    );
    expect(mockedSetCachedConfig).toHaveBeenCalledTimes(1);
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });

  it.each([
    ['changePassword', { targetPassword: 'new-secret' }],
    ['deleteUser', {}],
  ])('%s 使用原子用户事务', async (action, extra) => {
    const response = await POST(
      createRequest({
        action,
        targetUsername: 'member',
        ...extra,
      })
    );

    expect(response.status).toBe(200);
    expect(mockedMutateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        action: action === 'deleteUser' ? 'delete' : action,
        username: 'member',
      })
    );
    expect(mockedSetCachedConfig).toHaveBeenCalledTimes(1);
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });

  it('配置冲突返回 409 且不更新缓存', async () => {
    mockedMutateUser.mockRejectedValueOnce(new ConfigConflictError());

    const response = await POST(
      createRequest({
        action: 'changePassword',
        targetUsername: 'member',
        targetPassword: 'new-secret',
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: '配置已被其他请求更新，请刷新后重试',
    });
    expect(mockedSetCachedConfig).not.toHaveBeenCalled();
  });

  it('竞态下用户已存在返回 400 且不更新缓存', async () => {
    mockedMutateUser.mockRejectedValueOnce(new UserAlreadyExistsError());

    const response = await POST(
      createRequest({
        action: 'add',
        targetUsername: 'new-user',
        targetPassword: 'secret',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '用户已存在' });
    expect(mockedSetCachedConfig).not.toHaveBeenCalled();
  });
});
