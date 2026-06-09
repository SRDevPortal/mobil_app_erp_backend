const express = require("express");
const cors = require("cors");
const {
  PORT,
  ERP_BASE_URL,
  ERP_TOKEN,
  ERP_API_KEY,
  ERP_API_SECRET,
  ERP_BEARER_TOKEN,
  ERP_AUTH_SCHEME,
  DOCTYPE,
  APP_ERP_TOKEN,
  MOBILE_APP_ERP_TOKEN,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} = require("./config");
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
const authRouter = require("./routes/auth");

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  /** Supabase JWT verification + Mobile App User upsert (no APP_ERP_TOKEN). */
  app.use("/api/auth", authRouter);

  app.get("/api/health", (_req, res) => {
    res.json({
      success: true,
      service: "sriaas-backend-erp",
      frappe: {
        baseUrlConfigured: Boolean(ERP_BASE_URL),
        /** Node → Frappe (`Authorization: token client_id:client_secret`) */
        erpTokenConfigured: Boolean(ERP_TOKEN),
        erpAuthScheme: ERP_AUTH_SCHEME,
        erpTokenHasColon: ERP_TOKEN.includes(":"),
        erpTokenLength: ERP_TOKEN.length,
        erpApiKeyPairConfigured: Boolean(ERP_API_KEY && ERP_API_SECRET),
        erpBearerTokenConfigured: Boolean(ERP_BEARER_TOKEN),
        /** Node → Frappe for `mobile_app.api.v1.*` (`X-ERP-Token` = site `mobile_app_erp_token`) */
        mobileAppErpTokenConfigured: Boolean(MOBILE_APP_ERP_TOKEN),
        /** App / Postman → Node (`X-ERP-Token` = APP_ERP_TOKEN) */
        appTokenConfigured: Boolean(APP_ERP_TOKEN),
        doctypes: DOCTYPE,
      },
      supabase: {
        configured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
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
  app.use("/api/v1/support/tickets", supportTicketsRouter);
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
