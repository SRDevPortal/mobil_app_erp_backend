const express = require("express");

const { getUserContextForApi } = require("../services/userService");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const data = await getUserContextForApi(req.query || {});
    if (!data?.user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
