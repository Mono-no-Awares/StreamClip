(function (root) {
  const CONCURRENCY = 6;
  const MAX_RETRIES = 2;
  const MAX_CLIP_SECONDS = 600;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function sanitizeFilenamePart(value) {
    return String(value || 'stream')
      .trim()
      .toLowerCase()
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'stream';
  }

  function buildFilename({ platform, streamer, dateObj }) {
    const d = dateObj || new Date();
    const dateStr = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const timeStr = `${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
    const safePlatform = sanitizeFilenamePart(platform || 'stream');
    const safeStreamer = sanitizeFilenamePart(streamer || 'channel');
    return `${safePlatform}_${safeStreamer}_${dateStr}_${timeStr}.mp4`;
  }

  function parseIvBytes(ivHex, seq) {
    const iv = new Uint8Array(16);
    if (ivHex) {
      const cleaned = ivHex.replace(/^0x/i, '').padStart(32, '0').slice(-32);
      for (let i = 0; i < 16; i++) {
        iv[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16) || 0;
      }
      return iv;
    }
    const view = new DataView(iv.buffer);
    view.setUint32(12, seq >>> 0);
    return iv;
  }

  async function fetchBinary(url, signal, allowExpiredSkip) {
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal && signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      try {
        const res = await fetch(url, { signal, cache: 'no-store' });
        if (allowExpiredSkip && (res.status === 404 || res.status === 410)) {
          return { expired: true, bytes: null };
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const buf = await res.arrayBuffer();
        return { expired: false, bytes: new Uint8Array(buf) };
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
    }
    throw lastError || new Error('Segment download failed');
  }

  async function downloadAndMux({ segments, allowLeadingExpire, signal, onProgress }) {
    if (!segments || segments.length === 0) {
      throw new Error('No media segments selected');
    }

    const total = segments.length;
    const results = new Array(total);
    const keyCache = new Map();
    let initMapBytes = null;
    let nextIndex = 0;
    let completed = 0;
    let bytesDownloaded = 0;

    const firstMapUrl = segments.find((s) => s.mapUrl)?.mapUrl;
    if (firstMapUrl) {
      const mapRes = await fetchBinary(firstMapUrl, signal, false);
      initMapBytes = mapRes.bytes;
    }

    async function getCryptoKey(uri) {
      if (!keyCache.has(uri)) {
        const promise = (async () => {
          const res = await fetchBinary(uri, signal, false);
          return crypto.subtle.importKey('raw', res.bytes, { name: 'AES-CBC' }, false, ['decrypt']);
        })();
        keyCache.set(uri, promise);
      }
      return keyCache.get(uri);
    }

    async function worker() {
      while (true) {
        if (signal && signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const idx = nextIndex++;
        if (idx >= total) return;

        const seg = segments[idx];
        const fetched = await fetchBinary(seg.url, signal, Boolean(allowLeadingExpire));
        if (fetched.expired) {
          results[idx] = { expired: true, bytes: null, discontinuity: seg.discontinuity };
        } else {
          let bytes = fetched.bytes;
          if (seg.key && seg.key.method === 'AES-128' && seg.key.uri) {
            const cryptoKey = await getCryptoKey(seg.key.uri);
            const iv = parseIvBytes(seg.key.iv, seg.seq || idx);
            const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, bytes);
            bytes = new Uint8Array(plain);
          }
          bytesDownloaded += bytes.byteLength;
          results[idx] = {
            expired: false,
            bytes,
            discontinuity: Boolean(seg.discontinuity)
          };
        }

        completed += 1;
        if (onProgress) {
          onProgress({
            phase: 'downloading',
            done: completed,
            total,
            bytesDownloaded
          });
        }
      }
    }

    const workerCount = Math.min(CONCURRENCY, total);
    const workers = [];
    for (let w = 0; w < workerCount; w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    const validSegments = [];
    let skippedExpired = 0;
    let sawNonExpired = false;
    for (let i = 0; i < results.length; i++) {
      const item = results[i];
      if (!item || item.expired) {
        if (!sawNonExpired && allowLeadingExpire) {
          skippedExpired += 1;
          continue;
        }
        throw new Error('A segment expired on CDN before download finished');
      }
      sawNonExpired = true;
      validSegments.push({
        bytes: item.bytes,
        discontinuity: validSegments.length === 0 ? false : item.discontinuity
      });
    }

    if (validSegments.length === 0) {
      throw new Error('Selected segments already expired on CDN');
    }

    if (onProgress) {
      onProgress({
        phase: 'muxing',
        done: total,
        total,
        bytesDownloaded
      });
    }

    const { blob, durationSec } = await root.StreamClipMuxer.transmuxToMp4(validSegments, initMapBytes);

    return {
      blob,
      durationSec,
      sizeBytes: blob.size,
      segmentCount: validSegments.length,
      skippedExpired
    };
  }

  root.StreamClipBuilder = {
    MAX_CLIP_SECONDS,
    buildFilename,
    downloadAndMux
  };
})(typeof self !== 'undefined' ? self : globalThis);
