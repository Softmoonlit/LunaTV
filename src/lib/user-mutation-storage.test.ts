/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { AdminConfig } from './admin.types';
import { hashPassword } from './password';
import { BaseRedisStorage } from './redis-base.db';
import {
  MIGRATE_PASSWORD_SCRIPT,
  MUTATE_USER_SCRIPT,
  REGISTER_USER_SCRIPT,
  REPLACE_ADMIN_CONFIG_SCRIPT,
  RESTORE_USER_PASSWORD_SCRIPT,
} from './storage-scripts';
import { ConfigConflictError } from './types';
import { UpstashRedisStorage } from './upstash.db';

function createConfig(): AdminConfig {
  return {
    ConfigVersion: 4,
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

class TestRedisStorage extends BaseRedisStorage {
  constructor(client: Record<string, jest.Mock>) {
    const symbol = Symbol.for('__MOONTV_REDIS_MUTATION_TEST__');
    (global as any)[symbol] = client;
    super({ url: 'redis://test', clientName: 'RedisTest' }, symbol);
  }
}

describe('原子用户存储适配器协议', () => {
  afterEach(() => {
    delete (global as any)[Symbol.for('__MOONTV_REDIS_MUTATION_TEST__')];
    delete (global as any)[Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__')];
  });

  it('Redis 恢复已哈希密码时不重复哈希', async () => {
    const storedPassword = hashPassword('secret');
    const client = {
      eval: jest.fn().mockResolvedValue(['OK']),
    };
    const storage = new TestRedisStorage(client);

    await storage.restoreUserPassword('member', storedPassword);

    const [script, options] = client.eval.mock.calls[0];
    expect(script).toBe(RESTORE_USER_PASSWORD_SCRIPT);
    expect(options.keys).toHaveLength(3);
    expect(options.keys[0]).toBe('u:member:pwd');
    expect(options.keys[2]).toMatch(/^restore-user:operation:/);
    expect(options.arguments).toEqual([storedPassword, 'member', '300']);
  });

  it('Redis 登录升级通过 CAS 保留并发写入', async () => {
    const client = {
      get: jest.fn().mockResolvedValue('legacy-password'),
      eval: jest.fn().mockResolvedValue('SKIPPED'),
    };
    const storage = new TestRedisStorage(client);

    await expect(storage.verifyUser('member', 'legacy-password')).resolves.toBe(
      true
    );

    expect(client.eval).toHaveBeenCalledWith(MIGRATE_PASSWORD_SCRIPT, {
      keys: ['u:member:pwd'],
      arguments: ['legacy-password', expect.any(String)],
    });
  });

  it('Redis 使用对象形式传递固定的 KEYS 和 ARGV', async () => {
    const savedConfig = { ...createConfig(), ConfigVersion: 5 };
    const client = {
      eval: jest.fn().mockResolvedValue(['OK']),
      get: jest.fn().mockResolvedValue(JSON.stringify(savedConfig)),
    };
    const storage = new TestRedisStorage(client);

    await expect(
      storage.mutateUserAtomically({
        action: 'changePassword',
        username: 'member',
        passwordHash: 'hashed-password',
        config: createConfig(),
      })
    ).resolves.toEqual(savedConfig);

    const [script, options] = client.eval.mock.calls[0];
    expect(script).toBe(MUTATE_USER_SCRIPT);
    expect(options.keys).toHaveLength(9);
    expect(options.keys).toEqual(
      expect.arrayContaining([
        'admin:config',
        'admin:config:version',
        'u:member:pwd',
        'sys:users',
      ])
    );
    expect(options.keys[8]).toMatch(/^user:operation:/);
    expect(options.arguments).toEqual([
      '4',
      expect.stringContaining('"ConfigVersion":5'),
      'changePassword',
      'hashed-password',
      'member',
      '300',
    ]);
    const targetConfig = JSON.parse(options.arguments[1]);
    expect(targetConfig.SourceConfig).toEqual([]);
    expect(targetConfig.CustomCategories).toEqual([]);
    expect(targetConfig.LiveConfig).toEqual([]);
  });

  it('Redis 注册冲突后基于最新配置重建目标 JSON', async () => {
    const initialConfig = createConfig();
    const latestConfig = { ...createConfig(), ConfigVersion: 5 };
    const savedConfig = {
      ...latestConfig,
      ConfigVersion: 6,
      UserConfig: {
        ...latestConfig.UserConfig,
        Users: [
          ...latestConfig.UserConfig.Users,
          { username: 'new-user', role: 'user' as const },
        ],
      },
    };
    const client = {
      eval: jest
        .fn()
        .mockResolvedValueOnce(['CONFLICT'])
        .mockResolvedValueOnce(['CREATED', '0']),
      get: jest
        .fn()
        .mockResolvedValueOnce(JSON.stringify(initialConfig))
        .mockResolvedValueOnce(JSON.stringify(latestConfig))
        .mockResolvedValueOnce(JSON.stringify(savedConfig)),
    };
    const storage = new TestRedisStorage(client);

    await expect(
      storage.registerUserAtomically({
        username: 'new-user',
        ownerUsername: 'owner',
        passwordHash: 'hashed-password',
        operationId: 'operation-id',
        requestFingerprint: 'fingerprint',
      })
    ).resolves.toEqual({
      outcome: 'created',
      replayed: false,
      config: savedConfig,
    });

    const firstOptions = client.eval.mock.calls[0][1];
    const secondOptions = client.eval.mock.calls[1][1];
    expect(client.eval.mock.calls[0][0]).toBe(REGISTER_USER_SCRIPT);
    expect(firstOptions.keys[4]).toBe('registration:operation:operation-id');
    expect(secondOptions.keys[4]).toBe('registration:operation:operation-id');
    expect(firstOptions.arguments[5]).toBe('4');
    expect(secondOptions.arguments[5]).toBe('5');
    const targetConfig = JSON.parse(secondOptions.arguments[6]);
    expect(targetConfig.ConfigVersion).toBe(6);
    expect(targetConfig.CustomCategories).toEqual([]);
    expect(targetConfig.UserConfig.Users).toContainEqual({
      username: 'new-user',
      role: 'user',
    });
  });

  it('Redis 将配置版本冲突映射为 ConfigConflictError', async () => {
    const client = {
      eval: jest.fn().mockResolvedValue(['CONFLICT']),
      get: jest.fn(),
    };
    const storage = new TestRedisStorage(client);

    await expect(
      storage.mutateUserAtomically({
        action: 'delete',
        username: 'member',
        config: createConfig(),
      })
    ).rejects.toBeInstanceOf(ConfigConflictError);
    expect(client.get).not.toHaveBeenCalled();
  });

  it('Upstash 恢复已哈希密码时不重复哈希', async () => {
    const storedPassword = hashPassword('secret');
    const client = {
      eval: jest.fn().mockResolvedValue(['OK']),
    };
    (global as any)[Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__')] = client;
    const storage = new UpstashRedisStorage();

    await storage.restoreUserPassword('member', storedPassword);

    const [script, keys, args] = client.eval.mock.calls[0];
    expect(script).toBe(RESTORE_USER_PASSWORD_SCRIPT);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe('u:member:pwd');
    expect(keys[2]).toMatch(/^restore-user:operation:/);
    expect(args).toEqual([storedPassword, 'member', '300']);
  });

  it('Upstash 使用双数组形式传递相同的 KEYS 和 ARGV', async () => {
    const savedConfig = { ...createConfig(), ConfigVersion: 5 };
    const client = {
      eval: jest.fn().mockResolvedValue(['OK']),
      get: jest.fn().mockResolvedValue(savedConfig),
    };
    (global as any)[Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__')] = client;
    const storage = new UpstashRedisStorage();

    await expect(
      storage.mutateUserAtomically({
        action: 'add',
        username: 'new-user',
        passwordHash: 'hashed-password',
        config: createConfig(),
      })
    ).resolves.toEqual(savedConfig);

    const [script, keys, args] = client.eval.mock.calls[0];
    expect(script).toBe(MUTATE_USER_SCRIPT);
    expect(keys).toHaveLength(9);
    expect(keys[2]).toBe('u:new-user:pwd');
    expect(keys[8]).toMatch(/^user:operation:/);
    expect(args).toEqual([
      '4',
      expect.stringContaining('"ConfigVersion":5'),
      'add',
      'hashed-password',
      'new-user',
      '300',
    ]);
  });

  it('Upstash 整体替换冲突后保留操作键并原样传递空数组', async () => {
    const initialConfig = createConfig();
    const latestConfig = { ...createConfig(), ConfigVersion: 5 };
    const savedConfig = { ...createConfig(), ConfigVersion: 6 };
    const client = {
      eval: jest
        .fn()
        .mockResolvedValueOnce(['CONFLICT'])
        .mockResolvedValueOnce(['OK']),
      get: jest
        .fn()
        .mockResolvedValueOnce(initialConfig)
        .mockResolvedValueOnce(latestConfig)
        .mockResolvedValueOnce(savedConfig),
    };
    (global as any)[Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__')] = client;
    const storage = new UpstashRedisStorage();

    await expect(storage.replaceAdminConfig(createConfig())).resolves.toEqual(
      savedConfig
    );

    const [firstScript, firstKeys, firstArgs] = client.eval.mock.calls[0];
    const [, secondKeys, secondArgs] = client.eval.mock.calls[1];
    expect(firstScript).toBe(REPLACE_ADMIN_CONFIG_SCRIPT);
    expect(firstKeys[2]).toMatch(/^config:operation:/);
    expect(secondKeys[2]).toBe(firstKeys[2]);
    expect(firstArgs[0]).toBe('4');
    expect(secondArgs[0]).toBe('5');
    const targetConfig = JSON.parse(secondArgs[1]);
    expect(targetConfig.ConfigVersion).toBe(6);
    expect(targetConfig.SourceConfig).toEqual([]);
    expect(targetConfig.CustomCategories).toEqual([]);
    expect(targetConfig.LiveConfig).toEqual([]);
  });

  it('Upstash 将配置版本冲突映射为 ConfigConflictError', async () => {
    const client = {
      eval: jest.fn().mockResolvedValue(['CONFLICT']),
      get: jest.fn(),
    };
    (global as any)[Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__')] = client;
    const storage = new UpstashRedisStorage();

    await expect(
      storage.mutateUserAtomically({
        action: 'delete',
        username: 'member',
        config: createConfig(),
      })
    ).rejects.toBeInstanceOf(ConfigConflictError);
    expect(client.get).not.toHaveBeenCalled();
  });
});
