/**
 * Analytics & User Behavior Tracking System
 * Tracks user interactions, navigation, and engagement
 */

import { getAuthToken } from './auth';
import { getAPIBaseURL } from './apiConfig';

// =============================================================================
// TYPES
// =============================================================================

interface AnalyticsEvent {
  type: EventType;
  category: EventCategory;
  action: string;
  label?: string;
  value?: number;
  metadata?: Record<string, unknown>;
  timestamp: number;
  sessionId: string;
  userId?: number;
  page: string;
  referrer?: string;
  userAgent: string;
  screenSize: string;
  language: string;
  ipAddress?: string;
  country?: string;
  city?: string;
  device: 'mobile' | 'tablet' | 'desktop';
  browser: string;
  os: string;
}

type EventType = 
  | 'page_view'
  | 'click'
  | 'form_submit'
  | 'form_error'
  | 'search'
  | 'filter'
  | 'scroll'
  | 'engagement'
  | 'error'
  | 'navigation'
  | 'auth'
  | 'property'
  | 'message'
  | 'contract'
  | 'payment'
  | 'feature';

type EventCategory = 
  | 'navigation'
  | 'interaction'
  | 'conversion'
  | 'error'
  | 'engagement'
  | 'auth'
  | 'property'
  | 'messaging'
  | 'contracts'
  | 'payments';

interface SessionData {
  id: string;
  startTime: number;
  lastActivity: number;
  pageViews: number;
  events: number;
  referrer: string;
  entryPage: string;
  device: 'mobile' | 'tablet' | 'desktop';
  ipAddress?: string;
  country?: string;
  city?: string;
}

interface GeoInfo {
  ip: string;
  country?: string;
  city?: string;
}

interface UserEngagement {
  timeOnPage: number;
  scrollDepth: number;
  interactions: number;
  focusTime: number;
}

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

const SESSION_KEY = 'hoomy_analytics_session';
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

function getDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

function getOrCreateSession(): SessionData {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      const session = JSON.parse(stored) as SessionData;
      // Check if session is still valid
      if (Date.now() - session.lastActivity < SESSION_TIMEOUT) {
        session.lastActivity = Date.now();
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        return session;
      }
    }
  } catch {
    // Ignore parsing errors
  }

  // Create new session
  const newSession: SessionData = {
    id: generateSessionId(),
    startTime: Date.now(),
    lastActivity: Date.now(),
    pageViews: 0,
    events: 0,
    referrer: document.referrer || 'direct',
    entryPage: window.location.pathname,
    device: getDeviceType(),
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
  return newSession;
}

function updateSession(updates: Partial<SessionData>): void {
  try {
    const session = getOrCreateSession();
    const updated = { ...session, ...updates, lastActivity: Date.now() };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
  } catch {
    // Ignore errors
  }
}

// =============================================================================
// EVENT QUEUE & BATCHING
// =============================================================================

const EVENT_QUEUE_KEY = 'hoomy_analytics_queue';
const EVENT_HISTORY_KEY = 'hoomy_analytics_history';
const GEO_INFO_KEY = 'hoomy_geo_info';
const BATCH_SIZE = 10;
const FLUSH_INTERVAL = 30000; // 30 seconds
const MAX_HISTORY_SIZE = 500; // Keep last 500 events for admin view

let eventQueue: AnalyticsEvent[] = [];
let eventHistory: AnalyticsEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let geoInfo: GeoInfo | null = null;

// =============================================================================
// IP & GEO DETECTION
// =============================================================================

async function fetchGeoInfo(): Promise<GeoInfo | null> {
  // Try to get from cache first
  try {
    const cached = localStorage.getItem(GEO_INFO_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      // Cache for 1 hour
      if (Date.now() - data.timestamp < 3600000) {
        geoInfo = data.info;
        return geoInfo;
      }
    }
  } catch {
    // Ignore cache errors
  }

  try {
    // Use ipapi.co for IP and geo info (free, no API key needed)
    const response = await fetch('https://ipapi.co/json/', { 
      signal: AbortSignal.timeout(5000) 
    });
    if (response.ok) {
      const data = await response.json();
      geoInfo = {
        ip: data.ip,
        country: data.country_name,
        city: data.city,
      };
      // Cache the result
      localStorage.setItem(GEO_INFO_KEY, JSON.stringify({
        info: geoInfo,
        timestamp: Date.now(),
      }));
      return geoInfo;
    }
  } catch {
    // Fallback to ip-api.com
    try {
      const response = await fetch('http://ip-api.com/json/?fields=query,country,city', {
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        const data = await response.json();
        geoInfo = {
          ip: data.query,
          country: data.country,
          city: data.city,
        };
        localStorage.setItem(GEO_INFO_KEY, JSON.stringify({
          info: geoInfo,
          timestamp: Date.now(),
        }));
        return geoInfo;
      }
    } catch {
      // Ignore errors
    }
  }
  return null;
}

// =============================================================================
// BROWSER & OS DETECTION
// =============================================================================

function getBrowser(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome/')) return 'Chrome';
  if (ua.includes('Safari/')) return 'Safari';
  if (ua.includes('Opera/') || ua.includes('OPR/')) return 'Opera';
  return 'Unknown';
}

function getOS(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  return 'Unknown';
}

function loadQueueFromStorage(): void {
  try {
    const stored = localStorage.getItem(EVENT_QUEUE_KEY);
    if (stored) {
      eventQueue = JSON.parse(stored);
    }
    const historyStored = localStorage.getItem(EVENT_HISTORY_KEY);
    if (historyStored) {
      eventHistory = JSON.parse(historyStored);
    }
  } catch {
    eventQueue = [];
    eventHistory = [];
  }
}

function saveQueueToStorage(): void {
  try {
    localStorage.setItem(EVENT_QUEUE_KEY, JSON.stringify(eventQueue));
  } catch {
    // Storage full or unavailable
  }
}

function saveHistoryToStorage(): void {
  try {
    localStorage.setItem(EVENT_HISTORY_KEY, JSON.stringify(eventHistory));
  } catch {
    // Storage full or unavailable - clear old events
    eventHistory = eventHistory.slice(-100);
    try {
      localStorage.setItem(EVENT_HISTORY_KEY, JSON.stringify(eventHistory));
    } catch {
      // Still failing, clear all
      eventHistory = [];
    }
  }
}

function addToHistory(event: AnalyticsEvent): void {
  eventHistory.push(event);
  // Keep only the last MAX_HISTORY_SIZE events
  if (eventHistory.length > MAX_HISTORY_SIZE) {
    eventHistory = eventHistory.slice(-MAX_HISTORY_SIZE);
  }
  saveHistoryToStorage();
}

async function flushEvents(): Promise<void> {
  if (eventQueue.length === 0) return;

  const eventsToSend = [...eventQueue];
  eventQueue = [];
  saveQueueToStorage();

  const apiUrl = `${getAPIBaseURL()}/admin/analytics/events`;

  try {
    // Send to admin analytics endpoint (accepts from anyone, but only admin can VIEW)
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events: eventsToSend }),
    });

    if (!response.ok) {
      // Re-queue events on failure
      eventQueue = [...eventsToSend, ...eventQueue];
      saveQueueToStorage();
    }
  } catch {
    // Re-queue events on error
    eventQueue = [...eventsToSend, ...eventQueue];
    saveQueueToStorage();
  }
}

function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushEvents, FLUSH_INTERVAL);
}

function queueEvent(event: AnalyticsEvent): void {
  eventQueue.push(event);
  addToHistory(event); // Store in history for admin view
  updateSession({ events: (getOrCreateSession().events || 0) + 1 });

  // Flush if queue is full
  if (eventQueue.length >= BATCH_SIZE) {
    flushEvents();
  }

  saveQueueToStorage();
}

// =============================================================================
// CORE TRACKING FUNCTIONS
// =============================================================================

function createEvent(
  type: EventType,
  category: EventCategory,
  action: string,
  options?: {
    label?: string;
    value?: number;
    metadata?: Record<string, unknown>;
  }
): AnalyticsEvent {
  const session = getOrCreateSession();
  
  // Try to get user ID from localStorage
  let userId: number | undefined;
  try {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      userId = user.id;
    }
  } catch {
    // Ignore
  }

  return {
    type,
    category,
    action,
    label: options?.label,
    value: options?.value,
    metadata: options?.metadata,
    timestamp: Date.now(),
    sessionId: session.id,
    userId,
    page: window.location.pathname,
    referrer: document.referrer,
    userAgent: navigator.userAgent,
    screenSize: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
    ipAddress: geoInfo?.ip,
    country: geoInfo?.country,
    city: geoInfo?.city,
    device: getDeviceType(),
    browser: getBrowser(),
    os: getOS(),
  };
}

// =============================================================================
// PUBLIC API
// =============================================================================

export const analytics = {
  /**
   * Track a page view
   */
  pageView(pageName?: string): void {
    const session = getOrCreateSession();
    updateSession({ pageViews: session.pageViews + 1 });

    queueEvent(createEvent('page_view', 'navigation', pageName || window.location.pathname, {
      metadata: {
        title: document.title,
        referrer: document.referrer,
        queryParams: window.location.search,
        hash: window.location.hash,
      },
    }));
  },

  /**
   * Track a click event
   */
  click(element: string, metadata?: Record<string, unknown>): void {
    queueEvent(createEvent('click', 'interaction', element, { metadata }));
  },

  /**
   * Track a navigation event
   */
  navigate(from: string, to: string, method: 'link' | 'button' | 'redirect' = 'link'): void {
    queueEvent(createEvent('navigation', 'navigation', `${from} -> ${to}`, {
      metadata: { from, to, method },
    }));
  },

  /**
   * Track a search
   */
  search(query: string, resultsCount?: number, filters?: Record<string, unknown>): void {
    queueEvent(createEvent('search', 'interaction', query, {
      value: resultsCount,
      metadata: { query, resultsCount, filters },
    }));
  },

  /**
   * Track filter usage
   */
  filter(filterName: string, value: unknown): void {
    queueEvent(createEvent('filter', 'interaction', filterName, {
      metadata: { filterName, value },
    }));
  },

  /**
   * Track form submission
   */
  formSubmit(formName: string, success: boolean, metadata?: Record<string, unknown>): void {
    queueEvent(createEvent('form_submit', success ? 'conversion' : 'interaction', formName, {
      value: success ? 1 : 0,
      metadata: { ...metadata, success },
    }));
  },

  /**
   * Track form errors
   */
  formError(formName: string, errors: string[]): void {
    queueEvent(createEvent('form_error', 'error', formName, {
      metadata: { errors },
    }));
  },

  /**
   * Track authentication events
   */
  auth(action: 'login' | 'logout' | 'register' | 'login_failed' | 'register_failed', metadata?: Record<string, unknown>): void {
    queueEvent(createEvent('auth', 'auth', action, { metadata }));
  },

  /**
   * Track property interactions
   */
  property(action: 'view' | 'favorite' | 'unfavorite' | 'contact' | 'share' | 'create' | 'edit' | 'delete', propertyId: number, metadata?: Record<string, unknown>): void {
    queueEvent(createEvent('property', 'property', action, {
      value: propertyId,
      metadata: { propertyId, ...metadata },
    }));
  },

  /**
   * Track messaging events
   */
  message(action: 'open_conversation' | 'send_message' | 'send_image' | 'receive_message', conversationId?: number, metadata?: Record<string, unknown>): void {
    queueEvent(createEvent('message', 'messaging', action, {
      value: conversationId,
      metadata: { conversationId, ...metadata },
    }));
  },

  /**
   * Track contract events
   */
  contract(action: 'view' | 'create' | 'sign' | 'accept' | 'reject' | 'edit', contractId?: number, metadata?: Record<string, unknown>): void {
    queueEvent(createEvent('contract', 'contracts', action, {
      value: contractId,
      metadata: { contractId, ...metadata },
    }));
  },

  /**
   * Track payment events
   */
  payment(action: 'initiate' | 'success' | 'failed' | 'cancelled', amount?: number, metadata?: Record<string, unknown>): void {
    queueEvent(createEvent('payment', 'payments', action, {
      value: amount,
      metadata: { amount, ...metadata },
    }));
  },

  /**
   * Track feature usage
   */
  feature(featureName: string, action: string, metadata?: Record<string, unknown>): void {
    queueEvent(createEvent('feature', 'engagement', `${featureName}:${action}`, { metadata }));
  },

  /**
   * Track errors
   */
  error(errorType: string, message: string, metadata?: Record<string, unknown>): void {
    queueEvent(createEvent('error', 'error', errorType, {
      label: message,
      metadata: { errorType, message, ...metadata },
    }));
  },

  /**
   * Track scroll depth
   */
  scrollDepth(depth: number): void {
    queueEvent(createEvent('scroll', 'engagement', 'scroll_depth', {
      value: depth,
      metadata: { depth: `${depth}%` },
    }));
  },

  /**
   * Track engagement metrics
   */
  engagement(action: 'time_on_page' | 'active_time' | 'idle', duration: number): void {
    queueEvent(createEvent('engagement', 'engagement', action, {
      value: duration,
      metadata: { duration: `${duration}ms` },
    }));
  },

  /**
   * Custom event tracking
   */
  track(type: EventType, category: EventCategory, action: string, options?: {
    label?: string;
    value?: number;
    metadata?: Record<string, unknown>;
  }): void {
    queueEvent(createEvent(type, category, action, options));
  },

  /**
   * Get current session data
   */
  getSession(): SessionData {
    return getOrCreateSession();
  },

  /**
   * Get all events history (for admin dashboard)
   */
  getHistory(): AnalyticsEvent[] {
    return [...eventHistory].reverse(); // Most recent first
  },

  /**
   * Get events summary by type (for admin dashboard)
   */
  getSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const event of eventHistory) {
      const key = `${event.type}:${event.action}`;
      summary[key] = (summary[key] || 0) + 1;
    }
    return summary;
  },

  /**
   * Get unique users count (for admin dashboard)
   */
  getUniqueUsers(): number {
    const users = new Set(eventHistory.filter(e => e.userId).map(e => e.userId));
    return users.size;
  },

  /**
   * Get unique sessions count (for admin dashboard)
   */
  getUniqueSessions(): number {
    const sessions = new Set(eventHistory.map(e => e.sessionId));
    return sessions.size;
  },

  /**
   * Clear history (admin action)
   */
  clearHistory(): void {
    eventHistory = [];
    saveHistoryToStorage();
  },

  /**
   * Get hourly visits data for charts
   */
  getHourlyVisits(): { hour: string; visits: number }[] {
    const hourlyData: Record<number, number> = {};
    
    // Initialize all hours
    for (let i = 0; i < 24; i++) {
      hourlyData[i] = 0;
    }
    
    // Count page views by hour
    eventHistory
      .filter(e => e.type === 'page_view')
      .forEach(event => {
        const hour = new Date(event.timestamp).getHours();
        hourlyData[hour] = (hourlyData[hour] || 0) + 1;
      });
    
    return Object.entries(hourlyData).map(([hour, visits]) => ({
      hour: `${hour}h`,
      visits,
    }));
  },

  /**
   * Get daily visits data for charts (last 7 days)
   */
  getDailyVisits(): { day: string; visits: number; users: number }[] {
    const now = new Date();
    const days: { day: string; visits: number; users: number }[] = [];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dayStart = new Date(date.setHours(0, 0, 0, 0)).getTime();
      const dayEnd = new Date(date.setHours(23, 59, 59, 999)).getTime();
      
      const dayEvents = eventHistory.filter(
        e => e.timestamp >= dayStart && e.timestamp <= dayEnd
      );
      
      const pageViews = dayEvents.filter(e => e.type === 'page_view').length;
      const uniqueUsers = new Set(dayEvents.filter(e => e.userId).map(e => e.userId)).size;
      
      days.push({
        day: date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }),
        visits: pageViews,
        users: uniqueUsers,
      });
    }
    
    return days;
  },

  /**
   * Get page visits ranking
   */
  getPageRanking(): { page: string; visits: number }[] {
    const pageData: Record<string, number> = {};
    
    eventHistory
      .filter(e => e.type === 'page_view')
      .forEach(event => {
        const page = event.page || '/';
        pageData[page] = (pageData[page] || 0) + 1;
      });
    
    return Object.entries(pageData)
      .map(([page, visits]) => ({ page, visits }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 10);
  },

  /**
   * Get device distribution
   */
  getDeviceDistribution(): { device: string; count: number; percentage: number }[] {
    const deviceData: Record<string, number> = { mobile: 0, tablet: 0, desktop: 0 };
    
    eventHistory.forEach(event => {
      if (event.device) {
        deviceData[event.device] = (deviceData[event.device] || 0) + 1;
      }
    });
    
    const total = Object.values(deviceData).reduce((a, b) => a + b, 0) || 1;
    
    return Object.entries(deviceData).map(([device, count]) => ({
      device: device === 'mobile' ? '📱 Mobile' : device === 'tablet' ? '📱 Tablet' : '💻 Desktop',
      count,
      percentage: Math.round((count / total) * 100),
    }));
  },

  /**
   * Get browser distribution
   */
  getBrowserDistribution(): { browser: string; count: number }[] {
    const browserData: Record<string, number> = {};
    
    eventHistory.forEach(event => {
      if (event.browser) {
        browserData[event.browser] = (browserData[event.browser] || 0) + 1;
      }
    });
    
    return Object.entries(browserData)
      .map(([browser, count]) => ({ browser, count }))
      .sort((a, b) => b.count - a.count);
  },

  /**
   * Get country distribution
   */
  getCountryDistribution(): { country: string; count: number }[] {
    const countryData: Record<string, number> = {};
    
    eventHistory.forEach(event => {
      const country = event.country || 'Unknown';
      countryData[country] = (countryData[country] || 0) + 1;
    });
    
    return Object.entries(countryData)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);
  },

  /**
   * Get action types distribution for pie chart
   */
  getActionDistribution(): { name: string; value: number; color: string }[] {
    const actionData: Record<string, number> = {};
    
    eventHistory.forEach(event => {
      actionData[event.type] = (actionData[event.type] || 0) + 1;
    });
    
    const colors: Record<string, string> = {
      page_view: '#3b82f6',
      click: '#10b981',
      auth: '#8b5cf6',
      property: '#f59e0b',
      message: '#ec4899',
      search: '#eab308',
      filter: '#06b6d4',
      error: '#ef4444',
      scroll: '#6366f1',
      engagement: '#14b8a6',
      navigation: '#84cc16',
      contract: '#f97316',
      payment: '#22c55e',
      feature: '#a855f7',
    };
    
    return Object.entries(actionData)
      .map(([name, value]) => ({ 
        name, 
        value,
        color: colors[name] || '#6b7280',
      }))
      .sort((a, b) => b.value - a.value);
  },

  /**
   * Get unique IPs list
   */
  getUniqueIPs(): { ip: string; country: string; city: string; visits: number; lastSeen: string }[] {
    const ipData: Record<string, { country: string; city: string; visits: number; lastSeen: number }> = {};
    
    eventHistory.forEach(event => {
      if (event.ipAddress) {
        if (!ipData[event.ipAddress]) {
          ipData[event.ipAddress] = {
            country: event.country || 'Unknown',
            city: event.city || 'Unknown',
            visits: 0,
            lastSeen: event.timestamp,
          };
        }
        ipData[event.ipAddress].visits++;
        if (event.timestamp > ipData[event.ipAddress].lastSeen) {
          ipData[event.ipAddress].lastSeen = event.timestamp;
        }
      }
    });
    
    return Object.entries(ipData)
      .map(([ip, data]) => ({
        ip,
        country: data.country,
        city: data.city,
        visits: data.visits,
        lastSeen: new Date(data.lastSeen).toLocaleString('fr-FR'),
      }))
      .sort((a, b) => b.visits - a.visits);
  },

  /**
   * Manually flush events
   */
  flush(): Promise<void> {
    return flushEvents();
  },

  /**
   * Initialize analytics
   */
  init(): void {
    loadQueueFromStorage();
    startFlushTimer();

    // Fetch geo info first, then track page view
    fetchGeoInfo().then(() => {
      // Track initial page view with geo info
      this.pageView();
    }).catch(() => {
      this.pageView();
    });

    // Flush on page unload
    window.addEventListener('beforeunload', () => {
      flushEvents();
    });

    // Track visibility changes
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.engagement('idle', Date.now());
        flushEvents();
      } else {
        this.engagement('active_time', Date.now());
      }
    });

    // Track errors
    window.addEventListener('error', (event) => {
      this.error('js_error', event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      this.error('promise_rejection', String(event.reason));
    });

  },
};

// =============================================================================
// SCROLL TRACKING
// =============================================================================

let maxScrollDepth = 0;
let scrollTrackingEnabled = false;

export function enableScrollTracking(): void {
  if (scrollTrackingEnabled) return;
  scrollTrackingEnabled = true;

  const trackScroll = () => {
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    const scrolled = window.scrollY;
    const depth = Math.round((scrolled / scrollHeight) * 100);

    if (depth > maxScrollDepth) {
      maxScrollDepth = depth;

      // Track at 25%, 50%, 75%, 100%
      if ([25, 50, 75, 100].includes(depth)) {
        analytics.scrollDepth(depth);
      }
    }
  };

  window.addEventListener('scroll', trackScroll, { passive: true });
}

// =============================================================================
// PAGE TIME TRACKING
// =============================================================================

let pageStartTime = Date.now();
let isPageVisible = true;
let activeTime = 0;
let lastActiveStart = Date.now();

export function trackPageTime(): void {
  // Track visibility
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      isPageVisible = false;
      activeTime += Date.now() - lastActiveStart;
    } else {
      isPageVisible = true;
      lastActiveStart = Date.now();
    }
  });

  // Track on unload
  window.addEventListener('beforeunload', () => {
    if (isPageVisible) {
      activeTime += Date.now() - lastActiveStart;
    }
    const totalTime = Date.now() - pageStartTime;
    analytics.engagement('time_on_page', totalTime);
    analytics.engagement('active_time', activeTime);
  });
}

// =============================================================================
// CLICK TRACKING (AUTO)
// =============================================================================

export function enableAutoClickTracking(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    
    // Find the closest interactive element
    const interactive = target.closest('button, a, [data-track], [data-testid]');
    if (!interactive) return;

    const trackId = interactive.getAttribute('data-track') || 
                   interactive.getAttribute('data-testid') ||
                   interactive.getAttribute('aria-label') ||
                   interactive.textContent?.trim().slice(0, 50);

    if (trackId) {
      analytics.click(trackId, {
        tagName: interactive.tagName.toLowerCase(),
        href: (interactive as HTMLAnchorElement).href,
        className: interactive.className,
      });
    }
  }, { capture: true });
}

// =============================================================================
// INITIALIZE
// =============================================================================

// Auto-initialize on import
if (typeof window !== 'undefined') {
  analytics.init();
  enableScrollTracking();
  trackPageTime();
  enableAutoClickTracking();
}

export default analytics;

