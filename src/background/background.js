if (typeof importScripts === 'function') {
  importScripts(
    '../core/m3u8-parser.js',
    '../core/clip-builder.js',
    '../platforms/twitch.js',
    '../platforms/kick.js'
  );
}

(function () {
  const BUFFER_WINDOW_SEC = 180;
  const SESSION_KEY = 'streamclip_tab_buffers_v1';

  const tabBuffers = new Map();
  const resolvedCache = new Map();
  const activeJobs = new Map();
  const firefoxControllers = new Map();
  const downloadJobMap = new Map();
  const blobUrlCleanupMap = new Map();
  let hydrated = false;

  async function hydrateBuffers() {
    if (hydrated) return;
    hydrated = true;
    try {
      if (chrome.storage && chrome.storage.session) {
        const stored = await chrome.storage.session.get(SESSION_KEY);
        const raw = stored && stored[SESSION_KEY];
        if (raw && typeof raw === 'object') {
          for (const [k, v] of Object.entries(raw)) {
            tabBuffers.set(Number(k), v);
          }
        }
      }
    } catch (_) {
    }
  }

  async function persistBuffers() {
    try {
      if (chrome.storage && chrome.storage.session) {
        const obj = {};
        for (const [k, v] of tabBuffers.entries()) {
          obj[String(k)] = v;
        }
        await chrome.storage.session.set({ [SESSION_KEY]: obj });
      }
    } catch (_) {
    }
  }

  function parseTabContext(url) {
    if (!url) return null;
    return StreamClipTwitch.parseUrl(url) || StreamClipKick.parseUrl(url);
  }

  function sendTabMessage(tabId, message) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, message, async (res) => {
          if (chrome.runtime.lastError) {
            if (chrome.scripting && message.type !== 'STOP_BUFFER_HEARTBEAT') {
              try {
                await chrome.scripting.executeScript({
                  target: { tabId },
                  files: ['src/content/content.js']
                });
                chrome.tabs.sendMessage(tabId, message, (retryRes) => {
                  if (chrome.runtime.lastError) {
                    resolve(null);
                    return;
                  }
                  resolve(retryRes || null);
                });
                return;
              } catch (_) {
              }
            }
            resolve(null);
            return;
          }
          resolve(res || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function broadcastJobUpdate(job) {
    try {
      chrome.runtime.sendMessage({
        target: 'popup',
        type: 'JOB_UPDATE',
        job
      });
    } catch (_) {
    }
  }

  function segmentCanonicalKey(seg) {
    let path = seg.url;
    try {
      path = new URL(seg.url).pathname;
    } catch (_) {
    }
    return `${seg.seq}:${path}`;
  }

  function sumBufferedDuration(list) {
    let total = 0;
    for (let i = 0; i < list.length; i++) {
      total += list[i].duration || 0;
    }
    return total;
  }

  function rebuildOffsets(list) {
    let cur = 0;
    const out = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const seg = list[i];
      const dur = seg.duration || 2;
      out[i] = {
        seq: seg.seq,
        url: seg.url,
        duration: dur,
        startSec: cur,
        endSec: cur + dur,
        discontinuity: i === 0 ? false : Boolean(seg.discontinuity),
        isAd: Boolean(seg.isAd),
        mapUrl: seg.mapUrl || null,
        key: seg.keyInfo || null
      };
      cur += dur;
    }
    return out;
  }

  async function refreshMasterForBuffer(buf, tabId) {
    const metaResp = await sendTabMessage(tabId, { target: 'content', type: 'GET_PAGE_META' });
    const context = parseTabContext(buf.url);
    if (!context) return false;
    const resolved = await resolveStream(tabId, context, metaResp?.meta || {});
    if (resolved.mode === 'live_buffer' && resolved.variants.length > 0) {
      buf.masterUrl = resolved.masterUrl;
      buf.variants = resolved.variants;
      buf.title = resolved.title || buf.title;
      return true;
    }
    return false;
  }

  async function pollLiveBuffer(tabId) {
    await hydrateBuffers();
    const buf = tabBuffers.get(tabId);
    if (!buf || !buf.variants || buf.variants.length === 0) return null;

    if (buf.polling) return buf;
    buf.polling = true;

    try {
      const fetcher =
        buf.platform === 'twitch'
          ? StreamClipTwitch.fetchMediaPlaylist
          : StreamClipKick.fetchMediaPlaylist;

      const variantsToPoll = buf.variants.slice(0, 8);
      let needsMasterRefresh = false;

      await Promise.all(
        variantsToPoll.map(async (variant) => {
          try {
            const media = await fetcher(variant.url);
            if (!buf.variantBuffers[variant.id]) {
              buf.variantBuffers[variant.id] = [];
            }
            const list = buf.variantBuffers[variant.id];
            const existingKeys = new Set(list.map((item) => item.key));

            for (let i = 0; i < media.segments.length; i++) {
              const seg = media.segments[i];
              const key = segmentCanonicalKey(seg);
              if (existingKeys.has(key)) continue;
              existingKeys.add(key);
              list.push({
                key,
                seq: seg.seq,
                url: seg.url,
                duration: seg.duration,
                isAd: seg.isAd,
                discontinuity: seg.discontinuity,
                mapUrl: seg.mapUrl || null,
                keyInfo: seg.key || null
              });
            }

            let total = sumBufferedDuration(list);
            while (list.length > 1 && total > BUFFER_WINDOW_SEC + 12) {
              const removed = list.shift();
              total -= removed.duration || 0;
            }
          } catch (_) {
            needsMasterRefresh = true;
          }
        })
      );

      if (needsMasterRefresh) {
        await refreshMasterForBuffer(buf, tabId).catch(() => {});
      }

      buf.updatedAtMs = Date.now();
      await persistBuffers();
      return buf;
    } finally {
      buf.polling = false;
    }
  }

  async function stopTabBuffer(tabId) {
    await hydrateBuffers();
    if (tabBuffers.has(tabId)) {
      tabBuffers.delete(tabId);
      await persistBuffers();
    }
    resolvedCache.delete(tabId);
    await sendTabMessage(tabId, { target: 'content', type: 'STOP_BUFFER_HEARTBEAT' });
  }

  async function resolveStream(tabId, context, pageMeta) {
    if (context.platform === 'twitch') {
      if (context.kind === 'vod') {
        return StreamClipTwitch.resolveVod(context.vodId, pageMeta?.twitchAuthToken || null);
      }
      return StreamClipTwitch.resolveLive(context.channel, pageMeta?.twitchAuthToken || null);
    }

    if (context.platform === 'kick') {
      const kickResp = await sendTabMessage(tabId, {
        target: 'content',
        type: 'FETCH_KICK_DATA',
        context
      });
      if (!kickResp || !kickResp.ok) {
        throw new Error(kickResp?.error || 'Could not reach Kick tab context');
      }
      return StreamClipKick.resolveFromPageData({
        context,
        channelData: kickResp.data.channelData,
        channelVideos: kickResp.data.channelVideos,
        videoData: kickResp.data.videoData
      });
    }

    throw new Error('Unsupported platform');
  }

  async function ensureLiveBufferStarted(tabId, url, resolved) {
    await hydrateBuffers();
    const existing = tabBuffers.get(tabId);
    const sameStream =
      existing &&
      existing.platform === resolved.platform &&
      existing.streamer === resolved.streamer &&
      existing.streamId === resolved.streamId;

    if (!sameStream) {
      const initial = {
        tabId,
        url,
        platform: resolved.platform,
        streamer: resolved.streamer,
        displayName: resolved.displayName,
        title: resolved.title,
        streamId: resolved.streamId || '',
        startedAt: resolved.startedAt || null,
        masterUrl: resolved.masterUrl,
        variants: resolved.variants,
        openedAtMs: Date.now(),
        updatedAtMs: Date.now(),
        variantBuffers: {},
        polling: false
      };
      tabBuffers.set(tabId, initial);
      await pollLiveBuffer(tabId);
    } else {
      existing.url = url;
      existing.title = resolved.title || existing.title;
      existing.variants = resolved.variants;
      existing.masterUrl = resolved.masterUrl;
      await pollLiveBuffer(tabId);
    }

    await sendTabMessage(tabId, { target: 'content', type: 'START_BUFFER_HEARTBEAT' });
    return tabBuffers.get(tabId);
  }

  async function handlePageContextChanged(tabId, meta) {
    if (!tabId || !meta || !meta.url) return;
    const context = parseTabContext(meta.url);
    if (!context) {
      await stopTabBuffer(tabId);
      return;
    }

    if (context.kind !== 'live') {
      await stopTabBuffer(tabId);
      return;
    }

    try {
      const resolved = await resolveStream(tabId, context, meta);
      resolvedCache.set(tabId, {
        url: meta.url,
        resolved,
        player: meta.player || { currentTime: 0, duration: 0 },
        twitchAuthToken: meta.twitchAuthToken || null,
        fetchedAtMs: Date.now()
      });

      if (resolved.mode === 'live_buffer') {
        await ensureLiveBufferStarted(tabId, meta.url, resolved);
      } else {
        await stopTabBuffer(tabId);
        resolvedCache.set(tabId, {
          url: meta.url,
          resolved,
          player: meta.player || { currentTime: 0, duration: 0 },
          twitchAuthToken: meta.twitchAuthToken || null,
          fetchedAtMs: Date.now()
        });
      }
    } catch (_) {
    }
  }

  function stripVariantUrls(variants) {
    return (variants || []).map((v) => ({
      id: v.id,
      label: v.label,
      width: v.width,
      height: v.height,
      fps: v.fps,
      bandwidth: v.bandwidth,
      isSource: Boolean(v.isSource)
    }));
  }

  function buildPopupPayload({ tabId, resolved, buf, variantId, media, seekHintSec, player }) {
    const variants = resolved.variants || [];
    const selected = variants.find((v) => v.id === variantId) || variants[0] || null;
    let durationSec = 0;

    if (resolved.mode === 'vod' || resolved.mode === 'live_archive') {
      durationSec = media ? media.totalDuration : resolved.durationSec || 0;
    } else if (resolved.mode === 'live_buffer' && buf && selected) {
      const list = buf.variantBuffers[selected.id] || [];
      durationSec = sumBufferedDuration(list);
    }

    return {
      tabId,
      platform: resolved.platform,
      mode: resolved.mode,
      streamer: resolved.streamer,
      displayName: resolved.displayName,
      title: resolved.title,
      vodId: resolved.vodId || null,
      startedAt: resolved.startedAt || null,
      durationSec,
      variants: stripVariantUrls(variants),
      selectedVariantId: selected ? selected.id : null,
      seekHintSec: seekHintSec || 0,
      playerCurrentTime: player?.currentTime || 0,
      filenamePreview: StreamClipBuilder.buildFilename({
        platform: resolved.platform,
        streamer: resolved.streamer
      }),
      maxClipSeconds: StreamClipBuilder.MAX_CLIP_SECONDS
    };
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0] ? tabs[0] : null;
  }

  async function handlePopupGetState() {
    await hydrateBuffers();
    const tab = await getActiveTab();
    if (!tab || !tab.id || !tab.url) {
      return { ok: true, state: { mode: 'unsupported' }, activeJob: getLatestActiveJob(tab?.id) };
    }

    const context = parseTabContext(tab.url);
    if (!context) {
      return { ok: true, state: { mode: 'unsupported' }, activeJob: getLatestActiveJob(tab.id) };
    }

    const metaResp = await sendTabMessage(tab.id, { target: 'content', type: 'GET_PAGE_META' });
    const meta = metaResp?.meta || { url: tab.url, twitchAuthToken: null, player: { currentTime: 0, duration: 0 } };

    const resolved = await resolveStream(tab.id, context, meta);
    resolvedCache.set(tab.id, {
      url: tab.url,
      resolved,
      player: meta.player || { currentTime: 0, duration: 0 },
      twitchAuthToken: meta.twitchAuthToken || null,
      fetchedAtMs: Date.now()
    });

    if (resolved.mode === 'offline') {
      await stopTabBuffer(tab.id);
      return {
        ok: true,
        state: {
          tabId: tab.id,
          platform: resolved.platform,
          mode: 'offline',
          streamer: resolved.streamer,
          displayName: resolved.displayName,
          title: ''
        },
        activeJob: getLatestActiveJob(tab.id)
      };
    }

    let buf = null;
    if (resolved.mode === 'live_buffer') {
      buf = await ensureLiveBufferStarted(tab.id, tab.url, resolved);
    }

    const state = buildPopupPayload({
      tabId: tab.id,
      resolved,
      buf,
      variantId: resolved.variants[0]?.id,
      media: resolved.initialMedia || null,
      seekHintSec: context.seekHintSec || meta.player?.currentTime || 0,
      player: meta.player
    });

    return { ok: true, state, activeJob: getLatestActiveJob(tab.id) };
  }

  async function handleFetchVariantTimeline({ tabId, variantId }) {
    await hydrateBuffers();
    const cached = resolvedCache.get(tabId);
    if (!cached || !cached.resolved) {
      throw new Error('Stream state expired, please refresh');
    }
    const resolved = cached.resolved;
    const variant = resolved.variants.find((v) => v.id === variantId) || resolved.variants[0];
    if (!variant) {
      throw new Error('Selected quality not found');
    }

    if (resolved.mode === 'live_buffer') {
      await pollLiveBuffer(tabId);
      const buf = tabBuffers.get(tabId);
      const list = buf?.variantBuffers[variant.id] || [];
      return {
        ok: true,
        durationSec: sumBufferedDuration(list),
        selectedVariantId: variant.id
      };
    }

    const fetcher =
      resolved.platform === 'twitch'
        ? StreamClipTwitch.fetchMediaPlaylist
        : StreamClipKick.fetchMediaPlaylist;
    const media = await fetcher(variant.url);
    resolved.initialMedia = media;
    return {
      ok: true,
      durationSec: media.totalDuration,
      selectedVariantId: variant.id
    };
  }

  async function ensureOffscreenDocument() {
    if (!chrome.offscreen) return false;
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });
      if (contexts.length > 0) return true;
    }
    try {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Transmux HLS TS segments to MP4 Blob and generate object URL for download.'
      });
    } catch (err) {
      if (!String(err?.message || '').includes('Only a single offscreen')) {
        throw err;
      }
    }
    return true;
  }

  function maybeCloseOffscreen() {
    if (!chrome.offscreen) return Promise.resolve();
    for (const job of activeJobs.values()) {
      if (
        job.status === 'downloading' ||
        job.status === 'muxing' ||
        job.status === 'saving'
      ) {
        return Promise.resolve();
      }
    }
    if (blobUrlCleanupMap.size > 0) return Promise.resolve();
    return chrome.offscreen.closeDocument().catch(() => {});
  }

  function getLatestActiveJob(tabId) {
    let latest = null;
    for (const job of activeJobs.values()) {
      if (tabId !== undefined && job.tabId !== tabId) continue;
      if (!latest || job.createdAt > latest.createdAt) {
        latest = job;
      }
    }
    return latest;
  }

  async function triggerBrowserDownload({ jobId, blobUrl, filename, isOffscreen, saveAs }) {
    const job = activeJobs.get(jobId);
    if (job) {
      job.status = 'saving';
      job.phase = 'saving';
      broadcastJobUpdate(job);
    }

    blobUrlCleanupMap.set(jobId, { blobUrl, isOffscreen });

    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url: blobUrl,
          filename,
          conflictAction: 'uniquify',
          saveAs: Boolean(saveAs)
        },
        (id) => {
          if (chrome.runtime.lastError || !id) {
            reject(new Error(chrome.runtime.lastError?.message || 'Browser download failed'));
            return;
          }
          resolve(id);
        }
      );
    });

    downloadJobMap.set(downloadId, jobId);

    setTimeout(() => {
      cleanupBlobUrl(jobId);
    }, 120000);
  }

  async function cleanupBlobUrl(jobId) {
    const entry = blobUrlCleanupMap.get(jobId);
    if (!entry) return;
    blobUrlCleanupMap.delete(jobId);
    if (entry.isOffscreen) {
      try {
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'OFFSCREEN_REVOKE_URL',
          jobId,
          blobUrl: entry.blobUrl
        });
      } catch (_) {
      }
      await maybeCloseOffscreen();
    } else {
      try {
        URL.revokeObjectURL(entry.blobUrl);
      } catch (_) {
      }
    }
  }

  async function startClipJob({ tabId, variantId, startSec, endSec, skipAds, maxClipSeconds, saveAs }) {
    await hydrateBuffers();
    const cached = resolvedCache.get(tabId);
    if (!cached || !cached.resolved) {
      throw new Error('Stream info missing, please reopen popup');
    }

    const resolved = cached.resolved;
    const variant = resolved.variants.find((v) => v.id === variantId) || resolved.variants[0];
    if (!variant) {
      throw new Error('No stream quality selected');
    }

    const limitSec = Number.isFinite(maxClipSeconds) && maxClipSeconds > 0
      ? maxClipSeconds
      : StreamClipBuilder.MAX_CLIP_SECONDS;
    const clipDur = endSec - startSec;
    if (!Number.isFinite(clipDur) || clipDur <= 0) {
      throw new Error('Invalid time range');
    }
    if (clipDur > limitSec + 0.5) {
      throw new Error(`Clip exceeds maximum length of ${Math.round(limitSec / 60)} minutes`);
    }

    let fullSegments = [];
    let allowLeadingExpire = false;

    if (resolved.mode === 'live_buffer') {
      await pollLiveBuffer(tabId);
      const buf = tabBuffers.get(tabId);
      const rawList = buf?.variantBuffers[variant.id] || [];
      fullSegments = rebuildOffsets(rawList);
      allowLeadingExpire = true;
    } else {
      const fetcher =
        resolved.platform === 'twitch'
          ? StreamClipTwitch.fetchMediaPlaylist
          : StreamClipKick.fetchMediaPlaylist;
      const media = await fetcher(variant.url);
      fullSegments = media.segments;
    }

    const effectiveSegments = skipAds === false
      ? fullSegments.map((s) => ({ ...s, isAd: false }))
      : fullSegments;
    const sliced = StreamClipM3U8.sliceSegments(effectiveSegments, startSec, endSec);
    if (!sliced.segments.length) {
      throw new Error('No video segments found in selected time range');
    }

    const filename = StreamClipBuilder.buildFilename({
      platform: resolved.platform,
      streamer: resolved.streamer
    });

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      jobId,
      tabId,
      status: 'downloading',
      phase: 'downloading',
      done: 0,
      total: sliced.segments.length,
      bytesDownloaded: 0,
      skippedAdCount: sliced.skippedAdCount,
      skippedAdSeconds: Math.round(sliced.skippedAdSeconds),
      filename,
      saveAs: Boolean(saveAs),
      durationSec: 0,
      sizeBytes: 0,
      error: null,
      createdAt: Date.now()
    };
    activeJobs.set(jobId, job);
    broadcastJobUpdate(job);

    if (chrome.offscreen) {
      await ensureOffscreenDocument();
      await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'OFFSCREEN_START_JOB',
        jobId,
        segments: sliced.segments,
        allowLeadingExpire,
        filename
      });
    } else {
      runFirefoxClipJob(job, sliced.segments, allowLeadingExpire);
    }

    return job;
  }

  async function runFirefoxClipJob(job, segments, allowLeadingExpire) {
    const controller = new AbortController();
    firefoxControllers.set(job.jobId, controller);
    let lastBroadcast = 0;

    try {
      const result = await StreamClipBuilder.downloadAndMux({
        segments,
        allowLeadingExpire,
        signal: controller.signal,
        onProgress(progress) {
          job.phase = progress.phase;
          job.status = progress.phase;
          job.done = progress.done;
          job.total = progress.total;
          job.bytesDownloaded = progress.bytesDownloaded;
          const now = Date.now();
          if (progress.phase === 'muxing' || progress.done === progress.total || now - lastBroadcast >= 120) {
            lastBroadcast = now;
            broadcastJobUpdate(job);
          }
        }
      });

      const blobUrl = URL.createObjectURL(result.blob);
      job.durationSec = result.durationSec;
      job.sizeBytes = result.sizeBytes;
      await triggerBrowserDownload({
        jobId: job.jobId,
        blobUrl,
        filename: job.filename,
        isOffscreen: false,
        saveAs: job.saveAs
      });

      job.status = 'completed';
      job.phase = 'completed';
      broadcastJobUpdate(job);
    } catch (err) {
      const aborted = Boolean(err && err.name === 'AbortError');
      job.status = aborted ? 'cancelled' : 'error';
      job.phase = job.status;
      job.error = aborted ? 'Cancelled' : err?.message || 'Failed';
      broadcastJobUpdate(job);
    } finally {
      firefoxControllers.delete(job.jobId);
    }
  }

  async function cancelClipJob(jobId) {
    const job = activeJobs.get(jobId);
    if (!job) return;
    if (chrome.offscreen) {
      try {
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'OFFSCREEN_CANCEL_JOB',
          jobId
        });
      } catch (_) {
      }
    } else {
      const ctrl = firefoxControllers.get(jobId);
      if (ctrl) ctrl.abort();
    }
  }

  chrome.downloads.onChanged.addListener((delta) => {
    const jobId = downloadJobMap.get(delta.id);
    if (!jobId) return;
    if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
      downloadJobMap.delete(delta.id);
      cleanupBlobUrl(jobId);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    stopTabBuffer(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url && !parseTabContext(changeInfo.url)) {
      stopTabBuffer(tabId);
    }
  });

  if (chrome.commands && chrome.commands.onCommand) {
    chrome.commands.onCommand.addListener(async (command) => {
      if (command !== 'clip-last-30' && command !== 'clip-last-60') return;
      try {
        const stored = await chrome.storage.local.get('streamclip_settings_v1');
        const settings = stored?.streamclip_settings_v1;
        if (!settings || !settings.hotkeysEnabled) return;

        await hydrateBuffers();
        const tab = await getActiveTab();
        if (!tab || !tab.id || !tab.url) return;
        const context = parseTabContext(tab.url);
        if (!context) return;

        const metaResp = await sendTabMessage(tab.id, { target: 'content', type: 'GET_PAGE_META' });
        const meta = metaResp?.meta || { url: tab.url, twitchAuthToken: null, player: { currentTime: 0, duration: 0 } };
        const resolved = await resolveStream(tab.id, context, meta);
        if (!resolved || resolved.mode === 'offline' || !resolved.variants?.length) return;

        resolvedCache.set(tab.id, {
          url: tab.url,
          resolved,
          player: meta.player || { currentTime: 0, duration: 0 },
          twitchAuthToken: meta.twitchAuthToken || null,
          fetchedAtMs: Date.now()
        });

        const pref = settings.defaultQuality || 'source';
        let variant = resolved.variants[0];
        if (pref !== 'source') {
          const targetH = parseInt(pref, 10);
          variant =
            resolved.variants.find((v) => v.height === targetH) ||
            resolved.variants.find((v) => v.height > 0 && v.height <= targetH) ||
            resolved.variants[0];
        }

        let durationSec = 0;
        if (resolved.mode === 'live_buffer') {
          const buf = await ensureLiveBufferStarted(tab.id, tab.url, resolved);
          durationSec = sumBufferedDuration(buf?.variantBuffers[variant.id] || []);
        } else if (variant.id === resolved.variants[0].id && resolved.initialMedia) {
          durationSec = resolved.initialMedia.totalDuration;
        } else {
          const fetcher =
            resolved.platform === 'twitch'
              ? StreamClipTwitch.fetchMediaPlaylist
              : StreamClipKick.fetchMediaPlaylist;
          const media = await fetcher(variant.url);
          durationSec = media.totalDuration;
        }

        if (durationSec < 1) return;
        const clipLen = command === 'clip-last-60' ? 60 : 30;
        const endSec = Math.floor(durationSec);
        const startSec = Math.max(0, endSec - clipLen);

        await startClipJob({
          tabId: tab.id,
          variantId: variant.id,
          startSec,
          endSec,
          skipAds: settings.skipAds !== false,
          maxClipSeconds: settings.maxClipSeconds || 600,
          saveAs: Boolean(settings.saveAs)
        });
      } catch (_) {
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target !== 'background') return false;

    if (msg.type === 'PAGE_CONTEXT_CHANGED') {
      const tabId = sender?.tab?.id;
      if (tabId) {
        handlePageContextChanged(tabId, msg.meta);
      }
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'LIVE_BUFFER_TICK') {
      const tabId = sender?.tab?.id;
      if (tabId) {
        pollLiveBuffer(tabId);
      }
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'POPUP_GET_STATE') {
      handlePopupGetState()
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (msg.type === 'POPUP_FETCH_VARIANT_TIMELINE') {
      handleFetchVariantTimeline(msg)
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (msg.type === 'POPUP_START_DOWNLOAD') {
      startClipJob(msg)
        .then((job) => sendResponse({ ok: true, job }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (msg.type === 'POPUP_CANCEL_DOWNLOAD') {
      cancelClipJob(msg.jobId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (msg.type === 'OFFSCREEN_JOB_PROGRESS') {
      const job = activeJobs.get(msg.jobId);
      if (job) {
        job.phase = msg.progress.phase;
        job.status = msg.progress.phase;
        job.done = msg.progress.done;
        job.total = msg.progress.total;
        job.bytesDownloaded = msg.progress.bytesDownloaded;
        broadcastJobUpdate(job);
      }
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'OFFSCREEN_JOB_COMPLETE') {
      const job = activeJobs.get(msg.jobId);
      if (job) {
        job.durationSec = msg.durationSec;
        job.sizeBytes = msg.sizeBytes;
        if (msg.filename) job.filename = msg.filename;
        triggerBrowserDownload({
          jobId: msg.jobId,
          blobUrl: msg.blobUrl,
          filename: job.filename,
          isOffscreen: true,
          saveAs: job.saveAs
        })
          .then(() => {
            job.status = 'completed';
            job.phase = 'completed';
            broadcastJobUpdate(job);
          })
          .catch((err) => {
            job.status = 'error';
            job.phase = 'error';
            job.error = err.message;
            broadcastJobUpdate(job);
            cleanupBlobUrl(msg.jobId);
          });
      }
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'OFFSCREEN_JOB_ERROR') {
      const job = activeJobs.get(msg.jobId);
      if (job) {
        job.status = msg.aborted ? 'cancelled' : 'error';
        job.phase = job.status;
        job.error = msg.aborted ? 'Cancelled' : msg.error;
        broadcastJobUpdate(job);
      }
      maybeCloseOffscreen();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
})();
