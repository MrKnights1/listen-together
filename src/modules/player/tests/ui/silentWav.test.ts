import { describe, expect, test } from "bun:test";
import { silentWav } from "@/modules/player/ui/silentWav.ts";

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

describe("silentWav", () => {
  test("is a mono 8-bit PCM WAV file at the asked sample rate", () => {
    const wav = silentWav(1, 8000);
    const view = new DataView(wav.buffer);

    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(ascii(wav, 8, 16)).toBe("WAVEfmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(28, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(8);
    expect(ascii(wav, 36, 40)).toBe("data");
  });

  test("holds one byte per sample for as long as asked", () => {
    const wav = silentWav(10, 8000);

    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(80_000);
    expect(wav.length).toBe(44 + 80_000);
  });

  test("is silence from the first sample to the last", () => {
    const samples = silentWav(2, 3000).subarray(44);

    expect(samples.every((sample) => sample === 0x80)).toBe(true);
  });
});
