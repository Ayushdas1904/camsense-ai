import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { AutomationRule } from '../models/AutomationRule.js';
import { AutomationLog } from '../models/AutomationLog.js';
import { Device } from '../models/Device.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { assertDevicesExist, assertRoomExists } from '../services/deviceService.js';
import {
  automationEngineHealth,
  devicesForRule,
  evaluateRoom,
} from '../services/automationEngine.js';
import { normalizeHistoryPaging, parseDateRange } from '../services/occupancyRules.js';

/**
 * Automation rule management and execution history (Review 3).
 *
 * AUTHORIZATION POLICY:
 *   Reads (rules, history, health) require requireAuth.
 *   EVERY rule change — create, update, enable, disable — additionally
 *   requires requireRole('admin'). An automation rule decides when a device is
 *   switched, so editing one is equivalent to being allowed to switch it.
 *
 * TWO DEFAULTS WORTH STATING PLAINLY, because they are what makes this feature
 * safe to ship:
 *   • a new rule is created with `enabled: false`. Nothing runs until an
 *     administrator explicitly enables it, and the device must ALSO be in
 *     'automatic' control mode — two separate opt-ins.
 *   • `onUnavailableOccupancy` defaults to 'suspend'. When the occupancy
 *     figure is unavailable or stale the rule issues NO command and records
 *     'skipped_stale_data'. Unavailable data is not evidence that a room is
 *     empty.
 */

const hourMinute = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM')
  .or(z.literal(''));

export const ruleSchema = z.object({
  ruleId: z.string().min(1, 'Rule ID is required').max(40),
  name: z.string().min(1, 'Name is required').max(80),
  description: z.string().max(300).optional().default(''),
  roomId: z.string().min(1, 'Room ID is required').max(40),
  deviceIds: z
    .array(z.string().min(1).max(40))
    .max(32, 'A rule may control at most 32 devices')
    .optional()
    .default([]),
  // Deliberately NOT defaulted to true. A rule that switched things on the
  // moment it was created would be the wrong behaviour to ship.
  enabled: z.boolean().optional().default(false),
  occupancyThreshold: z.number().int().min(0).max(100000).optional().default(1),
  unoccupiedForSec: z.number().int().min(0).max(86400).optional(),
  switchOffDelaySec: z.number().int().min(0).max(86400).optional().default(0),
  switchOnDelaySec: z.number().int().min(0).max(86400).optional().default(0),
  // Both empty means "always allowed". An end before the start wraps midnight.
  allowedHours: z
    .object({ start: hourMinute.optional().default(''), end: hourMinute.optional().default('') })
    .optional()
    .default({ start: '', end: '' }),
  commandCooldownSec: z.number().int().min(0).max(86400).optional(),
  // 'suspend' is the safe default. 'leave_as_is' is an EXPLICITLY CONFIGURED
  // operator policy; neither value ever switches a device on unusable data.
  onUnavailableOccupancy: z.enum(['suspend', 'leave_as_is']).optional().default('suspend'),
  manualOverrideMinutes: z.number().int().min(1).max(1440).optional(),
  active: z.boolean().optional().default(true),
});

export const ruleUpdateSchema = ruleSchema.partial().omit({ ruleId: true });

/** Client-facing shape of a rule, with its safety posture spelled out. */
function serializeRule(rule, extra = {}) {
  return {
    id: rule._id?.toString?.() ?? null,
    ruleId: rule.ruleId,
    name: rule.name,
    description: rule.description ?? '',
    roomId: rule.roomId,
    deviceIds: rule.deviceIds ?? [],
    enabled: rule.enabled === true,
    occupancyThreshold: rule.occupancyThreshold ?? 1,
    unoccupiedForSec: rule.unoccupiedForSec ?? env.automation.defaultUnoccupiedForSec,
    switchOffDelaySec: rule.switchOffDelaySec ?? 0,
    switchOnDelaySec: rule.switchOnDelaySec ?? 0,
    allowedHours: {
      start: rule.allowedHours?.start ?? '',
      end: rule.allowedHours?.end ?? '',
    },
    commandCooldownSec: rule.commandCooldownSec ?? env.automation.commandCooldownSec,
    onUnavailableOccupancy: rule.onUnavailableOccupancy ?? 'suspend',
    // Stated as prose so the UI can show the operator what the rule does when
    // a camera goes dark, without re-deriving it.
    unavailableDataBehaviour:
      (rule.onUnavailableOccupancy ?? 'suspend') === 'suspend'
        ? 'Automatic switching is SUSPENDED while occupancy is unavailable or stale. ' +
          'Unavailable data is not treated as an empty room.'
        : 'Devices are LEFT AS THEY ARE while occupancy is unavailable or stale (an ' +
          'explicitly configured policy). No command is issued either way.',
    manualOverrideMinutes: rule.manualOverrideMinutes ?? env.automation.manualOverrideMinutes,
    active: rule.active !== false,
    createdAt: rule.createdAt ?? null,
    updatedAt: rule.updatedAt ?? null,
    ...extra,
  };
}

async function findRuleOrThrow(id) {
  const byRuleId = await AutomationRule.findOne({ ruleId: id });
  if (byRuleId) return byRuleId;
  if (/^[a-f\d]{24}$/i.test(String(id))) {
    const byObjectId = await AutomationRule.findById(id);
    if (byObjectId) return byObjectId;
  }
  throw ApiError.notFound('Automation rule not found');
}

export const listRules = asyncHandler(async (req, res) => {
  const filter = {};
  const roomId = typeof req.query.roomId === 'string' ? req.query.roomId.trim() : '';
  if (roomId) filter.roomId = roomId;
  if (req.query.enabled === 'true') filter.enabled = true;
  else if (req.query.enabled === 'false') filter.enabled = false;

  const paging = normalizeHistoryPaging({
    limit: req.query.limit,
    page: req.query.page,
    maxLimit: 200,
  });

  const [rules, total] = await Promise.all([
    AutomationRule.find(filter).sort({ roomId: 1, name: 1 }).skip(paging.skip).limit(paging.perPage),
    AutomationRule.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      items: rules.map((rule) => serializeRule(rule)),
      total,
      page: paging.page,
      perPage: paging.perPage,
      enabledCount: rules.filter((rule) => rule.enabled).length,
      engine: automationEngineHealth(),
    },
  });
});

export const getRule = asyncHandler(async (req, res) => {
  const rule = await findRuleOrThrow(req.params.id);
  res.json({
    success: true,
    data: serializeRule(rule, { devices: await devicesForRule(rule) }),
  });
});

export const createRule = asyncHandler(async (req, res) => {
  const exists = await AutomationRule.findOne({ ruleId: req.body.ruleId });
  if (exists) throw ApiError.conflict('A rule with that ID already exists');

  await assertRoomExists(req.body.roomId);
  const deviceIds = await assertDevicesExist(req.body.deviceIds);

  const rule = await AutomationRule.create({
    ...req.body,
    deviceIds,
    // Defaults applied here rather than in the schema so an operator who
    // leaves them blank inherits the documented env values.
    unoccupiedForSec: req.body.unoccupiedForSec ?? env.automation.defaultUnoccupiedForSec,
    commandCooldownSec: req.body.commandCooldownSec ?? env.automation.commandCooldownSec,
    manualOverrideMinutes:
      req.body.manualOverrideMinutes ?? env.automation.manualOverrideMinutes,
  });

  logger.info(
    `Automation rule ${rule.ruleId} created for ${rule.roomId} over ` +
      `${deviceIds.length} device(s), enabled=${rule.enabled}.`
  );

  res.status(201).json({
    success: true,
    data: serializeRule(rule, {
      note: rule.enabled
        ? 'The rule is enabled. It still only acts on devices whose control mode is ' +
          "'automatic'."
        : 'The rule was created DISABLED. Enable it, and set the devices to ' +
          "'automatic' control mode, before it can switch anything.",
    }),
  });
});

export const updateRule = asyncHandler(async (req, res) => {
  const rule = await findRuleOrThrow(req.params.id);

  if (req.body.roomId && req.body.roomId !== rule.roomId) {
    await assertRoomExists(req.body.roomId);
  }
  if (req.body.deviceIds) {
    req.body.deviceIds = await assertDevicesExist(req.body.deviceIds);
  }

  // Strip explicitly-undefined keys a partial zod schema may hand back, so an
  // omitted field is left alone rather than cleared.
  const patch = { ...req.body };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete patch[key];
  }
  Object.assign(rule, patch);
  await rule.save();

  res.json({
    success: true,
    data: serializeRule(rule, { devices: await devicesForRule(rule) }),
  });
});

export const deleteRule = asyncHandler(async (req, res) => {
  const rule = await findRuleOrThrow(req.params.id);
  await rule.deleteOne();
  logger.info(
    `Automation rule ${rule.ruleId} deleted. Its execution history was RETAINED so past ` +
      'automation decisions stay auditable.'
  );
  res.json({ success: true, data: { ruleId: rule.ruleId, historyRetained: true } });
});

/**
 * POST /api/automation/rules/:id/enable
 *
 * Enabling a rule does NOT switch anything by itself. It also reports which of
 * the rule's devices are actually in 'automatic' mode, because a rule enabled
 * over devices that are all 'disabled' does nothing and the operator should
 * find that out here rather than from a silent dashboard.
 */
export const enableRule = asyncHandler(async (req, res) => {
  const rule = await findRuleOrThrow(req.params.id);
  rule.enabled = true;
  await rule.save();

  const devices = await Device.find({ deviceId: { $in: rule.deviceIds ?? [] } }).select(
    'deviceId name controlMode simulated'
  );
  const automatic = devices.filter((device) => device.controlMode === 'automatic');

  logger.info(`Automation rule ${rule.ruleId} ENABLED.`);

  res.json({
    success: true,
    data: serializeRule(rule, {
      devicesInAutomaticMode: automatic.length,
      devicesTotal: devices.length,
      note:
        automatic.length === 0
          ? "This rule is enabled but NONE of its devices are in 'automatic' control mode, " +
            'so it will not switch anything yet.'
          : `${automatic.length} of ${devices.length} device(s) are in 'automatic' mode and ` +
            'will be evaluated on the next occupancy report or engine tick.',
    }),
  });
});

/**
 * POST /api/automation/rules/:id/disable
 *
 * Disabling a rule leaves every device exactly where it is. An operator
 * disabling automation has not asked for the lights to change, and switching
 * them as a side effect of a configuration change would be its own surprise.
 */
export const disableRule = asyncHandler(async (req, res) => {
  const rule = await findRuleOrThrow(req.params.id);
  rule.enabled = false;
  await rule.save();
  logger.info(`Automation rule ${rule.ruleId} DISABLED. No device state was changed.`);
  res.json({
    success: true,
    data: serializeRule(rule, {
      note: 'The rule is disabled. Every device was left in its current state.',
    }),
  });
});

/**
 * POST /api/automation/rules/:id/evaluate — run this rule's room once, now.
 *
 * Admin-only, and genuinely useful for the demo: it makes the engine's
 * decision visible immediately instead of waiting up to a tick interval. It
 * takes no shortcuts — the same decision function, the same fail-safe, the
 * same adapter confirmation — so a stale occupancy figure produces
 * 'skipped_stale_data' here exactly as it would on the tick.
 */
export const evaluateRule = asyncHandler(async (req, res) => {
  const rule = await findRuleOrThrow(req.params.id);
  const result = await evaluateRoom(rule.roomId, { now: Date.now(), trigger: 'manual' });
  res.json({
    success: true,
    data: {
      ...result,
      note:
        'The rules for this room were evaluated once. Every decision, including any skip, ' +
        'was written to the automation history.',
    },
  });
});

/**
 * GET /api/automation/history — paginated execution history.
 *
 * INCLUDES THE SKIPPED DECISIONS, which is the point. A rule that refused to
 * act because the occupancy data was stale is the single most important thing
 * this endpoint has to be able to show; filtering it out would make a
 * suspended rule indistinguishable from one that was never evaluated.
 */
export const getAutomationHistory = asyncHandler(async (req, res) => {
  const { roomId, deviceId, ruleId, decision, from, to, limit, page } = req.query;

  const paging = normalizeHistoryPaging({
    limit,
    page,
    maxLimit: env.automation.historyMaxLimit,
  });

  const filter = {};
  if (typeof roomId === 'string' && roomId.trim()) filter.roomId = roomId.trim();
  if (typeof deviceId === 'string' && deviceId.trim()) filter.deviceId = deviceId.trim();
  if (typeof ruleId === 'string' && ruleId.trim()) filter.ruleId = ruleId.trim();
  if (typeof decision === 'string' && decision.trim()) filter.decision = decision.trim();
  const range = parseDateRange({ from, to });
  if (range) filter.evaluatedAt = range;

  const [rows, total] = await Promise.all([
    AutomationLog.find(filter)
      .sort({ evaluatedAt: -1 })
      .skip(paging.skip)
      .limit(paging.perPage),
    AutomationLog.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      items: rows.map((row) => ({
        id: row._id.toString(),
        ruleId: row.ruleId ?? null,
        roomId: row.roomId ?? null,
        deviceId: row.deviceId ?? null,
        decision: row.decision,
        reason: row.reason,
        // NULL for an unavailable or stale figure — never 0.
        occupancyCount: row.occupancyCount ?? null,
        occupancyStatus: row.occupancyStatus ?? null,
        outcome: row.outcome,
        adapterMessage: row.adapterMessage ?? null,
        evaluatedAt: row.evaluatedAt,
      })),
      total,
      page: paging.page,
      perPage: paging.perPage,
      maxLimit: paging.maxLimit,
      engine: automationEngineHealth(),
    },
  });
});

/** GET /api/automation/health — what the engine is actually doing. */
export const getAutomationHealth = asyncHandler(async (_req, res) => {
  const [rules, enabled] = await Promise.all([
    AutomationRule.countDocuments({}),
    AutomationRule.countDocuments({ enabled: true, active: true }),
  ]);
  res.json({
    success: true,
    data: { ...automationEngineHealth(), rules, enabledRules: enabled },
  });
});
