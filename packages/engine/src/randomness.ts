import { z } from "zod";

export const RANDOMNESS_ALGORITHM = "mulberry32-v1" as const;

export const unsignedInt32Schema = z
  .number()
  .int()
  .min(0)
  .max(0xffff_ffff);

export const randomnessStateSchema = z
  .object({
    algorithm: z.literal(RANDOMNESS_ALGORITHM),
    rootSeed: unsignedInt32Schema,
    nextStream: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type RandomnessState = z.infer<typeof randomnessStateSchema>;

export const randomnessTraceSchema = z
  .object({
    algorithm: z.literal(RANDOMNESS_ALGORITHM),
    stream: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    seed: unsignedInt32Schema,
    draws: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type RandomnessTrace = z.infer<typeof randomnessTraceSchema>;

export interface DeterministicRandom {
  next(): number;
}

export interface WorldSeedSource {
  nextSeed(): number;
}

export function initialRandomnessState(rootSeed: number): RandomnessState {
  return randomnessStateSchema.parse({
    algorithm: RANDOMNESS_ALGORITHM,
    rootSeed,
    nextStream: 0,
  });
}

export function createSeededRandom(seed: number): DeterministicRandom {
  let state = unsignedInt32Schema.parse(seed) >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    },
  };
}

function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

/**
 * Versioned by RANDOMNESS_ALGORITHM. Both halves of the safe-integer stream
 * index participate so streams remain stable beyond the unsigned-32 range.
 */
export function deriveLocalStreamSeed(
  rootSeed: number,
  stream: number,
): number {
  const parsed = randomnessStateSchema.parse({
    algorithm: RANDOMNESS_ALGORITHM,
    rootSeed,
    nextStream: stream,
  });
  const low = parsed.nextStream >>> 0;
  const high = Math.floor(parsed.nextStream / 4_294_967_296) >>> 0;
  return mix32(parsed.rootSeed ^ low ^ Math.imul(high, 0x9e3779b1));
}

export interface LazyRandomnessStream {
  readonly random: DeterministicRandom;
  trace(): RandomnessTrace | null;
}

export function createLazyRandomnessStream(
  state: RandomnessState,
): LazyRandomnessStream {
  const parsed = randomnessStateSchema.parse(state);
  const stream = parsed.nextStream;
  const seed = deriveLocalStreamSeed(parsed.rootSeed, stream);
  let generator: DeterministicRandom | undefined;
  let draws = 0;

  return {
    random: {
      next() {
        generator ??= createSeededRandom(seed);
        draws += 1;
        return generator.next();
      },
    },
    trace() {
      return draws === 0
        ? null
        : randomnessTraceSchema.parse({
            algorithm: parsed.algorithm,
            stream,
            seed,
            draws,
          });
    },
  };
}
