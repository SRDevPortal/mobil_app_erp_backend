const crypto = require("crypto");
const express = require("express");
const { erpCallMethod, erpGetDoc, erpGetList } = require("../frappeClient");
const { DOCTYPE } = require("../config");
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

const MESSAGE_TICKET_FIELD = (process.env.ERP_MESSAGE_TICKET_FIELD || "ticket").trim();
const SUPPORT_RESOURCE_DOCTYPES = [
  process.env.ERP_TICKET_DOCTYPE || "Support Ticket",
  DOCTYPE.MOBILE_APP_SUPPORT_TICKET,
].filter((v, i, arr) => v && arr.indexOf(v) === i);
const RESOURCE_FIELD_CACHE = new Map();
const SUPPORT_BASE_FIELDS = [
  "name",
  "ticket_number",
  "customer_name",
  "requester_name",
  "user_name",
  "patient_name",
  "name_text",
  "email",
  "user_email",
  "email_id",
  "raised_by",
  "phone",
  "user_phone",
  "mobile_number",
  "subject",
  "title",
  "description",
  "message",
  "status",
  "priority",
  "category",
  "assigned_to",
  "assigned_to_name",
  "external_id",
  "user_id",
  "patient_id",
  "mobile_user_id",
  "customer_id",
  "supabase_user_id",
  "creation",
  "modified",
  "resolved_at",
  "closed_at",
  "metadata",
];
const SUPPORT_LOOKUP_METHODS = [
  "mobile_app.api.v1.support_tickets_lookup",
  "mobile_app.api.v1.support_tickets_list",
  "mobile_app.api.v1.support_tickets_get",
  "mobile_app.api.v1.support_tickets_full_sync",
  "mobile_app.api.v1.support_ticket_lookup",
  "mobile_app.api.v1.support_ticket_list",
  "mobile_app.api.v1.support_ticket_get",
  "mobile_app.api.v1.support_tickets",
  "mobile_app.api.v1.support_ticket",
  "mobile_app.api.v1.tickets_lookup",
  "mobile_app.api.v1.tickets_list",
  "mobile_app.api.v1.user_tickets",
  "mobile_app.api.v1.get_user_tickets",
  "mobile_app.api.v1.get_support_tickets",
  "mobile_app.api.v1.support.lookup",
  "mobile_app.api.v1.support.list_tickets",
  "mobile_app.api.v1.support.get_tickets",
];
const SUPPORT_SYNC_METHODS = [
  "mobile_app.api.v1.support_tickets_sync",
  "mobile_app.api.v1.support_tickets_create",
  "mobile_app.api.v1.support_ticket_sync",
  "mobile_app.api.v1.support_ticket_create",
  "mobile_app.api.v1.create_support_ticket",
  "mobile_app.api.v1.support.create_ticket",
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
  if (Array.isArray(data?.supportTickets)) return data.supportTickets;
  if (Array.isArray(data?.support_ticket)) return data.support_ticket;
  if (Array.isArray(data?.supportTicket)) return data.supportTicket;
  if (Array.isArray(data?.ticket_list)) return data.ticket_list;
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

async function getResourceFieldSet(doctype) {
  if (RESOURCE_FIELD_CACHE.has(doctype)) return RESOURCE_FIELD_CACHE.get(doctype);
  try {
    const meta = await erpGetDoc("DocType", doctype);
    const fields = new Set(["name", "owner", "creation", "modified", "modified_by", "docstatus", "idx"]);
    for (const field of meta?.fields || []) {
      if (field?.fieldname) fields.add(String(field.fieldname));
    }
    RESOURCE_FIELD_CACHE.set(doctype, fields);
    return fields;
  } catch (e) {
    console.warn(`[supportTickets] Could not read DocType metadata for ${doctype}; trying candidate fields:`, e.message);
    RESOURCE_FIELD_CACHE.set(doctype, null);
    return null;
  }
}

function supportedFields(fields, candidates) {
  if (!fields) return candidates;
  return candidates.filter((field) => fields.has(field));
}

async function findTickets({ userId, userLinkName, userEmail, userPhone, userName, status, limit, offset }) {
  try {
    const { data } = await callFirstSupportMethod(SUPPORT_LOOKUP_METHODS, {
      method: "GET",
      query: {
        external_id: userId,
        customer_id: userId,
        patient_id: userId,
        user_id: userId,
        mobile_user_id: userLinkName,
        email: userEmail,
        phone: userPhone,
        mobile: userPhone,
        phone_number: userPhone,
        status,
        limit,
        offset,
      },
    });
    const rows = ticketRowsFromMethodData(data)
      .sort((a, b) => {
        const at = new Date(a.modified || a.updated_at || a.creation || a.created_at || 0).getTime() || 0;
        const bt = new Date(b.modified || b.updated_at || b.creation || b.created_at || 0).getTime() || 0;
        return bt - at;
      })
      .slice(0, limit);
    if (rows.length > 0) return rows;
  } catch (e) {
    console.warn("[supportTickets] mobile_app support lookup failed, trying users_lookup engagement fallback:", e.message);
  }

  try {
    const parsed = await erpCallMethod("mobile_app.api.v1.users_lookup", {
      method: "GET",
      appToken: true,
      query: {
        external_id: userId,
        customer_id: userId,
        supabase_user_id: userId,
        user_id: userId,
        mobile_user_id: userLinkName,
        email: userEmail,
        phone: userPhone,
        mobile: userPhone,
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
  addQueries(queries, ["external_id", "user_id", "patient_id", "mobile_user_id", "customer_id", "supabase_user_id"], userId, status);
  addQueries(queries, ["user_id", "mobile_user_id", "patient_id", "customer_id"], userLinkName, status);
  addQueries(queries, ["email", "user_email", "email_id", "raised_by", "customer_email"], userEmail, status);
  addQueries(queries, ["phone", "user_phone", "mobile_number", "phone_number", "mobile"], userPhone, status);
  addQueries(queries, ["customer_name", "requester_name", "user_name", "patient_name", "name_text"], userName, status);

  const byName = new Map();
  for (const doctype of SUPPORT_RESOURCE_DOCTYPES) {
    const fieldSet = await getResourceFieldSet(doctype);
    const fields = supportedFields(fieldSet, SUPPORT_BASE_FIELDS);
    for (const filters of queries) {
      const supportedFilters = fieldSet ? filters.filter(([field]) => fieldSet.has(field)) : filters;
      if (supportedFilters.length !== filters.length) continue;
      try {
        const rows = await erpGetList(doctype, {
          fields: fields.length ? fields : ["name", "creation", "modified"],
          filters: supportedFilters,
          limit,
          offset,
          orderBy: "modified desc",
        });
        for (const row of rows) {
          const key = row.name || row.ticket_number || JSON.stringify(row);
          byName.set(`${doctype}:${key}`, row);
        }
      } catch (e) {
        if (e.status !== 403 && e.status !== 404) {
          console.warn(`[supportTickets] Resource API lookup failed for ${doctype}:`, e.message);
        }
      }
    }
  }

  const resourceRows = [...byName.values()]
    .sort((a, b) => {
      const at = new Date(a.modified || a.updated_at || a.creation || a.created_at || 0).getTime() || 0;
      const bt = new Date(b.modified || b.updated_at || b.creation || b.created_at || 0).getTime() || 0;
      return bt - at;
    })
    .slice(0, limit);
  if (resourceRows.length > 0) return resourceRows;

  return [];
}

async function resolveTicket(id) {
  const { data } = await callFirstSupportMethod([
    "mobile_app.api.v1.support_ticket_detail",
    "mobile_app.api.v1.support_ticket_get",
    "mobile_app.api.v1.get_support_ticket",
    "mobile_app.api.v1.support.get_ticket",
  ], {
    method: "GET",
    query: { id, name: id, ticket: id, ticket_id: id, ticket_number: id },
  });
  const rows = ticketRowsFromMethodData(data);
  return rows[0] || (data && typeof data === "object" ? data : null);
}

async function getMessages(ticketName, { limit = 100, offset = 0 } = {}) {
  try {
    const { data } = await callFirstSupportMethod([
      "mobile_app.api.v1.support_ticket_messages",
      "mobile_app.api.v1.support_messages",
      "mobile_app.api.v1.get_support_ticket_messages",
      "mobile_app.api.v1.support.get_messages",
    ], {
      method: "GET",
      query: { id: ticketName, ticket: ticketName, ticket_id: ticketName, limit, offset },
    });
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.messages)) return data.messages;
    if (Array.isArray(data?.rows)) return data.rows;
  } catch (_) {}
  return [];
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
      userName:
        req.mobileUser?.full_name ||
        [req.mobileUser?.first_name, req.mobileUser?.last_name].filter(Boolean).join(" ") ||
        "",
    });

    const tickets = rows.map((row) => mapTicket({ ...row, external_id: row.external_id || userId }));
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
      return res.status(e.status || 502).json({
        success: false,
        message: "Support ticket sync method failed",
        error: e.message,
      });
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
    const message = (req.body?.message || "").toString().trim();
    if (!message) return res.status(400).json({ success: false, message: "Message is required" });

    const { data } = await callFirstSupportMethod([
      "mobile_app.api.v1.support_ticket_message_sync",
      "mobile_app.api.v1.support_ticket_message_create",
      "mobile_app.api.v1.add_support_ticket_message",
      "mobile_app.api.v1.support.add_message",
    ], {
      method: "POST",
      body: {
        ticket: req.params.id,
        ticket_id: req.params.id,
        message,
        sender_type: "User",
        sender_id: req.body?.user_id,
        sender_name: req.body?.user_name || "User",
        attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
      },
    });
    const saved = Array.isArray(data) ? data[0] : data;
    return res.status(201).json({ success: true, data: { message: mapMessage(saved || {}) } });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.post("/:id/messages/read", async (req, res) => {
  try {
    await callFirstSupportMethod([
      "mobile_app.api.v1.support_ticket_messages_read",
      "mobile_app.api.v1.mark_support_ticket_messages_read",
      "mobile_app.api.v1.support.mark_messages_read",
    ], {
      method: "POST",
      body: {
        ticket: req.params.id,
        ticket_id: req.params.id,
        message_ids: Array.isArray(req.body?.message_ids) ? req.body.message_ids : [],
      },
    });
    return res.json({ success: true, message: "Messages marked as read" });
  } catch (e) {
    if (e.status === 404) return res.json({ success: true, message: "Messages marked as read" });
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
