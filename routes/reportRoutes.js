const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient");

// ✅ Fetch reports by email
router.get("/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const { data, error } = await supabase
      .from("civic_reports")
      .select(`
        complaint_id,
        issue_type,
        location,
        status,
        created_at,
        photo_url,
        driver_photo_url
      `)
      .eq("email", email)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({ reports: data });
  } catch (err) {
    console.error("❌ Error fetching reports:", err.message || err);
    res.status(500).json({ message: "Server error fetching reports" });
  }
});

module.exports = router;
