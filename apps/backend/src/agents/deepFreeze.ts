/**
 * Freezes a value and everything reachable from it, and returns it. Used for the
 * worked examples a versioned prompt serialises into its text: a prompt file is
 * append-only, so nothing at run time may be able to change what v1 says.
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}
