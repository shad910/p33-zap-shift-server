// 1. DNS CONFIGURATION FIRST - BEFORE ANYTHING ELSE
process.env.NODE_OPTIONS = "--dns-result-order=ipv4first";
const dns = require("node:dns");
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"]);

// 2. NOW load environment variables (which contain MongoDB URI)
require("dotenv").config();

// 3. Then the rest of your imports
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.Payment_Secret_Key);
const { json } = require("express");
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-admin-service-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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

const verifyFbToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Unauthorized access: Missing or invalid authorization header",
    });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res
      .status(401)
      .json({ message: "Unauthorized access: Invalid token format" });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  } catch (error) {
    return res
      .status(403)
      .json({ message: "Forbidden access: Invalid or expired token" });
  }

  console.log(req.decoded);
};

const run = async () => {
  try {
    await client.connect();
    console.log("MongoDB connected successfully");

    const zapShift = client.db("zapShift");
    const usersCollection = zapShift.collection("users");
    const ridersCollection = zapShift.collection("riders");
    const parcelCollection = zapShift.collection("parcels");
    const paymentsCollection = zapShift.collection("payments");

    // -----------------------------
    // USER MANAGEMENT ENDPOINTS
    // -----------------------------

    app.get("/users", async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.json(users);
    });

    app.post("/users", async (req, res) => {
      try {
        const { email, last_login } = req.body;

        // Validate email
        if (!email) {
          return res.status(400).json({
            message: "Email is required",
          });
        }

        const emailExists = await usersCollection.findOne({ email });

        if (emailExists) {
          // Update last_login if user already exists
          await usersCollection.updateOne(
            { email },
            {
              $set: {
                last_login: last_login || new Date().toISOString(),
              },
            },
          );

          return res.status(200).json({
            message: "Last login updated successfully",
            updated: true,
            userId: emailExists._id,
          });
        }

        // Create new user if not exists
        const user = {
          ...req.body,
          created_at: new Date().toISOString(),
          last_login: last_login || new Date().toISOString(),
        };

        const result = await usersCollection.insertOne(user);

        res.status(201).json({
          message: "User created successfully",
          insertedId: result.insertedId,
          created: true,
        });
      } catch (error) {
        console.error("User API Error:", error);
        res.status(500).json({
          message: "Internal Server Error",
        });
      }
    });


    // -----------------------------
    // RIDER MANAGEMENT ENDPOINTS
    // -----------------------------

    app.get("/riders/active", async (req, res) => {
      try {
        const activeRiders = await ridersCollection
          .find({ status: "active" })
          .toArray();

        res.status(200).json(activeRiders);
      } catch (error) {
        console.error("Pending Riders API Error:", error);
        res.status(500).json({
          message: "Internal Server Error",
        });
      }
    });
    
    app.get("/riders/de-active", async (req, res) => {
      try {
        const deActiveRiders = await ridersCollection
          .find({ status: "deactive" })
          .toArray();

        res.status(200).json(deActiveRiders);
      } catch (error) {
        console.error("Pending Riders API Error:", error);
        res.status(500).json({
          message: "Internal Server Error",
        });
      }
    });

    app.get("/riders/pending", async (req, res) => {
      try {
        const pendingRiders = await ridersCollection
          .find({ status: "pending" })
          .toArray();

        res.status(200).json(pendingRiders);
      } catch (error) {
        console.error("Pending Riders API Error:", error);
        res.status(500).json({
          message: "Internal Server Error",
        });
      }
    });

    app.post("/riders", async (req, res) => {
      try {
        const rider = req.body;
        const { name, email } = rider;

        // Validate required fields
        if (!name || !email) {
          return res.status(400).json({
            message: "Name and Email are required",
          });
        }

        // Check if already applied
        const existingRider = await ridersCollection.findOne({ email });

        if (existingRider) {
          return res.status(409).json({
            message: "You have already applied as a rider",
            exists: true,
          });
        }

        // Prepare rider data (backend controlled fields)
        const riderData = {
          ...rider,
          status: "pending", // default status
          created_at: new Date().toISOString(),
          updated_at: null,
        };

        const result = await ridersCollection.insertOne(riderData);

        res.status(201).json({
          message: "Application submitted successfully",
          insertedId: result.insertedId,
          created: true,
        });
      } catch (error) {
        console.error("Riders API Error:", error);

        res.status(500).json({
          message: "Internal Server Error",
        });
      }
    });

    // PATCH rider status
    app.patch("/riders/:id/approve", async (req, res) => {
      const { id } = req.params;
      const result = await ridersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "active", updated_at: new Date().toISOString() } },
      );
      res.json({ modifiedCount: result.modifiedCount });
    });

    app.patch("/riders/:id/status", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || !["active", "deactive"].includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }

      try {
        const result = await ridersCollection.updateOne(
          { _id: new ObjectId(id) }, // ✅ convert string id to ObjectId
          { $set: { status, updated_at: new Date().toISOString() } },
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .json({ message: "Rider not found or status unchanged" });
        }

        res.json({
          message: "Status updated successfully",
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to update status", error });
      }
    });

    // DELETE rider
    app.delete("/riders/:id", async (req, res) => {
      const { id } = req.params;
      const result = await ridersCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.json({ deletedCount: result.deletedCount });
    });


    // -----------------------------
    // PARCEL MANAGEMENT ENDPOINTS
    // -----------------------------

    // GET: All Parcels
    // GET /parcels/user?email=optional → get parcels by user email or all parcels, sorted latest first
    app.get("/parcels", verifyFbToken, async (req, res) => {
      try {
        const userEmail = req.query.email;

        if (userEmail && req.decoded.email !== userEmail) {
          return res.status(403).json({
            message: "Forbidden: You can only access your own parcels",
          });
        }

        const parcelCollection = client.db("zapShift").collection("parcels");

        // Build query
        const query = userEmail ? { created_by: userEmail } : {};

        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_date: -1 }) // latest first
          .toArray();

        res.json(parcels);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET: Single Parcel by ID
    app.get("/parcels/:id", verifyFbToken, async (req, res) => {
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

    // POST: Send Parcel Details
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

    // DELETE: Parcel by ID
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = new ObjectId(req.params.id);

        // Find the parcel
        const parcel = await parcelCollection.findOne({ _id: id });
        if (!parcel)
          return res.status(404).json({ message: "Parcel not found" });

        // Prevent deletion if paid
        if (parcel.paymentStatus === "Paid")
          return res
            .status(403)
            .json({ message: "Paid parcels cannot be deleted" });

        // Delete parcel
        const { deletedCount } = await parcelCollection.deleteOne({ _id: id });
        if (deletedCount > 0) {
          return res.json({
            message: "Parcel deleted successfully",
            deletedCount,
          });
        }

        res
          .status(404)
          .json({ message: "Parcel not found or already deleted" });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    
    // -----------------------------
    // PAYMENT MANAGEMENT ENDPOINTS
    // -----------------------------

    // GET: Payment history (latest first, supports user filtering)
    app.get("/payments", verifyFbToken, async (req, res) => {
      try {
        const userEmail = req.query.email; // optional: ?email=user@example.com

        if (userEmail && req.decoded.email !== userEmail) {
          return res.status(403).json({
            message: "Forbidden: You can only access your own payments",
          });
        }

        // Build query: if email is provided, filter by paidBy
        const query = userEmail ? { paidBy: userEmail } : {};

        const payments = await paymentsCollection
          .find(query)
          .sort({ paymentDate: -1 }) // latest first
          .toArray();

        res.json(payments);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Payment Integration with Stripe
    app.post("/create-payment-intent", async (req, res) => {
      const amount = req.body.amount;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // POST: Mark parcel as Paid
    app.post("/payments", async (req, res) => {
      try {
        const {
          mainParcelID,
          parcelId,
          email,
          amount,
          paymentMethod,
          transactionId,
        } = req.body;

        if (!mainParcelID || !parcelId) {
          return res
            .status(400)
            .json({ message: "Both mainParcelID and parcelId are required" });
        }

        const id = new ObjectId(mainParcelID);

        // Find the parcel
        const parcel = await parcelCollection.findOne({ _id: id });
        if (!parcel) {
          return res.status(404).json({ message: "Parcel not found" });
        }

        if (parcel.paymentStatus === "paid") {
          return res.status(400).json({ message: "Parcel already paid" });
        }

        // Update parcel payment status
        await parcelCollection.updateOne(
          { _id: id },
          { $set: { paymentStatus: "paid" } },
        );

        // Log payment history
        const result = await paymentsCollection.insertOne({
          mainParcelID: parcel._id, // Mongo _id
          parcelId: parcelId, // Your generated parcelId
          parcelTitle: parcel.parcelTitle,
          senderName: parcel.senderName,
          receiverName: parcel.receiverName,
          amount: amount || parcel.deliveryCost,
          paidBy: email || parcel.created_by,
          paymentDate: new Date().toISOString(),
          paymentMethod: paymentMethod || "Card / Stripe",
          transactionId: transactionId || null,
        });

        res.json({
          message: "Payment marked as Paid successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Payment API error:", error);
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
