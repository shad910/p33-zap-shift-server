// 1. DNS CONFIGURATION FIRST - BEFORE ANYTHING ELSE
process.env.NODE_OPTIONS = '--dns-result-order=ipv4first';
const dns = require('node:dns');
dns.setServers(['1.1.1.1','1.0.0.1', '8.8.8.8', '8.8.4.4']);

// 2. NOW load environment variables (which contain MongoDB URI)
require('dotenv').config();

// 3. Then the rest of your imports
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { json } = require("express");

//fixed firebase admin initialization issue
// const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
// const serviceAccount = JSON.parse(decoded);

// admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount)
// });

const uri = process.env.MDB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const port = process.env.PORT || 5000;

const app = express();

// Middleware
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());

// Simple Route
app.get("/", (req, res) => {
  res.send("Zap-Shift server is running...........");
});

const run = async () => {
  try {
    await client.connect();
    console.log("MongoDB connected successfully");

    const zapShift = client.db("zapShift");
    const parcelCollection = zapShift.collection("parcels");

    // -----------------------------
    // GET: All Parcels
    // GET /parcels/user?email=optional → get parcels by user email or all parcels, sorted latest first
    // -----------------------------
    app.get("/parcels", async (req, res) => {
      try {
        const userEmail = req.query.email;

        const parcelCollection = client.db("zapShift").collection("parcels");

        // Build query
        const query = userEmail ? { created_by: userEmail } : {};

        const parcels = await parcelCollection
          .find(query)
          .sort({ createdAt: -1 }) // latest first
          .toArray();

        res.json(parcels);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // -----------------------------
    // GET: Single Parcel by ID
    // -----------------------------
    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(id),
        });
        res.json(parcel);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // -----------------------------
    // POST: Send Parcel Details
    // -----------------------------
    app.post("/parcels", async (req, res) => {
      try {
        const parcelData = req.body;
        const result = await parcelCollection.insertOne(parcelData);
        res.status(201).json({
          message: "Parcel created successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  } catch (error) {
    console.error(error);
  }
};

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Zap-Shift server is running on port ${port}.`);
});

// console.log("Mongo URI:", process.env.MDB_URI ? "Loaded ✅" : "Missing ❌");
// console.log("Firebase Key:", process.env.FB_SERVICE_KEY ? "Loaded ✅" : "Missing ❌");
