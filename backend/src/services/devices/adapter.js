/**
 * THE DEVICE ADAPTER CONTRACT (Review 3).
 *
 * The automation engine and deviceService never talk to a device directly.
 * They resolve an adapter by `device.adapterType` (services/devices/index.js →
 * getAdapter) and call the two methods below. That indirection is the whole
 * reason a real integration can be added later without touching the engine,
 * the rules, the models or the API.
 *
 * This module is DOCUMENTATION PLUS ONE VALIDATOR. It deliberately does not
 * export a base class to extend: an adapter is a plain object with two async
 * methods, and JavaScript gains nothing from inheritance here.
 *
 * ── The contract ────────────────────────────────────────────────
 *
 *   async apply(device, desiredState, context)
 *     Requests that the device move to `desiredState` ('on' | 'off').
 *     `context` carries { trigger, reason, ruleId, actorId, timeoutSec } for
 *     adapters that need it (an HTTP adapter would use timeoutSec).
 *
 *     Returns: {
 *       ok:            Boolean  — TRUE ONLY IF THE DEVICE ACTUALLY CHANGED,
 *                                 as far as the adapter can tell. An adapter
 *                                 that cannot confirm MUST return false.
 *       reportedState: 'on' | 'off' | 'unknown'
 *                                 The state the adapter OBSERVED afterwards.
 *                                 On failure this should be 'unknown' unless
 *                                 the adapter genuinely read the device.
 *       message:       String   — human-readable, surfaced in the UI and the
 *                                 automation log. A simulation adapter's
 *                                 message MUST begin with 'SIMULATED'.
 *       simulated:     Boolean  — true when no physical device was involved.
 *     }
 *
 *   async probe(device)
 *     Reads the device's current state without changing it.
 *
 *     Returns: {
 *       ok, reportedState, connectionStatus: 'online'|'offline'|'unknown',
 *       simulated, message
 *     }
 *
 * ── THE RULE EVERY CALLER MUST OBEY ─────────────────────────────
 *
 *   A CALLER MUST NOT RECORD A STATE CHANGE UNLESS THE RETURN VALUE CONFIRMS
 *   IT. Concretely: `device.reportedState` may only be updated, and a
 *   DeviceStateHistory row may only be written with `confirmed: true`, when
 *   `ok === true`. When `ok` is false the previous reportedState stays exactly
 *   as it was, the failure is recorded with `confirmed: false`, and a
 *   `device_failure` alert is raised.
 *
 *   This matters beyond tidiness: DeviceStateHistory is the sole input to the
 *   energy analytics, so a state change recorded on the strength of a command
 *   that failed would turn into fabricated kWh in a report. See
 *   services/deviceService.js → issueCommand, which is the only place in the
 *   codebase that writes device state, precisely so this rule is enforced once.
 *
 * ── Implementation status ───────────────────────────────────────
 *
 *   'simulation'  IMPLEMENTED (services/devices/simulationAdapter.js).
 *   'http'        NOT IMPLEMENTED. getAdapter throws a clear error for it.
 *
 *   NO MQTT, ESP32, relay-board or other IoT integration exists anywhere in
 *   this repository, and none is stubbed here. A stub that accepted commands
 *   and returned ok would be indistinguishable from working hardware to
 *   everything upstream, which is the one failure mode this contract exists to
 *   prevent. When a real integration is added it must require explicit
 *   configuration (endpoint, credentials) and must refuse to send a command to
 *   a device it was not explicitly configured for.
 */

/** The adapter types the Device schema accepts, and whether each one works. */
export const ADAPTER_TYPES = {
  simulation: { implemented: true, simulated: true, label: 'Simulation (no hardware)' },
  http: { implemented: false, simulated: false, label: 'HTTP device (not implemented)' },
};

/** The two states a device may be commanded into. */
export const COMMANDABLE_STATES = ['on', 'off'];

/**
 * Validates an adapter's return value before it is trusted.
 *
 * Called by deviceService on every adapter response. A malformed response —
 * an adapter that returns undefined, or claims ok without a usable state — is
 * treated as a FAILURE rather than being coerced into a success, because the
 * alternative is recording a state change nothing actually confirmed.
 *
 * @returns {{ valid: boolean, problem: string|null }}
 */
export function validateAdapterResult(result, expectedState) {
  if (!result || typeof result !== 'object') {
    return { valid: false, problem: 'the adapter returned no result object' };
  }
  if (typeof result.ok !== 'boolean') {
    return { valid: false, problem: 'the adapter result has no boolean `ok`' };
  }
  if (!result.ok) {
    // A declared failure is a perfectly valid result; it just is not a success.
    return { valid: true, problem: null };
  }
  if (!['on', 'off', 'unknown'].includes(result.reportedState)) {
    return {
      valid: false,
      problem: `the adapter claimed success but reported an unusable state (${result.reportedState})`,
    };
  }
  if (expectedState && result.reportedState !== expectedState) {
    return {
      valid: false,
      problem:
        `the adapter claimed success but reported '${result.reportedState}' when ` +
        `'${expectedState}' was requested`,
    };
  }
  return { valid: true, problem: null };
}
