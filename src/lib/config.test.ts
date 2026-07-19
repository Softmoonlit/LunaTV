import { AdminConfig } from './admin.types';
import { configSelfCheck, getConfig, setCachedConfig } from './config';
import { db } from './db';

jest.mock('@/lib/db', () => ({
  db: {
    getAdminConfigVersion: jest.fn(),
    getAdminConfig: jest.fn(),
  },
}));

const mockedGetConfigVersion = db.getAdminConfigVersion as jest.MockedFunction<
  typeof db.getAdminConfigVersion
>;
const mockedGetAdminConfig = db.getAdminConfig as jest.MockedFunction<
  typeof db.getAdminConfig
>;

function createConfig(allowRegister?: boolean) {
  return {
    ConfigFile: '',
    ConfigSubscribtion: {
      URL: '',
      AutoUpdate: false,
      LastCheck: '',
    },
    SiteConfig: {},
    UserConfig: {
      ...(allowRegister === undefined ? {} : { AllowRegister: allowRegister }),
      Users: [],
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
  } as unknown as AdminConfig;
}

describe('configSelfCheck', () => {
  beforeEach(() => {
    process.env.USERNAME = 'owner';
  });

  it('旧配置缺少注册开关时默认关闭', () => {
    const config = configSelfCheck(createConfig());

    expect(config.UserConfig.AllowRegister).toBe(false);
  });

  it('保留已有的注册开关值', () => {
    const config = configSelfCheck(createConfig(true));

    expect(config.UserConfig.AllowRegister).toBe(true);
  });

  it('保留已有的配置版本', () => {
    const input = createConfig(true);
    input.ConfigVersion = 7;

    const config = configSelfCheck(input);

    expect(config.ConfigVersion).toBe(7);
  });

  it('缓存配置时修复错误的自定义分类类型并隔离原对象', async () => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    const malformed = createConfig(true);
    malformed.ConfigVersion = 10;
    malformed.CustomCategories = {} as AdminConfig['CustomCategories'];

    await setCachedConfig(malformed);
    malformed.UserConfig.AllowRegister = false;
    mockedGetConfigVersion.mockResolvedValueOnce(10);

    const result = await getConfig();

    expect(result.CustomCategories).toEqual([]);
    expect(result.UserConfig.AllowRegister).toBe(true);
  });

  it('配置版本探测失败时返回缓存副本', async () => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    const cached = createConfig(true);
    cached.ConfigVersion = 9;
    await setCachedConfig(cached);
    mockedGetConfigVersion.mockRejectedValueOnce(new Error('存储暂时不可用'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    const result = await getConfig();

    expect(result).toEqual(configSelfCheck(JSON.parse(JSON.stringify(cached))));
    expect(result).not.toBe(cached);
    expect(cached.UserConfig.Users).toEqual([]);
    expect(mockedGetAdminConfig).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      '获取配置版本失败:',
      expect.any(Error)
    );
    consoleError.mockRestore();
  });
});
