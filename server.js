const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;
const CLOUDFLARE_API_URL = process.env.CLOUDFLARE_API_URL || "https://api.cloudflare.com/client/v4";
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/dns-manager";
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Enhanced CORS configuration
const corsOptions = {
  origin: [
    process.env.FRONTEND_URL || "http://localhost:3000",
    // process.env.FRONTEND_URL || "https://dnsmanager.vercel.app",
    // Add other allowed origins as needed
  ],
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(express.json());
app.use(cors(corsOptions));

// Import and use user routes
const userRoutes = require('./routes/users');
app.use('/api', userRoutes);

const getHeaders = (apiKey) => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
});

// Fetch Zones
app.post("/api/fetch-zones", async (req, res) => {
  try {
    const { apiKey } = req.body;
    const response = await axios.get(`${CLOUDFLARE_API_URL}/zones`, {
      headers: getHeaders(apiKey),
    });
    res.json(response.data.result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fetch DNS Records
app.post("/api/fetch-dns-records", async (req, res) => {
  try {
    const { apiKey, zoneId } = req.body;
    const response = await axios.get(
      `${CLOUDFLARE_API_URL}/zones/${zoneId}/dns_records`,
      { headers: getHeaders(apiKey) }
    );
    res.json(response.data.result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ New API: Add Zone(s) to Cloudflare
app.post("/api/add-zone", async (req, res) => {
  try {
    const { apiKey, domains } = req.body;
    const domainList = domains.split(",").map((domain) => domain.trim());
    let progressLog = [];

    for (let domain of domainList) {
      try {
        const response = await axios.post(
          `${CLOUDFLARE_API_URL}/zones`,
          { name: domain, jump_start: true },
          { headers: getHeaders(apiKey) }
        );
        progressLog.push(`✅ Zone added successfully: ${domain}`);
      } catch (error) {
        progressLog.push(
          `❌ Failed to add zone: ${domain} - ${
            error.response?.data?.errors[0]?.message || error.message
          }`
        );
      }
    }

    res.json({ message: "Zone operation completed", log: progressLog });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete zone
app.post("/api/delete-zone", async (req, res) => {
  const { apiKey, zoneId } = req.body;

  try {
    const response = await axios.delete(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data.success) {
      res.json({ message: "Zone deleted successfully" });
    } else {
      res.status(400).json({ error: "Failed to delete zone" });
    }
  } catch (error) {
    res.status(500).json({ error: "Error deleting zone" });
  }
});

// Csvs

app.post("/api/add-google-workspace-dns", async (req, res) => {
  try {
    const { apiKey, zoneId, domain } = req.body; // Add domain to request body

    const csvPath = path.join(__dirname, "data", "google_workspace.csv");
    if (!fs.existsSync(csvPath)) {
      return res.status(400).json({ error: "DNS template file not found" });
    }

    const csvData = fs.readFileSync(csvPath, "utf8");

    // Get the zone's actual domain name
    const zoneDomain =
      domain ||
      (
        await axios.get(`${CLOUDFLARE_API_URL}/zones/${zoneId}`, {
          headers: getHeaders(apiKey),
        })
      ).data.result.name;

    const records = csvData
      .split("\n")
      .filter((line) => line.trim() !== "")
      .slice(1) // skip header
      .map((line) => {
        const [type, name, content, ttl, proxied, priority] = line.split(",");

        // Replace placeholders with actual domain
        let processedContent = content.trim();
        processedContent = processedContent.replace(
          /yourdomain\.com/g,
          zoneDomain
        );
        processedContent = processedContent.replace(
          /yourdomain-com/g,
          zoneDomain.replace(/\./g, "-")
        );

        return {
          type: type.trim(),
          name:
            name.trim() === "@" ? zoneDomain : `${name.trim()}.${zoneDomain}`,
          content: processedContent,
          priority: priority ? parseInt(priority.trim()) : undefined,
          ttl: parseInt(ttl.trim()) || 1,
          proxied: proxied.trim().toLowerCase() === "true",
        };
      })
      .filter((record) => record.type && record.content);

    const results = [];
    for (const record of records) {
      try {
        await axios.post(
          `${CLOUDFLARE_API_URL}/zones/${zoneId}/dns_records`,
          record,
          { headers: getHeaders(apiKey) }
        );
        results.push(`✅ Added ${record.type} record: ${record.name}`);
      } catch (error) {
        results.push(
          `❌ Failed to add ${record.type} record: ${
            error.response?.data?.errors[0]?.message || error.message
          }`
        );
      }
    }

    res.json({ success: true, results, domain: zoneDomain });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
});

// Delete DNS Record
app.post("/api/delete-dns-record", async (req, res) => {
  try {
    const { apiKey, zoneId, recordId } = req.body;

    const response = await axios.delete(
      `${CLOUDFLARE_API_URL}/zones/${zoneId}/dns_records/${recordId}`,
      { headers: getHeaders(apiKey) }
    );

    if (response.data.success) {
      res.json({ success: true, message: "DNS record deleted successfully" });
    } else {
      res.status(400).json({ error: "Failed to delete DNS record" });
    }
  } catch (error) {
    res.status(500).json({
      error: "Error deleting DNS record",
      details: error.message,
    });
  }
});

// Add this endpoint to your existing backend code
app.post("/api/fetch-nameservers", async (req, res) => {
  try {
    const { apiKey, zoneId } = req.body;
    const response = await axios.get(`${CLOUDFLARE_API_URL}/zones/${zoneId}`, {
      headers: getHeaders(apiKey),
    });
    res.json({
      success: true,
      nameservers: response.data.result.name_servers,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/api/add-google-verification", async (req, res) => {
  try {
    const { apiKey, zoneId, domain, txtValue } = req.body;
    
    const record = {
      type: "TXT",
      name: domain, // Will become "@" for root domain
      content: txtValue,
      ttl: 1, // Auto TTL
      proxied: false,
      comment: "Google site verification"
    };

    const response = await axios.post(
      `${CLOUDFLARE_API_URL}/zones/${zoneId}/dns_records`,
      record,
      { headers: getHeaders(apiKey) }
    );

    res.json({
      success: true,
      message: "Google verification TXT record added successfully",
      record: response.data.result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to add verification record",
      details: error.message
    });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
