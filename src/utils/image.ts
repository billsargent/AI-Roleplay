/**
 * ─── Image Utility — File/URL to Base64 ───
 *
 * Converts a File object (e.g., from an <input type="file">)
 * into a base64 data URL string for inline storage.
 *
 * Also provides urlToBase64() to fetch a remote image via HTTP
 * and convert it to a base64 data URL — used by the FictionLab
 * beta import to download images into the database.
 *
 * @module image
 */

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

/**
 * Fetches a remote image URL and converts it to a base64 data URL.
 * Used during FictionLab import to download images and embed them
 * directly into the database (cover images, character avatars, etc.).
 *
 * First tries a direct browser fetch. If that fails (e.g., CORS),
 * falls back to the /api/proxy-image endpoint which fetches
 * server-side (no CORS restrictions).
 *
 * @param url - The full HTTP/HTTPS URL of the image
 * @returns A Promise resolving to a base64 data URL, or the original URL on failure
 */
export const urlToBase64 = async (url: string): Promise<string> => {
  // ── Attempt 1: Direct browser fetch (works if CORS allows it) ──
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`urlToBase64: HTTP ${response.status} for ${url} — falling back to proxy`);
      return await proxyFetch(url);
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => {
        console.warn('urlToBase64: FileReader error', error);
        resolve(url);
      };
    });
  } catch (err) {
    console.warn('urlToBase64: direct fetch failed for', url, '— falling back to proxy');
    return await proxyFetch(url);
  }
};

/**
 * Fallback: fetches an image through the server-side proxy to bypass CORS.
 */
const proxyFetch = async (url: string): Promise<string> => {
  try {
    const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`);
    if (!res.ok) {
      console.warn('proxyFetch: proxy returned', res.status);
      return url;
    }
    const { dataUrl } = await res.json();
    if (!dataUrl) {
      console.warn('proxyFetch: no dataUrl in response');
      return url;
    }
    return dataUrl;
  } catch (err) {
    console.warn('proxyFetch: failed for', url, err);
    return url;
  }
};
