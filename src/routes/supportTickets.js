const crypto = require("crypto");
const express = require("express");
const { DOCTYPE } = require("../config");
const { erpCallMethod, erpCreate, erpGetDoc, erpGetList, erpUpdate } = require("../frappeClient");
const { resolveUserMiddleware } = require("../services/userService");
const { mapSupportTicketToFrappe, pickExternalId } = require("../normalize");

const router = express.Router();

router.use((req, _res, next) => {
  const queryUserId = req.query?.user_id || req.query?.patient_id;
  const bodyUserId = req.body?.user_id || req.body?.patient_id;
  if (queryUserId && !req.query.external_id) req.query.external_id = queryUserId;
  if ((bodyUserId || queryUserId) && req.body && !req.body.external_id) req.body.external_id = bodyUserId || queryUserId;
  next();
});

router.use(resolveUserMiddleware);

const TICKET_FIELDS = [
  "name",
  "external_id",
  "user_id",
  "requester_name",
  "email",
  "phone",
  "subject",
  "description",
  "priority",
  "status",
  "attachments",
  "creation",
  "modified",
  "created_at",
  "updated_at",
];

const MESSAGE_FIELDS = [
  "name",
  "ticket",
  "ticket_id",
  "sender_type",
  "sender_id",
  "sender_name",
  "message",
  "attachment",
  "attachments",
  "timestamp",
  "is_read",
  "read_at",
  "creation",
  "modified",
];

const MESSAGE_DOCTYPE =
  (process.env.DOCTYPE_MOBILE_APP_SUPPORT_TICKET_MESSAGE || process.env.ERP_MESSAGE_DOCTYPE || "").trim();
const MESSAGE_TICKET_FIELD = (process.env.ERP_MESSAGE_TICKET_FIELD || "ticket").trim();
const SUPPORT_LOOKUP_METHODS = [
  "mobile_app.api.v1.support_tickets_lookup",
  "mobile_app.api.v1.support_ticket_lookup",
  "mobile_app.api.v1.support_tickets",
  "mobile_app.api.v1.tickets_lookup",
];
const SUPPORT_SYNC_METHODS = [
  "mobile_app.api.v1.support_tickets_sync",
  "mobile_app.api.v1.support_ticket_sync",
];

function toApiStatus(value) {
  const normalized = (value || "").toString().trim().toLowerCase().replace(/\s+/g, "_");
  return normalized || "open";
}

function toFrappeStatus(value) {
  const normalized = (value || "").toString().trim().toLowerCase();
  if (normalized === "in_progress") return "In Progress";
  if (normalized === "waiting_for_customer") return "Waiting for Customer";
  if (normalized === "resolved") return "Resolved";
  if (normalized === "closed") return "Closed";
  return "Open";
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

function safeJsonParse(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function mapTicket(doc = {}) {
  return {
    id: doc.name || doc.id || doc.ticket_number || doc.record_external_id,
    ticket_number: doc.ticket_number || doc.name || doc.id || doc.record_external_id,
    user_id: doc.external_id || doc.user_id || doc.patient_id || doc.mobile_user_id || null,
    user_name: doc.requester_name || doc.user_name || doc.customer_name || doc.patient_name || doc.name_text || "",
    user_email: doc.email || doc.user_email || doc.email_id || doc.raised_by || "",
    user_phone: doc.phone || doc.user_phone || doc.mobile_number || "",
    subject: doc.subject || doc.title || doc.record_type || "Support Ticket",
    description: doc.description || doc.message || doc.notes || doc.details || "",
    status: toApiStatus(doc.status),
    priority: (doc.priority || "medium").toString().trim().toLowerCase(),
    category: doc.category || null,
    assigned_to: doc.assigned_to || null,
    assigned_to_name: doc.assigned_to_name || null,
    created_at: toIso(doc.created_at || doc.creation || doc.timestamp, new Date().toISOString()),
    updated_at: toIso(doc.updated_at || doc.modified || doc.timestamp, new Date().toISOString()),
    resolved_at: toIso(doc.resolved_at, null),
    closed_at: toIso(doc.closed_at, null),
    metadata: safeJsonParse(doc.metadata, null),
    unread_message_count: 0,
    agent_message_count: 0,
  };
}

function unwrapMethodData(parsed) {
  const msg = parsed?.message;
  if (msg && typeof msg === "object") {
    if (msg.success === false) return null;
    return msg.data ?? msg.tickets ?? msg.ticket ?? msg;
  }
  return parsed?.data ?? parsed?.tickets ?? parsed?.ticket ?? null;
}

function ticketRowsFromMethodData(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.tickets)) return data.tickets;
  if (Array.isArray(data?.support_tickets)) return data.support_tickets;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.engagement_items)) {
    return data.engagement_items.filter((row) => /support|ticket/i.test(String(row.record_type || row.type || "")));
  }
  if (data && typeof data === "object" && (data.name || data.subject)) return [data];
  return [];
}

async function callFirstSupportMethod(methods, options) {
  let firstError = null;
  for (const method of methods) {
    try {
      const parsed = await erpCallMethod(method, { ...options, appToken: true });
      const data = unwrapMethodData(parsed);
      return { method, data };
    } catch (e) {
      firstError = firstError || e;
      if (e.status && e.status !== 404) break;
    }
  }
  throw firstError || new Error("No support method configured");
}

function mapMessage(doc = {}) {
  const attachments = safeJsonParse(doc.attachments, []);
  const senderType = (doc.sender_type || "").toString().trim().toLowerCase();
  return {
    id: doc.name,
    ticket_id: doc[MESSAGE_TICKET_FIELD] || doc.ticket || doc.ticket_id || "",
    sender_type: senderType === "agent" ? "agent" : "user",
    sender_id: doc.sender_id || null,
    sender_name: doc.sender_name || "",
    message: doc.message || "",
    attachments: Array.isArray(attachments) && attachments.length > 0 ? attachments : doc.attachment ? [doc.attachment] : [],
    is_read: doc.is_read === 1 || doc.is_read === true || doc.is_read === "1",
    read_at: toIso(doc.read_at, null),
    created_at: toIso(doc.timestamp || doc.creation, new Date().toISOString()),
    updated_at: toIso(doc.modified, new Date().toISOString()),
  };
}

function addQueries(queries, fields, value, status) {
  const normalized = (value || "").toString().trim();
  if (!normalized) return;
  for (const field of fields) {
    const filters = [[field, "=", normalized]];
    if (status) filters.push(["status", "=", toFrappeStatus(status)]);
    queries.push(filters);
  }
}

async function findTickets({ userId, userLinkName, userEmail, userPhone, status, limit, offset }) {
  try {
    const { data } = await callFirstSupportMethod(SUPPORT_LOOKUP_METHODS, {
      method: "GET",
      query: {
        external_id: userId,
        user_id: userId,
        mobile_user_id: userLinkName,
        email: userEmail,
        phone: userPhone,
        status,
        limit,
        offset,
      },
    });
    return ticketRowsFromMethodData(data)
      .sort((a, b) => {
        const at = new Date(a.modified || a.updated_at || a.creation || a.created_at || 0).getTime() || 0;
        const bt = new Date(b.modified || b.updated_at || b.creation || b.created_at || 0).getTime() || 0;
        return bt - at;
      })
      .slice(0, limit);
  } catch (e) {
    console.warn("[supportTickets] mobile_app support lookup failed, falling back to Resource API:", e.message);
  }

  try {
    const parsed = await erpCallMethod("mobile_app.api.v1.users_lookup", {
      method: "GET",
      appToken: true,
      query: {
        external_id: userId,
        supabase_user_id: userId,
        email: userEmail,
        phone: userPhone,
      },
    });
    const data = unwrapMethodData(parsed);
    const rows = ticketRowsFromMethodData(data);
    if (rows.length > 0) {
      return rows
        .sort((a, b) => {
          const at = new Date(a.modified || a.updated_at || a.creation || a.created_at || 0).getTime() || 0;
          const bt = new Date(b.modified || b.updated_at || b.creation || b.created_at || 0).getTime() || 0;
          return bt - at;
        })
        .slice(offset, offset + limit);
    }
  } catch (e) {
    console.warn("[supportTickets] users_lookup engagement fallback failed:", e.message);
  }

  const queries = [];
  addQueries(queries, ["external_id", "user_id", "patient_id"], userId, status);
  addQueries(queries, ["user_id"], userLinkName, status);
  addQueries(queries, ["email", "user_email", "raised_by", "email_id"], userEmail, status);
  addQueries(queries, ["phone", "user_phone"], userPhone, status);

  const rowsByName = new Map();
  let firstError = null;
  let successCount = 0;

  for (const filters of queries) {
    try {
      const rows = await erpGetList(DOCTYPE.MOBILE_APP_SUPPORT_TICKET, {
        fields: TICKET_FIELDS,
        filters,
        orderBy: "modified desc",
        limit: Math.min(limit + offset, 100),
        offset: 0,
      });
      successCount += 1;
      for (const row of rows) {
        if (row?.name) rowsByName.set(row.name, { ...(rowsByName.get(row.name) || {}), ...row });
      }
    } catch (e) {
      firstError = firstError || e;
    }
  }

  if (successCount === 0 && firstError) throw firstError;

  return Array.from(rowsByName.values())
    .sort((a, b) => {
      const at = new Date(a.modified || a.creation || 0).getTime() || 0;
      const bt = new Date(b.modified || b.creation || 0).getTime() || 0;
      return bt - at;
    })
    .slice(offset, offset + limit);
}

async function resolveTicket(id) {
  try {
    return await erpGetDoc(DOCTYPE.MOBILE_APP_SUPPORT_TICKET, id);
  } catch (_) {
    const rows = await erpGetList(DOCTYPE.MOBILE_APP_SUPPORT_TICKET, {
      fields: TICKET_FIELDS,
      filters: [["external_id", "=", id]],
      limit: 1,
      orderBy: "modified desc",
    });
    return rows[0] || null;
  }
}

async function getMessages(ticketName, { limit = 100, offset = 0 } = {}) {
  if (!MESSAGE_DOCTYPE) return [];
  try {
    return await erpGetList(MESSAGE_DOCTYPE, {
      fields: MESSAGE_FIELDS,
      filters: [[MESSAGE_TICKET_FIELD, "=", ticketName]],
      orderBy: "creation asc",
      limit,
      offset,
    });
  } catch (_) {
    return [];
  }
}

function isPluginPath(req) {
  return (req.baseUrl || "").includes("/api/v1/support/tickets");
}

router.get("/", async (req, res) => {
  try {
    const { user_id, patient_id, user_email, email, user_phone, phone, status, page = 1, limit = 20 } = req.query;
    const userId = (user_id || patient_id || "").toString().trim();
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required. Provide user_id or patient_id." });
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (pageNum - 1) * limitNum;
    const rows = await findTickets({
      userId,
      userLinkName: req.userLinkName,
      userEmail: user_email || email,
      userPhone: user_phone || phone,
      status,
      limit: limitNum,
      offset,
    });

    const tickets = rows.map(mapTicket);
    return res.json({
      success: true,
      data: {
        tickets,
        pagination: { page: pageNum, limit: limitNum, total: tickets.length },
      },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    let external_id = pickExternalId(body);
    if (!external_id) external_id = crypto.randomUUID();

    const requesterName = body.requester_name || body.name || body.user_name;
    const doc = mapSupportTicketToFrappe(
      {
        ...body,
        external_id,
        requester_name: requesterName,
        name: requesterName,
        email: body.email || body.user_email,
        phone: body.phone || body.user_phone,
        status: body.status || "open",
      },
      req.userLinkName,
    );
    let saved = null;
    try {
      const { data } = await callFirstSupportMethod(SUPPORT_SYNC_METHODS, {
        method: "POST",
        body: doc,
      });
      saved = Array.isArray(data) ? data[0] : data;
    } catch (e) {
      console.warn("[supportTickets] mobile_app support sync failed, falling back to Resource API:", e.message);
      saved = await erpCreate(DOCTYPE.MOBILE_APP_SUPPORT_TICKET, doc);
    }
    const ticket = mapTicket(saved || {});
    if (isPluginPath(req)) return res.status(201).json({ success: true, data: { ticket } });
    return res.status(201).json({ success: true, data: saved });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const ticketDoc = await resolveTicket(req.params.id);
    if (!ticketDoc) return res.status(404).json({ success: false, message: "Ticket not found" });
    const messages = (await getMessages(ticketDoc.name)).map(mapMessage);
    return res.json({ success: true, data: { ticket: mapTicket(ticketDoc), messages } });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.get("/:id/messages", async (req, res) => {
  try {
    const ticketDoc = await resolveTicket(req.params.id);
    if (!ticketDoc) return res.status(404).json({ success: false, message: "Ticket not found" });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const rows = await getMessages(ticketDoc.name, { limit, offset: (page - 1) * limit });
    const messages = rows.map(mapMessage);
    return res.json({ success: true, data: { messages, pagination: { page, limit, total: messages.length } } });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.post("/:id/messages", async (req, res) => {
  try {
    if (!MESSAGE_DOCTYPE) {
      return res.status(503).json({ success: false, message: "Support ticket message DocType is not configured" });
    }
    const ticketDoc = await resolveTicket(req.params.id);
    if (!ticketDoc) return res.status(404).json({ success: false, message: "Ticket not found" });
    const message = (req.body?.message || "").toString().trim();
    if (!message) return res.status(400).json({ success: false, message: "Message is required" });
    const saved = await erpCreate(MESSAGE_DOCTYPE, {
      [MESSAGE_TICKET_FIELD]: ticketDoc.name,
      sender_type: "User",
      sender_id: req.body?.user_id || mapTicket(ticketDoc).user_id,
      sender_name: req.body?.user_name || mapTicket(ticketDoc).user_name || "User",
      message,
      attachments: JSON.stringify(Array.isArray(req.body?.attachments) ? req.body.attachments : []),
      timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
      is_read: 0,
    });
    return res.status(201).json({ success: true, data: { message: mapMessage(saved || {}) } });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.post("/:id/messages/read", async (req, res) => {
  try {
    if (!MESSAGE_DOCTYPE) return res.json({ success: true, message: "Messages marked as read" });
    const ticketDoc = await resolveTicket(req.params.id);
    if (!ticketDoc) return res.status(404).json({ success: false, message: "Ticket not found" });
    const rows = await getMessages(ticketDoc.name);
    const requested = Array.isArray(req.body?.message_ids) ? new Set(req.body.message_ids.map(String)) : null;
    await Promise.all(
      rows
        .filter((row) => !requested || requested.has(String(row.name)))
        .filter((row) => (row.sender_type || "").toString().trim().toLowerCase() === "agent")
        .map((row) => erpUpdate(MESSAGE_DOCTYPE, row.name, { is_read: 1, read_at: new Date().toISOString() })),
    );
    return res.json({ success: true, message: "Messages marked as read" });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
