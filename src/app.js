const express = require("express");
const cors = require("cors");
const { PORT, ERP_BASE_URL, ERP_TOKEN, DOCTYPE, APP_ERP_TOKEN } = require("./config");
const { requireAppToken } = require("./middleware/requireAppToken");

const usersRouter = require("./routes/users");
const profilesRouter = require("./routes/profiles");
const diseasesRouter = require("./routes/diseases");
const diseaseSelectionsRouter = require("./routes/diseaseSelections");
const healthEntriesRouter = require("./routes/healthEntries");
const prescriptionsRouter = require("./routes/prescriptions");
const doctorsRouter = require("./routes/doctors");
const appointmentsRouter = require("./routes/appointments");
const notificationsRouter = require("./routes/notifications");
const supportTicketsRouter = require("./routes/supportTickets");
const webhookEventsRouter = require("./routes/webhookEvents");

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      success: true,
      service: "sriaas-backend-erp",
      frappe: {
        baseUrlConfigured: Boolean(ERP_BASE_URL),
        tokenConfigured: Boolean(ERP_TOKEN),
        appTokenConfigured: Boolean(APP_ERP_TOKEN),
        doctypes: DOCTYPE,
      },
    });
  });

  app.use("/api/v1", requireAppToken);

  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/profiles", profilesRouter);
  app.use("/api/v1/diseases", diseasesRouter);
  app.use("/api/v1/disease-selections", diseaseSelectionsRouter);
  app.use("/api/v1/health-entries", healthEntriesRouter);
  app.use("/api/v1/prescriptions", prescriptionsRouter);
  app.use("/api/v1/doctors", doctorsRouter);
  app.use("/api/v1/appointments", appointmentsRouter);
  app.use("/api/v1/notifications", notificationsRouter);
  app.use("/api/v1/support-tickets", supportTicketsRouter);
  app.use("/api/v1/webhook-events", webhookEventsRouter);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  });

  return app;
}

function listen() {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`backend-erp listening on http://localhost:${PORT}`);
    console.log(`health: http://localhost:${PORT}/api/health`);
  });
}

module.exports = { createApp, listen };
