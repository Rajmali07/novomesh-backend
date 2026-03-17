const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcrypt");
const dotenv = require("dotenv");

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const getCitizenByEmail = async (req, res) => {
  const { email } = req.params;

  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !data)
      return res.status(404).json({ message: "Citizen not found" });

    res.status(200).json({ user: data });
  } catch (err) {
    console.error("❌ Fetch citizen error:", err);
    res.status(500).json({ message: "Server error fetching profile" });
  }
};

const updateCitizenProfile = async (req, res) => {
  try {
    const { id, full_name, phone, address } = req.body;

    if (!id) return res.status(400).json({ message: "Missing citizen ID" });

    const { data, error } = await supabase
      .from("users")
      .update({ full_name, phone, address, updated_at: new Date() })
      .eq("id", id)
      .select();

    if (error) throw error;

    res.status(200).json({ message: "Profile updated successfully", data });
  } catch (err) {
    console.error("❌ Profile update error:", err);
    res.status(500).json({ message: "Error updating profile" });
  }
};

const changeCitizenPassword = async (req, res) => {
  const { email, currentPassword, newPassword } = req.body;

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("password")
      .eq("email", email)
      .single();

    if (error || !user)
      return res.status(404).json({ message: "Citizen not found" });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid)
      return res.status(400).json({ message: "Current password incorrect" });

    const hashed = await bcrypt.hash(newPassword, 10);

    await supabase
      .from("users")
      .update({ password: hashed })
      .eq("email", email);

    res.status(200).json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("❌ Password change error:", err);
    res.status(500).json({ message: "Error updating password" });
  }
};

module.exports = {
  getCitizenByEmail,
  updateCitizenProfile,
  changeCitizenPassword,
};
