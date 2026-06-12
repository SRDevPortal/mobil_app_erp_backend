const {
  REMINDER_POLL_INTERVAL_MS,
  REMINDER_SCHEDULER_DISABLED,
} = require("../config");
const { runAppointmentReminders } = require("./reminderService");

let timer = null;
let inFlight = false;

async function tick(source = "timer") {
  if (inFlight) return;
  inFlight = true;
  try {
    const result = await runAppointmentReminders();
    if (result.sent > 0 || result.results.length > 0) {
      console.log(
        `[reminderScheduler] ${source}: sent=${result.sent}, checked=${result.checked}, due=${result.results.length}`,
      );
    }
  } catch (e) {
    console.error("[reminderScheduler] run failed:", e.message);
  } finally {
    inFlight = false;
  }
}

function startReminderScheduler() {
  if (REMINDER_SCHEDULER_DISABLED) {
    console.log("[reminderScheduler] disabled by REMINDER_SCHEDULER_DISABLED=true");
    return;
  }
  if (timer) return;

  const intervalMs = Math.max(Number(REMINDER_POLL_INTERVAL_MS) || 60000, 15000);
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();

  console.log(`[reminderScheduler] started intervalMs=${intervalMs}`);
  void tick("startup");
}

function stopReminderScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = { startReminderScheduler, stopReminderScheduler };
