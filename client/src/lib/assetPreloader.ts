/**
 * Asset Preloader with Caching
 * Preloads critical assets (videos, images) and caches them for faster subsequent loads
 */

const CACHE_NAME = 'hoomy-assets-v3';
const CACHE_DURATION = 0; // NO CACHE - always fresh

// NO preloading - all assets load on demand
const CRITICAL_ASSETS: string[] = []; // Empty - no preloading

// Non-critical assets for lazy loading (loaded on demand)
const LAZY_ASSETS = [
  // Videos - loaded only when landing page is visited
  '/video/background.webm',
  '/video/background.mp4',
  // City images - loaded only when landing page is visited
  '/images/zurich.webp',
  '/images/geneva.webp',
  '/images/lausanne.webp',
  '/images/bern.webp',
  '/images/basel.webp',
  '/images/lugano.webp',
];

interface PreloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

type ProgressCallback = (progress: PreloadProgress) => void;

/**
 * Check if Cache API is available
 */
function isCacheAPIAvailable(): boolean {
  return 'caches' in window && typeof caches !== 'undefined';
}

/**
 * Open or create the cache
 */
async function openCache(): Promise<Cache | null> {
  if (!isCacheAPIAvailable()) {
    return null;
  }
  try {
    return await caches.open(CACHE_NAME);
  } catch (error) {
    console.warn('Failed to open cache:', error);
    return null;
  }
}

/**
 * Check if an asset is cached and still valid
 */
async function isCached(url: string): Promise<boolean> {
  const cache = await openCache();
  if (!cache) return false;
  
  try {
    const cachedResponse = await cache.match(url);
    if (!cachedResponse) return false;
    
    // Check if cache is still valid (within duration)
    const cachedDate = cachedResponse.headers.get('cached-date');
    if (cachedDate) {
      const cacheTime = parseInt(cachedDate, 10);
      const now = Date.now();
      if (now - cacheTime > CACHE_DURATION) {
        // Cache expired, remove it
        await cache.delete(url);
        return false;
      }
    }
    
    return true;
  } catch (error) {
    console.warn('Error checking cache for', url, error);
    return false;
  }
}

/**
 * Cache an asset
 */
async function cacheAsset(url: string, response: Response): Promise<void> {
  const cache = await openCache();
  if (!cache) return;
  
  try {
    // Clone the response and add cache date header
    const headers = new Headers(response.headers);
    headers.set('cached-date', Date.now().toString());
    
    const responseToCache = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers,
    });
    
    await cache.put(url, responseToCache);
  } catch (error) {
    console.warn('Failed to cache asset', url, error);
  }
}

/**
 * Load an asset (from cache or network)
 */
async function loadAsset(url: string): Promise<Response> {
  // Try cache first
  const cached = await isCached(url);
  if (cached) {
    const cache = await openCache();
    if (cache) {
      const cachedResponse = await cache.match(url);
      if (cachedResponse) {
        return cachedResponse;
      }
    }
  }
  
  // Load from network
  try {
    const response = await fetch(url);
    if (response.ok) {
      // Cache the response
      await cacheAsset(url, response.clone());
      return response;
    }
    throw new Error(`Failed to load ${url}: ${response.status}`);
  } catch (error) {
    console.error('Error loading asset', url, error);
    throw error;
  }
}

/**
 * Preload a video element
 */
function preloadVideo(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    
    const handleCanPlay = () => {
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
      resolve();
    };
    
    const handleError = (e: Event) => {
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
      reject(new Error(`Failed to preload video: ${src}`));
    };
    
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);
    
    video.src = src;
    video.load();
  });
}

/**
 * Preload an image
 */
function preloadImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to preload image: ${src}`));
    
    img.src = src;
  });
}

/**
 * Preload critical assets (minimal, fast)
 */
export async function preloadAssets(
  onProgress?: ProgressCallback
): Promise<void> {
  const total = CRITICAL_ASSETS.length;
  let loaded = 0;
  
  const updateProgress = () => {
    if (onProgress) {
      onProgress({
        loaded,
        total,
        percentage: Math.round((loaded / total) * 100),
      });
    }
  };
  
  // Preload only small critical assets (no videos)
  const preloadPromises = CRITICAL_ASSETS.map(async (asset) => {
    try {
      // Only preload images (no videos in critical assets)
      await preloadImage(asset);
      // Try to cache it (non-blocking)
      loadAsset(asset).catch(() => {
        // Ignore cache errors
      });
      
      loaded++;
      updateProgress();
    } catch (error) {
      // Continue even if one asset fails
      console.warn(`Failed to preload ${asset}:`, error);
      loaded++;
      updateProgress();
    }
  });
  
  await Promise.allSettled(preloadPromises);
}

/**
 * Lazy load assets when needed - DISABLED for fast loading
 */
export async function lazyLoadAssets(assets: string[]): Promise<void> {
  // NO lazy loading - assets load naturally when needed
  // This prevents any blocking or cache issues
  return Promise.resolve();
}

/**
 * Get lazy assets for landing page
 */
export function getLazyAssets(): string[] {
  return LAZY_ASSETS;
}

/**
 * Clear expired cache entries - DISABLED (no cache)
 */
export async function clearExpiredCache(): Promise<void> {
  // Clear ALL cache immediately (no cache policy)
  try {
    if (isCacheAPIAvailable()) {
      await caches.delete(CACHE_NAME);
      // Also clear all other caches
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
  } catch (error) {
    // Ignore errors
  }
}

/**
 * Clear all cached assets
 */
export async function clearAssetCache(): Promise<void> {
  if (!isCacheAPIAvailable()) return;
  
  try {
    await caches.delete(CACHE_NAME);
    console.log('Asset cache cleared');
  } catch (error) {
    console.warn('Error clearing asset cache:', error);
  }
}

