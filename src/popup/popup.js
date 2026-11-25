(function () {
  const I18N = {
    ru: {
      loading: 'Определение потока и плейлиста…',
      unsupportedTitle: 'Откройте стрим или запись',
      unsupportedDesc: 'Перейдите на страницу трансляции или VOD на Twitch или Kick.',
      offlineTitle: 'Стрим сейчас оффлайн',
      offlineDesc: 'Канал не в сети. Откройте запись (VOD) или дождитесь начала эфира.',
      errorTitle: 'Не удалось получить поток',
      retry: 'Обновить',
      badgeVod: 'VOD • Запись',
      badgeLiveArchive: 'LIVE • Весь стрим',
      badgeLiveBuffer: 'LIVE • Буфер 2–3м',
      badgeOffline: 'Оффлайн',
      badgeIdle: 'Ожидание',
      timelineFull: 'Доступна вся шкала',
      timelineBuffer: 'Буфер в памяти',
      timelineEmpty: 'Накопление первых сегментов… подождите пару секунд',
      qualityLabel: 'Качество видео',
      qualityHint: 'независимо от плеера',
      rangeLabel: 'Отрезок времени',
      startLabel: 'Начало',
      endLabel: 'Конец',
      last30: 'Последние 30 сек',
      last60: 'Последняя 1 мин',
      atPlayer: 'К плееру',
      fileLabel: 'Имя файла',
      downloadBtn: 'Скачать клип MP4',
      cancelBtn: 'Отмена',
      durationFmt: '{dur} / макс. {max}м',
      limitHit: ' • лимит',
      phaseDownloading: 'Загрузка сегментов…',
      phaseMuxing: 'Сборка MP4 в памяти…',
      phaseSaving: 'Сохранение файла…',
      phaseCompleted: 'Готово! Скачивание запущено',
      phaseCancelled: 'Загрузка отменена',
      phaseError: 'Ошибка сборки',
      adsSkipped: 'Пропущено рекламы: {count} сегм. ({sec}с)',
      segmentsProgress: '{done} / {total} сегм. • {mb} МБ',
      settingsTitle: 'Настройки',
      settingsBack: 'Назад',
      defaultQualityLabel: 'Качество по умолчанию',
      defaultSource: 'Максимальное (Source)',
      maxClipLabel: 'Лимит длины клипа',
      min5: '5 мин',
      min10: '10 мин',
      skipAdsLabel: 'Автопропуск рекламы Twitch',
      saveAsLabel: 'Спрашивать папку при сохранении',
      hotkeysLabel: 'Горячие клавиши клипа',
      hotkeysHint: 'Alt+Shift+S — последние 30с • Alt+Shift+D — 1 мин'
    },
    en: {
      loading: 'Detecting stream and playlist…',
      unsupportedTitle: 'Open a stream or VOD',
      unsupportedDesc: 'Navigate to a live channel or past broadcast on Twitch or Kick.',
      offlineTitle: 'Channel is offline',
      offlineDesc: 'This channel is not live right now. Open a VOD or wait for the stream to start.',
      errorTitle: 'Could not load stream',
      retry: 'Refresh',
      badgeVod: 'VOD',
      badgeLiveArchive: 'LIVE • Full Stream',
      badgeLiveBuffer: 'LIVE • 2–3m Buffer',
      badgeOffline: 'Offline',
      badgeIdle: 'Idle',
      timelineFull: 'Full timeline available',
      timelineBuffer: 'Memory ring buffer',
      timelineEmpty: 'Buffering initial segments… wait a moment',
      qualityLabel: 'Video Quality',
      qualityHint: 'independent of player',
      rangeLabel: 'Time Range',
      startLabel: 'Start',
      endLabel: 'End',
      last30: 'Last 30s',
      last60: 'Last 1 min',
      atPlayer: 'At Player',
      fileLabel: 'Output Filename',
      downloadBtn: 'Download MP4 Clip',
      cancelBtn: 'Cancel',
      durationFmt: '{dur} / max {max}m',
      limitHit: ' • cap',
      phaseDownloading: 'Downloading segments…',
      phaseMuxing: 'Remuxing to MP4 in memory…',
      phaseSaving: 'Saving MP4 file…',
      phaseCompleted: 'Done! File download started',
      phaseCancelled: 'Download cancelled',
      phaseError: 'Build failed',
      adsSkipped: 'Skipped ads: {count} seg ({sec}s)',
      segmentsProgress: '{done} / {total} seg • {mb} MB',
      settingsTitle: 'Settings',
      settingsBack: 'Back',
      defaultQualityLabel: 'Default Quality',
      defaultSource: 'Highest (Source)',
      maxClipLabel: 'Max Clip Length',
      min5: '5 min',
      min10: '10 min',
      skipAdsLabel: 'Auto-skip Twitch Ads',
      saveAsLabel: 'Ask where to save each file',
      hotkeysLabel: 'Enable quick clip hotkeys',
      hotkeysHint: 'Alt+Shift+S — last 30s • Alt+Shift+D — last 1 min'
    }
  };

  const SETTINGS_KEY = 'streamclip_settings_v1';
  const DEFAULT_SETTINGS = {
    defaultQuality: 'source',
    maxClipSeconds: 600,
    skipAds: true,
    saveAs: false,
    hotkeysEnabled: false
  };

  const els = {
    modeBadge: document.getElementById('modeBadge'),
    langToggle: document.getElementById('langToggle'),
    settingsBtn: document.getElementById('settingsBtn'),
    loadingView: document.getElementById('loadingView'),
    loadingText: document.getElementById('loadingText'),
    emptyView: document.getElementById('emptyView'),
    emptyTitle: document.getElementById('emptyTitle'),
    emptyDesc: document.getElementById('emptyDesc'),
    retryBtn: document.getElementById('retryBtn'),
    mainView: document.getElementById('mainView'),
    settingsView: document.getElementById('settingsView'),
    platformPill: document.getElementById('platformPill'),
    streamerName: document.getElementById('streamerName'),
    streamTitle: document.getElementById('streamTitle'),
    timelineInfo: document.getElementById('timelineInfo'),
    qualityLabel: document.getElementById('qualityLabel'),
    qualityHint: document.getElementById('qualityHint'),
    qualitySelect: document.getElementById('qualitySelect'),
    rangeLabel: document.getElementById('rangeLabel'),
    durationBadge: document.getElementById('durationBadge'),
    rangeSlider: document.getElementById('rangeSlider'),
    sliderFill: document.getElementById('sliderFill'),
    thumbStart: document.getElementById('thumbStart'),
    thumbEnd: document.getElementById('thumbEnd'),
    tipStart: document.getElementById('tipStart'),
    tipEnd: document.getElementById('tipEnd'),
    scaleMax: document.getElementById('scaleMax'),
    startLabel: document.getElementById('startLabel'),
    endLabel: document.getElementById('endLabel'),
    startInput: document.getElementById('startInput'),
    endInput: document.getElementById('endInput'),
    btnLast30: document.getElementById('btnLast30'),
    btnLast60: document.getElementById('btnLast60'),
    btnAtPlayer: document.getElementById('btnAtPlayer'),
    fileLabel: document.getElementById('fileLabel'),
    filenamePreview: document.getElementById('filenamePreview'),
    progressBox: document.getElementById('progressBox'),
    progressStatus: document.getElementById('progressStatus'),
    progressPct: document.getElementById('progressPct'),
    progressFill: document.getElementById('progressFill'),
    progressMeta: document.getElementById('progressMeta'),
    errorBox: document.getElementById('errorBox'),
    downloadBtn: document.getElementById('downloadBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    settingsTitle: document.getElementById('settingsTitle'),
    settingsBackBtn: document.getElementById('settingsBackBtn'),
    defaultQualityLabel: document.getElementById('defaultQualityLabel'),
    defaultQualitySelect: document.getElementById('defaultQualitySelect'),
    maxClipLabel: document.getElementById('maxClipLabel'),
    maxClipSelect: document.getElementById('maxClipSelect'),
    skipAdsLabel: document.getElementById('skipAdsLabel'),
    skipAdsToggle: document.getElementById('skipAdsToggle'),
    saveAsLabel: document.getElementById('saveAsLabel'),
    saveAsToggle: document.getElementById('saveAsToggle'),
    hotkeysLabel: document.getElementById('hotkeysLabel'),
    hotkeysToggle: document.getElementById('hotkeysToggle'),
    hotkeysHint: document.getElementById('hotkeysHint')
  };

  let lang = 'en';
  let settings = { ...DEFAULT_SETTINGS };
  let streamState = null;
  let activeJobId = null;
  let maxSec = 0;
  let startSec = 0;
  let endSec = 30;
  let dragState = null;
  let settingsOpen = false;
  let lastView = 'loading';
  let liveRefreshTimer = null;

  function t(key, vars) {
    let text = I18N[lang]?.[key] || I18N.en[key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  }

  async function saveSettings() {
    try {
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    } catch (_) {
    }
  }

  function applySettingsToControls() {
    els.defaultQualitySelect.value = settings.defaultQuality;
    els.maxClipSelect.value = String(settings.maxClipSeconds);
    els.skipAdsToggle.checked = Boolean(settings.skipAds);
    els.saveAsToggle.checked = Boolean(settings.saveAs);
    els.hotkeysToggle.checked = Boolean(settings.hotkeysEnabled);
    els.hotkeysHint.classList.toggle('hidden', !settings.hotkeysEnabled);
  }

  function formatHms(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    return [h, m, rem].map((n) => String(n).padStart(2, '0')).join(':');
  }

  function formatShortDur(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }

  function parseHmsInput(value) {
    const clean = String(value || '').trim();
    if (!clean) return null;
    const parts = clean.split(':').map((p) => p.trim());
    if (parts.some((p) => !/^\d+$/.test(p))) return null;
    if (parts.length === 1) return parseInt(parts[0], 10);
    if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    if (parts.length === 3) {
      return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
    }
    return null;
  }

  function applyStaticLabels() {
    els.langToggle.textContent = lang === 'ru' ? 'EN' : 'RU';
    els.loadingText.textContent = t('loading');
    els.retryBtn.textContent = t('retry');
    els.qualityLabel.textContent = t('qualityLabel');
    els.qualityHint.textContent = t('qualityHint');
    els.rangeLabel.textContent = t('rangeLabel');
    els.startLabel.textContent = t('startLabel');
    els.endLabel.textContent = t('endLabel');
    els.btnLast30.textContent = t('last30');
    els.btnLast60.textContent = t('last60');
    els.btnAtPlayer.textContent = t('atPlayer');
    els.fileLabel.textContent = t('fileLabel');
    els.downloadBtn.textContent = t('downloadBtn');
    els.cancelBtn.textContent = t('cancelBtn');
    els.settingsTitle.textContent = t('settingsTitle');
    els.settingsBackBtn.textContent = t('settingsBack');
    els.defaultQualityLabel.textContent = t('defaultQualityLabel');
    els.defaultQualitySelect.options[0].textContent = t('defaultSource');
    els.maxClipLabel.textContent = t('maxClipLabel');
    els.maxClipSelect.options[0].textContent = t('min5');
    els.maxClipSelect.options[1].textContent = t('min10');
    els.skipAdsLabel.textContent = t('skipAdsLabel');
    els.saveAsLabel.textContent = t('saveAsLabel');
    els.hotkeysLabel.textContent = t('hotkeysLabel');
    els.hotkeysHint.textContent = t('hotkeysHint');
    if (streamState) renderStreamState();
  }

  function syncRangeUi() {
    const safeMax = Math.max(1, Math.floor(maxSec));
    const maxClipSeconds = settings.maxClipSeconds || 600;
    startSec = Math.max(0, Math.min(startSec, Math.max(0, safeMax - 1)));
    endSec = Math.max(startSec + 1, Math.min(endSec, safeMax));

    let hitLimit = false;
    if (endSec - startSec > maxClipSeconds) {
      endSec = startSec + maxClipSeconds;
      hitLimit = true;
    }

    const startHms = formatHms(startSec);
    const endHms = formatHms(endSec);
    els.startInput.value = startHms;
    els.endInput.value = endHms;
    els.tipStart.textContent = startHms;
    els.tipEnd.textContent = endHms;
    els.scaleMax.textContent = formatHms(maxSec);

    const leftPct = (startSec / safeMax) * 100;
    const rightPct = (endSec / safeMax) * 100;
    els.thumbStart.style.left = `${leftPct}%`;
    els.thumbEnd.style.left = `${rightPct}%`;
    els.sliderFill.style.left = `${leftPct}%`;
    els.sliderFill.style.width = `${Math.max(1, rightPct - leftPct)}%`;

    const dur = Math.max(0, endSec - startSec);
    const maxMin = Math.round(maxClipSeconds / 60);
    els.durationBadge.textContent =
      t('durationFmt', { dur: formatShortDur(dur), max: maxMin }) +
      (hitLimit ? t('limitHit') : '');

    els.downloadBtn.disabled = maxSec < 1 || dur <= 0 || Boolean(activeJobId);
  }

  function secFromClientX(clientX) {
    const rect = els.rangeSlider.getBoundingClientRect();
    if (!rect.width) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * Math.max(1, Math.floor(maxSec)));
  }

  function setError(msg) {
    if (!msg) {
      els.errorBox.classList.add('hidden');
      els.errorBox.textContent = '';
      return;
    }
    els.errorBox.textContent = msg;
    els.errorBox.classList.remove('hidden');
  }

  function showView(viewName) {
    if (viewName !== 'settings') {
      lastView = viewName;
    }
    els.loadingView.classList.toggle('hidden', viewName !== 'loading');
    els.emptyView.classList.toggle('hidden', viewName !== 'empty');
    els.mainView.classList.toggle('hidden', viewName !== 'main');
    els.settingsView.classList.toggle('hidden', viewName !== 'settings');
    els.settingsBtn.classList.toggle('active', viewName === 'settings');
  }

  function renderModeBadge(mode) {
    els.modeBadge.className = 'badge';
    if (mode === 'vod') {
      els.modeBadge.classList.add('badge-vod');
      els.modeBadge.textContent = t('badgeVod');
    } else if (mode === 'live_archive') {
      els.modeBadge.classList.add('badge-archive');
      els.modeBadge.textContent = t('badgeLiveArchive');
    } else if (mode === 'live_buffer') {
      els.modeBadge.classList.add('badge-live');
      els.modeBadge.textContent = t('badgeLiveBuffer');
    } else if (mode === 'offline') {
      els.modeBadge.textContent = t('badgeOffline');
    } else {
      els.modeBadge.textContent = t('badgeIdle');
    }
  }

  function applyPlatformTheme(platform) {
    document.body.dataset.platform = platform === 'kick' ? 'kick' : 'twitch';
  }

  function renderStreamState() {
    if (!streamState) return;
    applyPlatformTheme(streamState.platform);
    renderModeBadge(streamState.mode);

    if (streamState.mode === 'unsupported') {
      els.emptyTitle.textContent = t('unsupportedTitle');
      els.emptyDesc.textContent = t('unsupportedDesc');
      els.retryBtn.classList.add('hidden');
      if (!settingsOpen) showView('empty');
      return;
    }

    if (streamState.mode === 'offline') {
      els.emptyTitle.textContent = `${streamState.displayName || streamState.streamer} — ${t('offlineTitle')}`;
      els.emptyDesc.textContent = t('offlineDesc');
      els.retryBtn.classList.remove('hidden');
      if (!settingsOpen) showView('empty');
      return;
    }

    if (!settingsOpen) showView('main');
    els.platformPill.textContent = streamState.platform;
    els.streamerName.textContent = streamState.displayName || streamState.streamer;
    els.streamTitle.textContent = streamState.title || '';

    const timelineLabel =
      streamState.mode === 'live_buffer' ? t('timelineBuffer') : t('timelineFull');
    if (maxSec < 1) {
      els.timelineInfo.textContent = t('timelineEmpty');
    } else {
      els.timelineInfo.textContent = `${timelineLabel}: 00:00:00 — ${formatHms(maxSec)}`;
    }

    els.filenamePreview.textContent = streamState.filenamePreview || '';
    const hasPlayerHint =
      (streamState.mode === 'vod' || streamState.mode === 'live_archive') &&
      streamState.playerCurrentTime > 2;
    els.btnAtPlayer.classList.toggle('hidden', !hasPlayerHint);

    syncRangeUi();
  }

  function pickPreferredVariant(variants) {
    if (!variants || variants.length === 0) return null;
    const pref = settings.defaultQuality || 'source';
    if (pref === 'source') return variants[0].id;
    const targetH = parseInt(pref, 10);
    const match = variants.find((v) => v.height === targetH);
    if (match) return match.id;
    const closest = variants.find((v) => v.height > 0 && v.height <= targetH);
    return (closest || variants[0]).id;
  }

  function applyDefaultSelection(state) {
    maxSec = Math.max(0, Math.floor(state.durationSec || 0));
    if (maxSec <= 0) {
      startSec = 0;
      endSec = 0;
      return;
    }
    const hint = state.seekHintSec || state.playerCurrentTime || 0;
    if (state.mode === 'vod' && hint > 5 && hint <= maxSec) {
      endSec = Math.min(maxSec, Math.floor(hint));
      startSec = Math.max(0, endSec - 60);
    } else {
      endSec = maxSec;
      startSec = Math.max(0, maxSec - 60);
    }
  }

  function renderJobUpdate(job) {
    if (!job) return;
    const isRunning =
      job.status === 'downloading' ||
      job.status === 'muxing' ||
      job.status === 'saving';
    activeJobId = isRunning ? job.jobId : null;

    els.progressBox.classList.remove('hidden');
    els.cancelBtn.classList.toggle('hidden', !isRunning);
    els.downloadBtn.disabled = isRunning || maxSec < 1;

    const total = Math.max(1, job.total || 1);
    const done = Math.min(total, job.done || 0);
    let pct = Math.round((done / total) * 85);
    if (job.phase === 'muxing') pct = 92;
    if (job.phase === 'saving') pct = 97;
    if (job.phase === 'completed') pct = 100;

    els.progressFill.style.width = `${pct}%`;
    els.progressPct.textContent = `${pct}%`;

    if (job.phase === 'downloading') {
      els.progressStatus.textContent = t('phaseDownloading');
    } else if (job.phase === 'muxing') {
      els.progressStatus.textContent = t('phaseMuxing');
    } else if (job.phase === 'saving') {
      els.progressStatus.textContent = t('phaseSaving');
    } else if (job.phase === 'completed') {
      els.progressStatus.textContent = t('phaseCompleted');
    } else if (job.phase === 'cancelled') {
      els.progressStatus.textContent = t('phaseCancelled');
    } else if (job.phase === 'error') {
      els.progressStatus.textContent = t('phaseError');
    }

    const mb = ((job.bytesDownloaded || 0) / (1024 * 1024)).toFixed(1);
    let meta = t('segmentsProgress', { done, total, mb });
    if (job.skippedAdCount > 0) {
      meta += ` • ${t('adsSkipped', { count: job.skippedAdCount, sec: job.skippedAdSeconds || 0 })}`;
    }
    els.progressMeta.textContent = meta;

    if (job.status === 'error' && job.error) {
      setError(job.error);
    } else if (job.status !== 'error') {
      setError(null);
    }
  }

  function populateQualities(variants, selectedId) {
    els.qualitySelect.innerHTML = '';
    for (let i = 0; i < (variants || []).length; i++) {
      const v = variants[i];
      const opt = document.createElement('option');
      opt.value = v.id;
      const mbps = v.bandwidth ? ` • ${(v.bandwidth / 1000000).toFixed(1)} Mbps` : '';
      opt.textContent = `${v.label}${mbps}`;
      if (v.id === selectedId) opt.selected = true;
      els.qualitySelect.appendChild(opt);
    }
  }

  function sendBackground(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ target: 'background', ...payload }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(res);
      });
    });
  }

  function startLiveTimelineRefresh() {
    if (liveRefreshTimer) {
      clearInterval(liveRefreshTimer);
      liveRefreshTimer = null;
    }
    if (!streamState || (streamState.mode !== 'live_buffer' && streamState.mode !== 'live_archive')) {
      return;
    }
    liveRefreshTimer = setInterval(async () => {
      if (!streamState || dragState) return;
      try {
        const res = await sendBackground({
          type: 'POPUP_FETCH_VARIANT_TIMELINE',
          tabId: streamState.tabId,
          variantId: els.qualitySelect.value
        });
        if (res && res.ok) {
          const prevMax = maxSec;
          const nextMax = Math.max(0, Math.floor(res.durationSec || 0));
          if (nextMax !== prevMax) {
            const wasAtEnd = endSec >= prevMax - 2;
            maxSec = nextMax;
            if (prevMax === 0 && nextMax > 0) {
              endSec = nextMax;
              startSec = Math.max(0, nextMax - 60);
            } else if (wasAtEnd) {
              const span = Math.max(1, endSec - startSec);
              endSec = nextMax;
              startSec = Math.max(0, nextMax - span);
            }
            renderStreamState();
          }
        }
      } catch (_) {
      }
    }, 3000);
  }

  async function init() {
    showView('loading');
    setError(null);

    try {
      const stored = await chrome.storage.local.get(['streamclip_lang', SETTINGS_KEY]);
      if (stored?.streamclip_lang) {
        lang = stored.streamclip_lang;
      } else {
        const uiLang = (chrome.i18n?.getUILanguage?.() || navigator.language || 'en').toLowerCase();
        lang = uiLang.startsWith('ru') ? 'ru' : 'en';
      }
      if (stored?.[SETTINGS_KEY]) {
        settings = { ...DEFAULT_SETTINGS, ...stored[SETTINGS_KEY] };
      }
    } catch (_) {
    }
    applySettingsToControls();
    applyStaticLabels();

    try {
      const res = await sendBackground({ type: 'POPUP_GET_STATE' });
      if (!res || !res.ok) {
        throw new Error(res?.error || 'Failed to read stream state');
      }
      streamState = res.state;
      if (streamState.variants && streamState.variants.length > 0) {
        const preferredId = pickPreferredVariant(streamState.variants);
        streamState.selectedVariantId = preferredId;
        populateQualities(streamState.variants, preferredId);
        if (preferredId && preferredId !== streamState.variants[0].id) {
          const vRes = await sendBackground({
            type: 'POPUP_FETCH_VARIANT_TIMELINE',
            tabId: streamState.tabId,
            variantId: preferredId
          });
          if (vRes?.ok) {
            streamState.durationSec = vRes.durationSec;
          }
        }
      }
      applyDefaultSelection(streamState);
      renderStreamState();
      startLiveTimelineRefresh();
      if (res.activeJob && res.activeJob.tabId === streamState.tabId) {
        renderJobUpdate(res.activeJob);
      }
    } catch (err) {
      renderModeBadge('idle');
      els.emptyTitle.textContent = t('errorTitle');
      els.emptyDesc.textContent = err.message;
      els.retryBtn.classList.remove('hidden');
      showView('empty');
    }
  }

  els.rangeSlider.addEventListener('pointerdown', (e) => {
    if (maxSec < 1) return;
    e.preventDefault();
    const roleEl = e.target.closest('[data-role]');
    let mode = roleEl ? roleEl.dataset.role : null;
    const clickSec = secFromClientX(e.clientX);

    if (!mode) {
      mode = Math.abs(clickSec - startSec) <= Math.abs(clickSec - endSec) ? 'start' : 'end';
    }

    dragState = {
      mode,
      pointerId: e.pointerId,
      originSec: clickSec,
      initStart: startSec,
      initEnd: endSec
    };

    try {
      els.rangeSlider.setPointerCapture(e.pointerId);
    } catch (_) {
    }
    els.thumbStart.classList.toggle('dragging', mode === 'start');
    els.thumbEnd.classList.toggle('dragging', mode === 'end');
    els.sliderFill.classList.toggle('dragging', mode === 'window');

    if (mode === 'start') {
      startSec = Math.min(clickSec, Math.max(0, endSec - 1));
      if (endSec - startSec > settings.maxClipSeconds) endSec = startSec + settings.maxClipSeconds;
      syncRangeUi();
    } else if (mode === 'end') {
      endSec = Math.max(clickSec, Math.min(maxSec, startSec + 1));
      if (endSec - startSec > settings.maxClipSeconds) startSec = Math.max(0, endSec - settings.maxClipSeconds);
      syncRangeUi();
    }
  });

  function onPointerMove(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const curSec = secFromClientX(e.clientX);
    const maxClipSeconds = settings.maxClipSeconds || 600;

    if (dragState.mode === 'start') {
      startSec = Math.max(0, Math.min(curSec, Math.max(0, endSec - 1)));
      if (endSec - startSec > maxClipSeconds) {
        endSec = Math.min(maxSec, startSec + maxClipSeconds);
      }
    } else if (dragState.mode === 'end') {
      endSec = Math.max(1, Math.min(maxSec, Math.max(curSec, startSec + 1)));
      if (endSec - startSec > maxClipSeconds) {
        startSec = Math.max(0, endSec - maxClipSeconds);
      }
    } else if (dragState.mode === 'window') {
      const span = dragState.initEnd - dragState.initStart;
      const delta = curSec - dragState.originSec;
      let nextStart = dragState.initStart + delta;
      nextStart = Math.max(0, Math.min(nextStart, Math.max(0, maxSec - span)));
      startSec = nextStart;
      endSec = Math.min(maxSec, nextStart + span);
    }

    syncRangeUi();
  }

  function endDrag(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    try {
      els.rangeSlider.releasePointerCapture(e.pointerId);
    } catch (_) {
    }
    dragState = null;
    els.thumbStart.classList.remove('dragging');
    els.thumbEnd.classList.remove('dragging');
    els.sliderFill.classList.remove('dragging');
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  els.langToggle.addEventListener('click', async () => {
    lang = lang === 'ru' ? 'en' : 'ru';
    applyStaticLabels();
    try {
      await chrome.storage.local.set({ streamclip_lang: lang });
    } catch (_) {
    }
  });

  els.settingsBtn.addEventListener('click', () => {
    settingsOpen = !settingsOpen;
    if (settingsOpen) {
      showView('settings');
    } else {
      showView(lastView);
    }
  });

  els.settingsBackBtn.addEventListener('click', () => {
    settingsOpen = false;
    showView(lastView);
  });

  els.defaultQualitySelect.addEventListener('change', async () => {
    settings.defaultQuality = els.defaultQualitySelect.value;
    await saveSettings();
  });

  els.maxClipSelect.addEventListener('change', async () => {
    settings.maxClipSeconds = parseInt(els.maxClipSelect.value, 10) || 600;
    await saveSettings();
    syncRangeUi();
  });

  els.skipAdsToggle.addEventListener('change', async () => {
    settings.skipAds = Boolean(els.skipAdsToggle.checked);
    await saveSettings();
  });

  els.saveAsToggle.addEventListener('change', async () => {
    settings.saveAs = Boolean(els.saveAsToggle.checked);
    await saveSettings();
  });

  els.hotkeysToggle.addEventListener('change', async () => {
    settings.hotkeysEnabled = Boolean(els.hotkeysToggle.checked);
    els.hotkeysHint.classList.toggle('hidden', !settings.hotkeysEnabled);
    await saveSettings();
  });

  els.retryBtn.addEventListener('click', init);

  els.qualitySelect.addEventListener('change', async () => {
    if (!streamState) return;
    setError(null);
    try {
      const res = await sendBackground({
        type: 'POPUP_FETCH_VARIANT_TIMELINE',
        tabId: streamState.tabId,
        variantId: els.qualitySelect.value
      });
      if (res && res.ok) {
        streamState.selectedVariantId = res.selectedVariantId;
        maxSec = Math.max(0, Math.floor(res.durationSec || 0));
        renderStreamState();
      }
    } catch (err) {
      setError(err.message);
    }
  });

  function commitTimeInputs(editedStart) {
    const parsedStart = parseHmsInput(els.startInput.value);
    const parsedEnd = parseHmsInput(els.endInput.value);
    const maxClipSeconds = settings.maxClipSeconds || 600;
    if (parsedStart !== null) {
      startSec = Math.max(0, Math.min(parsedStart, Math.max(0, maxSec - 1)));
    }
    if (parsedEnd !== null) {
      endSec = Math.max(1, Math.min(parsedEnd, maxSec));
    }
    if (startSec >= endSec) {
      if (editedStart) {
        endSec = Math.min(maxSec, startSec + 30);
      } else {
        startSec = Math.max(0, endSec - 30);
      }
    }
    if (endSec - startSec > maxClipSeconds) {
      if (editedStart) {
        endSec = Math.min(maxSec, startSec + maxClipSeconds);
      } else {
        startSec = Math.max(0, endSec - maxClipSeconds);
      }
    }
    syncRangeUi();
  }

  els.startInput.addEventListener('change', () => commitTimeInputs(true));
  els.endInput.addEventListener('change', () => commitTimeInputs(false));

  els.btnLast30.addEventListener('click', () => {
    endSec = maxSec;
    startSec = Math.max(0, maxSec - 30);
    syncRangeUi();
  });

  els.btnLast60.addEventListener('click', () => {
    endSec = maxSec;
    startSec = Math.max(0, maxSec - 60);
    syncRangeUi();
  });

  els.btnAtPlayer.addEventListener('click', () => {
    if (!streamState) return;
    const tCur = Math.max(1, Math.min(maxSec, Math.floor(streamState.playerCurrentTime || 0)));
    endSec = tCur;
    startSec = Math.max(0, tCur - 30);
    syncRangeUi();
  });

  els.downloadBtn.addEventListener('click', async () => {
    if (!streamState || activeJobId) return;
    setError(null);
    try {
      const res = await sendBackground({
        type: 'POPUP_START_DOWNLOAD',
        tabId: streamState.tabId,
        variantId: els.qualitySelect.value,
        startSec,
        endSec,
        skipAds: settings.skipAds,
        maxClipSeconds: settings.maxClipSeconds,
        saveAs: settings.saveAs
      });
      if (!res || !res.ok) {
        throw new Error(res?.error || 'Could not start download');
      }
      renderJobUpdate(res.job);
    } catch (err) {
      setError(err.message);
    }
  });

  els.cancelBtn.addEventListener('click', async () => {
    if (!activeJobId) return;
    try {
      await sendBackground({
        type: 'POPUP_CANCEL_DOWNLOAD',
        jobId: activeJobId
      });
    } catch (_) {
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.target === 'popup' && msg.type === 'JOB_UPDATE') {
      if (!streamState || !msg.job || msg.job.tabId === streamState.tabId) {
        renderJobUpdate(msg.job);
      }
    }
  });

  document.addEventListener('DOMContentLoaded', init);
})();
