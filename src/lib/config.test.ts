import { AdminConfig } from './admin.types';
import { configSelfCheck } from './config';

jest.mock('@/lib/db', () => ({
  db: {},
}));

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
});
