# CamSense AI — Occupancy, Automation and Energy (Review 3)

The technical companion to [`FACE_RECOGNITION.md`](FACE_RECOGNITION.md), for the
Review 3 layer: how a headcount is produced, how it is judged trustworthy, what
is allowed to act on it, and how a kWh figure is arrived at.

> **Nothing described here has been executed.** No test, build, typecheck,
> service start, database operation or page render. **No device has ever been
> switched, not even a simulated one, and no kWh figure has ever been computed
> by a running process.** See [`REVIEW3-REPORT.md`](REVIEW3-REPORT.md) §D for
> the verbatim per-command record.

---

## 1. Module and interface map

### AI service

| Module | Exports / members used elsewhere | Role |
|---|---|---|
| `app/services/stream_manager.py` → `_CameraWorker` | `_person_track_for(bbox)`, `_update_occupancy(detections, settings)`, `occupancy_count`, `occupancy_available`, `occupancy_updated_at`, `occupancy_updated_wall`, `occupancy_age_seconds` | Produces the headcount from the human detections the Review 1 pipeline already returns |
| `app/services/event_reporter.py` → `EventReporter` | `report_occupancy(camera_id, count, available, frame_mode)` | The third report leg. Rate-limited per camera, bypassed on a change, dispatched on a background thread, **carries no image** |
| `app/models/schemas.py` → `StreamStats` | `occupancy`, `occupancy_available`, `occupancy_age_seconds` | Additive stats contract. `occupancy` is deliberately nullable (`int` or `None`) |
| `app/config.py` → `Settings` | `occupancy_enabled`, `occupancy_report_interval`, `occupancy_min_track_hits`, `occupancy_track_ttl` | All four driveable from the environment with the `AI_SERVICE_` prefix |
| `app/recognition/face_service.py` | `bbox_iou(a, b)` | Reused, not reimplemented — the person tracker uses the same IoU helper the face tracker does |

### Backend — the three dependency-free rule modules

These import **nothing** — no mongoose, no models, no env, no logger — which is
why `node:test` can drive every decision branch with plain objects, no MongoDB
and no AI service. Same pattern as Review 2's `services/identityRules.js`.

| Module | Exports | Role |
|---|---|---|
| `services/occupancyRules.js` | `OCCUPANCY_STATUSES`, `OCCUPANCY_STATUS_LABELS`, `isValidCount`, `aggregateRoomCount`, `isOccupancyUsable`, `deriveOccupancyStatus`, `shouldPersistReading`, `shouldRaiseOccupancyAlert`, `normalizeHistoryPaging`, `parseDateRange` | Status derivation, MAX aggregation, change-based persistence, bounded paging |
| `services/automationRules.js` | `AUTOMATION_DECISIONS`, `minutesOfDay`, `parseHourMinute`, `isWithinAllowedHours`, `isOverrideActive`, `isOccupancyActionable`, `decideDeviceAction`, `updateThresholdMarkers` | The decision that decides whether a room full of people has its lights switched off |
| `services/energyRules.js` | `energyKwh`, `onSecondsFromHistory`, `hasUsableHistory`, `baselineKwh`, `savingsKwh`, `savingsPercent`, `roundKwh`, `windowHours` | All of the arithmetic, including the awkward window cases and the zero-baseline case |

### Backend — the I/O layers

| Module | Role |
|---|---|
| `services/occupancyService.js` | `ingestOccupancy`, `listCurrent`, `listHistory`, `roomSummary`, `serializeRoomState` |
| `services/automationEngine.js` | `startAutomationEngine`, `stopAutomationEngine`, `onOccupancyUpdated`, `runTick`, `evaluateRoom`, `automationEngineHealth`, `devicesForRule` |
| `services/deviceService.js` | `issueCommand` *(the only writer of device state)*, `setControlMode`, `setManualOverride`, `clearOverride`, `syncDeviceState`, `listDevices`, `listDeviceHistory`, `serializeDevice`, `deviceHealth`, `inFlightCommandCount` |
| `services/energyService.js` | `summary`, `history`, `byRoom`, `byDevice`, `trend`, `rollupDay` |
| `services/devices/adapter.js` | The contract + `validateAdapterResult`, `COMMANDABLE_STATES` |
| `services/devices/simulationAdapter.js` | `simulationAdapter`, `setSimulatedFailure`, `isSimulatedFailure`, `resetSimulation`, `simulationSnapshot` |
| `services/devices/index.js` | `getAdapter`, `isAdapterImplemented`, `adapterHealth` |

### Where the honesty rules are enforced

Each of these lives in exactly one place, deliberately, so the rule cannot
drift between call sites:

| Rule | The one place |
|---|---|
| An unmeasurable room reports `null`, never `0` | `occupancyRules.deriveOccupancyStatus` |
| A null count can never produce a switching decision | `automationRules.isOccupancyActionable` *(re-checked independently — defence in depth)* |
| A multi-camera room uses MAX | `occupancyRules.aggregateRoomCount` |
| Device state changes only on a confirmed adapter result | `deviceService.issueCommand` |
| kWh is derived | `energyRules.energyKwh` |
| `null` renders as an em-dash in the UI | `frontend/src/utils/review3.ts` → `renderCount` / `renderNumber` |

---

## 2. How the headcount is produced

### 2.1 The counting rule

**Occupancy is the number of distinct live person tracks on one camera
worker.** It is **not** the sum of per-frame detections and **not** a running
total.

```
for each processed frame:
    if not settings.occupancy_enabled:          return            # untouched
    if not YoloModel.instance().available:
        occupancy_available = False
        return                                                     # count LEFT ALONE
    expire tracks older than occupancy_track_ttl
    person_pass += 1
    for each detection where type == 'human' and bbox is well formed:
        best = the live track with the highest IoU that has NOT already
               been claimed in THIS pass
        if best and IoU(best) >= 0.3:
            best.bbox = bbox ; best.ts = now ; best.hits += 1
        else:
            open a new track  (hits = 1)
    occupancy_count     = count of tracks with hits >= occupancy_min_track_hits
    occupancy_updated_at = monotonic now
    occupancy_available  = True
```

Four properties follow, and each is asserted in
`ai-service/tests/test_review3_occupancy.py`:

| Property | Why it holds |
|---|---|
| One person across 100 consecutive frames counts **once** | Their box re-associates with the same track every frame; no new track opens |
| Two distinct people count as **2** | Non-overlapping boxes have IoU 0, so neither can claim the other's track |
| Two boxes in one frame cannot collapse into one track | The per-pass claim counter: a track already matched in this pass is skipped |
| A one-frame false positive does not move the count | It never reaches `occupancy_min_track_hits` (default 2) |

Review 1's `people` statistic is untouched and is **not** the occupancy figure:
it is still the count of human boxes in the current frame. The two coincide for
a still scene, which is exactly why they are easy to confuse, so Live
Monitoring shows both with an explicit explanation.

### 2.2 Honest limitations of this method

State these plainly whenever the number is shown.

| Limitation | Consequence |
|---|---|
| **It is not a multi-object tracker.** No Kalman filter, no motion model, no appearance embedding, no ByteTrack/DeepSORT | **Two people who cross will mis-associate.** The count can be briefly wrong in either direction |
| **It is per camera worker only** | Nothing is shared between cameras or between processes |
| **It does not survive a worker restart** | Tracks live in a Python list on the worker. Restarting the AI service, or stopping and starting a camera, resets occupancy to *never measured* (`None`, not 0) |
| **There is no cross-camera re-identification** | The same person in front of two cameras opens two independent tracks and nothing can know they are one human — hence MAX, never a sum (§2.4) |
| **A track handle is not an identity** | `CAM-01-person-7` is a transient session handle for de-duplication. It makes no claim about who anyone is, and it is never stored as one |
| **It inherits every `yolov8n` limitation** | Occlusion, small or distant subjects, crowding, unusual poses. `yolov8n` is the smallest YOLOv8 variant, chosen for CPU speed |
| **`occupancy_min_track_hits` trades latency for stability** | A genuinely new person takes at least two processed frames to appear in the count |
| **No accuracy evaluation has been performed** | There is no measured error rate for this method in this project, and none is claimed |

### 2.3 Status derivation

`deriveOccupancyStatus` is checked in this order, and the **unavailability
checks come first**:

| Order | Status | UI label | Condition | Count reported |
|---|---|---|---|---|
| 1 | `camera_unavailable` | Camera Unavailable | `monitoringEnabled === false` | **`null`** *(reason `monitoring_disabled`)* |
| 2 | `camera_unavailable` | Camera Unavailable | `available === false`, or the count is not a valid non-negative integer, or there is no timestamp | **`null`** |
| 3 | `stale` | Occupancy Data Stale | the measurement is older than `OCCUPANCY_STALE_AFTER` | **`null`** |
| 4 | `capacity_exceeded` | Capacity Exceeded | capacity configured **and** `count > capacity` | the count |
| 5 | `near_capacity` | Near Capacity | capacity configured **and** `count >= capacity × nearCapacityRatio` **and** `count > 0` | the count |
| 6 | `occupied` | Occupied | `count >= max(occupancyThreshold, 1)` | the count |
| 7 | `unoccupied` | Unoccupied | otherwise | the count — **including a genuine `0`** |

Notes that matter:

- **Capacity statuses are skipped entirely when capacity is 0 or unset.** A
  ratio of an unknown capacity is meaningless, so such a room only ever reports
  occupied/unoccupied.
- **`monitoringEnabled: false` is reported as unavailable, not unoccupied.** The
  room is deliberately not being measured, so the honest answer is still "no
  current figure".
- **A measured `0` *is* `unoccupied`.** That is the honest empty-room case, and
  it is the whole reason the unavailable cases must be `null` instead: the two
  statements must not collapse into the same number.

### 2.4 Multi-camera aggregation — MAX, never a sum

```js
aggregateRoomCount([{ count, available }, …])
  → usable  = entries that are available AND have a valid integer count
  → if none: { count: null, available: false }          // not 0
  → else:    { count: MAX(usable counts), aggregation: 'max' }
```

An unavailable camera **contributes nothing** rather than contributing `0` — a
camera we cannot read carries no information, not a count of nobody.

Why the maximum and not the sum:

> This project implements no cross-camera re-identification. Person tracks are
> per-camera and transient, so when two cameras cover the same room, one person
> standing in the overlap is tracked independently by both and there is no way
> to know the two tracks are the same human. **Adding** the counts would report
> two people where there is one, and the error grows with the overlap. The
> maximum is a documented **lower bound** on the true headcount — possibly an
> undercount when the cameras see genuinely different parts of the room, but
> never a fabricated overcount, and never a number the system cannot justify.
>
> **For an accurate count, give a room one camera that covers it.** Several
> cameras are supported for coverage, not for additive counting.

### 2.5 Persistence — change-based plus sampled

`shouldPersistReading` decides whether a reading reaches the **history**
collection:

| Condition | Decision | Reason code |
|---|---|---|
| No previous reading, or nothing persisted yet | write | `first_reading` |
| The count changed | write | `count_changed` |
| The status changed | write | `status_changed` |
| The availability flag changed | write | `availability_changed` |
| Nothing changed, but `OCCUPANCY_PERSIST_INTERVAL` has elapsed | write *(heartbeat)* | `sampling_interval` |
| Nothing changed, inside the interval | **skip** | `unchanged_within_interval` |

The live `RoomOccupancyState` document is upserted on **every** accepted report
(so the dashboard is current), while history is written only on the rules
above. That split is deliberate: the live view needs freshness, the history
needs signal. A test drives 30 unchanged reports a second apart and asserts
**zero** history writes.

### 2.6 Reporting cadence, and what the payload does not contain

`report_occupancy` sends when either the `occupancy_report_interval` (default
5 s per camera) has elapsed **or** the count differs from the last reported
value — so a real transition is never delayed by the interval. It dispatches on
a background thread through the same `_dispatch` path the detection and
recognition legs use, so it inherits the per-leg per-camera in-flight cap and
the dropped-report counter, and a stalled backend cannot slow frame processing.

**The payload carries camera ids, counts, availability and the frame mode. It
carries no frame, no image, no face, no identity and no embedding.** A headcount
needs no snapshot, and attaching one would put people's faces on a leg with no
reason to carry them.

---

## 3. Automation

### 3.1 The decision, in precedence order

`decideDeviceAction({ rule, device, occupancy, now, lastCommandAt, override,
nowMinutes })` returns `{ decision, reason, desiredState, occupancyCount,
occupancyStatus }`. The caller issues a command **only** for `switch_on` and
`switch_off`; every other value is recorded and nothing is touched.

| # | Condition | Decision | Command issued? |
|---|---|---|---|
| 1 | `rule.enabled !== true`, `rule.active === false`, `device.active === false`, or `device.controlMode !== 'automatic'` | `no_change` | no |
| 2 | an **unexpired** manual override | `skipped_override` | no |
| 3 | occupancy not actionable — unavailable, stale, or a null/invalid count | `skipped_stale_data` | **no — this is the fail-safe** |
| 4 | `nowMinutes` outside `rule.allowedHours` *(the window may wrap midnight)* | `skipped_schedule` | no |
| 5 | last command within `rule.commandCooldownSec` | `skipped_cooldown` | no |
| 6a | `count > threshold`, switch-on delay not yet satisfied | `no_change` | no |
| 6b | `count > threshold`, delay satisfied, device **already** `on` | `no_change` | no |
| 6c | `count > threshold`, delay satisfied, device not on | **`switch_on`** | yes |
| 7a | `count <= threshold` for less than `unoccupiedForSec + switchOffDelaySec` | `no_change` | no |
| 7b | that elapsed, device **already** `off` | `no_change` | no |
| 7c | that elapsed, device not off | **`switch_off`** | yes |

Three design notes:

- **Why 2 before 3.** An operator who has just taken manual control should be
  told *"your override is in force"*, not *"the camera is stale"*. The override
  is the reason nothing happened, and it would still be the reason if the data
  were perfect.
- **Why 3 before anything that can switch.** See §3.2.
- **Why 6b and 7b exist.** They are the anti-flapping guard. A room occupied for
  an hour produces one `switch_on` and then `no_change` on every subsequent
  evaluation, rather than a command per tick. The step-5 cooldown is the second
  line: it bounds how often a device can be commanded even when the desired
  state genuinely oscillates, so two rules disagreeing about one device cannot
  flap it.

### 3.2 The fail-safe: absent data is not evidence of an empty room

`isOccupancyActionable` rejects, independently of any flag the caller passes in:

```
no occupancy object            → not actionable
occupancy.usable === false     → not actionable
occupancy.available === false  → not actionable
status 'camera_unavailable'    → not actionable
status 'stale'                 → not actionable
count null / undefined / non-numeric / non-integer / negative → not actionable
count 0 with available && usable && a usable status → ACTIONABLE
```

That last line is the point of the whole design: a **measured** zero is
actionable, and an **unknown** is not.

When the figure is not actionable, `decideDeviceAction` returns
`skipped_stale_data` and **no command is issued**. The configured policy only
changes the recorded wording:

| `onUnavailableOccupancy` | Behaviour |
|---|---|
| `suspend` *(the default)* | Automatic switching is suspended; the reason says so explicitly |
| `leave_as_is` | **Also issues no command.** It exists so an operator can record that they considered the question |

**There is no configuration in this project that switches a device on
unavailable data.**

`updateThresholdMarkers` additionally **freezes both clocks** on an unusable
reading — it neither starts nor resets them — so a camera outage cannot
accumulate "unoccupied" time that later satisfies a switch-off delay. A test
asserts the frozen state and the `markers_frozen:<reason>` marker.

Every skip is written to `AutomationLog` with `occupancyCount: null` (never 0)
and surfaces in the UI's activity list. A suspended rule is invisible unless it
is recorded, and being able to *show* the system refusing to act is the single
most important demonstration this feature supports.

### 3.3 Manual override

| Aspect | Behaviour |
|---|---|
| Set | `POST /api/devices/:id/command` with `override: true` — records state, actor, reason and an **explicit expiry** (`overrideMinutes`, default `AUTOMATION_MANUAL_OVERRIDE_MINUTES`) |
| While unexpired | Automation records `skipped_override` and changes nothing |
| On expiry | Automatic control resumes by itself; no operator action needed |
| Cleared early | `DELETE /api/devices/:id/override` |
| **No expiry recorded** | Treated as **expired**, not permanent. A device silently stuck in manual forever because somebody forgot is the worse outcome, and the API always sets an expiry — so a missing one means the record is incomplete |

### 3.4 How the engine is driven

Two inputs, and **no new infrastructure** — no message bus, no second process,
no scheduler library:

1. **Event-driven (the main path).** `occupancyService` calls
   `onOccupancyUpdated(roomId)` directly after it upserts a room's state. A
   plain function call, so a room's devices respond to the report that just
   arrived.
2. **One low-frequency tick** (`AUTOMATION_TICK_INTERVAL`, default 30 s) for the
   transitions caused by *time passing* rather than by a new report: an
   unoccupied delay maturing, an override expiring, and a reading going stale.
   **The last matters most** — when a camera goes dark, no report arrives at
   all, so the event-driven path alone would leave the room's last evaluation
   frozen forever. The tick is what makes an outage visible in the log.

Reliability properties:

| Property | How |
|---|---|
| The tick cannot run twice concurrently | A `tickRunning` flag; an overrun logs and returns |
| **Two commands for one device cannot interleave** | A per-`deviceId` in-flight guard in `deviceService.issueCommand`, cleared in a `finally`. The second command is **refused** (HTTP 409), not queued — the first is about to make the state current. Without it, two paths could both read the same `previousState` and both write a history row, and those rows *are* the timeline the energy arithmetic reads |
| One room's failure does not abandon the others | Each `evaluateRoom` call is individually caught inside the tick |
| An automation fault never crashes the process | The whole tick is wrapped; a failure raises an `automation_failure` alert (cooldowned) and returns |
| An automation fault never fails an occupancy ingest | `onOccupancyUpdated` swallows its own errors. Losing the headcount because a light would not switch would be the wrong trade |
| A restart does not fire an unearned switch-off | The room-threshold clocks are persisted on `RoomOccupancyState` and read back. A rule whose threshold differs from the room's starts its clock fresh, which can only **delay** a switch-off |
| The interval is cleared on shutdown | `stopAutomationEngine()` runs **before** `httpServer.close()`. Devices are deliberately left exactly as they are — stopping the backend is not a request to change the state of the lights |
| Starting twice does not double every evaluation | `startAutomationEngine()` is idempotent |
| The clock map cannot grow without bound | `MARKER_CLOCK_MAX_KEYS = 500`, oldest-first eviction. Evicting an entry only restarts a clock, which delays a switch-off |

---

## 4. The device adapter contract

```js
/**
 * Every adapter must satisfy:
 *   async apply(device, desiredState, context)
 *     -> { ok: boolean, reportedState: 'on'|'off'|'unknown',
 *          message: string, simulated: boolean }
 *
 *   async probe(device)
 *     -> { ok: boolean, reportedState: 'on'|'off'|'unknown',
 *          connectionStatus: 'online'|'offline'|'unknown',
 *          message: string, simulated: boolean }
 *
 * A CALLER MUST NOT RECORD A STATE CHANGE UNLESS THE RETURN VALUE CONFIRMS IT.
 */
```

| Adapter type | Status |
|---|---|
| `simulation` | **Implemented.** In-process `Map` of device states, acknowledges with a message beginning with the literal word `SIMULATED`, supports injected failure via `setSimulatedFailure` |
| `http` | **Not implemented.** `getAdapter('http')` throws an `ApiError` whose message says `NOT IMPLEMENTED` |
| anything else | `getAdapter` throws `Unknown device adapter` |

**No HTTP, MQTT, ESP32 or relay stub was written**, deliberately: an adapter
that silently pretends to work is worse than one that refuses, because it would
let the system claim a physical device changed state.

### 4.1 Confirm before recording

`deviceService.issueCommand` is the only code in the project that writes device
state, so the rule is enforced once:

```
validate the requested state                      → throws on an unknown state
check the device/automation index verification     → refuses while unverified
getAdapter(device.adapterType)                     → THROWS for anything but simulation
result = await adapter.apply(...)                  → a THROW becomes ok:false
validateAdapterResult(result, requestedState)      → a malformed or inconsistent
                                                     success is DOWNGRADED to a failure
record lastCommand (state, issuedAt, by, reason, outcome, message)

if (!result.ok):                                   ← the failure path RETURNS here
    connectionStatus = 'offline'
    reportedState  —  LEFT EXACTLY AS IT WAS
    DeviceStateHistory row with confirmed: false   ← excluded from the energy maths
    AutomationLog row with decision 'command_failed'
    device_failure Alert (per-device cooldown)
    emit device:state { commandFailed: true, reportedState: UNCHANGED }
    HTTP 502 — never a 200 with a quiet flag

else:                                              ← success path
    reportedState = result.reportedState
    lastSuccessfulStateAt = now ; connectionStatus = 'online'
    DeviceStateHistory row with confirmed: true   (only if the state changed)
    emit device:state { stateChanged }
```

`validateAdapterResult` rejects a response with no boolean `ok`, and a response
that claims `ok: true` while reporting a state nobody requested — including
`unknown`. That is what stops a buggy adapter from being coerced into a
success.

`review3-automation.test.js` asserts the **ordering** by string index: the
`if (!result.ok)` early return must appear before
`device.reportedState = result.reportedState`.

### 4.2 Simulation disclosure

Four independent channels, so it cannot be missed:

1. `result.simulated === true` on every adapter return;
2. every message begins with the literal word `SIMULATED`;
3. `serializeDevice` always emits `simulated`, `adapterType` and
   `adapterImplemented`, so every API payload and every `device:state` socket
   event carries it;
4. `GET /api/devices/adapters` returns a plain-language statement of which
   adapters actually work — the UI builds its dropdown from this, and labels an
   unimplemented option *NOT IMPLEMENTED, commands will be refused*.

A **never-commanded** simulated device probes as **`unknown`**, not `off`.
`unknown` is the honest initial value: nothing has been confirmed.

**A reachable adapter does not mean hardware is connected.** The health panel
reports the device adapter with the dedicated status `simulation`, never `ok`.

---

## 5. Energy

### 5.1 Consumption

Derived in **one place** (`energyRules.energyKwh`) so nothing re-derives it and
gets the units wrong:

```
kWh = watts × (seconds / 3600) / 1000
```

The two classic slips — dividing by 1000 twice, and treating a duration in
seconds as hours — are asserted as explicit *not-equals* in
`review3-energy.test.js`, so a regression fails rather than quietly reporting a
plausible-looking small number. Non-finite or negative inputs yield `0` rather
than `NaN`, so one misconfigured device cannot poison a whole report.

### 5.2 On-duration from persisted history

`onSecondsFromHistory(transitions, windowStart, windowEnd)` sums the time a
device was in state `on` inside the window, from `DeviceStateHistory` rows.

| Case | Handling |
|---|---|
| `confirmed: false` | **Skipped.** An unconfirmed row records a command that FAILED; counting it would bill a room for electricity a device never used |
| `toState: 'unknown'` | **Contributes nothing.** Unknown is not off, and guessing either way would be a fabricated figure |
| A state that began **before** `windowStart` | The newest transition at or before `windowStart` establishes the state the device was **already** in, counted from `windowStart` — not from the transition's own timestamp, which may be days earlier |
| An interval still **open** at `windowEnd` | Closed **at `windowEnd`** — never at "now" (which would overstate a historical window) and never dropped (which would understate it) |
| Transitions after `windowEnd` | Ignored; the window caps the contribution |
| Out-of-order rows | Sorted before processing |
| An inverted or zero-length window, or no rows | `0`, never a negative duration |

`hasUsableHistory` separates *"the device was off"* from *"nothing is known"*, so
an empty window can be reported as `insufficientData` rather than as a `0` that
looks like a measurement of an idle device.

### 5.3 The declared baseline

```
baselineKwh = watts × min(ENERGY_BASELINE_HOURS_PER_DAY × windowHours/24, windowHours) / 1000
```

`ENERGY_BASELINE_HOURS_PER_DAY` (default **12**) represents:

> *the hours per day this device would have run under its configured operating
> schedule **without** occupancy-based switching.*

**It is an assumption, not a measurement.** It is deliberately an operator-set
environment variable rather than a hidden constant, it is returned inside
**every** energy API response together with a description of what it assumes and
the name of the variable it came from, and the UI renders that description next
to any savings figure.

The baseline is **pro-rated** for windows shorter or longer than a day and
**capped at the window itself**, so a two-hour window is never compared against
a whole day's baseline, and a baseline can never claim more hours than actually
elapsed. An unconfigured wattage (0 W, the default) produces **no baseline**
rather than a guess.

### 5.4 Savings

```
savedKwh     = max(0, baselineKwh − estimatedActualKwh)
savedPercent = min(100, savedKwh / baselineKwh × 100)      or NULL when baselineKwh <= 0
```

**The clamp is deliberate.** A device that ran *longer* than the baseline has
not saved a negative amount of electricity in any useful sense — it used more
than the comparison schedule — and reporting "−0.3 kWh saved" invites a reader
to subtract it from a total and get a number that means nothing. Zero, with the
consumption figure next to it, is the honest presentation.

**The null is equally deliberate.** With no baseline there is nothing to be a
percentage *of*: dividing by zero gives `Infinity`, and the tempting "report
0%" and "report 100%" are both claims the data does not support. The null
travels to the UI as *"not enough configuration to express this as a
percentage"*, which is true. This is also why `powerRatingWatts` defaults to
**0** rather than to some plausible wattage: an unconfigured device produces a
null percentage rather than a fabricated one.

### 5.5 Worked example

The seeded demo light, `DEV-LIGHT-01`, over a 24-hour window.

| Step | Input | Calculation | Result |
|---|---|---|---|
| Configured rating | `powerRatingWatts: 108` | *(a number an operator typed in — there is no meter)* | 108 W |
| Confirmed history | `on` at 09:00, `off` at 13:00, both `confirmed: true` | `onSecondsFromHistory` | 14,400 s (4 h) |
| **Estimated consumption** | 108 W, 14,400 s | `108 × (14400/3600) / 1000` | **0.432 kWh** |
| Window | 24 h | `windowHours` | 24 |
| **Declared baseline** | 108 W, 12 h/day, 24 h window | `108 × min(12 × 24/24, 24) / 1000` | **1.296 kWh** |
| **Estimated saving** | | `max(0, 1.296 − 0.432)` | **0.864 kWh** |
| **Estimated saving %** | | `0.864 / 1.296 × 100` | **66.7 %** |

Both figures are **estimates**. The 108 W is configured, not metered; the
12 hours is a stated assumption, not an observation; and `DEV-LIGHT-01` is a
**simulated** device, so the 4 hours is real elapsed time during which an entry
in a `Map` said `on` — no hardware was ever energised. `review3-energy.test.js`
composes exactly this example end to end, so the document and the code cannot
drift apart.

Add the fan (`DEV-FAN-01`, 75 W) on the same 4-hour schedule and the room
totals become 0.432 + 0.300 = **0.732 kWh** consumed against a
1.296 + 0.900 = **2.196 kWh** baseline, i.e. **1.464 kWh** estimated saved,
**66.7 %** — the same percentage, because both devices share the schedule and
the baseline assumption.

### 5.6 Insufficient data

A window that cannot be computed returns `insufficientData: true` plus a
`requires` array naming what is missing, rather than a zero:

| Missing | `requires` message covers |
|---|---|
| No confirmed state transitions | the device has never been commanded, or every command failed |
| `powerRatingWatts` is 0 | the device needs a configured power rating |
| No devices in scope | the room has no devices, or none are active |

`GET /api/energy/trend` reads the `EnergySummary` rollup, which the automation
tick fills for **yesterday only**, at most once per local day (an idempotent
upsert on the unique `{ date, deviceId }` key, so a duplicate run recomputes
rather than double-counting). Only a **completed** day is rolled up — a partial
day's row would be wrong the moment it was written and would then be served as
a finished day. On a fresh system the trend therefore legitimately returns
`insufficientData` and the UI says *"no completed day has been rolled up yet"*
instead of drawing a flat line at zero.

---

## 6. What must never be claimed

| Claim | Why it is false here |
|---|---|
| "The system counted N people" | It counted N **distinct tracks** from a bbox-IoU association over `yolov8n` detections. No accuracy evaluation has been performed |
| "The room was empty" | Only when the status is `unoccupied` with a measured count. `camera_unavailable` and `stale` mean **unknown**, and carry `null` |
| "The lights were switched off" | Only a **simulated** state changed. No MQTT, ESP32 or relay integration exists |
| "The device is on" | Only if the adapter **confirmed** it. A failed command leaves the reported state untouched and says so |
| "We saved X kWh" | *Estimated* X kWh, against the **declared** `ENERGY_BASELINE_HOURS_PER_DAY` assumption, from an operator-typed wattage. There is no power meter |
| "Energy savings were Y %" | Only ever *estimated*, and only when the baseline is non-zero — otherwise the figure is `null`, not 0 |
| "The occupancy feature was tested" | The tests are **written**. None has been executed. See [`REVIEW3-REPORT.md`](REVIEW3-REPORT.md) §D |

---

## 7. Related documents

| Document | Contents |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System design, the Review 3 data flow diagram (§4.1) and the trust-boundary rationale (§4.2) |
| [`FACE_RECOGNITION.md`](FACE_RECOGNITION.md) | The Review 2 identity pipeline, which this document parallels |
| [`REVIEW3-REPORT.md`](REVIEW3-REPORT.md) | The Review 3 delivery report: §D verification, §E limitations, §F the demonstration plan |
| [`REVIEW3-VERIFICATION.md`](REVIEW3-VERIFICATION.md) | The per-feature static-audit and blocked-command record |
| [`../README.md`](../README.md) | Setup, configuration, demo instructions, troubleshooting |
