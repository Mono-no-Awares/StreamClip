(function (root) {
  const RESERVED_PATHS = new Set([
    'browse',
    'categories',
    'following',
    'search',
    'dashboard',
    'settings',
    'transactions',
    'subscriptions',
    'terms-of-service',
    'privacy-policy',
    'dmca-policy',
    'community-guidelines',
    'video',
    'videos',
    'clips',
    'auth',
    'login',
    'register',
    'help',
    'about'
  ]);

  function parseUrl(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch (_) {
      return null;
    }

    const host = url.hostname.toLowerCase();
    if (host !== 'kick.com' && !host.endsWith('.kick.com')) return null;

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;

    if (parts[0].toLowerCase() === 'video' && parts[1]) {
      return {
        platform: 'kick',
        kind: 'vod',
        channel: null,
        vodId: parts[1],
        seekHintSec: 0
      };
    }

    const slug = parts[0].toLowerCase();
    if (RESERVED_PATHS.has(slug)) return null;

    if (parts[1] && parts[1].toLowerCase() === 'videos' && parts[2]) {
      return {
        platform: 'kick',
        kind: 'vod',
        channel: slug,
        vodId: parts[2],
        seekHintSec: 0
      };
    }

    if (parts[1] && parts[1].toLowerCase() === 'clips') {
      return null;
    }

    if (!/^[a-zA-Z0-9_-]{2,40}$/.test(slug)) return null;

    return {
      platform: 'kick',
      kind: 'live',
      channel: slug,
      vodId: null,
      seekHintSec: 0
    };
  }

  async function fetchVariants(masterUrl) {
    const res = await fetch(masterUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Kick playlist HTTP ${res.status}`);
    }
    const text = await res.text();
    const variants = root.StreamClipM3U8.parseMasterPlaylist(text, masterUrl);
    if (!variants.length) {
      throw new Error('No video qualities found in Kick playlist');
    }
    return variants;
  }

  async function fetchMediaPlaylist(variantUrl) {
    const res = await fetch(variantUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Kick media playlist HTTP ${res.status}`);
    }
    const text = await res.text();
    return root.StreamClipM3U8.parseMediaPlaylist(text, variantUrl);
  }

  function findActiveArchiveVod(livestream, channelData, channelVideos) {
    if (!livestream) return null;
    const candidates = [];
    if (Array.isArray(channelVideos)) candidates.push(...channelVideos);
    if (Array.isArray(channelData?.previous_livestreams)) {
      candidates.push(...channelData.previous_livestreams);
    }

    const streamStartMs = Date.parse(livestream.created_at || livestream.start_time || '');

    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      if (!item || !item.source) continue;
      const matchesId =
        item.id === livestream.id ||
        item.live_stream_id === livestream.id ||
        item.video?.live_stream_id === livestream.id;
      if (matchesId) return item;

      const itemMs = Date.parse(item.created_at || item.start_time || '');
      if (
        item.is_live &&
        !Number.isNaN(itemMs) &&
        !Number.isNaN(streamStartMs) &&
        Math.abs(itemMs - streamStartMs) <= 20 * 60 * 1000
      ) {
        return item;
      }
    }

    return null;
  }

  async function resolveFromPageData({ context, channelData, channelVideos, videoData }) {
    if (context.kind === 'vod') {
      let vodObj = videoData;
      if (!vodObj && Array.isArray(channelVideos)) {
        vodObj = channelVideos.find(
          (v) => v?.video?.uuid === context.vodId || v?.uuid === context.vodId || String(v?.id) === String(context.vodId)
        );
      }

      const masterUrl = vodObj?.source || vodObj?.livestream?.source;
      if (!masterUrl) {
        throw new Error('Kick VOD stream URL not found');
      }

      const streamer =
        vodObj?.livestream?.channel?.slug ||
        vodObj?.channel?.slug ||
        context.channel ||
        'kick';
      const displayName =
        vodObj?.livestream?.channel?.user?.username ||
        vodObj?.channel?.user?.username ||
        streamer;
      const title = vodObj?.session_title || vodObj?.livestream?.session_title || `VOD ${context.vodId}`;
      const startedAt = vodObj?.created_at || vodObj?.start_time || null;

      const variants = await fetchVariants(masterUrl);
      const media = await fetchMediaPlaylist(variants[0].url);

      return {
        platform: 'kick',
        mode: 'vod',
        streamer,
        displayName,
        channelId: vodObj?.channel_id || vodObj?.livestream?.channel_id || vodObj?.channel?.id || null,
        title,
        vodId: context.vodId,
        startedAt,
        durationSec: media.totalDuration || (vodObj?.duration ? vodObj.duration / 1000 : 0),
        masterUrl,
        variants,
        initialMedia: media
      };
    }

    if (!channelData) {
      throw new Error(`Kick channel "${context.channel}" data unavailable`);
    }

    const streamer = channelData.slug || context.channel;
    const displayName = channelData.user?.username || streamer;
    const livestream = channelData.livestream;
    const livePlaybackUrl = channelData.playback_url || livestream?.playback_url;

    if (!livestream && !livePlaybackUrl) {
      return {
        platform: 'kick',
        mode: 'offline',
        streamer,
        displayName,
        title: '',
        variants: []
      };
    }

    const activeArchive = findActiveArchiveVod(livestream, channelData, channelVideos);
    if (activeArchive && activeArchive.source) {
      try {
        const vodVariants = await fetchVariants(activeArchive.source);
        const vodMedia = await fetchMediaPlaylist(vodVariants[0].url);
        if (vodMedia.segments.length > 0 && vodMedia.totalDuration > 0) {
          return {
            platform: 'kick',
            mode: 'live_archive',
            streamer,
            displayName,
            channelId: channelData.id || livestream?.channel_id || null,
            title: livestream?.session_title || activeArchive.session_title || '',
            vodId: activeArchive.video?.uuid || String(activeArchive.id || ''),
            streamId: String(livestream?.id || ''),
            startedAt: livestream?.created_at || livestream?.start_time || activeArchive.created_at || null,
            durationSec: vodMedia.totalDuration,
            masterUrl: activeArchive.source,
            variants: vodVariants,
            initialMedia: vodMedia
          };
        }
      } catch (_) {
      }
    }

    if (!livePlaybackUrl) {
      return {
        platform: 'kick',
        mode: 'offline',
        streamer,
        displayName,
        title: '',
        variants: []
      };
    }

    const liveVariants = await fetchVariants(livePlaybackUrl);

    return {
      platform: 'kick',
      mode: 'live_buffer',
      streamer,
      displayName,
      channelId: channelData.id || livestream?.channel_id || null,
      title: livestream?.session_title || '',
      vodId: null,
      streamId: String(livestream?.id || ''),
      startedAt: livestream?.created_at || livestream?.start_time || null,
      durationSec: 0,
      masterUrl: livePlaybackUrl,
      variants: liveVariants
    };
  }

  root.StreamClipKick = {
    parseUrl,
    resolveFromPageData,
    fetchVariants,
    fetchMediaPlaylist
  };
})(typeof self !== 'undefined' ? self : globalThis);
