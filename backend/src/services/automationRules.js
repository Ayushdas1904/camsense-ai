/**
 * Pure decision rules for Review 3 occupancy-driven automation.
 *
 * DEPENDENCY-FREE, exactly like services/identityRules.js and
 * services/occupancyRules.js: this module imports NOTHING — no mongoose, no
 * models, no env, no logger. Every rule is a pure function of its arguments.
 *
 * That is not stylistic. The decisions in this file are the ones that decide
 * whether a room full of people has its lights switched off, and they are the
 * decisions that most need to be testable. Because nothing is imported, a
 * node:test file can drive every branch — stale data, an override, a cooldown,
 * a schedule boundary — with plain objects, no MongoDB, no AI service and no
 * devices. services/automationEngine.js holds all the I/O; the judgement lives
 * here.
 */

/** The AutomationLog decision values this module may return. */
export const AUTOMATION_DECISIONS = [
  'switch_on',
  'switch_off',
  'no_change',
  'skipped_stale_data',
  'skipped_override',
  'skipped_schedule',
  'skipped_cooldown',
  'command_failed',
];

/** Minutes since local midnight for a Date (0–1439). */
export function minutesOfDay(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return null;
  return value.getHours() * 60 + value.getMinutes();
}

/** Parses an 'HH:MM' 24-hour string into minutes since midnight, or null. */
export function parseHourMinute(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Whether `nowMinutes` falls inside a rule's allowed operating window.
 *
 * An absent, empty or unparseable window means ALWAYS ALLOWED — a rule with no
 * schedule should run, and a typo in a time string must not silently suspend
 * automation without saying why (the caller gets `reason: 'unparseable'` so it
 * can be logged).
 *
 * A window whose end is before its start WRAPS PAST MIDNIGHT: start 18:00, end
 * 06:00 means the evening and the small hours, which is the common case for
 * "only automate outside working hours".
 */
export function isWithinAllowedHours(allowedHours, nowMinutes) {
  const start = parseHourMinute(allowedHours?.start);
  const end = parseHourMinute(allowedHours?.end);

  if (start === null && end === null) return { allowed: true, reason: 'no_window' };
  if (start === null || end === null) return { allowed: true, reason: 'unparseable' };
  if (start === end) return { allowed: true, reason: 'full_day' };
  if (!Number.isFinite(nowMinutes)) return { allowed: true, reason: 'no_clock' };

  if (start < end) {
    const allowed = nowMinutes >= start && nowMinutes < end;
    return { allowed, reason: allowed ? 'inside_window' : 'outside_window' };
  }

  // Wraps midnight.
  const allowed = nowMinutes >= start || nowMinutes < end;
  return { allowed, reason: allowed ? 'inside_window' : 'outside_window' };
}

/**
 * Whether a manual override is still in force at `now`.
 *
 * An override with no expiry is treated as EXPIRED rather than as permanent.
 * A device silently stuck in manual forever because somebody forgot to clear
 * an override is a worse outcome than automation resuming, and the API always
 * sets an explicit expiry (services/deviceService.js → setManualOverride), so
 * a missing one means the record is incomplete.
 */
export function isOverrideActive(override, now = Date.now()) {
  if (!override || !override.state) return { active: false, reason: 'none' };
  const expiresAt = override.expiresAt ? Number(new Date(override.expiresAt)) : null;
  if (expiresAt === null || !Number.isFinite(expiresAt)) {
    return { active: false, reason: 'no_expiry' };
  }
  if (Number(now) >= expiresAt) return { active: false, reason: 'expired' };
  return {
    active: true,
    reason: 'active',
    state: override.state,
    expiresAt: new Date(expiresAt),
    remainingSec: Math.round((expiresAt - Number(now)) / 1000),
  };
}

/**
 * Whether an occupancy figure may be used to switch a device.
 *
 * DEFENCE IN DEPTH. services/occupancyRules.js → isOccupancyUsable is the
 * authority and the engine passes its verdict in as `occupancy.usable`; this
 * function re-checks independently so that a caller which forgets to pass the
 * flag still cannot get a switching decision out of an unusable figure.
 *
 * A null count is the specific case to notice: occupancyRules reports
 * 'camera_unavailable' and 'stale' with `count: null`, NEVER 0. Treating that
 * null as 0 anywhere would read "we cannot see the room" as "the room is
 * empty" and switch the lights off on whoever is in it.
 */
export function isOccupancyActionable(occupancy) {
  if (!occupancy) return { actionable: false, reason: 'no_occupancy_data' };
  if (occupancy.usable === false) return { actionable: false, reason: 'not_usable' };
  if (occupancy.available === false) return { actionable: false, reason: 'camera_unavailable' };
  if (occupancy.status === 'camera_unavailable' || occupancy.status === 'stale') {
    return { actionable: false, reason: occupancy.status };
  }
  const count = occupancy.count;
  if (
    count === null ||
    count === undefined ||
    typeof count !== 'number' ||
    !Number.isFinite(count) ||
    !Number.isInteger(count) ||
    count < 0
  ) {
    // Includes the null case above — never coerced to 0.
    return { actionable: false, reason: 'no_measurement' };
  }
  return { actionable: true, reason: 'measured', count };
}

/** Seconds elapsed since a timestamp, or null when it is absent/invalid. */
function secondsSince(timestamp, now) {
  if (timestamp === null || timestamp === undefined) return null;
  const at = Number(new Date(timestamp));
  if (!Number.isFinite(at)) return null;
  return (Number(now) - at) / 1000;
}

/**
 * THE AUTOMATION DECISION. One device, one rule, one moment.
 *
 * Returns `{ decision, reason, ... }` where `decision` is one of
 * AUTOMATION_DECISIONS and `reason` is operator-facing prose that is written
 * verbatim into AutomationLog. The caller issues a command ONLY for
 * 'switch_on' and 'switch_off'; every other value is recorded and nothing is
 * touched.
 *
 * PRECEDENCE IS DELIBERATE AND IS CHECKED IN THIS ORDER:
 *
 *   1. automation not enabled for this rule/device  → no_change
 *   2. an unexpired manual override                 → skipped_override
 *   3. occupancy unusable (unavailable/stale/null)  → skipped_stale_data
 *   4. outside the allowed hours                    → skipped_schedule
 *   5. inside the command cooldown                  → skipped_cooldown
 *   6. occupied for long enough                     → switch_on  (or no_change)
 *   7. unoccupied for long enough                   → switch_off (or no_change)
 *
 * Why 2 before 3: an operator who has just taken manual control should see
 * "your override is in force", not "the camera is stale" — the override is the
 * reason nothing is happening, and it would still be the reason if the data
 * were perfect.
 *
 * Why 3 before everything that could switch: this is THE fail-safe. When the
 * figure cannot be trusted the rule issues no command at all and records
 * 'skipped_stale_data'. ABSENT DATA IS NOT EVIDENCE OF AN EMPTY ROOM. A stale
 * reading from ten minutes ago says nothing about the room now, and a camera
 * that cannot be read says nothing at all — so the devices are left exactly as
 * they are, and the skip is written to the log where an operator can see it.
 * `onUnavailableOccupancy: 'leave_as_is'` is the one alternative, and it also
 * issues no command; it exists so an operator can record that they considered
 * the question. There is no configuration in this project that switches a
 * device on unavailable data.
 *
 * THE FLAPPING GUARD (steps 6 and 7): both switching branches short-circuit to
 * 'no_change' when the device is ALREADY in the state the rule wants. That one
 * check is what prevents repeated identical commands — a room that stays
 * occupied for an hour produces one switch_on and then 'no_change' on every
 * subsequent evaluation rather than a command per tick. The cooldown in step 5
 * is the second line of defence: it bounds how often a device can be commanded
 * even when the desired state genuinely oscillates, so two rules disagreeing
 * about one device cannot flap it on and off.
 *
 * @param {object}  args
 * @param {object}  args.rule          AutomationRule (plain object or document)
 * @param {object}  args.device        Device
 * @param {object}  args.occupancy     { count, status, available, usable,
 *                                       aboveThresholdSince, belowThresholdSince }
 * @param {number}  args.now           epoch ms
 * @param {Date|null} args.lastCommandAt  when this device was last commanded
 * @param {object|null} args.override  Device.override
 * @param {number}  args.nowMinutes    minutes since local midnight
 */
export function decideDeviceAction({
  rule,
  device,
  occupancy,
  now = Date.now(),
  lastCommandAt = null,
  override = null,
  nowMinutes = null,
} = {}) {
  const base = {
    ruleId: rule?.ruleId ?? null,
    deviceId: device?.deviceId ?? null,
    occupancyCount: null,
    occupancyStatus: occupancy?.status ?? null,
    desiredState: null,
  };

  if (!rule || !device) {
    return { ...base, decision: 'no_change', reason: 'No rule or device to evaluate.' };
  }

  // ── 1. Is automation even switched on for this pair? ──────────
  if (rule.enabled !== true) {
    return {
      ...base,
      decision: 'no_change',
      reason: `Rule ${rule.ruleId} is disabled, so no automation ran.`,
    };
  }
  if (rule.active === false) {
    return {
      ...base,
      decision: 'no_change',
      reason: `Rule ${rule.ruleId} is inactive, so no automation ran.`,
    };
  }
  if (device.active === false) {
    return {
      ...base,
      decision: 'no_change',
      reason: `Device ${device.deviceId} is inactive, so it was not automated.`,
    };
  }
  if (device.controlMode !== 'automatic') {
    return {
      ...base,
      decision: 'no_change',
      reason:
        `Device ${device.deviceId} is in '${device.controlMode}' control mode, not ` +
        "'automatic', so automation left it alone.",
    };
  }

  // ── 2. A manual override outranks the rule ────────────────────
  const overrideState = isOverrideActive(override ?? device.override, now);
  if (overrideState.active) {
    return {
      ...base,
      decision: 'skipped_override',
      reason:
        `A manual override (${overrideState.state}) is in force for another ` +
        `${overrideState.remainingSec}s, so automation did not change this device. ` +
        'Automatic control resumes when the override expires.',
      overrideExpiresAt: overrideState.expiresAt,
    };
  }

  // ── 3. THE FAIL-SAFE: no usable occupancy figure → no command ─
  const actionable = isOccupancyActionable(occupancy);
  if (!actionable.actionable) {
    const policy = rule.onUnavailableOccupancy || 'suspend';
    const statusText = occupancy?.status ? ` (status: ${occupancy.status})` : '';
    if (policy === 'suspend') {
      return {
        ...base,
        decision: 'skipped_stale_data',
        reason:
          `Occupancy for ${rule.roomId} is not usable${statusText}: ${actionable.reason}. ` +
          'Automatic switching is SUSPENDED — unavailable or stale data is not evidence ' +
          'that the room is empty, so the device was left exactly as it is.',
      };
    }
    // The only other configured policy, and it also issues no command. It is a
    // separate value so the operator's explicit choice is recorded.
    return {
      ...base,
      decision: 'skipped_stale_data',
      reason:
        `Occupancy for ${rule.roomId} is not usable${statusText}: ${actionable.reason}. ` +
        `The configured policy '${policy}' leaves the device in its current state; no ` +
        'command was issued.',
      policy,
    };
  }

  const count = actionable.count;
  const withCount = { ...base, occupancyCount: count };

  // ── 4. Schedule ───────────────────────────────────────────────
  const minutes = Number.isFinite(nowMinutes) ? nowMinutes : minutesOfDay(new Date(now));
  const schedule = isWithinAllowedHours(rule.allowedHours, minutes);
  if (!schedule.allowed) {
    return {
      ...withCount,
      decision: 'skipped_schedule',
      reason:
        `Outside rule ${rule.ruleId}'s allowed hours ` +
        `(${rule.allowedHours?.start}–${rule.allowedHours?.end}), so no command was issued.`,
    };
  }

  // ── 5. Cooldown ───────────────────────────────────────────────
  const cooldownSec = Number(rule.commandCooldownSec) || 0;
  const sinceCommand = secondsSince(lastCommandAt, now);
  if (cooldownSec > 0 && sinceCommand !== null && sinceCommand < cooldownSec) {
    return {
      ...withCount,
      decision: 'skipped_cooldown',
      reason:
        `Device ${device.deviceId} was commanded ${Math.round(sinceCommand)}s ago and the ` +
        `rule's cooldown is ${cooldownSec}s, so no new command was issued. This is what ` +
        'stops a device being switched repeatedly.',
    };
  }

  const threshold = Number.isFinite(Number(rule.occupancyThreshold))
    ? Number(rule.occupancyThreshold)
    : 1;

  // ── 6. Occupied → switch on ───────────────────────────────────
  if (count > threshold) {
    const onDelay = Number(rule.switchOnDelaySec) || 0;
    const occupiedFor = secondsSince(occupancy.aboveThresholdSince, now);
    if (onDelay > 0 && (occupiedFor === null || occupiedFor < onDelay)) {
      return {
        ...withCount,
        decision: 'no_change',
        reason:
          `${rule.roomId} has ${count} occupant(s) but the rule's ${onDelay}s switch-on ` +
          `delay is not satisfied yet (${occupiedFor === null ? 'unknown' : Math.round(occupiedFor)}s).`,
      };
    }
    // THE FLAPPING GUARD: already on → do nothing, do not re-command.
    if (device.reportedState === 'on') {
      return {
        ...withCount,
        decision: 'no_change',
        reason:
          `${rule.roomId} is occupied (${count} > ${threshold}) and ${device.deviceId} is ` +
          'already on, so no command was repeated.',
      };
    }
    return {
      ...withCount,
      decision: 'switch_on',
      desiredState: 'on',
      reason:
        `${rule.roomId} is occupied: ${count} occupant(s) exceeds the threshold of ` +
        `${threshold}, so ${device.deviceId} was switched on.`,
    };
  }

  // ── 7. Unoccupied for long enough → switch off ────────────────
  const unoccupiedFor = Number(rule.unoccupiedForSec) || 0;
  const offDelay = Number(rule.switchOffDelaySec) || 0;
  // The two delays compose: the room must first have been continuously
  // at/below the threshold for `unoccupiedForSec` to COUNT as unoccupied, and
  // then the `switchOffDelaySec` grace period applies on top of that.
  const requiredSec = unoccupiedFor + offDelay;
  const belowFor = secondsSince(occupancy.belowThresholdSince, now);

  if (requiredSec > 0 && (belowFor === null || belowFor < requiredSec)) {
    return {
      ...withCount,
      decision: 'no_change',
      reason:
        `${rule.roomId} has ${count} occupant(s) (at or below the threshold of ` +
        `${threshold}), but has only been so for ` +
        `${belowFor === null ? 'an unknown time' : `${Math.round(belowFor)}s`} of the ` +
        `required ${requiredSec}s, so nothing was switched off yet.`,
    };
  }

  // THE FLAPPING GUARD, the other way round: already off → do nothing.
  if (device.reportedState === 'off') {
    return {
      ...withCount,
      decision: 'no_change',
      reason:
        `${rule.roomId} is unoccupied and ${device.deviceId} is already off, so no ` +
        'command was repeated.',
    };
  }

  return {
    ...withCount,
    decision: 'switch_off',
    desiredState: 'off',
    reason:
      `${rule.roomId} has been unoccupied (${count} at or below ${threshold}) for ` +
      `${belowFor === null ? 'the required time' : `${Math.round(belowFor)}s`}, which meets ` +
      `the required ${requiredSec}s, so ${device.deviceId} was switched off.`,
  };
}

/**
 * Updates the "continuously at/below threshold since" and "continuously above
 * threshold since" markers for a room.
 *
 * Pure: takes the previous markers and the new reading, returns the new
 * markers. The engine persists them on RoomOccupancyState so a backend
 * restart does not immediately look like a long-unoccupied room and fire a
 * switch-off that was never earned.
 *
 * AN UNUSABLE READING CLEARS NEITHER MARKER AND ADVANCES NEITHER. It carries
 * no information about the room, so the clock neither starts nor resets — it
 * simply does not tick. That is what stops a camera outage from accumulating
 * "unoccupied" time.
 */
export function updateThresholdMarkers({
  previous = {},
  occupancy = null,
  threshold = 1,
  now = Date.now(),
} = {}) {
  const at = new Date(Number(now));
  const actionable = isOccupancyActionable(occupancy);
  if (!actionable.actionable) {
    return {
      belowThresholdSince: previous.belowThresholdSince ?? null,
      aboveThresholdSince: previous.aboveThresholdSince ?? null,
      changed: false,
      reason: `markers_frozen:${actionable.reason}`,
    };
  }

  // "Above the threshold" means STRICTLY above, matching
  // decideDeviceAction exactly — the two must agree or the clock would be
  // running for a condition the decision does not recognise.
  const isAbove = actionable.count > threshold;
  if (isAbove) {
    return {
      belowThresholdSince: null,
      aboveThresholdSince: previous.aboveThresholdSince ?? at,
      changed: previous.belowThresholdSince != null || previous.aboveThresholdSince == null,
      reason: 'above_threshold',
    };
  }

  return {
    belowThresholdSince: previous.belowThresholdSince ?? at,
    aboveThresholdSince: null,
    changed: previous.aboveThresholdSince != null || previous.belowThresholdSince == null,
    reason: 'at_or_below_threshold',
  };
}
