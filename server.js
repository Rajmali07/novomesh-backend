// -------------------- IMPORTS --------------------
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const nodemailer = require("nodemailer");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const supabase = require("./config/supabaseClient");
const jwt = require("jsonwebtoken");

// -------------------- INITIAL SETUP --------------------
const app = express();
const PORT = process.env.PORT || 5000;

console.log("SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅ Loaded" : "❌ MISSING");
console.log("MAILTRAP CONFIG:", process.env.MAIL_HOST, process.env.MAIL_USER ? "✅ Loaded" : "❌ Missing");
app.use(cors({
  origin: true,
  methods: ["GET","POST","PUT","DELETE"],
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, "frontend")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/test-mail", async (req, res) => {
  try {
    await sendMail("test@mailtrap.io", "✅ Mailtrap Test", "<h3>Hello! Mailtrap works 🎉</h3>");
    res.status(200).send("✅ Test email sent! Check Mailtrap inbox.");
  } catch (err) {
    res.status(500).send("❌ Error: " + err.message);
  }
});


// -------------------- HELPERS --------------------
const hashPassword = async (pwd) => await bcrypt.hash(pwd, 10);
const comparePassword = async (pwd, hash) => await bcrypt.compare(pwd, hash);
const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));
const getExpiryMinutes = (mins = 10) =>
  new Date(Date.now() + mins * 60 * 1000).toISOString();

const sendMail = async (to, subject, html) => {
  try {

    const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT),
  secure: false,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      }
    });

    const info = await transporter.sendMail({
      from: '"Swach Raipur" <no-reply@swachraipur.com>',
      to,
      subject,
      html
    });

    console.log("📨 Email sent:", info.messageId);

    return true;

  } catch (error) {

    console.error("❌ Email sending failed:", error.message);

    throw new Error("Email service temporarily unavailable");
  }
};

const respond = (res, code, msg, data = null) => res.status(code).json(data ? { message: msg, ...data } : { message: msg });

// -------------------- MULTER SETUP --------------------
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const verifyAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return respond(res, 401, "No token provided");

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret");
    if (decoded.role !== "admin") return respond(res, 403, "Access denied");
    req.user = decoded;
    next();
  } catch (err) {
    respond(res, 401, "Invalid or expired token");
  }
};

// 🟢 Get all drivers (for admin)
app.get("/api/admin/drivers", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, username, email, phone, zone, vehicle, status, role")
      .eq("role", "driver");

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching drivers:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🟢 Create a new driver (for admin)
app.post("/api/drivers", async (req, res) => {
  try {
    const { username, email, password, phone, zone, vehicle } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("users")
      .insert([
{
  username,
  email,
  password: hashedPassword,
  phone,
  zone,
  vehicle,
  role: "driver",
  status: "Active"
}
])
      .select();

    if (error) throw error;

    res.status(201).json({
      message: "Driver created successfully",
      driver: data[0]
    });

  } catch (err) {
    console.error("❌ Error creating driver:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update driver details (for admin)
app.put("/api/drivers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, phone, zone, vehicle, password } = req.body;

    const updateData = {
      username,
      email,
      phone,
      zone,
      vehicle
    };

    if (password && password.trim().length >= 6) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const { data, error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", id)
      .eq("role", "driver")
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: "Driver updated successfully",
      driver: data
    });
  } catch (err) {
    console.error("❌ Error updating driver:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Terminate driver (soft delete via status)
app.delete("/api/drivers/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("users")
      .update({ status: "Terminated" })
      .eq("id", id)
      .eq("role", "driver")
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: "Driver terminated successfully",
      driver: data
    });
  } catch (err) {
    console.error("❌ Error terminating driver:", err.message);
    res.status(500).json({ error: err.message });
  }
});


app.get("/api/admin/complaints", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("civic_reports")
      .select("*, zone");

    if (error) {
      console.error("❌ Supabase fetch error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    // Optional: log a summary
    const zoneSummary = data.reduce((acc, r) => {
      acc[r.zone] = (acc[r.zone] || 0) + 1;
      return acc;
    }, {});
    console.log("📊 Complaints per zone:", zoneSummary);

    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching complaints:", err.message);
    res.status(500).json({ error: err.message || "Server error" });
  }
});


// -------------------- BASIC ROUTE --------------------
app.get("/", (_, res) => res.send("🚀 Novmesh Backend is running!"));

// -------------------- GET REPORTS BY USER EMAIL --------------------
app.get("/api/v1/civic_reports/:email", async (req, res) => {
  try {
    const { email } = req.params;

    const { data, error } = await supabase
      .from("civic_reports")
      .select("*")
      .eq("email", email)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      reports: data
    });

  } catch (err) {
    console.error("❌ Error fetching civic reports:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- ROUTES --------------------
app.use("/api/v1/citizens", require("./routes/citizenRoutes"));
app.use("/api/v1/civic_reports", require("./routes/reportRoutes"));

// -------------------- AUTH: SIGNUP --------------------
app.post("/auth/signup", async (req, res) => {
  try {
    const { email, username, password, role = "citizen" } = req.body;
    if (!email || !username || !password)
      return respond(res, 400, "All fields are required");

    const { data: existing } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();
    if (existing) return respond(res, 400, "User already exists");

    const hashed = await hashPassword(password);
    const { error } = await supabase
      .from("users")
      .insert([{ email, username, password: hashed, role }]);
    if (error) throw error;

    // 🟢 Send welcome email via Mailtrap
    try {
  await sendMail(
    email,
    "🎉 Welcome to Clean City Portal!",
    `<h2>Hello ${username || "Citizen"}!</h2>
    <p>Thank you for registering at Clean City Portal.</p>`
  );
} catch (err) {
  console.log("⚠️ Email failed but signup continues:", err.message);
}

    respond(res, 201, "Account created successfully!");
  } catch (err) {
    console.error("Signup error:", err);
    respond(res, 500, "Server error during signup");
  }
});

// -------------------- AUTH: LOGIN --------------------
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return respond(res, 400, "Email and password required");

    const { data: user, error } = await supabase.from("users").select("*").eq("email", email).single();
    if (error || !user) return respond(res, 404, "User not found");

    if (!(await comparePassword(password, user.password))) return respond(res, 401, "Invalid credentials");

    respond(res, 200, "Login successful!", { user: { id: user.id, email, username: user.username, role: user.role } });
  } catch {
    respond(res, 500, "Server error during login");
  }
});

app.get("/api/admin/feedback", async (req, res) => {
  try {

    const { data, error } = await supabase
      .from("feedback_messages")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);

  } catch (err) {
    console.error("Feedback fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- CONTACT FEEDBACK ----------------

app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    const { data, error } = await supabase
      .from("feedback_messages")
      .insert([
        {
          name,
          email,
          subject,
          message,
          status: "Unread"
        }
      ])
      .select();

    if (error) throw error;

    res.json({
      message: "Message sent successfully",
      feedback: data[0]
    });

  } catch (err) {
    console.error("Contact Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- AUTH: FORGOT PASSWORD --------------------
app.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return respond(res, 400, "Email required");

    // Check if user exists
    const { data: user, error } = await supabase.from("users").select("*").eq("email", email).single();
    if (error || !user) return respond(res, 404, "No user found with this email");

    // Generate reset token (you can later verify it)
    const token = jwt.sign({ email }, process.env.JWT_SECRET || "fallback_secret", { expiresIn: "15m" });
    const resetLink = `https://gilded-banoffee-8eaa77.netlify.app/citizen_reset_password.html?token=${token}`;

    // Send reset email
    await sendMail(
      email,
      "🔑 Reset your Clean City Password",
      `<h2>Hello, ${user.username || "Citizen"}</h2>
      <p>Click the link below to reset your password:</p>
      <p><a href="${resetLink}" style="background:#28a745;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;">Reset Password</a></p>
      <p>This link expires in 15 minutes.</p>`
    );

    respond(res, 200, "Password reset link sent successfully!");
  } catch (err) {
    console.error("Forgot password error:", err);
    respond(res, 500, "Error sending reset link");
  }
});

// -------------------- GET CITIZEN PROFILE --------------------
app.get("/api/v1/citizen/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const { data, error } = await supabase.from("users").select("*").eq("email", email).single();
    if (error || !data) return respond(res, 404, "Citizen not found");
    res.json({ user: data });
  } catch {
    respond(res, 500, "Server error fetching citizen");
  }
});

app.put("/api/citizen/update", async (req, res) => {
  try {
    const { id, username, phone, address, photo_url } = req.body;

    if (!id) {
      return res.status(400).json({ error: "Citizen id is required" });
    }

    const updateData = {
      username,
      phone,
      address
    };

    if (photo_url) {
      updateData.photo_url = photo_url;
    }

    const { data, error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", id)
      .eq("role", "citizen")
      .select("*");

    if (error) throw error;

    res.json({
      message: "Citizen profile updated successfully",
      data
    });
  } catch (err) {
    console.error("Citizen update error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- OTP AUTH --------------------
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: "Too many OTP requests, please try again later." } });

app.post("/auth/send-otp", otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return respond(res, 400, "Email required");

    // 🧹 Delete old unused OTPs for this email
    await supabase
  .from("email_otps")
  .delete()
  .eq("email", email);

    const otp = generateOtp();
    const hashedOtp = await hashPassword(otp);
    const expires_at = getExpiryMinutes();

    const { error } = await supabase.from("email_otps").insert([
      { email, otp: hashedOtp, expires_at, used: false }
    ]);
    if (error) throw error;

    await sendMail(
      email,
      "Your Novmesh OTP Code",
      `<p>Your OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`
    );

    respond(res, 200, "OTP sent successfully");
  } catch (err) {
    console.error("Send OTP error:", err.message);
    respond(res, 500, err.message);
  }
});

app.post("/auth/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return respond(res, 400, "Email and OTP required");

    // 🟢 Fetch latest OTP for the email
    const { data, error } = await supabase
      .from("email_otps")
      .select("*")
      .eq("email", email)
      .order("id", { ascending: false })
.limit(1);

    if (error || !data.length) return respond(res, 400, "No active OTP found");

    const record = data[0];

    // 🕒 Check expiry (10 minutes)
    const now = new Date().getTime();
const expiry = Date.parse(record.expires_at);

console.log("Server Time:", new Date(now));
console.log("OTP Expiry Time:", new Date(expiry));

if (now > expiry) {
  return respond(res, 400, "OTP expired");
}

    // 🚫 Check if already used
    if (record.used) return respond(res, 400, "OTP already used");

    // 🔐 Compare OTP using bcrypt
    const isValid = await bcrypt.compare(otp, record.otp);
    if (!isValid) return respond(res, 400, "Invalid OTP");

    // ✅ Delete OTP record after successful verification (prevents "already used" errors)
    await supabase.from("email_otps").update({ used: true }).eq("id", record.id)

    respond(res, 200, "OTP verified successfully");
  } catch (err) {
    console.error("OTP Verify Error:", err);
    respond(res, 500, "Server error verifying OTP");
  }
});


// -------------------- CHANGE PASSWORD -------------------
app.put("/api/v1/citizen/password", async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body;
    if (!email || !currentPassword || !newPassword) return respond(res, 400, "Missing fields");

    const { data: user, error } = await supabase.from("users").select("*").eq("email", email).single();
    if (error || !user) return respond(res, 404, "User not found");

    if (!(await comparePassword(currentPassword, user.password))) return respond(res, 401, "Current password incorrect");

    const hashed = await hashPassword(newPassword);
    const { error: updateErr } = await supabase.from("users").update({ password: hashed }).eq("email", email);
    if (updateErr) throw updateErr;

    respond(res, 200, "Password updated successfully!");
  } catch {
    respond(res, 500, "Server error updating password");
  }
});

// 🗺️ Simple location → zone mapping
const getZoneByLocation = (location) => {
  location = location.toLowerCase();

  // Define your known areas for each zone
  const zones = {
    "Zone 1": ["pandri", "sadar bazar", "mahadev ghat", "lakhe nagar"],
    "Zone 2": ["telibandha", "civil lines", "vip road"],
    "Zone 3": ["mowa", "shankar nagar", "amalidih"],
    "Zone 4": ["devendra nagar", "ge road", "tatibandh"],
    "Zone 5": ["raipura", "choubey colony", "gudiyari"],
    "Zone 6": ["mana", "kamal vihar", "hirapur"],
  };

  for (const [zone, areas] of Object.entries(zones)) {
    if (areas.some(area => location.includes(area))) {
      return zone;
    }
  }

  return "Unassigned"; // default if not matched
};

// -------------------- CIVIC REPORTS --------------------
app.post("/api/v1/reports/civic", upload.single("photo"), async (req, res) => {
  try {
    const { issue_type, location, description, email } = req.body;
    if (!issue_type || !location || !description || !email)
      return respond(res, 400, "All required fields must be filled");

    // 🧠 Automatically assign zone based on location keywords
    const zone = getZoneByLocation(location);
    console.log(`📍 Location: ${location} → Zone: ${zone}`);

    let photo_url = null;

    if (req.file) {
  // 🧼 Clean filename for Supabase upload
  const cleanName = req.file.originalname
    .normalize("NFD")                  // Fix special encoding like â, å, etc.
    .replace(/\s+/g, "_")              // Replace spaces with underscores
    .replace(/[^\w.-]/g, "");          // Remove all invalid characters

  const fileName = `photo_${Date.now()}_${cleanName}`;
  console.log("🧾 Cleaned filename:", fileName);

  const { error: uploadError } = await supabase.storage
    .from("civic_reports")
    .upload(fileName, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true,
    });

  if (uploadError) throw uploadError;

  photo_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/civic_reports/${fileName}`;
}

    const complaintId = "C-" + Math.floor(1000 + Math.random() * 9000);

    const { data, error } = await supabase
      .from("civic_reports")
      .insert([
        {
          complaint_id: complaintId,
          issue_type,
          location,
          description,
          photo_url,
          status: "pending",
          email,
          zone, // ✅ Always store zone
          assigned_driver: null,
          driver_photo_url: null,
        },
      ])
      .select();

    if (error) throw error;

    console.log(`✅ Civic issue inserted: ${complaintId} → Zone ${zone}`);

    await sendMail(
      email,
      "🗳️ Civic Issue Report Submitted - Clean City",
      `<h2>Hello Citizen,</h2>
      <p>Your complaint <strong>${complaintId}</strong> has been registered under <b>${zone}</b>.</p>
      <p><strong>Issue Type:</strong> ${issue_type}</p>
      <p><strong>Location:</strong> ${location}</p>
      <p><strong>Description:</strong> ${description}</p>`
    );

    respond(res, 201, "Report submitted successfully!", {
      complaintId,
      zone,
      report: data[0],
    });
  } catch (err) {
    console.error("❌ Error creating civic report:", err.message);
    respond(res, 500, err.message || "Error submitting report");
  }
});
// -------------------- ADMIN COMPLAINT ACTIONS --------------------

// 🟡 Examine: Fetch a single complaint by complaint_id
app.get("/api/admin/complaint/:complaint_id", async (req, res) => {
  try {
    const { complaint_id } = req.params;
    const { data, error } = await supabase
      .from("civic_reports")
      .select("*")
      .eq("complaint_id", complaint_id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Complaint not found" });
    }

    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching complaint:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- COMPLAINTS --------------------
app.post("/complaints", async (req, res) => {
  try {
    const { title, description, user_email, image_url } = req.body;
    const { data, error } = await supabase.from("complaints").insert([{ title, description, user_email, image_url, status: "pending" }]).select();
    if (error) throw error;

    await sendMail(user_email, "🗑️ Complaint Submitted Successfully", `<h2>Thank you for reporting!</h2><p><strong>Title:</strong> ${title}</p><p>Status: Pending</p>`);
    respond(res, 201, "Complaint submitted successfully!", { complaint: data[0] });
  } catch (err) {
    respond(res, 500, err.message);
  }
});

app.get("/complaints/user/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const { data, error } = await supabase.from("complaints").select("*").ilike("user_email", email);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    respond(res, 500, err.message);
  }
});

app.put("/complaints/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { data, error } = await supabase.from("complaints").update({ status }).eq("id", id).select("*");
    if (error) throw error;
    respond(res, 200, "Status updated!", { complaint: data[0] });
  } catch (err) {
    respond(res, 500, err.message);
  }
});

// -------------------- DRIVER TASK ROUTES --------------------

// Fetch driver profile for the logged-in driver
app.get("/api/v1/driver/profile", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "fallback_secret"
    );

    const { data, error } = await supabase
      .from("users")
      .select("id, username, email, phone, zone, vehicle, created_at, status, role")
      .eq("id", decoded.id)
      .eq("role", "driver")
      .single();

    if (error || !data) {
      return res.status(404).json({ message: "Driver not found" });
    }

    res.json({ driver: data });
  } catch (err) {
    console.error("Error fetching driver profile:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update driver profile for the logged-in driver
app.put("/api/v1/driver/profile", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "fallback_secret"
    );

    const { username, phone } = req.body;

    const updateData = {};

    if (username) updateData.username = username;
    if (phone) updateData.phone = phone;

    const { data, error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", decoded.id)
      .eq("role", "driver")
      .select("id, username, email, phone, zone, vehicle, created_at, status, role")
      .single();

    if (error || !data) {
      return res.status(404).json({ message: "Driver not found" });
    }

    res.json({
      message: "Profile updated successfully",
      driver: data
    });
  } catch (err) {
    console.error("Error updating driver profile:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Change password for the logged-in driver
app.put("/api/v1/driver/password", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "fallback_secret"
    );

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current password and new password are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters long" });
    }

    const { data: driver, error: fetchError } = await supabase
      .from("users")
      .select("id, password, role")
      .eq("id", decoded.id)
      .eq("role", "driver")
      .single();

    if (fetchError || !driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    const valid = await comparePassword(currentPassword, driver.password);

    if (!valid) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    const hashed = await hashPassword(newPassword);

    const { error: updateError } = await supabase
      .from("users")
      .update({ password: hashed })
      .eq("id", decoded.id)
      .eq("role", "driver");

    if (updateError) throw updateError;

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Error updating driver password:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🟢 Fetch all assigned tasks for a driver
app.get("/api/v1/driver/tasks", async (req, res) => {
  try {

    const authHeader = req.headers.authorization;
    const requestedDriverId = req.query.driver_id;
    const requestedZone = req.query.zone;

    if (!authHeader) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "fallback_secret"
    );

    const driverId = decoded.id;

    console.log("Driver ID from token:", driverId);
    console.log("Driver ID from query:", requestedDriverId || "none");
    console.log("Driver zone from query:", requestedZone || "none");

    const { data: driverProfile, error: driverProfileError } = await supabase
      .from("users")
      .select("id, zone")
      .eq("id", driverId)
      .maybeSingle();

    if (driverProfileError) throw driverProfileError;

    const taskColumns =
      "id, complaint_id, issue_type, location, status, photo_url, driver_photo_url, zone, assigned_driver, created_at";

    const { data: assignedTasks, error } = await supabase
      .from("civic_reports")
      .select(taskColumns)
      .eq("assigned_driver", driverId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    let tasks = assignedTasks || [];

    if (!tasks.length && requestedDriverId && requestedDriverId !== driverId) {
      const { data: requestedDriverTasks, error: requestedDriverError } = await supabase
        .from("civic_reports")
        .select(taskColumns)
        .eq("assigned_driver", requestedDriverId)
        .order("created_at", { ascending: false });

      if (requestedDriverError) throw requestedDriverError;

      tasks = requestedDriverTasks || [];
      console.log(`No token driver match. Falling back to requested driver ${requestedDriverId}.`);
    }

    const fallbackZone = requestedZone || driverProfile?.zone;

    if (!tasks.length && fallbackZone) {
      const { data: zoneTasks, error: zoneError } = await supabase
        .from("civic_reports")
        .select(taskColumns)
        .eq("zone", fallbackZone)
        .in("status", ["Assigned", "Completed", "Verified"])
        .order("created_at", { ascending: false });

      if (zoneError) throw zoneError;

      tasks = zoneTasks || [];
      console.log(`No exact assigned_driver match. Falling back to zone ${fallbackZone}.`);
    }

    console.log("Tasks fetched:", tasks);

    res.json(tasks);

  } catch (err) {

    console.error("❌ Error fetching driver tasks:", err.message);

    res.status(500).json({
      error: err.message
    });

  }
});

// 🟢 Verify (complete) a driver task with photo
app.post("/api/v1/driver/tasks/:id/verify", upload.single("photo"), async (req, res) => {
  try {
    const { id } = req.params;

    let photo_url = null;
    if (req.file) {
      const cleanName = req.file.originalname.replace(/\s+/g, "_");
      const fileName = `verified_${Date.now()}_${cleanName}`;

      const { error: uploadError } = await supabase.storage
        .from("civic_reports")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });

      if (uploadError) throw uploadError;

      photo_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/civic_reports/${fileName}`;
    }

    // ✅ Mark task as completed
    const { data, error } = await supabase
  .from("civic_reports")
  .update({
  status: "Completed",
  driver_photo_url: photo_url
})
  .eq("id", id)
  .select("*");

    if (error) throw error;

    res.json({ message: "Task verified successfully!", task: data[0] });
  } catch (err) {
    console.error("❌ Verify Task Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// -------------------- DRIVER / ADMIN LOGIN --------------------
async function roleLogin(req, res, roleName) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return respond(res, 400, "Email & Password required");

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .eq("role", roleName)
      .single();

    if (error || !user) return respond(res, 401, `${roleName} not found`);

    const valid = await comparePassword(password, user.password);
    if (!valid) return respond(res, 401, "Incorrect password");

    // ✅ Create a token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "1d" }
    );

    // ✅ Respond with token and user info
    res.status(200).json({
      message: `${roleName} Login Successful`,
      token,
      user: {
  id: user.id,
  username: user.username,
  email: user.email,
  role: user.role,
  zone: user.zone,
  vehicle: user.vehicle
}
    });
  } catch (err) {
    console.error(`${roleName} Login Error:`, err);
    respond(res, 500, `Server error during ${roleName} login`);
  }
}

// -------------------- ADMIN ASSIGN COMPLAINT --------------------
app.put("/api/admin/complaint/:complaint_id/assign", async (req, res) => {
  try {
    const { complaint_id } = req.params;
    const { zone, assigned_driver } = req.body;

    // ✅ Update status to "Assigned" (driver can be assigned later)
    const { data, error } = await supabase
      .from("civic_reports")
      .update({ status: "Assigned", zone, assigned_driver: assigned_driver || null })
      .eq("complaint_id", complaint_id)
      .select("*");

    if (error) throw error;
    res.json({ message: "Complaint assigned successfully", complaint: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/blogs", verifyAdmin, upload.single("image"), async (req, res) => {
console.log("FILE RECEIVED:", req.file);
  try {

    const { title, category, content, link, status } = req.body;

    let image_url = null;

    if (req.file) {

      const cleanName = req.file.originalname
        .replace(/\s+/g, "_")
        .replace(/[^\w.-]/g, "");

      const fileName = `blog_${Date.now()}_${cleanName}`;

      console.log("Uploading file:", fileName);

      const { error: uploadError } = await supabase.storage
        .from("blogs")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true
        });

      if (uploadError) {
        console.error("SUPABASE UPLOAD ERROR:", uploadError);
        throw uploadError;
      }

      image_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/blogs/${fileName}`;
    }

    const { data, error } = await supabase
      .from("blogs")
      .insert([
        {
          title,
          category,
          content,
          external_link: link,
          status,
          image_url
        }
      ])
      .select();

    if (error) throw error;

    res.json({
      message: "Blog saved successfully",
      blog: data[0]
    });

  } catch (err) {

    console.error("BLOG INSERT ERROR:", err.message);

    res.status(500).json({
      error: err.message
    });

  }
});

app.get("/api/blogs", async (req, res) => {
  try {

    const { data, error } = await supabase
      .from("blogs")
      .select("*")
      .eq("status", "Published")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);

  } catch (err) {

    console.error("BLOG FETCH ERROR:", err.message);

    res.status(500).json({
      error: err.message
    });

  }
});

// -------------------- ADMIN REJECT COMPLAINT --------------------
app.delete("/api/admin/complaint/:complaint_id", async (req, res) => {
  try {
    const { complaint_id } = req.params;
    const { data, error } = await supabase
      .from("civic_reports")
      .update({ status: "Rejected" })
      .eq("complaint_id", complaint_id)
      .select("*");

    if (error) throw error;
    res.json({ message: "Complaint rejected successfully", complaint: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/feedback/:id/review", async (req, res) => {
  try {

    const { id } = req.params;

    const { data, error } = await supabase
      .from("feedback_messages")
      .update({ status: "Reviewed" })
      .eq("id", id)
      .select("*");

    if (error) throw error;

    res.json({
      message: "Feedback marked as reviewed",
      feedback: data[0]
    });

  } catch (err) {
    console.error("Review feedback error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- ADMIN VERIFY COMPLAINT --------------------
app.put("/api/admin/complaint/:complaint_id/verify", async (req, res) => {
  try {

    const { complaint_id } = req.params;

    const { data, error } = await supabase
      .from("civic_reports")
      .update({ status: "Verified" })
      .eq("complaint_id", complaint_id)
      .select("*");

    if (error) throw error;

    res.json({
      message: "Complaint verified successfully",
      complaint: data[0]
    });

  } catch (err) {
    console.error("❌ Verify Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/complaint/:complaint_id/reject-verification", async (req, res) => {
  try {
    const { complaint_id } = req.params;
    const { reason = "" } = req.body || {};

    const { data, error } = await supabase
      .from("civic_reports")
      .update({
        status: "Assigned",
        driver_photo_url: null,
        admin_review_comment: reason || null,
      })
      .eq("complaint_id", complaint_id)
      .select("*");

    if (error) throw error;

    res.json({
      message: "Driver submission rejected and task moved back to ongoing",
      complaint: data[0]
    });
  } catch (err) {
    console.error("❌ Reject Verification Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/complaint/:complaint_id/abandon", async (req, res) => {
  try {
    const { complaint_id } = req.params;

    const { data, error } = await supabase
      .from("civic_reports")
      .update({ status: "Abandoned" })
      .eq("complaint_id", complaint_id)
      .select("*");

    if (error) throw error;

    res.json({
      message: "Task abandoned successfully",
      complaint: data[0]
    });
  } catch (err) {
    console.error("❌ Abandon Task Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
app.put("/api/admin/blogs/:id", verifyAdmin, upload.single("image"), async (req, res) => {

  try {

    const { id } = req.params;
    const { title, category, content, link, status } = req.body;

    let image_url = null;

    if (req.file) {

      const cleanName = req.file.originalname
        .replace(/\s+/g, "_")
        .replace(/[^\w.-]/g, "");

      const fileName = `blog_${Date.now()}_${cleanName}`;

      const { error: uploadError } = await supabase.storage
        .from("blogs")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true
        });

      if (uploadError) throw uploadError;

      image_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/blogs/${fileName}`;
    }

    const updateData = {
      title,
      category,
      content,
      external_link: link,
      status
    };

    if (image_url) {
      updateData.image_url = image_url;
    }

    const { error } = await supabase
      .from("blogs")
      .update(updateData)
      .eq("id", id);

    if (error) throw error;

    res.json({ message: "Blog updated successfully" });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "Failed to update blog" });

  }

});
app.get("/api/admin/blogs", verifyAdmin, async (req, res) => {

  try {

    const { data, error } = await supabase
      .from("blogs")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);

  } catch (err) {

    console.error("ADMIN BLOG FETCH ERROR:", err.message);

    res.status(500).json({
      error: err.message
    });

  }

});

app.delete("/api/admin/blogs/:id", verifyAdmin, async (req, res) => {

  try {

    const { id } = req.params;

    const { error } = await supabase
      .from("blogs")
      .delete()
      .eq("id", id);

    if (error) throw error;

    res.json({ message: "Blog deleted successfully" });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "Failed to delete blog" });

  }

});

app.post("/driver-login", (req, res) => roleLogin(req, res, "driver"));
app.post("/admin-login", (req, res) => roleLogin(req, res, "admin"));

// -------------------- SERVER --------------------
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
