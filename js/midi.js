// Web MIDI access and PLG150-AN native system exclusive message builders.
//
// Message formats (PLG150-AN Owner's Manual, "MIDI Data Format"):
//   Native parameter change  F0 43 1n 5C ah am al vv.. F7          (2.1.5)
//     2-byte parameters send two data bytes (MSB, LSB).
//   Native bulk dump         F0 43 0n 5C bh bl ah am al data.. cs F7 (2.2.2)
//     bh bl: byte count; cs: count + address + data + cs == 0 (mod 128)
//   Addresses (table <2-1>):
//     00 00 xx  AN1x System           00 08 xx  PLG150-AN System
//     09 0p xx  PLG150-AN Native Part p (0-15)
//     10 00 00  Current Voice Common  10 10 00  Current Voice Scene
//     10 0E 00  Current Voice Step Seq Pattern
//     20 mm 00  User Voice mm+1 (bulk only)
(function () {
  'use strict';

  const MODEL = 0x5C;

  const Sysex = {
    param(dev, ah, am, al, data) {
      return [0xF0, 0x43, 0x10 | (dev & 0x0F), MODEL, ah, am, al, ...data.map(b => b & 0x7F), 0xF7];
    },
    // bytes = [ah, am, al, ...data] as returned by AN.paramBytes
    voiceParam(dev, bytes) { return this.param(dev, bytes[0], bytes[1], bytes[2], bytes.slice(3)); },
    nativeSystem(dev, addr, data) { return this.param(dev, 0x00, 0x08, addr, data); },
    an1xSystem(dev, addr, data) { return this.param(dev, 0x00, 0x00, addr, data); },
    nativePart(dev, part, addr, data) { return this.param(dev, 0x09, part & 0x0F, addr, data); },

    bulk(dev, ah, am, al, data) {
      const n = data.length;
      const head = [(n >> 7) & 0x7F, n & 0x7F, ah, am, al];
      let sum = 0;
      for (const b of head) sum += b;
      for (const b of data) sum += b;
      const cs = (128 - (sum & 0x7F)) & 0x7F;
      return [0xF0, 0x43, dev & 0x0F, MODEL, ...head, ...data, cs, 0xF7];
    },
    // Current voice (edit buffer): Common, Scene, Step Seq
    commonBulk(dev, v) { return this.bulk(dev, 0x10, 0x00, 0x00, Array.from(AN.blockData(v, 'C'))); },
    sceneBulk(dev, v) { return this.bulk(dev, 0x10, 0x10, 0x00, Array.from(AN.blockData(v, 'S'))); },
    stepBulk(dev, v) { return this.bulk(dev, 0x10, 0x0E, 0x00, Array.from(AN.blockData(v, 'T'))); },
    userVoiceBulk(dev, slot, v) { return this.bulk(dev, 0x20, slot & 0x7F, 0x00, Array.from(v)); },
  };

  class Midi {
    constructor() {
      this.access = null;
      this.output = null;
      this.onStateChange = () => {};
      this.onSend = () => {};
    }

    get supported() { return typeof navigator.requestMIDIAccess === 'function'; }

    async init() {
      this.access = await navigator.requestMIDIAccess({ sysex: true });
      this.access.onstatechange = () => this.onStateChange();
    }

    outputs() { return this.access ? [...this.access.outputs.values()] : []; }

    selectOutput(id) {
      this.output = this.outputs().find(p => p.id === id) || null;
    }

    send(bytes, label) {
      if (!this.output) return false;
      this.output.send(bytes);
      this.onSend(bytes, label);
      return true;
    }

    // Sends messages in sequence with a gap between them, so the host and the
    // board have time to digest each bulk before the next one arrives. The gap
    // also covers the wire time of a 5-pin DIN link (~0.32 ms per byte).
    // shouldStop() is checked before each message; onProgress(i, n) after it.
    async sendSequence(list, gapMs = 120, { shouldStop, onProgress } = {}) {
      for (let i = 0; i < list.length; i++) {
        if (shouldStop && shouldStop()) return false;
        const [bytes, label] = list[i];
        if (!this.send(bytes, label)) return false;
        if (onProgress) onProgress(i + 1, list.length);
        await new Promise(r => setTimeout(r, gapMs + bytes.length * 0.35));
      }
      return true;
    }
  }

  window.Sysex = Sysex;
  window.Midi = Midi;
})();
