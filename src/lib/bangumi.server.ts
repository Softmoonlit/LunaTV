/* eslint-disable no-console */
import { BangumiCalendarData, isBangumiCalendarData } from './bangumi';

export const BANGUMI_CALENDAR_URL = 'https://api.bgm.tv/calendar';
export const BANGUMI_REQUEST_TIMEOUT_MS = 10000;
export const BANGUMI_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

type CalendarCacheStatus = 'miss' | 'stale' | 'unavailable';

type BangumiCalendarResult = {
  data: BangumiCalendarData[] | null;
  cacheStatus: CalendarCacheStatus;
};

let calendarCache: { data: BangumiCalendarData[]; cachedAt: number } | null =
  null;

function getStaleCalendarData(cacheTime: number): BangumiCalendarData[] | null {
  if (!calendarCache) return null;

  // 最多额外保留一个缓存周期，防止上游长期不可用时持续展示过时内容。
  const staleLifetime = Math.max(cacheTime, 1) * 2 * 1000;
  if (Date.now() - calendarCache.cachedAt > staleLifetime) {
    return null;
  }

  return calendarCache.data;
}

export async function fetchBangumiCalendar(
  cacheTime: number
): Promise<BangumiCalendarResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    BANGUMI_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(BANGUMI_CALENDAR_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': BANGUMI_USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Bangumi API returned ${response.status}`);
    }

    const data: unknown = await response.json();
    if (!isBangumiCalendarData(data)) {
      throw new Error('Bangumi API returned an invalid calendar response');
    }

    calendarCache = { data, cachedAt: Date.now() };
    return { data, cacheStatus: 'miss' };
  } catch (error) {
    console.error('获取 Bangumi 日历失败:', error);
    const staleData = getStaleCalendarData(cacheTime);
    if (staleData) {
      return { data: staleData, cacheStatus: 'stale' };
    }

    return { data: null, cacheStatus: 'unavailable' };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getBangumiCalendarCacheHeaders(
  cacheTime: number,
  cacheStatus: Exclude<CalendarCacheStatus, 'unavailable'>
): HeadersInit {
  if (cacheStatus === 'stale') {
    return {
      'Cache-Control': 'no-store',
      'X-Bangumi-Cache': 'stale',
    };
  }

  return {
    'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
    'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
    'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
    'X-Bangumi-Cache': 'miss',
  };
}

export function resetBangumiCalendarCacheForTest() {
  calendarCache = null;
}
