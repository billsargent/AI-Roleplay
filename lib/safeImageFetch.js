/**
 * ─── Safe server-side image fetching ───
 *
 * Used by GET /api/proxy-image to download remote images that the browser
 * cannot fetch itself (CORS). Guards against SSRF:
 *   - only http/https URLs
 *   - every resolved address is checked at connect time (also defeats DNS
 *     rebinding), and IP-literal hosts are checked up front
 *   - redirects are followed manually and each hop is re-checked
 *   - timeout, byte cap, and the image type is detected from the bytes
 *     (PNG, JPEG, GIF, WebP, BMP); anything else, including SVG, is refused
 *
 * @module safeImageFetch
 */

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { sniffImageType } from './imageType.js';

const blockList = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockList.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['64:ff9b::', 96], ['2001:db8::', 32], ['100::', 64],
]) blockList.addSubnet(addr, prefix, 'ipv6');

/**
 * True for loopback, private, link-local, multicast, reserved and other
 * non-public addresses (IPv4, IPv6 and IPv4-mapped IPv6).
 * @param {string} ip
 * @returns {boolean}
 */
export function isBlockedAddress(ip) {
  if (typeof ip !== 'string') return true;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];
  const family = net.isIP(ip);
  if (family === 4) return blockList.check(ip, 'ipv4');
  if (family === 6) return blockList.check(ip, 'ipv6');
  return true;
}

export class ImageFetchError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Declared types that can never be an image we accept; rejected before downloading */
const REJECT_TYPE_RE = /^(text\/|image\/svg|application\/(json|xml|javascript|xhtml))/;

/**
 * Fetches an image from a public URL.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.maxBytes=10MB]
 * @param {number} [opts.timeoutMs=10000]
 * @param {number} [opts.maxRedirects=3]
 * @param {(ip: string) => boolean} [opts.isBlocked] - address filter (tests only)
 * @returns {Promise<{ contentType: string, buffer: Buffer }>}
 */
export async function fetchImage(url, opts = {}) {
  const {
    maxBytes = 10 * 1024 * 1024,
    timeoutMs = 10000,
    maxRedirects = 3,
    isBlocked = isBlockedAddress,
  } = opts;

  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await requestOnce(current, { maxBytes, timeoutMs, isBlocked });
    if (res.redirect) {
      current = new URL(res.redirect, current).toString();
      continue;
    }
    return res;
  }
  throw new ImageFetchError('Too many redirects');
}

function requestOnce(rawUrl, { maxBytes, timeoutMs, isBlocked }) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return Promise.reject(new ImageFetchError('Invalid URL'));
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return Promise.reject(new ImageFetchError('Only http and https URLs are allowed'));
  }
  if (target.username || target.password) {
    return Promise.reject(new ImageFetchError('URLs with credentials are not allowed'));
  }

  // IP-literal hosts skip DNS, so check them here
  const host = target.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlocked(host)) {
    return Promise.reject(new ImageFetchError('This address is not allowed'));
  }

  // Check every address DNS returns, at connect time
  const lookup = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses.length || addresses.some(a => isBlocked(a.address))) {
        return callback(new ImageFetchError('This address is not allowed'));
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };

  const client = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'image/*', 'User-Agent': 'Mozilla/5.0 (compatible; RPChat image import)' };
    const req = client.get(target, { lookup, timeout: timeoutMs, headers }, res => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: res.headers.location });
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new ImageFetchError(`Upstream HTTP ${status}`, 502));
      }
      // The declared type is only used to bail out early; the real type is
      // detected from the bytes below (some CDNs send application/octet-stream)
      const declaredType = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (REJECT_TYPE_RE.test(declaredType)) {
        res.resume();
        return reject(new ImageFetchError('URL is not a supported image'));
      }
      const declared = Number(res.headers['content-length'] || 0);
      if (declared > maxBytes) {
        res.destroy();
        return reject(new ImageFetchError('Image is too large', 413));
      }

      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          res.destroy();
          reject(new ImageFetchError('Image is too large', 413));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const type = sniffImageType(buffer);
        if (!type) return reject(new ImageFetchError('URL is not a supported image'));
        resolve({ contentType: type.mime, buffer });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new ImageFetchError('Upstream timed out', 504)));
    req.on('error', err => reject(err instanceof ImageFetchError ? err : new ImageFetchError('Failed to fetch image', 502)));
  });
}
