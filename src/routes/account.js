const express = require("express");

const { DOCTYPE } = require("../config");
const { erpDelete, erpGetList } = require("../frappeClient");
const { findMobileAppUser } = require("../services/userService");
const { deleteSupabaseUser } = require("../supabaseAuth");

const router = express.Router();

async function deleteLinkedRows(doctype, userLinkName) {
  const rows = await erpGetList(doctype, {
    filters: [["user_id", "=", userLinkName]],
    fields: ["name"],
    limit: 1000,
  });
  for (const row of rows) {
    if (row?.name) await erpDelete(doctype, row.name);
  }
  return rows.length;
}

router.delete("/", async (req, res) => {
  try {
    const uid = req.authUser?.id;
    if (!uid) {
      return res.status(403).json({ success: false, message: "User authentication is required" });
    }
    if (req.body?.confirmation !== "DELETE") {
      return res.status(400).json({ success: false, message: "Type DELETE to confirm account deletion" });
    }

    const user = await findMobileAppUser({ external_id: uid, supabase_user_id: uid }, {}, {});
    const deleted = {};
    if (user?.name) {
      const linkedTypes = [
        DOCTYPE.MOBILE_APP_NOTIFICATION,
        DOCTYPE.MOBILE_APP_SUPPORT_TICKET,
        DOCTYPE.MOBILE_APP_APPOINTMENT,
        DOCTYPE.MOBILE_APP_PRESCRIPTION,
        DOCTYPE.MOBILE_APP_HEALTH_ENTRY,
        DOCTYPE.MOBILE_APP_USER_DISEASE_SELECTION,
        DOCTYPE.MOBILE_APP_USER_PROFILE,
        DOCTYPE.MOBILE_APP_USER_SESSION,
      ];
      for (const doctype of linkedTypes) {
        try {
          deleted[doctype] = await deleteLinkedRows(doctype, user.name);
        } catch (e) {
          // Schemas differ across deployments. Do not claim successful erasure
          // if a real deletion error occurs.
          if (e.status !== 404) throw e;
          deleted[doctype] = 0;
        }
      }
      await erpDelete(DOCTYPE.MOBILE_APP_USER, user.name);
      deleted[DOCTYPE.MOBILE_APP_USER] = 1;
    }

    await deleteSupabaseUser(uid);
    return res.json({ success: true, data: { deleted } });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
