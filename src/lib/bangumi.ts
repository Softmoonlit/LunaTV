export interface BangumiCalendarItem {
  id: number;
  name: string;
  name_cn?: string;
  rating?: {
    score?: number;
  };
  air_date?: string;
  images?: {
    large?: string;
    common?: string;
    medium?: string;
    small?: string;
    grid?: string;
  };
}

export interface BangumiCalendarData {
  weekday: {
    en: string;
  };
  items: BangumiCalendarItem[];
}

export interface BangumiCalendarItemWithImages extends BangumiCalendarItem {
  images: NonNullable<BangumiCalendarItem['images']>;
}

export interface BangumiCalendarDataWithImages {
  weekday: {
    en: string;
  };
  items: BangumiCalendarItemWithImages[];
}

const BANGUMI_IMAGE_HOST = 'lain.bgm.tv';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasValidBangumiImages(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;

  return Object.values(value).every((imageUrl) => typeof imageUrl === 'string');
}

function isBangumiCalendarItem(value: unknown): value is BangumiCalendarItem {
  if (!isRecord(value)) return false;

  if (typeof value.id !== 'number' || typeof value.name !== 'string') {
    return false;
  }

  if (value.name_cn !== undefined && typeof value.name_cn !== 'string') {
    return false;
  }

  if (value.air_date !== undefined && typeof value.air_date !== 'string') {
    return false;
  }

  if (!hasValidBangumiImages(value.images)) return false;

  if (value.rating !== undefined) {
    if (!isRecord(value.rating)) return false;
    if (
      value.rating.score !== undefined &&
      typeof value.rating.score !== 'number'
    ) {
      return false;
    }
  }

  return true;
}

export function isBangumiCalendarData(
  value: unknown
): value is BangumiCalendarData[] {
  if (!Array.isArray(value)) return false;

  return value.every((day) => {
    if (!isRecord(day) || !isRecord(day.weekday) || !Array.isArray(day.items)) {
      return false;
    }

    return (
      typeof day.weekday.en === 'string' &&
      day.items.every(isBangumiCalendarItem)
    );
  });
}

export function hasBangumiImage(
  item: BangumiCalendarItem
): item is BangumiCalendarItemWithImages {
  return Boolean(
    item.images &&
      (item.images.large ||
        item.images.common ||
        item.images.medium ||
        item.images.small ||
        item.images.grid)
  );
}

export function getBangumiPoster(item: BangumiCalendarItemWithImages): string {
  return (
    item.images.large ||
    item.images.common ||
    item.images.medium ||
    item.images.small ||
    item.images.grid ||
    ''
  );
}

export function getBangumiImageUrl(value: string): URL | null {
  try {
    const imageUrl = new URL(value);
    if (
      (imageUrl.protocol !== 'http:' && imageUrl.protocol !== 'https:') ||
      imageUrl.hostname !== BANGUMI_IMAGE_HOST ||
      imageUrl.port ||
      imageUrl.username ||
      imageUrl.password
    ) {
      return null;
    }

    imageUrl.protocol = 'https:';
    return imageUrl;
  } catch {
    return null;
  }
}
