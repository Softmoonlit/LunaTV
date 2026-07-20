'use client';

import {
  BangumiCalendarDataWithImages,
  hasBangumiImage,
  isBangumiCalendarData,
} from './bangumi';

export type { BangumiCalendarDataWithImages as BangumiCalendarData } from './bangumi';

export async function GetBangumiCalendarData(): Promise<
  BangumiCalendarDataWithImages[]
> {
  const response = await fetch('/api/bangumi/calendar');
  if (!response.ok) {
    throw new Error(`获取番剧日历失败: HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  if (!isBangumiCalendarData(data)) {
    throw new Error('Bangumi 日历响应格式异常');
  }

  return data.map((item) => ({
    ...item,
    items: item.items.filter(hasBangumiImage),
  }));
}
