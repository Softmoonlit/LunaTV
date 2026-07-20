import {
  fetchBangumiCalendar,
  getBangumiCalendarCacheHeaders,
  resetBangumiCalendarCacheForTest,
} from './bangumi.server';

const fetchMock = jest.fn();
const consoleErrorSpy = jest
  .spyOn(console, 'error')
  .mockImplementation(() => undefined);

const calendarData = [
  {
    weekday: { en: 'Mon' },
    items: [
      {
        id: 1,
        name: '测试番剧',
        images: { large: 'https://lain.bgm.tv/pic/cover/l/test.jpg' },
      },
    ],
  },
];

function createResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(data),
  } as unknown as Response;
}

describe('fetchBangumiCalendar', () => {
  beforeEach(() => {
    resetBangumiCalendarCacheForTest();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('仅缓存结构正确的日历数据', async () => {
    fetchMock.mockResolvedValue(createResponse(calendarData));

    const result = await fetchBangumiCalendar(7200);

    expect(result).toEqual({ data: calendarData, cacheStatus: 'miss' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.bgm.tv/calendar',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/json' }),
      })
    );
  });

  it('上游失败时返回最近的有效缓存', async () => {
    fetchMock.mockResolvedValueOnce(createResponse(calendarData));
    await fetchBangumiCalendar(7200);

    fetchMock.mockResolvedValueOnce(
      createResponse({ error: 'unavailable' }, false, 503)
    );
    const result = await fetchBangumiCalendar(7200);

    expect(result).toEqual({ data: calendarData, cacheStatus: 'stale' });
  });

  it('没有缓存时将上游失败标记为不可用', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error'));

    const result = await fetchBangumiCalendar(7200);

    expect(result).toEqual({ data: null, cacheStatus: 'unavailable' });
  });

  it('不会缓存格式错误的上游响应', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ weekday: 'Mon' }));

    const result = await fetchBangumiCalendar(7200);

    expect(result).toEqual({ data: null, cacheStatus: 'unavailable' });
  });

  it('为新鲜和 stale 响应设置不同的缓存策略', () => {
    expect(getBangumiCalendarCacheHeaders(7200, 'miss')).toMatchObject({
      'Cache-Control': 'public, max-age=7200, s-maxage=7200',
      'X-Bangumi-Cache': 'miss',
    });
    expect(getBangumiCalendarCacheHeaders(7200, 'stale')).toEqual({
      'Cache-Control': 'no-store',
      'X-Bangumi-Cache': 'stale',
    });
  });
});
