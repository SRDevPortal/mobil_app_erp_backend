const fs = require("fs/promises");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const targetsPath = path.join(dataDir, "support-notification-targets.json");
const statesPath = path.join(dataDir, "support-notification-states.json");

function clean(value) {
  return value == null ? "" : String(value).trim();
}

async function readJsonObject(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

async function writeJsonObject(filePath, value) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value || {}, null, 2));
}

function targetKey(input = {}) {
  return clean(
    input.userId ||
      input.user_id ||
      input.external_id ||
      input.patient_id ||
      input.customer_id,
  );
}

async function upsertSupportNotificationTarget(input = {}) {
  const userId = targetKey(input);
  if (!userId) throw Object.assign(new Error("user_id is required"), { status: 400 });

  const targets = await readJsonObject(targetsPath);
  const previous = targets[userId] || {};
  const next = {
    ...previous,
    userId,
    userEmail: clean(input.userEmail || input.user_email || input.email || previous.userEmail),
    userPhone: clean(input.userPhone || input.user_phone || input.phone || previous.userPhone),
    userName: clean(input.userName || input.user_name || input.name || previous.userName),
    oneSignalUserId: clean(input.oneSignalUserId || input.onesignal_user_id || input.player_id || previous.oneSignalUserId),
    oneSignalPushToken: clean(input.oneSignalPushToken || input.one_signal_push_token || previous.oneSignalPushToken),
    fcmToken: clean(input.fcmToken || input.fcm_token || previous.fcmToken),
    updatedAt: new Date().toISOString(),
    createdAt: previous.createdAt || new Date().toISOString(),
  };
  targets[userId] = next;
  await writeJsonObject(targetsPath, targets);
  return next;
}

async function listSupportNotificationTargets() {
  const targets = await readJsonObject(targetsPath);
  return Object.values(targets).filter((target) => clean(target.userId));
}

async function readSupportNotificationStates() {
  return readJsonObject(statesPath);
}

async function writeSupportNotificationStates(states) {
  await writeJsonObject(statesPath, states || {});
}

module.exports = {
  listSupportNotificationTargets,
  readSupportNotificationStates,
  upsertSupportNotificationTarget,
  writeSupportNotificationStates,
};
