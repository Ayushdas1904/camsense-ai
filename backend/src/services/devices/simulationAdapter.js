/**
 * Simulation device adapter (Review 3).
 *
 * Satisfies the contract in ./adapter.js entirely in this process: simulated
 * state lives in a Map keyed by deviceId. No network, no hardware, no new
 * dependency and no new infrastructure.
 *
 * WHAT IT IS FOR: this project has no smart lights and no relay board, so
 * without this adapter the automation engine could not be demonstrated or
 * tested at all. With it, every rule, delay, cooldown, override and failure
 * path is exercisable end to end.
 *
 * WHAT IT IS NOT: physical device control. Two things make that impossible to
 * miss anywhere downstream —
 *   • every result carries `simulated: true`, which deviceService copies into
 *     the device payload, the state history and the automation log;
 *   • every message BEGINS WITH THE LITERAL WORD 'SIMULATED', so even a raw
 *     log line or an un-styled table cell says so.
 * The on-durations it produces are real elapsed time, which is why the energy
 * arithmetic over them is meaningful as a demonstration — but the "device" is
 * a Map entry, and no response from this file may ever be described as a
 * measurement of hardware.
 *
 * FAILURE INJECTION: `failDeviceIds` makes a device's commands fail on demand.
 * The command_failed path (alert raised, reportedState left untouched, history
 * row written with confirmed:false) is a correctness-critical branch, and
 * without a way to trigger it deliberately it would be untestable and
 * undemonstrable. It is empty by default.
 */

/** deviceId → 'on' | 'off'. A device absent from the Map has never been set. */
const simulatedState = new Map();

/**
 * deviceIds whose commands will FAIL. Used by tests and by the demo's
 * deliberate failure walkthrough. Empty by default.
 */
const failDeviceIds = new Set();

/** Marks a device as failing, so its next command is refused. */
export function setSimulatedFailure(deviceId, shouldFail = true) {
  if (shouldFail) failDeviceIds.add(deviceId);
  else failDeviceIds.delete(deviceId);
  return { deviceId, failing: failDeviceIds.has(deviceId) };
}

/** Whether a device is currently configured to fail. */
export function isSimulatedFailure(deviceId) {
  return failDeviceIds.has(deviceId);
}

/** Clears all simulated state and failure injection (used by tests/seeding). */
export function resetSimulation() {
  simulatedState.clear();
  failDeviceIds.clear();
}

/** Read-only view of the simulated world, for diagnostics and health checks. */
export function simulationSnapshot() {
  return {
    adapterType: 'simulation',
    simulated: true,
    devices: [...simulatedState.entries()].map(([deviceId, state]) => ({ deviceId, state })),
    failing: [...failDeviceIds],
  };
}

export const simulationAdapter = {
  type: 'simulation',
  simulated: true,
  label: 'Simulation (no physical hardware)',

  /**
   * Applies a desired state to the simulated device.
   *
   * Returns ok:false — leaving the stored simulated state UNCHANGED — when the
   * device is in `failDeviceIds` or the requested state is not commandable, so
   * the caller's failure path is reachable.
   */
  async apply(device, desiredState, context = {}) {
    const deviceId = device?.deviceId ?? 'unknown-device';

    if (desiredState !== 'on' && desiredState !== 'off') {
      return {
        ok: false,
        reportedState: 'unknown',
        message: `SIMULATED adapter refused an unsupported state '${desiredState}'.`,
        simulated: true,
      };
    }

    if (failDeviceIds.has(deviceId)) {
      // Deliberate failure. The stored state is NOT touched, exactly as a real
      // unreachable device would leave its actual state unchanged.
      return {
        ok: false,
        reportedState: 'unknown',
        message:
          `SIMULATED failure: device ${deviceId} is configured to reject commands ` +
          '(failure injection). No state change was recorded.',
        simulated: true,
      };
    }

    simulatedState.set(deviceId, desiredState);
    const trigger = context.trigger ? ` via ${context.trigger}` : '';
    return {
      ok: true,
      reportedState: desiredState,
      message:
        `SIMULATED: ${device?.name || deviceId} switched ${desiredState}${trigger}. ` +
        'No physical device was controlled.',
      simulated: true,
    };
  },

  /**
   * Reads the simulated device's state.
   *
   * A device this adapter has never been asked to switch reports 'unknown'
   * rather than 'off' — the simulation does not invent an initial state any
   * more than a real adapter would.
   */
  async probe(device) {
    const deviceId = device?.deviceId ?? 'unknown-device';

    if (failDeviceIds.has(deviceId)) {
      return {
        ok: false,
        reportedState: 'unknown',
        connectionStatus: 'offline',
        message: `SIMULATED failure: device ${deviceId} is configured to be unreachable.`,
        simulated: true,
      };
    }

    const state = simulatedState.get(deviceId);
    if (state === undefined) {
      return {
        ok: true,
        reportedState: 'unknown',
        connectionStatus: 'online',
        message:
          `SIMULATED: device ${deviceId} is reachable but has never been commanded, ` +
          "so its state is genuinely unknown (not 'off').",
        simulated: true,
      };
    }

    return {
      ok: true,
      reportedState: state,
      connectionStatus: 'online',
      message: `SIMULATED: device ${deviceId} reports ${state}.`,
      simulated: true,
    };
  },
};
