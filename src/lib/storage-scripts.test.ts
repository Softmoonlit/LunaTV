import {
  MIGRATE_PASSWORD_SCRIPT,
  MUTATE_USER_SCRIPT,
  REGISTER_USER_SCRIPT,
  REPLACE_ADMIN_CONFIG_SCRIPT,
  RESTORE_USER_PASSWORD_SCRIPT,
  SET_ADMIN_CONFIG_SCRIPT,
} from './storage-scripts';

describe('存储原子脚本协议', () => {
  it('注册在写入前检查最新开关和全部用户状态', () => {
    expect(REGISTER_USER_SCRIPT).toContain(
      'config.UserConfig.AllowRegister ~= true'
    );
    expect(REGISTER_USER_SCRIPT).toContain("redis.call('EXISTS', KEYS[3])");
    expect(REGISTER_USER_SCRIPT).toContain(
      "redis.call('SADD', KEYS[4], ARGV[1])"
    );
    expect(REGISTER_USER_SCRIPT).toContain(
      "redis.call('SET', KEYS[1], updatedConfigRaw)"
    );
  });

  it('注册支持同一幂等操作的安全重放', () => {
    expect(REGISTER_USER_SCRIPT).toContain('operation.fingerprint == ARGV[5]');
    expect(REGISTER_USER_SCRIPT).toContain("return {'CREATED', '1'}");
    expect(REGISTER_USER_SCRIPT).toContain("return {'IDEMPOTENCY_CONFLICT'}");
  });

  it('配置写入使用版本 CAS 并记录可重放操作', () => {
    expect(SET_ADMIN_CONFIG_SCRIPT).toContain(
      'currentVersion ~= expectedVersion'
    );
    expect(SET_ADMIN_CONFIG_SCRIPT).toContain("return {'CONFLICT'}");
    expect(SET_ADMIN_CONFIG_SCRIPT).toContain(
      "redis.call('SET', KEYS[3], '1', 'EX', tonumber(ARGV[3]))"
    );
  });

  it('后台用户操作使用配置版本 CAS 并原子更新相关数据', () => {
    expect(MUTATE_USER_SCRIPT).toContain('currentVersion ~= tonumber(ARGV[1])');
    expect(MUTATE_USER_SCRIPT).toContain(
      "redis.call('SET', KEYS[1], targetRaw)"
    );
    expect(MUTATE_USER_SCRIPT).toContain(
      "redis.call('SET', KEYS[9], '1', 'EX', tonumber(ARGV[6]))"
    );
  });

  it('后台用户操作在任何写入前检查全部关键 key 类型', () => {
    const firstWrite = MUTATE_USER_SCRIPT.indexOf("redis.call('SET', KEYS[3]");
    for (const check of [
      "return {'INVALID_CONFIG'}",
      "return {'INVALID_PASSWORD_KEY'}",
      "return {'INVALID_USERS_KEY'}",
      "return {'INVALID_OPERATION_KEY'}",
    ]) {
      expect(MUTATE_USER_SCRIPT.indexOf(check)).toBeGreaterThan(-1);
      expect(MUTATE_USER_SCRIPT.indexOf(check)).toBeLessThan(firstWrite);
    }
  });

  it('密码迁移仅在存储值未变化时更新', () => {
    expect(MIGRATE_PASSWORD_SCRIPT).toContain('current ~= ARGV[1]');
    expect(MIGRATE_PASSWORD_SCRIPT).toContain("return 'SKIPPED'");
    expect(MIGRATE_PASSWORD_SCRIPT).toContain(
      "redis.call('SET', KEYS[1], ARGV[2])"
    );
  });

  it('删除和改密可修复缺失密码键的历史残留', () => {
    expect(MUTATE_USER_SCRIPT).not.toContain("return {'USER_MISSING'}");
    expect(MUTATE_USER_SCRIPT).toContain(
      "redis.call('DEL', KEYS[3], KEYS[5], KEYS[6], KEYS[7], KEYS[8])"
    );
    expect(MUTATE_USER_SCRIPT).toContain("redis.call('SET', KEYS[3], ARGV[4])");
  });

  it('新增和改密拒绝空密码哈希', () => {
    expect(MUTATE_USER_SCRIPT).toContain(
      "if ARGV[4] == '' then return {'INVALID_PASSWORD'} end"
    );
  });

  it('密码恢复预检 key 类型并支持响应丢失后的重放', () => {
    const firstWrite = RESTORE_USER_PASSWORD_SCRIPT.indexOf(
      "redis.call('SET', KEYS[1]"
    );
    for (const check of [
      "return {'INVALID_PASSWORD_KEY'}",
      "return {'INVALID_USERS_KEY'}",
      "return {'INVALID_OPERATION_KEY'}",
    ]) {
      expect(RESTORE_USER_PASSWORD_SCRIPT.indexOf(check)).toBeGreaterThan(-1);
      expect(RESTORE_USER_PASSWORD_SCRIPT.indexOf(check)).toBeLessThan(
        firstWrite
      );
    }
    expect(RESTORE_USER_PASSWORD_SCRIPT).toContain(
      'if operationRaw then return {operationRaw} end'
    );
    expect(RESTORE_USER_PASSWORD_SCRIPT).toContain(
      "redis.call('SET', KEYS[3], 'USER_EXISTS', 'EX', tonumber(ARGV[3]))"
    );
  });

  it('整体替换支持响应丢失后的幂等重试', () => {
    expect(REPLACE_ADMIN_CONFIG_SCRIPT).toContain(
      "local operationRaw = redis.call('GET', KEYS[3])"
    );
    expect(REPLACE_ADMIN_CONFIG_SCRIPT).toContain(
      "redis.call('SET', KEYS[3], '1', 'EX', tonumber(ARGV[2]))"
    );
  });
});
