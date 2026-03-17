const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

transporter.verify((error, success) => {
  if (error) {
    console.error("❌ Mailtrap connection error:", error);
  } else {
    console.log("✅ Mailtrap SMTP server is ready to send emails!");
  }
});

console.log(
  "Loaded ENV:",
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY ? "KEY OK" : "KEY MISSING"
);

const app = express();
app.use(cors());
app.use(express.json());
// import citizenRoutes from "./routes/citizenRoutes.js";
app.use("/api", citizenRoutes);

// Connect to Supabase using environment variables
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: {
      persistSession: false,
    },
  }
);

// Basic test route
app.get("/", (req, res) => {
  res.send("Novmesh backend is running 🚀");
});

app.get("/test-supabase", async (req, res) => {
  try {
    const { data, error } = await supabase.from("test").select("*");
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch all projects
app.get("/projects", async (req, res) => {
  try {
    const { data, error } = await supabase.from("projects").select("*");
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/// Add a new project and send notification email
app.post("/projects", async (req, res) => {
  try {
    const { title, description, email } = req.body;

    // 1️⃣ Add project to Supabase
    const { data, error } = await supabase
      .from("projects")
      .insert([{ title, description }])
      .select();
    if (error) throw error;

    // 2️⃣ Send email notification using Mailtrap
    await transporter.sendMail({
      from: '"Novmesh Projects" <no-reply@novmesh.com>',
      to: email || "admin@novmesh.com", // Fallback if user email not provided
      subject: "✅ Project Created Successfully!",
      html: `
        <h2>New Project Created</h2>
        <p><strong>Title:</strong> ${title}</p>
        <p><strong>Description:</strong> ${description}</p>
        <p>Your project has been added successfully 🚀</p>
      `,
    });

    // 3️⃣ Respond to the client
    res.status(201).json({ message: "Project added and email sent!", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single project by ID
app.get("/projects/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a project by ID
app.put("/projects/:id", async (req, res) => {
  const { id } = req.params;
  const { title, description } = req.body;
  try {
    const { data, error } = await supabase
      .from("projects")
      .update({ title, description })
      .eq("id", id)
      .select();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a project by ID
app.delete("/projects/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) throw error;
    res.json({ message: `Project ${id} deleted successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/auth/signup", async (req, res) => {
  try {
    const { email, username, password, role } = req.body;
    if (!email || !username || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check if user exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Insert user
    const { data, error } = await supabase
      .from("users")
      .insert([{ email, username, password, role }])
      .select();

    if (error) throw error;

    // ✅ Send welcome email
    await transporter.sendMail({
      from: '"Clean City Portal" <no-reply@cleancity.com>',
      to: email,
      subject: "Welcome to Clean City Portal 🌱",
      text: `Hello ${username}, welcome to Clean City! You can now log in and manage your complaints.`,
      html: `<h2>Welcome, ${username}!</h2>
             <p>Thank you for registering with <b>Clean City</b>. You can now log in and start managing your waste complaints.</p>`,
    });

    res.status(201).json({
      message:
        "Citizen registered successfully! A confirmation email has been sent.",
      user: data[0],
    });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ message: "Server error during signup" });
  }
});

// --------------------- LOGIN ENDPOINT ---------------------
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .eq("password", password)
      .single();

    if (error || !user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // ✅ Return user details (don’t return password)
    res.status(200).json({
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        address: user.address,
        citizen_id: user.citizen_id,
        points: user.points || 0,
        valid_id: user.valid_id,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// app.post("/auth/signup", async (req, res) => {
//   const { email, password } = req.body;

//   try {
//     // 1️⃣ Create a new user in Supabase Auth
//     const { data, error } = await supabase.auth.signUp({ email, password });
//     if (error) throw error;

//     // 2️⃣ Send a welcome email via Mailtrap
//     await transporter.sendMail({
//       from: '"Novmesh Team" <no-reply@novmesh.com>',
//       to: email,
//       subject: "🎉 Welcome to Novmesh!",
//       text: `Hi ${email}, welcome to the Novmesh community! 🚀`,
//       html: `
//         <h2>Welcome to Novmesh!</h2>
//         <p>Hi <b>${email}</b>, we're excited to have you on board. 🎉</p>
//         <p>You can now log in and start using your account.</p>
//         <br>
//         <p>— The Novmesh Team</p>
//       `
//     });

//     // 3️⃣ Respond to the client
//     res.json({ message: "Signup successful! Welcome email sent.", data });
//   } catch (err) {
//     res.status(400).json({ error: err.message });
//   }
// });

// Log in an existing user
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res
        .status(400)
        .json({ message: "Email and password are required" });

    // 1️⃣ Find user
    const { data: user, error: findError } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (findError || !user)
      return res.status(400).json({ message: "User not found" });

    // 2️⃣ Validate password (plain match — upgrade to bcrypt later)
    if (user.password !== password)
      return res.status(400).json({ message: "Invalid credentials" });

    // 3️⃣ Return success
    res.status(200).json({
      message: "Login successful!",
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

// Get the current user session (optional)
app.get("/auth/user", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --------------------- Civic Report Endpoint ---------------------
const civicStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const civicUpload = multer({ storage: civicStorage });

app.post(
  "/api/v1/reports/civic",
  civicUpload.single("photo"),
  async (req, res) => {
    try {
      const { issueType, location, description } = req.body;
      const photo = req.file ? req.file.filename : null;

      if (!issueType || !location || !description) {
        return res
          .status(400)
          .json({ message: "All fields except photo are required." });
      }

      const complaintId = "C-" + Math.floor(1000 + Math.random() * 9000);

      // ✅ Correct database insertion
      const { data, error } = await supabase
        .from("civic_reports")
        .insert([
          {
            complaint_id: complaintId,
            issue_type: issueType,
            location,
            description,
            photo_url: photo ? `/uploads/${photo}` : null,
            status: "Pending",
          },
        ])
        .select();

      if (error) throw error;

      // ✅ Send confirmation email via Mailtrap
      await transporter.sendMail({
        from: '"Clean City" <noreply@cleancity.com>',
        to: "biharimali2023@gmail.com",
        subject: "Civic Report Submitted",
        text: `Thank you for reporting a civic issue.\n\nComplaint ID: ${complaintId}\nIssue: ${issueType}\nLocation: ${location}`,
      });

      res.status(201).json({
        message: "Civic issue reported successfully!",
        complaintId,
        record: data[0],
      });
    } catch (err) {
      console.error("Civic report error:", err);
      res
        .status(500)
        .json({ message: "Server error during civic report submission" });
    }
  }
);

// ✉️ Test email route using Mailtrap
app.post("/send-email", async (req, res) => {
  const { to, subject, text } = req.body;

  try {
    const info = await transporter.sendMail({
      from: '"Novmesh App" <no-reply@novmesh.com>', // sender name + email
      to, // recipient email
      subject, // email subject
      text, // plain text body
      html: `<h3>${subject}</h3><p>${text}</p>`, // optional HTML version
    });

    res.json({ message: "Email sent successfully!", info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const fs = require("fs");
const upload = multer({ storage: multer.memoryStorage() }); // store in memory

// ✅ Reuse existing multer instance

// Optional: if you used memoryStorage before, create a new disk storage for complaints
const complaintStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const complaintUpload = multer({ storage: complaintStorage });

// Civic Complaint Route
app.post("/complaints", complaintUpload.single("file"), async (req, res) => {
  try {
    const { email, issue_type, location, description } = req.body;

    if (!email || !issue_type || !location || !description) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const filePath = req.file ? req.file.path : null;

    const { data, error } = await supabase
      .from("complaints")
      .insert([
        {
          email,
          issue_type,
          location,
          description,
          photo_path: filePath,
          status: "Pending",
          created_at: new Date(),
        },
      ])
      .select();

    if (error) throw error;

    res.status(201).json({
      message: "Complaint submitted successfully!",
      complaint_id: data[0].id,
    });
  } catch (err) {
    console.error("Complaint error:", err);
    res
      .status(500)
      .json({ message: "Server error while submitting complaint" });
  }
});

// 📤 Upload file to Supabase Storage
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileName = `${Date.now()}-${req.file.originalname}`;

    // Upload to Supabase Storage bucket "project-files"
    const { data, error } = await supabase.storage
      .from("project-files") // ✅ Make sure this bucket exists in Supabase!
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true, // optional: allows overwriting
      });

    if (error) throw error;

    // Get public URL
    const { data: publicUrl } = supabase.storage
      .from("project-files")
      .getPublicUrl(fileName);

    res.json({
      message: "File uploaded successfully!",
      filePath: data.path,
      publicUrl: publicUrl.publicUrl,
    });
  } catch (err) {
    console.error("❌ Upload error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 📩 Submit new complaint (citizen + admin notifications)
app.post("/complaints", async (req, res) => {
  try {
    const { title, description, user_email, image_url } = req.body;

    // 1️⃣ Add complaint to Supabase
    const { data, error } = await supabase
      .from("complaints")
      .insert([
        { title, description, user_email, image_url, status: "Pending" },
      ])
      .select("*");

    if (error) throw error;

    const complaint = data[0];

    // 2️⃣ Send confirmation email to citizen
    await transporter.sendMail({
      from: '"Waste Management" <no-reply@novmesh.com>',
      to: user_email,
      subject: "🗑️ Complaint Submitted Successfully",
      html: `
        <h2>Thank you for reporting the issue!</h2>
        <p><strong>Title:</strong> ${title}</p>
        <p><strong>Description:</strong> ${description}</p>
        <p>Status: <b>${complaint.status}</b></p>
        <br/>
        <p>We’ll notify you when it’s resolved. ♻️</p>
      `,
    });

    // 3️⃣ Send notification email to Admin
    await transporter.sendMail({
      from: '"Waste Management" <no-reply@novmesh.com>',
      to: "admin@novmesh.com", // ✅ Change this to your admin email
      subject: "🚨 New Waste Complaint Submitted",
      html: `
        <h2>New Complaint Received</h2>
        <p><strong>Title:</strong> ${title}</p>
        <p><strong>Description:</strong> ${description}</p>
        <p><strong>Citizen:</strong> ${user_email}</p>
        <p><strong>Status:</strong> Pending</p>
        ${image_url ? `<img src="${image_url}" width="300"/>` : ""}
        <br><br>
        <p>Check the admin dashboard for details.</p>
      `,
    });

    // 4️⃣ Respond to the client
    res.status(201).json({
      message: "Complaint submitted! Notifications sent to citizen and admin.",
      complaint,
    });
  } catch (err) {
    console.error("Complaint submission error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 📋 Get all complaints (Admin view)
app.post("/complaints", async (req, res) => {
  try {
    const {
      user_email,
      title,
      description,
      location,
      latitude,
      longitude,
      image_url,
    } = req.body;

    const { data, error } = await supabase
      .from("complaints")
      .insert([
        {
          user_email,
          title,
          description,
          location,
          latitude,
          longitude,
          image_url,
        },
      ])
      .select();

    if (error) throw error;

    res.status(201).json({ message: "Complaint submitted successfully", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 👤 Get complaints for a specific user (Citizen view)
app.get("/complaints/user/:email", async (req, res) => {
  const { email } = req.params;

  try {
    const { data, error } = await supabase
      .from("complaints")
      .select("*")
      .ilike("user_email", email); // ✅ makes it case-insensitive match

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.json({ message: "No complaints found for this user." });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Update complaint status (Admin only)
app.put("/complaints/:id/status", async (req, res) => {
  const id = req.params.id; // 👈 keep as string
  const { status } = req.body;

  try {
    const { data, error } = await supabase
      .from("complaints")
      .update({ status })
      .eq("id", id)
      .select("*");

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: "Complaint not found" });
    }

    const complaint = data[0];

    // Send email
    await transporter.sendMail({
      from: '"Waste Management" <no-reply@novmesh.com>',
      to: complaint.user_email,
      subject: `Complaint Status Updated to ${status}`,
      html: `
        <h3>Your complaint has been updated</h3>
        <p><strong>Title:</strong> ${complaint.title}</p>
        <p><strong>New Status:</strong> ${status}</p>
      `,
    });

    res.json({ message: "Status updated and email sent!", complaint });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

// 🚦 Simple rate limit (per IP): 3 requests / 15 minutes for OTP send
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { error: "Too many OTP requests, please try again later." },
});

// Helper: generate a 6-digit OTP
function generateOtp(digits = 6) {
  const max = 10 ** digits;
  const num = Math.floor(Math.random() * max);
  return String(num).padStart(digits, "0");
}

// Helper: get expiry (10 min)
function getExpiryMinutes(mins = 10) {
  return new Date(Date.now() + mins * 60 * 1000).toISOString();
}

/**
 * POST /auth/send-otp
 * Body: { "email": "user@example.com" }
 * Sends OTP email + saves hashed OTP
 */
app.post("/auth/send-otp", otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Generate OTP and hash
    const otp = generateOtp(6);
    const hashedOtp = await bcrypt.hash(otp, 10);
    const expires_at = getExpiryMinutes(10);

    // Store OTP record
    const { error: insertError } = await supabase
      .from("email_otps")
      .insert([{ email, otp: hashedOtp, expires_at }]);

    if (insertError) throw insertError;

    // Send OTP email
    await transporter.sendMail({
      from: '"Novmesh Auth" <no-reply@novmesh.com>',
      to: email,
      subject: "Your Novmesh Verification Code",
      html: `
        <h2>Verify your email</h2>
        <p>Your verification code is: <strong>${otp}</strong></p>
        <p>This code expires in 10 minutes.</p>
      `,
    });

    res.json({ message: "OTP sent successfully to email" });
  } catch (err) {
    console.error("send-otp error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /auth/verify-otp
 * Body: { "email": "user@example.com", "otp": "123456" }
 * Verifies OTP + marks as used + confirms user in Supabase
 */
app.post("/auth/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp)
      return res.status(400).json({ error: "Email and OTP are required" });

    // Fetch unused OTPs for email
    const { data, error } = await supabase
      .from("email_otps")
      .select("*")
      .eq("email", email)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    if (!data || data.length === 0)
      return res.status(400).json({ error: "No active OTP found" });

    const record = data[0];

    // Check expiry
    if (new Date(record.expires_at) < new Date())
      return res.status(400).json({ error: "OTP expired" });

    // Compare OTP
    const isValid = await bcrypt.compare(otp, record.otp);
    if (!isValid) return res.status(400).json({ error: "Invalid OTP" });

    // Mark OTP as used
    await supabase
      .from("email_otps")
      .update({ used: true })
      .eq("id", record.id);

    // ✅ Auto-confirm Supabase user email (admin API)
    // ⚠️ Requires service_role key in .env as SUPABASE_SERVICE_KEY
    const {
      createClient: createAdminClient,
    } = require("@supabase/supabase-js");
    const adminSupabase = createAdminClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: userList, error: userFindErr } =
      await adminSupabase.auth.admin.listUsers();
    if (userFindErr) console.error("User fetch error:", userFindErr);

    const user = userList.users.find((u) => u.email === email);
    if (user) {
      await adminSupabase.auth.admin.updateUserById(user.id, {
        email_confirmed_at: new Date().toISOString(),
      });
      console.log(`User ${email} marked as verified.`);
    }

    res.json({ message: "OTP verified and email confirmed successfully" });
  } catch (err) {
    console.error("verify-otp error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 📊 Generate daily report summary
app.get("/reports/daily", async (req, res) => {
  try {
    // Get today's date range
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
    const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

    // Fetch complaints created today
    const { data, error } = await supabase
      .from("complaints")
      .select("*")
      .gte("created_at", startOfDay)
      .lte("created_at", endOfDay);

    if (error) throw error;

    // Compute statistics
    const totalComplaints = data.length;
    const resolved = data.filter(
      (c) => c.status.toLowerCase() === "resolved"
    ).length;
    const pending = data.filter(
      (c) => c.status.toLowerCase() === "pending"
    ).length;

    res.json({
      date: new Date().toLocaleDateString(),
      totalComplaints,
      resolved,
      pending,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📈 General summary report (overall stats)
app.get("/reports/summary", async (req, res) => {
  try {
    const { data, error } = await supabase.from("complaints").select("*");

    if (error) throw error;

    if (!data.length) return res.json({ message: "No complaints found yet" });

    const totalComplaints = data.length;
    const resolvedComplaints = data.filter(
      (c) => c.status.toLowerCase() === "resolved"
    );
    const pendingComplaints = data.filter(
      (c) => c.status.toLowerCase() === "pending"
    );
    const resolvedCount = resolvedComplaints.length;
    const pendingCount = pendingComplaints.length;

    // 🕒 Average resolution time (in hours)
    const avgResolutionTime =
      resolvedComplaints.length > 0
        ? (
            resolvedComplaints.reduce((sum, c) => {
              const created = new Date(c.created_at);
              const updated = new Date(c.updated_at || c.created_at);
              return sum + (updated - created);
            }, 0) /
            resolvedComplaints.length /
            (1000 * 60 * 60)
          ).toFixed(2)
        : "N/A";

    res.json({
      totalComplaints,
      resolvedCount,
      pendingCount,
      avgResolutionTime:
        avgResolutionTime === "N/A" ? "N/A" : `${avgResolutionTime} hrs`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📦 File Upload Setup
// const multer = require("multer");
// const upload = multer({ storage: multer.memoryStorage() });

// 📤 Upload file and link to a complaint
app.post(
  "/upload-file/:complaint_id",
  upload.single("file"),
  async (req, res) => {
    try {
      const complaint_id = req.params.complaint_id;
      const email = req.body.email;
      const uploaded_by = req.body.uploaded_by || "citizen";

      // Validate uploaded file
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileName = `${Date.now()}-${req.file.originalname}`;

      // 1️⃣ Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("project-files")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
        });

      if (uploadError) {
        console.error("Upload Error:", uploadError.message);
        return res.status(500).json({ error: uploadError.message });
      }

      // 2️⃣ Get public file URL
      const { data: publicURLData } = supabase.storage
        .from("project-files")
        .getPublicUrl(fileName);

      const fileUrl = publicURLData.publicUrl;

      // 3️⃣ Insert metadata into files table
      const { error: insertError } = await supabase.from("files").insert([
        {
          uploader_email: email,
          complaint_id: complaint_id,
          file_url: fileUrl,
          file_type: req.file.mimetype,
          uploaded_by: uploaded_by,
        },
      ]);

      if (insertError) {
        console.error("Database Insert Error:", insertError.message);
        return res.status(500).json({ error: insertError.message });
      }

      res.status(201).json({
        message: "✅ File uploaded and linked to complaint successfully!",
        file_url: fileUrl,
      });
    } catch (err) {
      console.error("Unexpected Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// 🧾 Fetch all files linked to a specific complaint
app.get("/complaints/:id/files", async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch all files where complaint_id = id
    const { data, error } = await supabase
      .from("files")
      .select(
        "id, file_url, file_type, uploaded_by, uploader_email, uploaded_at"
      )
      .eq("complaint_id", id);

    if (error) throw error;

    res.json({
      complaint_id: id,
      total_files: data.length,
      files: data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🧍 Register a new user
app.post("/users", async (req, res) => {
  const { name, email, phone } = req.body;
  try {
    const { data, error } = await supabase
      .from("users")
      .insert([{ name, email, phone }])
      .select();

    if (error) throw error;
    res.status(201).json({ message: "User registered successfully!", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🚛 Register a new driver
app.post("/drivers", async (req, res) => {
  const { name, email, phone, area } = req.body;
  try {
    const { data, error } = await supabase
      .from("drivers")
      .insert([{ name, email, phone, area }])
      .select();

    if (error) throw error;
    res.status(201).json({ message: "Driver registered successfully!", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🧾 Assign a complaint to a driver
app.put("/complaints/:id/assign", async (req, res) => {
  const { id } = req.params;
  const { driver_id } = req.body;

  try {
    const { data, error } = await supabase
      .from("complaints")
      .update({ assigned_driver: driver_id, status: "Assigned" })
      .eq("id", id)
      .select();

    if (error) throw error;

    // 📨 Notify driver via email (optional)
    if (data && data[0]) {
      const { error: driverError, data: driverData } = await supabase
        .from("drivers")
        .select("email, name")
        .eq("id", driver_id)
        .single();

      if (!driverError && driverData?.email) {
        await transporter.sendMail({
          from: '"Waste Management" <no-reply@novmesh.com>',
          to: driverData.email,
          subject: "🧾 New Complaint Assigned",
          html: `
            <h2>Hello ${driverData.name},</h2>
            <p>A new complaint has been assigned to you.</p>
            <p><b>Complaint ID:</b> ${id}</p>
            <p>Please check your driver app for details.</p>
          `,
        });
      }
    }

    res.json({ message: "Complaint assigned successfully!", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🚛 Get all complaints assigned to a specific driver
app.get("/drivers/:id/complaints", async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from("complaints")
      .select("*")
      .eq("assigned_driver", id);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🚛 Driver Login
app.post("/auth/driver-login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("email", email)
      .eq("password", password)
      .single();

    if (error || !data) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    res.json({
      message: "Driver login successful!",
      driver: data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
