// controllers/reportController.js
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");

dotenv.config();

// -------------------- SUPABASE CLIENT --------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// -------------------- MAILTRAP / SMTP --------------------
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT), // ✅ Make sure it's a number
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// ✅ Check Mailtrap connection once at startup
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ Mailtrap SMTP connection failed:", error);
  } else {
    console.log("✅ Mailtrap SMTP connection successful!");
  }
});

// -------------------- CREATE CIVIC REPORT --------------------
const createCivicReport = async (req, res) => {
  try {
    const { email, issue_type, description, location } = req.body;
    const file = req.file; // multer gives this if a file was uploaded

    if (!email || !issue_type || !description || !location) {
      console.log("❌ Missing fields:", { email, issue_type, description, location });
      return res.status(400).json({ message: "All required fields must be provided." });
    }

    const complaint_id = "C-" + Math.floor(1000 + Math.random() * 9000);

    // Optional photo upload
    let photo_url = null;
    if (file) {
      const fileName = `${complaint_id}_${file.originalname}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("civic_reports")
        .upload(fileName, file.buffer, { contentType: file.mimetype });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from("civic_reports").getPublicUrl(fileName);
      photo_url = publicUrlData.publicUrl;
    }

    const { data, error } = await supabase
      .from("civic_reports")
      .insert([
        {
          complaint_id,
          email,
          issue_type,
          description,
          location,
          photo_url,
          status: "Pending",
          created_at: new Date(),
        },
      ])
      .select();

    if (error) throw error;

    console.log("📤 Sending Mailtrap email to:", email);

    const info = await transporter.sendMail({
      from: '"Clean City Portal" <no-reply@cleancity.com>',
      to: email,
      subject: `✅ Your Civic Report #${complaint_id}`,
      html: `
        <h2>Thank you for your report!</h2>
        <p><b>Complaint ID:</b> ${complaint_id}</p>
        <p><b>Issue Type:</b> ${issue_type}</p>
        <p><b>Description:</b> ${description}</p>
        <p><b>Location:</b> ${location}</p>
        ${photo_url ? `<p><b>Photo:</b> <a href="${photo_url}">View</a></p>` : ""}
        <p>Status: <b>Pending</b></p>
        <hr/>
        <p>This email is sent automatically by Clean City Portal.</p>
      `,
    });

    console.log("✅ Email sent successfully! Message ID:", info.messageId);

    res.status(201).json({
      message: "Civic report submitted successfully!",
      complaint_id,
      report: data[0],
    });
  } catch (err) {
    console.error("❌ Error creating civic report:", err);
    res.status(500).json({ message: "Server error while submitting report" });
  }
};

// -------------------- GET REPORTS BY EMAIL --------------------
const getCivicReportsByEmail = async (req, res) => {
  const { email } = req.params;

  try {
    const { data, error } = await supabase
      .from("civic_reports")
      .select("*")
      .eq("email", email)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.status(200).json({ reports: data || [] });
  } catch (err) {
    console.error("❌ Error fetching reports:", err);
    res.status(500).json({ message: "Error fetching reports" });
  }
};

module.exports = { createCivicReport, getCivicReportsByEmail };
