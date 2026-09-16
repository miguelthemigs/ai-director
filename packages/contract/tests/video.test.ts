import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_SECONDS,
  DEFAULT_VIDEO_SIZE,
  estimateMicroUsd,
  isRenderSuccess,
  isRenderTerminal,
  isValidVideoSeconds,
  MAX_VIDEO_SECONDS,
  MICRO_USD_PER_VIDEO_TOKEN,
  MIN_VIDEO_SECONDS,
  SEEDANCE_FPS,
  SEEDANCE_MODEL,
  videoSizeDimensions,
  videoTokens,
  VIDEO_SIZES,
} from "../src/video.js";

describe("video sizes", () => {
  it("offers exactly the two probed vertical sizes, cheapest first", () => {
    expect(VIDEO_SIZES).toEqual(["480x854", "720x1280"]);
    expect(DEFAULT_VIDEO_SIZE).toBe("480x854");
  });

  it("splits a size into its dimensions", () => {
    expect(videoSizeDimensions("480x854")).toEqual({ width: 480, height: 854 });
    expect(videoSizeDimensions("720x1280")).toEqual({ width: 720, height: 1280 });
  });
});

describe("duration bounds", () => {
  it("accepts the published integer range and nothing else", () => {
    expect(MIN_VIDEO_SECONDS).toBe(4);
    expect(MAX_VIDEO_SECONDS).toBe(30);
    expect(DEFAULT_VIDEO_SECONDS).toBe(4);
    expect(isValidVideoSeconds(4)).toBe(true);
    expect(isValidVideoSeconds(30)).toBe(true);
    expect(isValidVideoSeconds(3)).toBe(false);
    expect(isValidVideoSeconds(31)).toBe(false);
    expect(isValidVideoSeconds(4.5)).toBe(false);
    expect(isValidVideoSeconds(Number.NaN)).toBe(false);
  });
});

describe("pricing", () => {
  it("names the constants rather than hiding them in the formula", () => {
    expect(SEEDANCE_FPS).toBe(24);
    expect(MICRO_USD_PER_VIDEO_TOKEN).toBe(10.7);
    expect(SEEDANCE_MODEL).toBe("bytedance/seedance-2.5");
  });

  it("derives token count from width x height x fps x seconds / 1024", () => {
    expect(videoTokens(480, 854, 4)).toBe(38430);
    expect(videoTokens(720, 1280, 4)).toBe(86400);
    expect(videoTokens(720, 1280, 8)).toBe(172800);
  });

  it("estimates the cheapest usable pair at about eighty cents", () => {
    // 38430 tokens x 10.7 = 411,201 micro-USD, and the pair is twice that.
    expect(estimateMicroUsd("480x854", 4)).toBe(411_201);
    expect(estimateMicroUsd("480x854", 4) * 2).toBe(822_402);
  });

  it("estimates the second size from the same formula, never a second table", () => {
    expect(estimateMicroUsd("720x1280", 4)).toBe(924_480);
    expect(estimateMicroUsd("720x1280", 8)).toBe(1_848_960);
  });

  it("rounds once, at the end", () => {
    // 480x854 for 5s is 48,037.5 tokens x 10.7 = 514,001.25, which must round to an
    // integer number of micro-USD rather than being floored per-token.
    expect(estimateMicroUsd("480x854", 5)).toBe(514_001);
  });
});

describe("render status", () => {
  it("treats succeeded, failed and cancelled as terminal and the rest as not", () => {
    expect(isRenderTerminal("queued")).toBe(false);
    expect(isRenderTerminal("running")).toBe(false);
    expect(isRenderTerminal("succeeded")).toBe(true);
    expect(isRenderTerminal("failed")).toBe(true);
    expect(isRenderTerminal("cancelled")).toBe(true);
  });

  it("makes succeeded the only success, so cancelled can never render as a win", () => {
    expect(isRenderSuccess("succeeded")).toBe(true);
    expect(isRenderSuccess("failed")).toBe(false);
    expect(isRenderSuccess("cancelled")).toBe(false);
    expect(isRenderSuccess("running")).toBe(false);
  });
});
