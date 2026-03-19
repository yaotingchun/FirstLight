/**
 * Interface for normalized OSM features used by the app components.
 * This mimics the "Overpass" structure to avoid breaking existing code.
 */
export interface OSMFeature {
    id: string;
    center: { lat: number; lon: number };
    tags: any;
}

/**
 * Overpass API Mirrors (Global High-Availability)
 */
const OVERPASS_MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.osm.ch/api/interpreter',
    'https://overpass.be/api/interpreter'
];

/** In-flight request store to prevent duplicate simultaneous calls */
const activeRequests = new Map<string, Promise<OSMFeature[]>>();

/**
 * Robust fetch for OSM features with automatic mirror rotation, retries, and persistent caching.
 * Includes request deduplication to prevent 429 Rate Limit errors.
 * @param bbox Bounding box string "latMin,lonMin,latMax,lonMax"
 * @param useCache Whether to check/store in localStorage (default: true)
 * @returns Array of normalized OSM features
 */
export async function fetchOSMFeatures(bbox: string, useCache: boolean = true): Promise<OSMFeature[]> {
    const cacheKey = `osm_cache_${bbox}`;

    // 1. Request Deduplication: If we are already fetching this BBOX, return that promise
    if (activeRequests.has(bbox)) {
        console.log(`[osmClient] Deduplicating active request for ${bbox}`);
        return activeRequests.get(bbox)!;
    }

    const fetchPromise = (async () => {
        // 2. Try Cache
        if (useCache) {
            try {
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    const { timestamp, features } = JSON.parse(cached);
                    const isFresh = Date.now() - timestamp < 24 * 60 * 60 * 1000; // 24 hours
                    if (isFresh) {
                        console.log(`[osmClient] Cache hit for ${bbox}`);
                        return features;
                    }
                }
            } catch (e) {
                console.warn('[osmClient] Cache read error:', e);
            }
        }

        const query = `[out:json][timeout:25];(way["building"](${bbox});way["leisure"="pitch"](${bbox}););out center;`;
        let lastError: Error | null = null;

        // Shuffle mirrors to distribute load more evenly and avoid hitting the same one first every time
        const shuffledMirrors = [...OVERPASS_MIRRORS].sort(() => Math.random() - 0.5);

        for (const mirror of shuffledMirrors) {
            try {
                console.log(`[osmClient] Fetching from mirror: ${mirror}`);
                const response = await fetch(mirror, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'data=' + encodeURIComponent(query),
                    signal: AbortSignal.timeout(10000) // 10s timeout
                });

                if (!response.ok) {
                    // Check for 429 specifically and log it
                    if (response.status === 429) {
                        console.warn(`[osmClient] Mirror ${mirror} rate-limited (429), rotating...`);
                    } else {
                        console.warn(`[osmClient] Mirror ${mirror} returned status ${response.status}`);
                    }
                    continue;
                }

                const json = await response.json();
                const features = (json.elements || [])
                    .filter((el: any) => el.center)
                    .map((el: any) => ({
                        id: el.id.toString(),
                        center: el.center,
                        tags: el.tags
                    }));

                // 3. Save Cache
                if (useCache && features.length > 0) {
                    try {
                        localStorage.setItem(cacheKey, JSON.stringify({
                            timestamp: Date.now(),
                            features
                        }));
                    } catch (e) {
                        console.warn('[osmClient] Cache write error (possibly storage full):', e);
                    }
                }

                return features;
            } catch (err: any) {
                console.warn(`[osmClient] Mirror ${mirror} failed:`, err.message);
                lastError = err;
            }
        }

        throw lastError || new Error('All Overpass mirrors failed.');
    })();

    // Store the promise and clear it when done
    activeRequests.set(bbox, fetchPromise);
    try {
        return await fetchPromise;
    } finally {
        activeRequests.delete(bbox);
    }
}
