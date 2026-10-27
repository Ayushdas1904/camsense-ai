import { ApiError } from '../../utils/ApiError.js';
import { ADAPTER_TYPES } from './adapter.js';
import { simulationAdapter, simulationSnapshot } from './simulationAdapter.js';

/**
 * Device adapter registry (Review 3).
 *
 * One lookup, one deliberate refusal. `getAdapter('simulation')` returns the
 * in-process simulation adapter; ANY other adapter type THROWS.
 *
 * WHY IT THROWS INSTEAD OF FALLING BACK TO SIMULATION: a silent fallback would
 * mean a device configured for real hardware quietly reported successful
 * switching while nothing was connected — the automation log, the device
 * state, the energy analytics and the dashboard would all show a working
 * installation that does not exist. An explicit error names the missing
 * integration, and the device simply stops being controllable until it is
 * reconfigured. Everything else in the backend keeps running.
 *
 * 'http' is declared in the Device schema and in ADAPTER_TYPES as the
 * documented EXTENSION POINT. It is not implemented, and it is not stubbed.
 * There is no MQTT, ESP32 or relay-board integration in this repository to
 * reuse, and adding one purely to make the architecture look richer is out of
 * scope. A future real adapter drops in here, implements the two methods in
 * ./adapter.js, and needs no change to the automation engine, the rules, the
 * models or the API.
 */
const registry = new Map([['simulation', simulationAdapter]]);

/**
 * Resolves an adapter by type.
 *
 * @throws {ApiError} 400 for a type that exists in the schema but is not
 *   implemented (today: 'http'), 400 for an unrecognised type.
 */
export function getAdapter(adapterType) {
  const type = typeof adapterType === 'string' && adapterType ? adapterType : 'simulation';

  const adapter = registry.get(type);
  if (adapter) return adapter;

  const known = ADAPTER_TYPES[type];
  if (known && !known.implemented) {
    throw ApiError.badRequest(
      `The '${type}' device adapter is NOT IMPLEMENTED in this project, so this device ` +
        'cannot be controlled. Only the simulation adapter exists; there is no MQTT, ' +
        'ESP32 or relay integration here. Set the device to adapterType "simulation" to ' +
        'demonstrate automation without hardware, or implement the adapter contract in ' +
        'src/services/devices/adapter.js and register it.',
      { adapterType: type, implemented: false }
    );
  }

  throw ApiError.badRequest(
    `Unknown device adapter '${type}'. Implemented adapters: ${[...registry.keys()].join(', ')}.`,
    { adapterType: type }
  );
}

/** Whether an adapter type can actually control anything in this build. */
export function isAdapterImplemented(adapterType) {
  return registry.has(adapterType);
}

/**
 * Device-adapter health, for the service-health panel.
 *
 * Reports what is genuinely true: the simulation adapter is always "up"
 * because it is this process, and saying so plainly is more useful than a
 * green tick that implies hardware connectivity.
 */
export function adapterHealth() {
  return {
    adapters: Object.entries(ADAPTER_TYPES).map(([type, meta]) => ({
      type,
      implemented: registry.has(type),
      simulated: meta.simulated,
      label: meta.label,
    })),
    // The simulation adapter runs in this process, so it is available whenever
    // the backend is. This is NOT a statement about physical hardware.
    simulation: simulationSnapshot(),
  };
}

export { simulationAdapter };
export { setSimulatedFailure, isSimulatedFailure, resetSimulation } from './simulationAdapter.js';
