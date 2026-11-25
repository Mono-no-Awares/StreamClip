(function (root) {
  const GQL_URL = 'https://gql.twitch.tv/gql';
  const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  const RESERVED_PATHS = new Set([
    'directory',
    'downloads',
    'jobs',
    'p',
    'products',
    'settings',
    'subscriptions',
    'inventory',
    'drops',
    'wallet',
    'turbo',
    'videos',
    'search',
    'u',
    'popout',
    'embed',
    'moderator',
    'friends',
    'messages',
    'team',
    'store',
    'prime',
    'bits',
    'creatorcamp',
    'clip',
    'clips',
    'schedule',
    'about',
    'login',
    'signup'
  ]);

  function parseSeekSeconds(raw) {
    if (!raw) return 0;
    const match = String(raw).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
    if (!match) return 0;
    const h = parseInt(match[1] || '0', 10);
    const m = parseInt(match[2] || '0', 10);
    const s = parseInt(match[3] || '0', 10);
    return h * 3600 + m * 60 + s;
  }

  function parseUrl(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch (_) {
      return null;
    }

    const host = url.hostname.toLowerCase();
    if (!host.endsWith('twitch.tv')) return null;

    if (host === 'player.twitch.tv') {
      const vodId = url.searchParams.get('video');
      const channel = url.searchParams.get('channel');
      if (vodId) {
        return {
          platform: 'twitch',
          kind: 'vod',
          vodId: vodId.replace(/^v/i, ''),
          channel: null,
          seekHintSec: parseSeekSeconds(url.searchParams.get('t') || url.searchParams.get('time'))
        };
      }
      if (channel) {
        return {
          platform: 'twitch',
          kind: 'live',
          vodId: null,
          channel: channel.toLowerCase(),
          seekHintSec: 0
        };
      }
      return null;
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;

    if (parts[0].toLowerCase() === 'videos' && parts[1] && /^\d+$/.test(parts[1])) {
      return {
        platform: 'twitch',
        kind: 'vod',
        vodId: parts[1],
        channel: null,
        seekHintSec: parseSeekSeconds(url.searchParams.get('t'))
      };
    }

    if (parts[0].toLowerCase() === 'popout' && parts[1]) {
      const ch = parts[1].toLowerCase();
      if (!RESERVED_PATHS.has(ch)) {
        return {
          platform: 'twitch',
          kind: 'live',
          vodId: null,
          channel: ch,
          seekHintSec: 0
        };
      }
      return null;
    }

    const first = parts[0].toLowerCase();
    if (RESERVED_PATHS.has(first)) return null;
    if (parts[1] && ['clip', 'clips'].includes(parts[1].toLowerCase())) return null;
    if (!/^[a-zA-Z0-9_]{2,25}$/.test(first)) return null;

    return {
      platform: 'twitch',
      kind: 'live',
      vodId: null,
      channel: first,
      seekHintSec: 0
    };
  }

  async function gqlRequest(query, variables, oauthToken) {
    const headers = {
      'Client-ID': CLIENT_ID,
      'Content-Type': 'application/json'
    };
    if (oauthToken) {
      headers.Authorization = `OAuth ${oauthToken}`;
    }

    let res = await fetch(GQL_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables })
    });

    if ((res.status === 401 || res.status === 403) && oauthToken) {
      delete headers.Authorization;
      res = await fetch(GQL_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables })
      });
    }

    if (!res.ok) {
      throw new Error(`Twitch GQL HTTP ${res.status}`);
    }

    const json = await res.json();
    if (json.errors && !json.data) {
      throw new Error(json.errors[0]?.message || 'Twitch GQL error');
    }
    return json.data || {};
  }

  async function getPlaybackToken({ isLive, login, vodId, oauthToken }) {
    const query = `query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) {
      streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {
        value
        signature
      }
      videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {
        value
        signature
      }
    }`;

    const data = await gqlRequest(
      query,
      {
        isLive: Boolean(isLive),
        login: login || '',
        isVod: !isLive,
        vodID: vodId || '',
        playerType: 'site',
        platform: 'web'
      },
      oauthToken
    );

    const token = isLive ? data.streamPlaybackAccessToken : data.videoPlaybackAccessToken;
    if (!token || !token.value || !token.signature) {
      throw new Error('Failed to obtain Twitch playback token');
    }
    return token;
  }

  function buildUsherUrl({ isLive, login, vodId, token }) {
    const p = Math.floor(100000 + Math.random() * 8999999);
    const params = new URLSearchParams({
      token: token.value,
      sig: token.signature,
      allow_source: 'true',
      allow_audio_only: 'false',
      player_backend: 'mediaplayer',
      p: String(p)
    });
    if (isLive) {
      params.set('fast_bread', 'true');
      return `https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(login.toLowerCase())}.m3u8?${params.toString()}`;
    }
    return `https://usher.ttvnw.net/vod/${encodeURIComponent(vodId)}.m3u8?${params.toString()}`;
  }

  async function fetchVariants(masterUrl) {
    const res = await fetch(masterUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Twitch Usher HTTP ${res.status}`);
    }
    const text = await res.text();
    const variants = root.StreamClipM3U8.parseMasterPlaylist(text, masterUrl);
    if (!variants.length) {
      throw new Error('No video qualities found in Twitch playlist');
    }
    return variants;
  }

  async function fetchMediaPlaylist(variantUrl) {
    const res = await fetch(variantUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Twitch media playlist HTTP ${res.status}`);
    }
    const text = await res.text();
    return root.StreamClipM3U8.parseMediaPlaylist(text, variantUrl);
  }

  async function resolveVod(vodId, oauthToken) {
    const metaQuery = `query StreamClipVodMeta($id: ID!) {
      video(id: $id) {
        id
        title
        createdAt
        lengthSeconds
        owner {
          login
          displayName
        }
      }
    }`;

    const [metaData, token] = await Promise.all([
      gqlRequest(metaQuery, { id: vodId }, oauthToken),
      getPlaybackToken({ isLive: false, vodId, oauthToken })
    ]);

    const video = metaData.video;
    if (!video) {
      throw new Error('Twitch VOD not found or restricted');
    }

    const masterUrl = buildUsherUrl({ isLive: false, vodId, token });
    const variants = await fetchVariants(masterUrl);
    const media = await fetchMediaPlaylist(variants[0].url);

    return {
      platform: 'twitch',
      mode: 'vod',
      streamer: video.owner?.login || 'twitch',
      displayName: video.owner?.displayName || video.owner?.login || 'Twitch',
      title: video.title || `VOD ${vodId}`,
      vodId,
      startedAt: video.createdAt || null,
      durationSec: media.totalDuration || video.lengthSeconds || 0,
      masterUrl,
      variants,
      initialMedia: media
    };
  }

  async function resolveLive(channel, oauthToken) {
    const liveQuery = `query StreamClipLiveMeta($login: String!) {
      user(login: $login) {
        id
        login
        displayName
        stream {
          id
          createdAt
          title
        }
        videos(first: 5, type: ARCHIVE, sort: TIME) {
          edges {
            node {
              id
              title
              createdAt
              lengthSeconds
            }
          }
        }
      }
    }`;

    const data = await gqlRequest(liveQuery, { login: channel.toLowerCase() }, oauthToken);
    const user = data.user;
    if (!user) {
      throw new Error(`Twitch channel "${channel}" not found`);
    }

    if (!user.stream) {
      return {
        platform: 'twitch',
        mode: 'offline',
        streamer: user.login,
        displayName: user.displayName || user.login,
        title: '',
        variants: []
      };
    }

    const streamStartMs = Date.parse(user.stream.createdAt);
    const edges = user.videos?.edges || [];
    let activeVodId = null;

    for (let i = 0; i < edges.length; i++) {
      const node = edges[i]?.node;
      if (!node || !node.id || !node.createdAt) continue;
      const vodMs = Date.parse(node.createdAt);
      if (Number.isNaN(vodMs) || Number.isNaN(streamStartMs)) continue;
      if (vodMs >= streamStartMs - 10 * 60 * 1000 && vodMs <= streamStartMs + 25 * 60 * 1000) {
        activeVodId = node.id;
        break;
      }
    }

    if (activeVodId) {
      try {
        const vodToken = await getPlaybackToken({
          isLive: false,
          vodId: activeVodId,
          oauthToken
        });
        const vodMasterUrl = buildUsherUrl({
          isLive: false,
          vodId: activeVodId,
          token: vodToken
        });
        const vodVariants = await fetchVariants(vodMasterUrl);
        const vodMedia = await fetchMediaPlaylist(vodVariants[0].url);
        if (vodMedia.segments.length > 0 && vodMedia.totalDuration > 0) {
          return {
            platform: 'twitch',
            mode: 'live_archive',
            streamer: user.login,
            displayName: user.displayName || user.login,
            title: user.stream.title || '',
            vodId: activeVodId,
            streamId: user.stream.id,
            startedAt: user.stream.createdAt,
            durationSec: vodMedia.totalDuration,
            masterUrl: vodMasterUrl,
            variants: vodVariants,
            initialMedia: vodMedia
          };
        }
      } catch (_) {
      }
    }

    const liveToken = await getPlaybackToken({
      isLive: true,
      login: user.login,
      oauthToken
    });
    const liveMasterUrl = buildUsherUrl({
      isLive: true,
      login: user.login,
      token: liveToken
    });
    const liveVariants = await fetchVariants(liveMasterUrl);

    return {
      platform: 'twitch',
      mode: 'live_buffer',
      streamer: user.login,
      displayName: user.displayName || user.login,
      title: user.stream.title || '',
      vodId: null,
      streamId: user.stream.id,
      startedAt: user.stream.createdAt,
      durationSec: 0,
      masterUrl: liveMasterUrl,
      variants: liveVariants
    };
  }

  root.StreamClipTwitch = {
    parseUrl,
    resolveVod,
    resolveLive,
    fetchVariants,
    fetchMediaPlaylist
  };
})(typeof self !== 'undefined' ? self : globalThis);
