import { describe, expect, it } from "vitest";
import { RunEventBus } from "../../src/orchestrate/events.js";
import { eventId, type RunEvent } from "@ai-director/contract";

function ev(pass: number, step: number, name: RunEvent["name"] = "pass.started"): RunEvent {
  return { id: eventId(pass, step), name, at: "2026-09-11T10:00:00.000Z", pass } as RunEvent;
}

describe("RunEventBus", () => {
  it("delivers events published after a subscription", () => {
    const bus = new RunEventBus();
    const seen: string[] = [];
    bus.subscribe("r1", undefined, (e) => seen.push(e.id));
    bus.publish("r1", ev(1, 0));
    bus.publish("r1", ev(1, 1));
    expect(seen).toEqual(["1-0", "1-1"]);
  });

  it("replays history to a late subscriber, so a slow browser misses nothing", () => {
    const bus = new RunEventBus();
    bus.publish("r1", ev(1, 0));
    bus.publish("r1", ev(1, 1));
    const seen: string[] = [];
    bus.subscribe("r1", undefined, (e) => seen.push(e.id));
    expect(seen).toEqual(["1-0", "1-1"]);
  });

  it("resumes after Last-Event-ID without redelivering what was already seen", () => {
    const bus = new RunEventBus();
    bus.publish("r1", ev(1, 0));
    bus.publish("r1", ev(1, 1));
    bus.publish("r1", ev(2, 0));
    const seen: string[] = [];
    bus.subscribe("r1", "1-1", (e) => seen.push(e.id));
    expect(seen).toEqual(["2-0"]);
  });

  it("keeps runs apart", () => {
    const bus = new RunEventBus();
    const seen: string[] = [];
    bus.subscribe("r1", undefined, (e) => seen.push(e.id));
    bus.publish("r2", ev(1, 0));
    expect(seen).toEqual([]);
  });

  it("stops delivering after unsubscribe", () => {
    const bus = new RunEventBus();
    const seen: string[] = [];
    const off = bus.subscribe("r1", undefined, (e) => seen.push(e.id));
    off();
    bus.publish("r1", ev(1, 0));
    expect(seen).toEqual([]);
  });

  it("survives a throwing subscriber without losing the other subscribers", () => {
    const bus = new RunEventBus();
    const seen: string[] = [];
    bus.subscribe("r1", undefined, () => { throw new Error("boom"); });
    bus.subscribe("r1", undefined, (e) => seen.push(e.id));
    expect(() => bus.publish("r1", ev(1, 0))).not.toThrow();
    expect(seen).toEqual(["1-0"]);
  });

  it("returns a run's full history in publish order", () => {
    const bus = new RunEventBus();
    bus.publish("r1", ev(1, 0));
    bus.publish("r1", ev(1, 1));
    expect(bus.history("r1").map((e) => e.id)).toEqual(["1-0", "1-1"]);
    expect(bus.history("r2")).toEqual([]);
  });
});
