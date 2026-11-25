(function () {
  if (globalThis.__streamClipContentLoaded) return;
  globalThis.__streamClipContentLoaded = true;

  let lastUrl = location.href;
  let heartbeatTimer = null;

  function getCookie(name) {
    const prefix = `${name}=`;
    const parts = document.cookie.split(';');
    for (let i = 0; i < parts.length; i++) {
      const item = parts[i].trim();
      if (item.startsWith(prefix)) {
        return decodeURIComponent(item.slice(prefix.length));
      }
    }
    return null;
  }

  function getPlayerState() {
    const videos = document.querySelectorAll('video');
    let best = null;
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      if (!best || (v.videoWidth > 0 && best.videoWidth === 0)) {
        best = v;
      }
    }
    if (!best) {
      return { currentTime: 0, duration: 0 };
    }
    return {
      currentTime: Number.isFinite(best.currentTime) ? best.currentTime : 0,
      duration: Number.isFinite(best.duration) ? best.duration : 0
    };
  }

  function getPageMeta() {
    const host = location.hostname.toLowerCase();
    return {
      url: location.href,
      twitchAuthToken: host.endsWith('twitch.tv') ? getCookie('auth-token') : null,
      player: getPlayerState()
    };
  }

  async function fetchJson(url) {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json'
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return res.json();
  }

  async function fetchKickPageData(context) {
    if (context.kind === 'vod') {
      let videoData = null;
      let channelVideos = null;
      try {
        videoData = await fetchJson(`/api/v1/video/${encodeURIComponent(context.vodId)}`);
      } catch (_) {
      }
      if ((!videoData || !videoData.source) && context.channel) {
        try {
          channelVideos = await fetchJson(
            `/api/v2/channels/${encodeURIComponent(context.channel)}/videos`
          );
        } catch (_) {
        }
      }
      return { videoData, channelVideos, channelData: null };
    }

    const channelSlug = encodeURIComponent(context.channel);
    const channelData = await fetchJson(`/api/v2/channels/${channelSlug}`);
    let channelVideos = null;
    if (channelData && channelData.livestream) {
      try {
        channelVideos = await fetchJson(`/api/v2/channels/${channelSlug}/videos`);
      } catch (_) {
      }
    }
    return { channelData, channelVideos, videoData: null };
  }

  function startHeartbeat() {
    if (heartbeatTimer !== null) return;
    heartbeatTimer = setInterval(() => {
      try {
        chrome.runtime.sendMessage({
          target: 'background',
          type: 'LIVE_BUFFER_TICK',
          url: location.href
        });
      } catch (_) {
        stopHeartbeat();
      }
    }, 5000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function notifyUrlChange() {
    const current = location.href;
    if (current === lastUrl) return;
    lastUrl = current;
    stopHeartbeat();
    try {
      chrome.runtime.sendMessage({
        target: 'background',
        type: 'PAGE_CONTEXT_CHANGED',
        meta: getPageMeta()
      });
    } catch (_) {
    }
  }

  window.addEventListener('popstate', notifyUrlChange);
  window.addEventListener('hashchange', notifyUrlChange);
  setInterval(notifyUrlChange, 1000);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'content') return false;

    if (msg.type === 'GET_PAGE_META') {
      sendResponse({ ok: true, meta: getPageMeta() });
      return false;
    }

    if (msg.type === 'FETCH_KICK_DATA') {
      fetchKickPageData(msg.context)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (msg.type === 'START_BUFFER_HEARTBEAT') {
      startHeartbeat();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'STOP_BUFFER_HEARTBEAT') {
      stopHeartbeat();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  try {
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'PAGE_CONTEXT_CHANGED',
      meta: getPageMeta()
    });
  } catch (_) {
  }
})();
