(function () {
  const activeControllers = new Map();
  const activeBlobUrls = new Map();

  function safeSend(payload) {
    try {
      chrome.runtime.sendMessage(payload);
    } catch (_) {
    }
  }

  async function runJob(msg) {
    const { jobId, segments, allowLeadingExpire, filename } = msg;
    const controller = new AbortController();
    activeControllers.set(jobId, controller);
    let lastProgressAt = 0;

    try {
      const result = await StreamClipBuilder.downloadAndMux({
        segments,
        allowLeadingExpire,
        signal: controller.signal,
        onProgress(progress) {
          const now = Date.now();
          if (progress.phase === 'muxing' || progress.done === progress.total || now - lastProgressAt >= 120) {
            lastProgressAt = now;
            safeSend({
              target: 'background',
              type: 'OFFSCREEN_JOB_PROGRESS',
              jobId,
              progress
            });
          }
        }
      });

      const blobUrl = URL.createObjectURL(result.blob);
      activeBlobUrls.set(jobId, blobUrl);

      safeSend({
        target: 'background',
        type: 'OFFSCREEN_JOB_COMPLETE',
        jobId,
        blobUrl,
        filename,
        durationSec: result.durationSec,
        sizeBytes: result.sizeBytes,
        segmentCount: result.segmentCount,
        skippedExpired: result.skippedExpired
      });
    } catch (err) {
      safeSend({
        target: 'background',
        type: 'OFFSCREEN_JOB_ERROR',
        jobId,
        aborted: Boolean(err && err.name === 'AbortError'),
        error: err ? err.message : 'Download failed'
      });
    } finally {
      activeControllers.delete(jobId);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'offscreen') return false;

    if (msg.type === 'OFFSCREEN_START_JOB') {
      runJob(msg);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'OFFSCREEN_CANCEL_JOB') {
      const ctrl = activeControllers.get(msg.jobId);
      if (ctrl) ctrl.abort();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'OFFSCREEN_REVOKE_URL') {
      const url = activeBlobUrls.get(msg.jobId) || msg.blobUrl;
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {
        }
      }
      activeBlobUrls.delete(msg.jobId);
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
})();
