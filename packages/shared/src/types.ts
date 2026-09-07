export type DeviceType = 'mobile' | 'desktop' | 'tablet' | 'unknown';

export type AuthProvider = 'local' | 'github' | 'google';

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  provider: AuthProvider;
  createdAt: string;
}

export interface LinkDto {
  id: string;
  shortCode: string;
  /** Fully-qualified short URL, built from APP_BASE_URL at serialization time. */
  shortUrl: string;
  originalUrl: string;
  isActive: boolean;
  expiresAt: string | null;
  clickCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ClicksByDay {
  date: string;
  clicks: number;
}

export interface CountryClicks {
  country: string;
  clicks: number;
}

export interface ReferrerClicks {
  referrer: string;
  clicks: number;
}

export interface LinkAnalytics {
  linkId: string;
  period: { from: string; to: string };
  totalClicks: number;
  uniqueVisitors: number;
  clicksByDay: ClicksByDay[];
  topCountries: CountryClicks[];
  deviceBreakdown: Record<DeviceType, number>;
  browserBreakdown: Record<string, number>;
  topReferrers: ReferrerClicks[];
}

/** Every non-2xx response from the API uses this envelope. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level validation failures, keyed by dotted path. */
    details?: Record<string, string[]>;
  };
}
