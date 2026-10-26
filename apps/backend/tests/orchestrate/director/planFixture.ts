import type { Camera, Plan } from "@ai-director/contract";

/** The Gate B board example: four shots (normal, long, long, long) = 15 s. */
export function boardPlan(): Plan {
  return {
    styleLine: "Warm handheld lifestyle ad, natural colour",
    scene: "@maya in @kitchen on a quiet morning, @product on the counter.",
    assets: [
      { handle: "@product", kind: "product", description: "the product bottle, front label to camera" },
      { handle: "@kitchen", kind: "location", description: "a bright home kitchen with a wooden counter" },
      { handle: "@maya", kind: "character", description: "a woman in her thirties in a linen shirt" },
    ],
    shots: [
      { action: "@maya walks into @kitchen and reaches for @product", weight: "normal", sound: "footsteps, a kettle" },
      { action: "She lifts @product and reads the label", weight: "long", sound: "soft room tone" },
      { action: "Close on her hands opening @product", weight: "long", sound: "a gentle click" },
      { action: "@maya smiles and sets @product down in @kitchen", weight: "long", sound: "warm music" },
    ],
  };
}

export function boardCameras(): Camera[] {
  return [1, 2, 3, 4].map((shot) => ({
    shot,
    framing: "medium shot",
    lensMm: 35,
    move: "static" as const,
    light: "soft window light from the left",
  }));
}
