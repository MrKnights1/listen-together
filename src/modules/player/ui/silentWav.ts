const HEADER_BYTES = 44;
/** 8-bit PCM is unsigned: the midpoint is silence. */
const SILENCE = 0x80;

/**
 * A mono 8-bit PCM WAV file of digital silence, `seconds` long. Built here
 * rather than fetched: ten seconds at 8 kHz is 80 KB, made once per listen.
 */
export function silentWav(seconds: number, sampleRate: number): Uint8Array<ArrayBuffer> {
  const samples = Math.round(seconds * sampleRate);
  const bytes = new Uint8Array(HEADER_BYTES + samples);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i);
  };

  text(0, "RIFF");
  view.setUint32(4, HEADER_BYTES - 8 + samples, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // bytes per second: one byte per sample
  view.setUint16(32, 1, true); // bytes per frame
  view.setUint16(34, 8, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(SILENCE, HEADER_BYTES);
  return bytes;
}
