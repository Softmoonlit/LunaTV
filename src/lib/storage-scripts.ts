export const ADMIN_CONFIG_KEY = 'admin:config';
export const ADMIN_CONFIG_VERSION_KEY = 'admin:config:version';
export const USERS_SET_KEY = 'sys:users';

export const MIGRATE_PASSWORD_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current ~= ARGV[1] then return 'SKIPPED' end
redis.call('SET', KEYS[1], ARGV[2])
return 'UPDATED'
`;

export const RESTORE_USER_PASSWORD_SCRIPT = `
local passwordType = redis.call('TYPE', KEYS[1])
if type(passwordType) == 'table' then passwordType = passwordType.ok end
local usersType = redis.call('TYPE', KEYS[2])
if type(usersType) == 'table' then usersType = usersType.ok end
local operationType = redis.call('TYPE', KEYS[3])
if type(operationType) == 'table' then operationType = operationType.ok end

if passwordType ~= 'none' and passwordType ~= 'string' then return {'INVALID_PASSWORD_KEY'} end
if usersType ~= 'none' and usersType ~= 'set' then return {'INVALID_USERS_KEY'} end
if operationType ~= 'none' and operationType ~= 'string' then return {'INVALID_OPERATION_KEY'} end
local operationRaw = redis.call('GET', KEYS[3])
if operationRaw then return {operationRaw} end
if passwordType == 'string' then
  redis.call('SET', KEYS[3], 'USER_EXISTS', 'EX', tonumber(ARGV[3]))
  return {'USER_EXISTS'}
end

redis.call('SET', KEYS[1], ARGV[1])
redis.call('SADD', KEYS[2], ARGV[2])
redis.call('SET', KEYS[3], 'OK', 'EX', tonumber(ARGV[3]))
return {'OK'}
`;

export const SET_ADMIN_CONFIG_SCRIPT = `
local operationRaw = redis.call('GET', KEYS[3])
if operationRaw then
  return {'OK'}
end

local currentRaw = redis.call('GET', KEYS[1])
if not currentRaw then
  return {'MISSING'}
end

local current = cjson.decode(currentRaw)
local currentVersion = tonumber(current.ConfigVersion) or 0
local expectedVersion = tonumber(ARGV[1])
local targetRaw = ARGV[2]
local target = cjson.decode(targetRaw)
local targetVersion = tonumber(target.ConfigVersion) or 0

if currentRaw == targetRaw then
  redis.call('SET', KEYS[2], tostring(targetVersion))
  redis.call('SET', KEYS[3], '1', 'EX', tonumber(ARGV[3]))
  return {'OK'}
end

if currentVersion ~= expectedVersion then
  return {'CONFLICT'}
end

redis.call('SET', KEYS[1], targetRaw)
redis.call('SET', KEYS[2], tostring(targetVersion))
redis.call('SET', KEYS[3], '1', 'EX', tonumber(ARGV[3]))
return {'OK'}
`;

export const INITIALIZE_ADMIN_CONFIG_SCRIPT = `
local currentRaw = redis.call('GET', KEYS[1])
if currentRaw then
  local current = cjson.decode(currentRaw)
  local currentVersion = tonumber(current.ConfigVersion) or 0
  redis.call('SET', KEYS[2], tostring(currentVersion))
  return 'OK'
end

redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], '1')
return 'OK'
`;

export const REPLACE_ADMIN_CONFIG_SCRIPT = `
local operationRaw = redis.call('GET', KEYS[3])
if operationRaw then
  return 'OK'
end

local currentRaw = redis.call('GET', KEYS[1])
local currentVersion = 0
if currentRaw then
  local current = cjson.decode(currentRaw)
  currentVersion = tonumber(current.ConfigVersion) or 0
end

local replacement = cjson.decode(ARGV[1])
replacement.ConfigVersion = currentVersion + 1
local replacementRaw = cjson.encode(replacement)
redis.call('SET', KEYS[1], replacementRaw)
redis.call('SET', KEYS[2], tostring(replacement.ConfigVersion))
redis.call('SET', KEYS[3], '1', 'EX', tonumber(ARGV[2]))
return 'OK'
`;

export const MUTATE_USER_SCRIPT = `
local configType = redis.call('TYPE', KEYS[1])
if type(configType) == 'table' then configType = configType.ok end
local passwordType = redis.call('TYPE', KEYS[3])
if type(passwordType) == 'table' then passwordType = passwordType.ok end
local usersType = redis.call('TYPE', KEYS[4])
if type(usersType) == 'table' then usersType = usersType.ok end
local operationType = redis.call('TYPE', KEYS[9])
if type(operationType) == 'table' then operationType = operationType.ok end

if configType ~= 'string' then return {'INVALID_CONFIG'} end
if passwordType ~= 'none' and passwordType ~= 'string' then return {'INVALID_PASSWORD_KEY'} end
if usersType ~= 'none' and usersType ~= 'set' then return {'INVALID_USERS_KEY'} end
if operationType ~= 'none' and operationType ~= 'string' then return {'INVALID_OPERATION_KEY'} end

local operationRaw = redis.call('GET', KEYS[9])
if operationRaw then
  return {'OK'}
end

local currentRaw = redis.call('GET', KEYS[1])
if not currentRaw then return {'CONFLICT'} end
local current = cjson.decode(currentRaw)
local currentVersion = tonumber(current.ConfigVersion) or 0
if currentVersion ~= tonumber(ARGV[1]) then return {'CONFLICT'} end

local target = cjson.decode(ARGV[2])
local targetRaw = cjson.encode(target)
local action = ARGV[3]

if action == 'add' or action == 'changePassword' then
  if ARGV[4] == '' then return {'INVALID_PASSWORD'} end
end

if action == 'add' then
  if redis.call('EXISTS', KEYS[3]) == 1 then return {'USER_EXISTS'} end
elseif action ~= 'delete' and action ~= 'changePassword' then
  return {'INVALID_ACTION'}
end

if action == 'add' then
  redis.call('SET', KEYS[3], ARGV[4])
  redis.call('SADD', KEYS[4], ARGV[5])
elseif action == 'delete' then
  redis.call('DEL', KEYS[3], KEYS[5], KEYS[6], KEYS[7], KEYS[8])
  redis.call('SREM', KEYS[4], ARGV[5])
else
  redis.call('SET', KEYS[3], ARGV[4])
end

redis.call('SET', KEYS[1], targetRaw)
redis.call('SET', KEYS[2], tostring(target.ConfigVersion))
redis.call('SET', KEYS[9], '1', 'EX', tonumber(ARGV[6]))
return {'OK'}
`;

export const REGISTER_USER_SCRIPT = `
local configType = redis.call('TYPE', KEYS[1])
if type(configType) == 'table' then configType = configType.ok end
local passwordType = redis.call('TYPE', KEYS[3])
if type(passwordType) == 'table' then passwordType = passwordType.ok end
local usersType = redis.call('TYPE', KEYS[4])
if type(usersType) == 'table' then usersType = usersType.ok end
local operationType = redis.call('TYPE', KEYS[5])
if type(operationType) == 'table' then operationType = operationType.ok end

if configType ~= 'string' then return {'INVALID_CONFIG'} end
if passwordType ~= 'none' and passwordType ~= 'string' then return {'INVALID_PASSWORD_KEY'} end
if usersType ~= 'none' and usersType ~= 'set' then return {'INVALID_USERS_KEY'} end
if operationType ~= 'none' and operationType ~= 'string' then return {'INVALID_OPERATION_KEY'} end

local operationRaw = redis.call('GET', KEYS[5])
if operationRaw then
  local operation = cjson.decode(operationRaw)
  if operation.fingerprint == ARGV[5] then
    local replayConfigRaw = redis.call('GET', KEYS[1])
    local replayConfig = cjson.decode(replayConfigRaw)
    local userStillExists = redis.call('EXISTS', KEYS[3]) == 1
    for _, user in ipairs(replayConfig.UserConfig.Users or {}) do
      if user.username == ARGV[1] and userStillExists then
        return {'CREATED', '1'}
      end
    end
    return {'USER_EXISTS'}
  end
  return {'IDEMPOTENCY_CONFLICT'}
end

local configRaw = redis.call('GET', KEYS[1])
local config = cjson.decode(configRaw)
if type(config.UserConfig) ~= 'table' or config.UserConfig.AllowRegister ~= true then
  return {'REGISTRATION_DISABLED'}
end
if type(config.UserConfig.Users) ~= 'table' then return {'INVALID_CONFIG'} end
if ARGV[1] == ARGV[2] then return {'USER_EXISTS'} end

for _, user in ipairs(config.UserConfig.Users) do
  if user.username == ARGV[1] then return {'USER_EXISTS'} end
end
if redis.call('EXISTS', KEYS[3]) == 1 then return {'USER_EXISTS'} end

local currentVersion = tonumber(config.ConfigVersion) or 0
config.ConfigVersion = currentVersion + 1
table.insert(config.UserConfig.Users, {username = ARGV[1], role = 'user'})
local updatedConfigRaw = cjson.encode(config)
local operationRawToSave = cjson.encode({fingerprint = ARGV[5]})

redis.call('SET', KEYS[3], ARGV[3])
redis.call('SADD', KEYS[4], ARGV[1])
redis.call('SET', KEYS[5], operationRawToSave, 'EX', tonumber(ARGV[4]))
redis.call('SET', KEYS[1], updatedConfigRaw)
redis.call('SET', KEYS[2], tostring(config.ConfigVersion))
return {'CREATED', '0'}
`;
