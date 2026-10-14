const express = require("express");

const { getUserContextForApi } = require("../services/userService");

const router = express.Router();

const { buildStartupDecision } = require("../services/startupDecision");

router.get("/", async (req, res) => {
  try {
    const data = await getUserContextForApi(req.query || {});
    if (!data?.user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        data: {
          should_open: "login",
          profile_complete: false,
          force_profile_setup: false,
          selected_disease: "",
        },
      });
    }

    const decision = buildStartupDecision(data);
    return res.json({
      success: true,
      data: {
        ...data,
        ...decision,
      },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
