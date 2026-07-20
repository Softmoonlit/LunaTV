import { GET } from './route';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = fetchMock;

describe('Bangumi image route', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('将 HTTP 图片地址升级为 HTTPS 后请求上游', async () => {
    fetchMock.mockResolvedValue(
      new Response('image data', {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      })
    );

    const response = await GET(
      new Request(
        'http://localhost/api/bangumi/image?url=' +
          encodeURIComponent('http://lain.bgm.tv/pic/cover/l/test.jpg')
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(await response.text()).toBe('image data');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe('https://lain.bgm.tv/pic/cover/l/test.jpg');
    expect(options).toEqual(
      expect.objectContaining({
        redirect: 'manual',
        headers: expect.objectContaining({
          Referer: 'https://bangumi.tv/',
        }),
      })
    );
  });

  it('拒绝非白名单地址且不请求上游', async () => {
    const response = await GET(
      new Request(
        'http://localhost/api/bangumi/image?url=' +
          encodeURIComponent('https://example.com/image.jpg')
      )
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
