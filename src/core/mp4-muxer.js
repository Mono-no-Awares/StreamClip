(function (root) {
  function readUint32(u8, off) {
    return (
      ((u8[off] << 24) |
        (u8[off + 1] << 16) |
        (u8[off + 2] << 8) |
        u8[off + 3]) >>>
      0
    );
  }

  function writeUint32(u8, off, val) {
    const v = val >>> 0;
    u8[off] = (v >>> 24) & 0xff;
    u8[off + 1] = (v >>> 16) & 0xff;
    u8[off + 2] = (v >>> 8) & 0xff;
    u8[off + 3] = v & 0xff;
  }

  function readUint64(u8, off) {
    const hi = readUint32(u8, off);
    const lo = readUint32(u8, off + 4);
    return hi * 4294967296 + lo;
  }

  function writeUint64(u8, off, val) {
    const safe = Math.max(0, Math.floor(val));
    const hi = Math.floor(safe / 4294967296);
    const lo = safe >>> 0;
    writeUint32(u8, off, hi);
    writeUint32(u8, off + 4, lo);
  }

  function readBoxType(u8, off) {
    return String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
  }

  function walkBoxes(u8, start, end) {
    const boxes = [];
    let pos = start;
    while (pos + 8 <= end) {
      let size = readUint32(u8, pos);
      const type = readBoxType(u8, pos + 4);
      let headerSize = 8;
      if (size === 1 && pos + 16 <= end) {
        size = readUint64(u8, pos + 8);
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < headerSize || pos + size > end) break;
      boxes.push({
        type,
        start: pos,
        payloadStart: pos + headerSize,
        end: pos + size
      });
      pos += size;
    }
    return boxes;
  }

  function isFmp4Segment(bytes) {
    if (!bytes || bytes.byteLength < 8) return false;
    const type = readBoxType(bytes, 4);
    return (
      type === 'styp' ||
      type === 'moof' ||
      type === 'ftyp' ||
      type === 'sidx' ||
      type === 'emsg' ||
      type === 'prft' ||
      type === 'free' ||
      type === 'skip'
    );
  }

  function extractFmp4Fragments(bytes) {
    const out = [];
    const boxes = walkBoxes(bytes, 0, bytes.byteLength);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.type === 'moof' || b.type === 'mdat') {
        out.push(new Uint8Array(bytes.subarray(b.start, b.end)));
      }
    }
    return out;
  }

  function findTsStartOffset(bytes) {
    const limit = Math.min(bytes.byteLength - 188, 1024);
    for (let i = 0; i <= limit; i++) {
      if (bytes[i] === 0x47 && bytes[i + 188] === 0x47) {
        return i;
      }
    }
    return bytes[0] === 0x47 ? 0 : -1;
  }

  function normalizeTsBytes(rawBytes) {
    const offset = findTsStartOffset(rawBytes);
    if (offset > 0) {
      return rawBytes.subarray(offset);
    }
    return rawBytes;
  }

  function injectAudIntoTs(tsBytes) {
    const pktSize = 188;
    if (!tsBytes || tsBytes.byteLength < pktSize || tsBytes[0] !== 0x47) {
      return tsBytes;
    }

    let pmtPid = null;
    let videoPid = null;
    const outChunks = [];
    let cc = 0;

    for (let pos = 0; pos + pktSize <= tsBytes.byteLength; pos += pktSize) {
      if (tsBytes[pos] !== 0x47) {
        outChunks.push(tsBytes.subarray(pos, pos + pktSize));
        continue;
      }

      const pusi = Boolean(tsBytes[pos + 1] & 0x40);
      const pid = ((tsBytes[pos + 1] & 0x1f) << 8) | tsBytes[pos + 2];
      const afc = (tsBytes[pos + 3] >>> 4) & 0x03;
      let payloadOff = pos + 4;
      if (afc === 2 || afc === 3) {
        const afLen = tsBytes[payloadOff];
        payloadOff += 1 + afLen;
      }

      if (pid === 0 && pusi && payloadOff < pos + pktSize) {
        const ptr = tsBytes[payloadOff];
        const sec = payloadOff + 1 + ptr;
        if (sec + 12 <= pos + pktSize) {
          pmtPid = ((tsBytes[sec + 10] & 0x1f) << 8) | tsBytes[sec + 11];
        }
      } else if (pmtPid !== null && pid === pmtPid && pusi && payloadOff < pos + pktSize) {
        const ptr = tsBytes[payloadOff];
        const sec = payloadOff + 1 + ptr;
        if (sec + 12 <= pos + pktSize) {
          const secLen = ((tsBytes[sec + 1] & 0x0f) << 8) | tsBytes[sec + 2];
          const progInfoLen = ((tsBytes[sec + 10] & 0x0f) << 8) | tsBytes[sec + 11];
          let cur = sec + 12 + progInfoLen;
          const endSec = Math.min(pos + pktSize, sec + 3 + secLen - 4);
          while (cur + 5 <= endSec) {
            const streamType = tsBytes[cur];
            const elemPid = ((tsBytes[cur + 1] & 0x1f) << 8) | tsBytes[cur + 2];
            const esInfoLen = ((tsBytes[cur + 3] & 0x0f) << 8) | tsBytes[cur + 4];
            if (streamType === 0x1b) {
              videoPid = elemPid;
            }
            cur += 5 + esInfoLen;
          }
        }
      }

      if (videoPid !== null && pid === videoPid) {
        if (pusi && (afc === 1 || afc === 3) && payloadOff + 9 <= pos + pktSize) {
          if (tsBytes[payloadOff] === 0x00 && tsBytes[payloadOff + 1] === 0x00 && tsBytes[payloadOff + 2] === 0x01) {
            const pesHeaderDataLen = tsBytes[payloadOff + 8];
            const esStart = payloadOff + 9 + pesHeaderDataLen;
            let hasAud = false;
            for (let k = esStart; k + 4 < pos + pktSize; k++) {
              if (tsBytes[k] === 0x00 && tsBytes[k + 1] === 0x00 && tsBytes[k + 2] === 0x01 && (tsBytes[k + 3] & 0x1f) === 9) {
                hasAud = true;
                break;
              }
            }
            if (!hasAud && esStart < pos + pktSize) {
              const audPacket = new Uint8Array(pktSize);
              audPacket.fill(0xff);
              audPacket[0] = 0x47;
              audPacket[1] = 0x40 | ((videoPid >> 8) & 0x1f);
              audPacket[2] = videoPid & 0xff;
              audPacket[3] = 0x30 | (cc & 0x0f);
              cc = (cc + 1) & 0x0f;
              const pesBytes = tsBytes.subarray(payloadOff, esStart);
              const audBytes = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x09, 0xf0]);
              const neededPayload = pesBytes.length + audBytes.length;
              const stuffLen = pktSize - 4 - 1 - neededPayload;
              if (stuffLen >= 0) {
                audPacket[4] = stuffLen;
                if (stuffLen > 0) audPacket[5] = 0x00;
                const writeAt = 5 + stuffLen;
                audPacket.set(pesBytes, writeAt);
                audPacket.set(audBytes, writeAt + pesBytes.length);
                outChunks.push(audPacket);

                const contPacket = new Uint8Array(pktSize);
                contPacket.fill(0xff);
                contPacket[0] = 0x47;
                contPacket[1] = (videoPid >> 8) & 0x1f;
                contPacket[2] = videoPid & 0xff;
                contPacket[3] = 0x30 | (cc & 0x0f);
                cc = (cc + 1) & 0x0f;
                const remEs = tsBytes.subarray(esStart, pos + pktSize);
                const contStuff = pktSize - 4 - 1 - remEs.length;
                if (contStuff >= 0) {
                  contPacket[4] = contStuff;
                  if (contStuff > 0) contPacket[5] = 0x00;
                  contPacket.set(remEs, 5 + contStuff);
                  outChunks.push(contPacket);
                  continue;
                }
              }
            }
          }
        }
        const clone = new Uint8Array(tsBytes.subarray(pos, pos + pktSize));
        clone[3] = (clone[3] & 0xf0) | (cc & 0x0f);
        cc = (cc + 1) & 0x0f;
        outChunks.push(clone);
        continue;
      }

      outChunks.push(tsBytes.subarray(pos, pos + pktSize));
    }

    const totalLen = outChunks.reduce((acc, c) => acc + c.byteLength, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (let i = 0; i < outChunks.length; i++) {
      result.set(outChunks[i], offset);
      offset += outChunks[i].byteLength;
    }
    return result;
  }

  function transmuxRunWithMuxJs(runSegments, options) {
    return new Promise((resolve, reject) => {
      if (!root.muxjs || !root.muxjs.mp4 || !root.muxjs.mp4.Transmuxer) {
        reject(new Error('mux.js Transmuxer is not loaded'));
        return;
      }

      const transmuxer = new root.muxjs.mp4.Transmuxer({
        keepOriginalTimestamps: false,
        remux: options.remux !== false
      });

      let initSegment = null;
      const fragments = [];
      let trackInfo = null;

      transmuxer.on('trackinfo', (info) => {
        trackInfo = info;
      });

      transmuxer.on('data', (segment) => {
        if (options.remux === false) {
          const payload = segment?.data;
          if (payload?.initSegment && payload.initSegment.byteLength > 0) {
            if (!initSegment) initSegment = new Uint8Array(payload.initSegment);
          }
          if (payload?.boxes && payload.boxes.byteLength > 0) {
            fragments.push(new Uint8Array(payload.boxes));
          }
          return;
        }
        if (!initSegment && segment.initSegment && segment.initSegment.byteLength > 0) {
          initSegment = new Uint8Array(segment.initSegment);
        }
        if (segment.data && segment.data.byteLength > 0) {
          fragments.push(new Uint8Array(segment.data));
        }
      });

      transmuxer.on('error', (err) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });

      try {
        for (let i = 0; i < runSegments.length; i++) {
          let bytes = normalizeTsBytes(runSegments[i].bytes);
          if (!bytes || bytes.byteLength === 0) continue;
          if (options.injectAud) {
            bytes = injectAudIntoTs(bytes);
          }
          transmuxer.push(bytes);
        }
        transmuxer.flush();
        resolve({ initSegment, fragments, trackInfo });
      } catch (err) {
        reject(err);
      }
    });
  }

  function extractInitMetadata(initSegment) {
    const trackTimescales = {};
    const trackByType = {};
    const topBoxes = walkBoxes(initSegment, 0, initSegment.byteLength);
    for (let i = 0; i < topBoxes.length; i++) {
      if (topBoxes[i].type !== 'moov') continue;
      const moovChildren = walkBoxes(initSegment, topBoxes[i].payloadStart, topBoxes[i].end);
      for (let j = 0; j < moovChildren.length; j++) {
        if (moovChildren[j].type !== 'trak') continue;
        const trakChildren = walkBoxes(initSegment, moovChildren[j].payloadStart, moovChildren[j].end);
        let trackId = null;
        let timescale = 90000;
        let handlerType = null;
        for (let k = 0; k < trakChildren.length; k++) {
          const box = trakChildren[k];
          if (box.type === 'tkhd') {
            const ver = initSegment[box.payloadStart];
            trackId = ver === 0
              ? readUint32(initSegment, box.payloadStart + 12)
              : readUint32(initSegment, box.payloadStart + 20);
          } else if (box.type === 'mdia') {
            const mdiaChildren = walkBoxes(initSegment, box.payloadStart, box.end);
            for (let m = 0; m < mdiaChildren.length; m++) {
              if (mdiaChildren[m].type === 'mdhd') {
                const mdhd = mdiaChildren[m];
                const ver = initSegment[mdhd.payloadStart];
                timescale = ver === 0
                  ? readUint32(initSegment, mdhd.payloadStart + 12)
                  : readUint32(initSegment, mdhd.payloadStart + 20);
              } else if (mdiaChildren[m].type === 'hdlr') {
                const hdlr = mdiaChildren[m];
                handlerType = readBoxType(initSegment, hdlr.payloadStart + 8);
              }
            }
          }
        }
        if (trackId !== null) {
          trackTimescales[trackId] = timescale || 90000;
          if (handlerType) {
            trackByType[handlerType] = trackId;
          }
        }
      }
    }
    return { trackTimescales, trackByType };
  }

  function patchInitDurations(initSegment, trackTimescales, trackEndTfdt) {
    let totalDurationSec = 0;
    const tids = Object.keys(trackEndTfdt);
    for (let i = 0; i < tids.length; i++) {
      const tid = tids[i];
      const ts = trackTimescales[tid] || 90000;
      const sec = trackEndTfdt[tid] / ts;
      if (sec > totalDurationSec) totalDurationSec = sec;
    }

    const topBoxes = walkBoxes(initSegment, 0, initSegment.byteLength);
    for (let i = 0; i < topBoxes.length; i++) {
      if (topBoxes[i].type !== 'moov') continue;
      const moovChildren = walkBoxes(initSegment, topBoxes[i].payloadStart, topBoxes[i].end);
      let mvhdTimescale = 90000;
      for (let j = 0; j < moovChildren.length; j++) {
        const box = moovChildren[j];
        if (box.type === 'mvhd') {
          const ver = initSegment[box.payloadStart];
          if (ver === 0) {
            mvhdTimescale = readUint32(initSegment, box.payloadStart + 12) || 90000;
            const dur = Math.round(totalDurationSec * mvhdTimescale);
            writeUint32(initSegment, box.payloadStart + 16, Math.min(0xffffffff, dur));
          } else {
            mvhdTimescale = readUint32(initSegment, box.payloadStart + 20) || 90000;
            const dur = Math.round(totalDurationSec * mvhdTimescale);
            writeUint64(initSegment, box.payloadStart + 24, dur);
          }
        }
      }

      const mvhdDuration = Math.round(totalDurationSec * mvhdTimescale);
      for (let j = 0; j < moovChildren.length; j++) {
        const box = moovChildren[j];
        if (box.type !== 'trak') continue;
        const trakChildren = walkBoxes(initSegment, box.payloadStart, box.end);
        let trackId = null;
        let tkhdBox = null;
        let mdhdBox = null;
        for (let k = 0; k < trakChildren.length; k++) {
          const child = trakChildren[k];
          if (child.type === 'tkhd') {
            tkhdBox = child;
            const ver = initSegment[child.payloadStart];
            trackId = ver === 0
              ? readUint32(initSegment, child.payloadStart + 12)
              : readUint32(initSegment, child.payloadStart + 20);
          } else if (child.type === 'mdia') {
            const mdiaChildren = walkBoxes(initSegment, child.payloadStart, child.end);
            for (let m = 0; m < mdiaChildren.length; m++) {
              if (mdiaChildren[m].type === 'mdhd') {
                mdhdBox = mdiaChildren[m];
              }
            }
          }
        }
        if (tkhdBox) {
          const ver = initSegment[tkhdBox.payloadStart];
          if (ver === 0) {
            writeUint32(initSegment, tkhdBox.payloadStart + 20, Math.min(0xffffffff, mvhdDuration));
          } else {
            writeUint64(initSegment, tkhdBox.payloadStart + 28, mvhdDuration);
          }
        }
        if (mdhdBox && trackId !== null) {
          const trackDur = Math.round(trackEndTfdt[trackId] || 0);
          const ver = initSegment[mdhdBox.payloadStart];
          if (ver === 0) {
            writeUint32(initSegment, mdhdBox.payloadStart + 16, Math.min(0xffffffff, trackDur));
          } else {
            writeUint64(initSegment, mdhdBox.payloadStart + 24, trackDur);
          }
        }
      }
    }
    return totalDurationSec;
  }

  function stitchAndPatchMp4(runOutputs) {
    let masterInit = null;
    for (let i = 0; i < runOutputs.length; i++) {
      if (runOutputs[i].initSegment) {
        masterInit = new Uint8Array(runOutputs[i].initSegment);
        break;
      }
    }
    if (!masterInit) {
      throw new Error('Failed to build MP4 initialization header');
    }

    const { trackTimescales, trackByType: masterTrackByType } = extractInitMetadata(masterInit);
    const trackEndTfdt = {};
    const allFragments = [];
    let seqNum = 1;

    for (let r = 0; r < runOutputs.length; r++) {
      const runTrackMap = {};
      if (runOutputs[r].initSegment) {
        const { trackByType: runByType } = extractInitMetadata(runOutputs[r].initSegment);
        for (const [hType, runTid] of Object.entries(runByType)) {
          if (masterTrackByType[hType] !== undefined) {
            runTrackMap[runTid] = masterTrackByType[hType];
          }
        }
      }

      let runBaseSec = 0;
      const existingIds = Object.keys(trackEndTfdt);
      for (let i = 0; i < existingIds.length; i++) {
        const tid = existingIds[i];
        const sec = trackEndTfdt[tid] / (trackTimescales[tid] || 90000);
        if (sec > runBaseSec) runBaseSec = sec;
      }

      const runOriginRaw = {};
      const runTargetOrigin = {};
      const runFrags = runOutputs[r].fragments;

      for (let f = 0; f < runFrags.length; f++) {
        const frag = runFrags[f];
        const topBoxes = walkBoxes(frag, 0, frag.byteLength);
        for (let b = 0; b < topBoxes.length; b++) {
          const top = topBoxes[b];
          if (top.type !== 'moof') continue;
          const moofChildren = walkBoxes(frag, top.payloadStart, top.end);
          for (let mc = 0; mc < moofChildren.length; mc++) {
            const box = moofChildren[mc];
            if (box.type === 'mfhd') {
              writeUint32(frag, box.payloadStart + 4, seqNum++);
            } else if (box.type === 'traf') {
              const trafChildren = walkBoxes(frag, box.payloadStart, box.end);
              let trackId = 1;
              let defaultSampleDuration = 0;
              let tfdtBox = null;
              let fragDuration = 0;

              for (let tc = 0; tc < trafChildren.length; tc++) {
                const tbox = trafChildren[tc];
                if (tbox.type === 'tfhd') {
                  const tfFlags =
                    (frag[tbox.payloadStart + 1] << 16) |
                    (frag[tbox.payloadStart + 2] << 8) |
                    frag[tbox.payloadStart + 3];
                  const rawTrackId = readUint32(frag, tbox.payloadStart + 4);
                  trackId = runTrackMap[rawTrackId] !== undefined ? runTrackMap[rawTrackId] : rawTrackId;
                  if (trackId !== rawTrackId) {
                    writeUint32(frag, tbox.payloadStart + 4, trackId);
                  }
                  let off = tbox.payloadStart + 8;
                  if (tfFlags & 0x01) off += 8;
                  if (tfFlags & 0x02) off += 4;
                  if (tfFlags & 0x08) {
                    defaultSampleDuration = readUint32(frag, off);
                  }
                } else if (tbox.type === 'tfdt') {
                  tfdtBox = tbox;
                } else if (tbox.type === 'trun') {
                  const trFlags =
                    (frag[tbox.payloadStart + 1] << 16) |
                    (frag[tbox.payloadStart + 2] << 8) |
                    frag[tbox.payloadStart + 3];
                  const sampleCount = readUint32(frag, tbox.payloadStart + 4);
                  let cur = tbox.payloadStart + 8;
                  if (trFlags & 0x01) cur += 4;
                  if (trFlags & 0x04) cur += 4;
                  const hasDur = Boolean(trFlags & 0x100);
                  const hasSize = Boolean(trFlags & 0x200);
                  const hasFlags = Boolean(trFlags & 0x400);
                  const hasCts = Boolean(trFlags & 0x800);
                  if (hasDur) {
                    const stride =
                      4 + (hasSize ? 4 : 0) + (hasFlags ? 4 : 0) + (hasCts ? 4 : 0);
                    for (let s = 0; s < sampleCount; s++) {
                      if (cur + 4 > tbox.end) break;
                      fragDuration += readUint32(frag, cur);
                      cur += stride;
                    }
                  } else {
                    fragDuration += sampleCount * defaultSampleDuration;
                  }
                }
              }

              if (tfdtBox) {
                const ver = frag[tfdtBox.payloadStart];
                const rawTfdt = ver === 1
                  ? readUint64(frag, tfdtBox.payloadStart + 4)
                  : readUint32(frag, tfdtBox.payloadStart + 4);
                const ts = trackTimescales[trackId] || 90000;
                if (runOriginRaw[trackId] === undefined) {
                  runOriginRaw[trackId] = rawTfdt;
                  runTargetOrigin[trackId] = Math.round(runBaseSec * ts);
                }
                let patched = Math.max(
                  0,
                  runTargetOrigin[trackId] + (rawTfdt - runOriginRaw[trackId])
                );
                if (patched < (trackEndTfdt[trackId] || 0)) {
                  patched = trackEndTfdt[trackId];
                }
                if (ver === 1) {
                  writeUint64(frag, tfdtBox.payloadStart + 4, patched);
                } else {
                  writeUint32(frag, tfdtBox.payloadStart + 4, Math.min(0xffffffff, patched));
                }
                trackEndTfdt[trackId] = patched + fragDuration;
              }
            }
          }
        }
        allFragments.push(frag);
      }
    }

    const durationSec = patchInitDurations(masterInit, trackTimescales, trackEndTfdt);
    const blob = new Blob([masterInit, ...allFragments], { type: 'video/mp4' });
    return { blob, durationSec };
  }

  async function transmuxToMp4(segments, initMapBytes) {
    if (!segments || segments.length === 0) {
      throw new Error('No segments available to mux');
    }

    const runs = [];
    let currentRun = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg || !seg.bytes || seg.bytes.byteLength === 0) continue;
      if (seg.discontinuity && currentRun.length > 0) {
        runs.push(currentRun);
        currentRun = [];
      }
      currentRun.push(seg);
    }
    if (currentRun.length > 0) {
      runs.push(currentRun);
    }

    if (runs.length === 0) {
      throw new Error('All downloaded segments were empty');
    }

    const firstBytes = runs[0][0].bytes;
    if (isFmp4Segment(firstBytes)) {
      const runOutputs = runs.map((run) => {
        const fragments = [];
        for (let j = 0; j < run.length; j++) {
          const parts = extractFmp4Fragments(run[j].bytes);
          for (let p = 0; p < parts.length; p++) {
            fragments.push(parts[p]);
          }
        }
        return {
          initSegment: initMapBytes ? new Uint8Array(initMapBytes) : null,
          fragments
        };
      });
      return stitchAndPatchMp4(runOutputs);
    }

    const runOutputs = [];
    let lastInfo = null;
    for (let i = 0; i < runs.length; i++) {
      let out = await transmuxRunWithMuxJs(runs[i], { remux: true, injectAud: false });
      lastInfo = out.trackInfo;
      if (out.fragments.length === 0) {
        out = await transmuxRunWithMuxJs(runs[i], { remux: true, injectAud: true });
        lastInfo = out.trackInfo || lastInfo;
      }
      if (out.fragments.length === 0) {
        out = await transmuxRunWithMuxJs(runs[i], { remux: false, injectAud: false });
        lastInfo = out.trackInfo || lastInfo;
      }
      if (out.fragments.length === 0) {
        out = await transmuxRunWithMuxJs(runs[i], { remux: false, injectAud: true });
        lastInfo = out.trackInfo || lastInfo;
      }
      if (out.fragments.length > 0) {
        runOutputs.push(out);
      }
    }

    if (runOutputs.length === 0) {
      const firstHex = Array.from(firstBytes.subarray(0, 8))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      throw new Error(
        `Transmuxer produced no MP4 video fragments (segs: ${runs[0].length}, bytes: ${firstBytes.byteLength}, head: ${firstHex}, video: ${Boolean(lastInfo?.hasVideo)}, audio: ${Boolean(lastInfo?.hasAudio)})`
      );
    }

    return stitchAndPatchMp4(runOutputs);
  }

  root.StreamClipMuxer = {
    transmuxToMp4
  };
})(typeof self !== 'undefined' ? self : globalThis);
