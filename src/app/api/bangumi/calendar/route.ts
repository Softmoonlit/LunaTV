import { NextResponse } from 'next/server';

import {
  fetchBangumiCalendar,
  getBangumiCalendarCacheHeaders,
} from '@/lib/bangumi.server';
import { getCacheTime } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET() {
  const cacheTime = await getCacheTime();
  const result = await fetchBangumiCalendar(cacheTime);

  if (!result.data || result.cacheStatus === 'unavailable') {
    return NextResponse.json(
      { error: 'Bangumi 日历暂时不可用' },
      { status: 502 }
    );
  }

  return NextResponse.json(result.data, {
    headers: getBangumiCalendarCacheHeaders(cacheTime, result.cacheStatus),
  });
}
