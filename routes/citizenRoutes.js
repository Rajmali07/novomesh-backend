const express = require("express");
const router = express.Router();
const supabase = require("../config/supabaseClient"); // ✅ shared client

// Example route: get all citizens
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("role", "citizen");

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

module.exports = router; // ✅ export router
