import { getBangumiImageUrl } from './bangumi';

describe('getBangumiImageUrl', () => {
  it.each([
    [
      '允许 Bangumi HTTPS 图片',
      'https://lain.bgm.tv/pic/cover/l/test.jpg',
      true,
    ],
    [
      '允许 Bangumi HTTP 图片并升级协议',
      'http://lain.bgm.tv/pic/cover/l/test.jpg',
      true,
    ],
    ['拒绝 FTP', 'ftp://lain.bgm.tv/pic/cover/l/test.jpg', false],
    ['拒绝 localhost', 'https://localhost/pic/cover/l/test.jpg', false],
    ['拒绝 IPv4 回环地址', 'https://127.0.0.1/pic/cover/l/test.jpg', false],
    ['拒绝 IPv6 回环地址', 'https://[::1]/pic/cover/l/test.jpg', false],
    ['拒绝私网地址', 'https://192.168.1.1/pic/cover/l/test.jpg', false],
    [
      '拒绝用户名伪装',
      'https://lain.bgm.tv@evil.example/pic/cover/l/test.jpg',
      false,
    ],
    [
      '拒绝相似域名',
      'https://lain.bgm.tv.evil.example/pic/cover/l/test.jpg',
      false,
    ],
    ['拒绝非白名单域名', 'https://bgm.tv/pic/cover/l/test.jpg', false],
    ['拒绝自定义端口', 'https://lain.bgm.tv:8443/pic/cover/l/test.jpg', false],
  ])('%s', (_description, value, isAllowed) => {
    expect(Boolean(getBangumiImageUrl(value))).toBe(isAllowed);
  });

  it('将通过校验的 HTTP URL 升级为 HTTPS', () => {
    const value = 'http://lain.bgm.tv/pic/cover/l/test.jpg?x=1';

    expect(getBangumiImageUrl(value)?.toString()).toBe(
      'https://lain.bgm.tv/pic/cover/l/test.jpg?x=1'
    );
  });

  it('保留通过校验的 HTTPS URL', () => {
    const value = 'https://lain.bgm.tv/pic/cover/l/test.jpg?x=1';

    expect(getBangumiImageUrl(value)?.toString()).toBe(value);
  });
});
