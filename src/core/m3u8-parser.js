(function (root) {
  function parseAttributes(raw) {
    const attrs = {};
    if (!raw) return attrs;
    const regex = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      const key = match[1];
      const val = match[3] !== undefined ? match[3] : match[2];
      attrs[key] = val;
    }
    return attrs;
  }

  function resolveUrl(uri, baseUrl) {
    try {
      return new URL(uri, baseUrl).toString();
    } catch (_) {
      return uri;
    }
  }

  function formatQualityLabel(width, height, fps, mediaName, groupId) {
    if (mediaName) {
      const cleaned = mediaName.trim();
      if (cleaned) return cleaned;
    }
    const h = height || 0;
    const f = fps && fps >= 45 ? Math.round(fps) : '';
    const base = h > 0 ? `${h}p${f}` : 'Auto';
    if (groupId && groupId.toLowerCase() === 'chunked') {
      return `${base} (Source)`;
    }
    return base;
  }

  function parseMasterPlaylist(text, baseUrl) {
    const lines = String(text || '').split(/\r?\n/);
    const mediaLabels = {};
    const variants = [];
    const seenUrls = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXT-X-MEDIA:')) {
        const attrs = parseAttributes(line.slice('#EXT-X-MEDIA:'.length));
        if (attrs['GROUP-ID'] && attrs.NAME && (!attrs.TYPE || attrs.TYPE === 'VIDEO')) {
          mediaLabels[attrs['GROUP-ID']] = attrs.NAME;
        }
        continue;
      }

      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const attrs = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
        let nextUrl = '';
        for (let j = i + 1; j < lines.length; j++) {
          const candidate = lines[j].trim();
          if (!candidate || candidate.startsWith('#')) continue;
          nextUrl = resolveUrl(candidate, baseUrl);
          i = j;
          break;
        }
        if (!nextUrl || seenUrls.has(nextUrl)) continue;

        const videoGroup = attrs.VIDEO || '';
        const mediaName = mediaLabels[videoGroup] || attrs.NAME || '';
        if (
          videoGroup.toLowerCase() === 'audio_only' ||
          mediaName.toLowerCase().includes('audio_only') ||
          mediaName.toLowerCase() === 'audio only'
        ) {
          continue;
        }

        let width = 0;
        let height = 0;
        if (attrs.RESOLUTION) {
          const parts = attrs.RESOLUTION.split('x');
          width = parseInt(parts[0], 10) || 0;
          height = parseInt(parts[1], 10) || 0;
        }

        if (width === 0 && height === 0 && attrs.CODECS && !attrs.CODECS.includes('avc') && !attrs.CODECS.includes('hev') && !attrs.CODECS.includes('hvc')) {
          continue;
        }

        const fps = parseFloat(attrs['FRAME-RATE'] || '0') || 0;
        const bandwidth = parseInt(attrs.BANDWIDTH || '0', 10) || 0;
        const isSource =
          videoGroup.toLowerCase() === 'chunked' ||
          mediaName.toLowerCase().includes('source');

        seenUrls.add(nextUrl);
        variants.push({
          id: `${variants.length}_${height || bandwidth}`,
          url: nextUrl,
          label: formatQualityLabel(width, height, fps, mediaName, videoGroup),
          width,
          height,
          fps,
          bandwidth,
          codecs: attrs.CODECS || '',
          isSource
        });
      }
    }

    variants.sort((a, b) => {
      if (a.isSource !== b.isSource) return a.isSource ? -1 : 1;
      if (b.height !== a.height) return b.height - a.height;
      if (b.fps !== a.fps) return b.fps - a.fps;
      return b.bandwidth - a.bandwidth;
    });

    if (variants.length > 0 && !variants.some((v) => v.isSource)) {
      variants[0].isSource = true;
      if (!variants[0].label.toLowerCase().includes('source')) {
        variants[0].label = `${variants[0].label} (Source)`;
      }
    }

    return variants;
  }

  function isTwitchAdDateRange(attrs) {
    const cls = (attrs.CLASS || '').toLowerCase();
    const id = (attrs.ID || '').toLowerCase();
    if (cls.includes('twitch-stitched-ad') || id.includes('stitched-ad')) return true;
    for (const key of Object.keys(attrs)) {
      if (key.startsWith('X-TV-TWITCH-AD')) return true;
    }
    return false;
  }

  function isAdTitle(title) {
    if (!title) return false;
    const t = title.trim().toLowerCase();
    if (!t || t === 'live') return false;
    return (
      t.includes('amazon') ||
      t.includes('stitched-ad') ||
      t.includes('preroll') ||
      t.includes('midroll') ||
      t === 'ad' ||
      t.startsWith('ad|') ||
      t.includes('|ad|')
    );
  }

  function isAdSegmentUrl(url) {
    const lower = url.toLowerCase();
    return (
      lower.includes('/ads/') ||
      lower.includes('creative.twitch.tv') ||
      lower.includes('stitched-ad') ||
      lower.includes('stitched_ad')
    );
  }

  function parseMediaPlaylist(text, baseUrl) {
    const lines = String(text || '').split(/\r?\n/);
    let targetDuration = 2;
    let mediaSequence = 0;
    let isEnded = false;
    let currentMap = null;
    let currentKey = null;
    let pendingDuration = null;
    let pendingTitle = '';
    let pendingDiscontinuity = false;
    let currentPdtMs = null;
    let inScteAd = false;
    let inDiscontinuityAd = false;
    let activeAdEndMs = 0;
    let cumulativeSec = 0;
    let nonAdDuration = 0;
    let adDuration = 0;
    const adWindows = [];
    const segments = [];
    let segIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXT-X-TARGETDURATION:')) {
        targetDuration = parseFloat(line.slice('#EXT-X-TARGETDURATION:'.length)) || 2;
        continue;
      }

      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        mediaSequence = parseInt(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length), 10) || 0;
        continue;
      }

      if (line === '#EXT-X-ENDLIST') {
        isEnded = true;
        continue;
      }

      if (line.startsWith('#EXT-X-MAP:')) {
        const attrs = parseAttributes(line.slice('#EXT-X-MAP:'.length));
        if (attrs.URI) {
          currentMap = resolveUrl(attrs.URI, baseUrl);
        }
        continue;
      }

      if (line.startsWith('#EXT-X-KEY:')) {
        const attrs = parseAttributes(line.slice('#EXT-X-KEY:'.length));
        if (!attrs.METHOD || attrs.METHOD === 'NONE') {
          currentKey = null;
        } else {
          currentKey = {
            method: attrs.METHOD,
            uri: attrs.URI ? resolveUrl(attrs.URI, baseUrl) : null,
            iv: attrs.IV || null
          };
        }
        continue;
      }

      if (line.startsWith('#EXT-X-DATERANGE:')) {
        const attrs = parseAttributes(line.slice('#EXT-X-DATERANGE:'.length));
        if (isTwitchAdDateRange(attrs)) {
          const startMs = attrs['START-DATE'] ? Date.parse(attrs['START-DATE']) : NaN;
          const durSec = parseFloat(attrs.DURATION || attrs['PLANNED-DURATION'] || '0') || 0;
          if (!Number.isNaN(startMs) && durSec > 0) {
            const endMs = startMs + durSec * 1000;
            adWindows.push({ startMs, endMs });
            if (endMs > activeAdEndMs) activeAdEndMs = endMs;
          }
          inDiscontinuityAd = true;
        }
        continue;
      }

      if (line.startsWith('#EXT-X-SCTE35-OUT') || line.startsWith('#EXT-X-CUE-OUT')) {
        inScteAd = true;
        continue;
      }

      if (line.startsWith('#EXT-X-SCTE35-IN') || line.startsWith('#EXT-X-CUE-IN')) {
        inScteAd = false;
        inDiscontinuityAd = false;
        continue;
      }

      if (line === '#EXT-X-DISCONTINUITY') {
        pendingDiscontinuity = true;
        if (inDiscontinuityAd && segments.length > 0 && segments[segments.length - 1].isAd) {
          inDiscontinuityAd = false;
        }
        continue;
      }

      if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
        const parsed = Date.parse(line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length).trim());
        if (!Number.isNaN(parsed)) {
          currentPdtMs = parsed;
        }
        continue;
      }

      if (line.startsWith('#EXTINF:')) {
        const body = line.slice('#EXTINF:'.length);
        const commaIdx = body.indexOf(',');
        const durStr = commaIdx === -1 ? body : body.slice(0, commaIdx);
        pendingDuration = parseFloat(durStr) || targetDuration;
        pendingTitle = commaIdx === -1 ? '' : body.slice(commaIdx + 1);
        continue;
      }

      if (line.startsWith('#')) {
        continue;
      }

      if (pendingDuration === null) continue;

      const segUrl = resolveUrl(line, baseUrl);
      const seq = mediaSequence + segIndex;
      segIndex += 1;

      let isAd = false;
      if (inScteAd || isAdTitle(pendingTitle) || isAdSegmentUrl(segUrl)) {
        isAd = true;
      } else if (currentPdtMs !== null && adWindows.length > 0) {
        for (let w = 0; w < adWindows.length; w++) {
          if (currentPdtMs >= adWindows[w].startMs - 500 && currentPdtMs < adWindows[w].endMs - 200) {
            isAd = true;
            break;
          }
        }
      } else if (inDiscontinuityAd && pendingDiscontinuity) {
        isAd = true;
      }

      if (isAd && currentPdtMs !== null && activeAdEndMs > 0 && currentPdtMs >= activeAdEndMs) {
        isAd = false;
        inDiscontinuityAd = false;
      }

      const startSec = cumulativeSec;
      const endSec = cumulativeSec + pendingDuration;
      cumulativeSec = endSec;
      if (isAd) {
        adDuration += pendingDuration;
      } else {
        nonAdDuration += pendingDuration;
      }

      segments.push({
        seq,
        url: segUrl,
        duration: pendingDuration,
        startSec,
        endSec,
        pdtMs: currentPdtMs,
        discontinuity: pendingDiscontinuity,
        isAd,
        mapUrl: currentMap,
        key: currentKey
      });

      if (currentPdtMs !== null) {
        currentPdtMs += Math.round(pendingDuration * 1000);
      }
      pendingDuration = null;
      pendingTitle = '';
      pendingDiscontinuity = false;
    }

    return {
      targetDuration,
      mediaSequence,
      isEnded,
      totalDuration: cumulativeSec,
      nonAdDuration,
      adDuration,
      segments
    };
  }

  function sliceSegments(segments, startSec, endSec) {
    const selected = [];
    let skippedAdCount = 0;
    let skippedAdSeconds = 0;
    let sawSkippedOrDisc = false;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.endSec <= startSec + 0.05) continue;
      if (seg.startSec >= endSec - 0.05) break;

      if (seg.isAd) {
        skippedAdCount += 1;
        skippedAdSeconds += seg.duration;
        sawSkippedOrDisc = true;
        continue;
      }

      selected.push({
        seq: seg.seq,
        url: seg.url,
        duration: seg.duration,
        startSec: seg.startSec,
        endSec: seg.endSec,
        discontinuity: selected.length === 0 ? false : Boolean(seg.discontinuity || sawSkippedOrDisc),
        mapUrl: seg.mapUrl || null,
        key: seg.key || null
      });
      sawSkippedOrDisc = false;
    }

    if (selected.length === 0 && segments.length > 0) {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg.isAd && seg.endSec >= startSec) {
          selected.push({
            seq: seg.seq,
            url: seg.url,
            duration: seg.duration,
            startSec: seg.startSec,
            endSec: seg.endSec,
            discontinuity: false,
            mapUrl: seg.mapUrl || null,
            key: seg.key || null
          });
          break;
        }
      }
    }

    return {
      segments: selected,
      skippedAdCount,
      skippedAdSeconds
    };
  }

  root.StreamClipM3U8 = {
    parseAttributes,
    parseMasterPlaylist,
    parseMediaPlaylist,
    sliceSegments
  };
})(typeof self !== 'undefined' ? self : globalThis);
