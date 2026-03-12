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
const middlewareWrapper = require("cors");

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

const run = async () => {
  try {
    await client.connect();
    console.log("MongoDB connected successfully");

    const zapShift = client.db("zapShift");
    const usersCollection = zapShift.collection("users");
    const ridersCollection = zapShift.collection("riders");
    const parcelCollection = zapShift.collection("parcels");
    const paymentsCollection = zapShift.collection("payments");

    // Middleware
    const verifyFbToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          message:
            "Unauthorized access: Missing or invalid authorization header",
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
    };

    const verifyAdmin = async (req, res, next) => {
      try {
        if (!req.decoded?.email) {
          return res.status(401).json({ message: "Unauthorized access" });
        }

        const user = await usersCollection.findOne({
          email: req.decoded.email,
        });

        if (!user || user.role !== "admin") {
          return res.status(403).json({ message: "Forbidden access" });
        }

        next();
      } catch (error) {
        console.error("Admin verification error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    };

    const verifyRider = async (req, res, next) => {
      try {
        if (!req.decoded?.email) {
          return res.status(401).json({ message: "Unauthorized access" });
        }

        const user = await usersCollection.findOne({
          email: req.decoded.email,
        });

        if (!user || user.role !== "rider") {
          return res.status(403).json({ message: "Forbidden access" });
        }

        next();
      } catch (error) {
        console.error("Rider verification error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    };

    // -----------------------------
    // USER MANAGEMENT ENDPOINTS
    // -----------------------------

    app.get("/users", verifyFbToken, verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection
          .find()
          .project({ name: 1, email: 1, role: 1, created_at: 1, last_login: 1 }) // return only needed fields
          .toArray();

        res.json(users);
      } catch (error) {
        console.error("Get all users error:", error);
        res.status(500).json({ message: "Failed to fetch users" });
      }
    });

    app.get(
      "/users/role/:email",
      verifyFbToken,

      async (req, res) => {
        const { email } = req.params;

        try {
          const user = await usersCollection.findOne(
            { email },
            { projection: { role: 1, _id: 0 } }, // only return role
          );

          if (!user) {
            return res.status(404).json({ message: "User not found" });
          }

          res.json({ email, role: user.role });
        } catch (error) {
          console.error("Get user role error:", error);
          res.status(500).json({ message: "Failed to fetch user role" });
        }
      },
    );

    // SEARCH users by name or email (max 5 if query is provided)
    app.get("/users/search", verifyFbToken, verifyAdmin, async (req, res) => {
      const { query } = req.query;

      try {
        let filter = {};
        if (query) {
          filter = {
            $or: [
              { name: { $regex: query, $options: "i" } },
              { email: { $regex: query, $options: "i" } },
            ],
          };
        }

        const usersCursor = usersCollection
          .find(filter)
          .sort({ created_at: -1 });

        if (query) {
          usersCursor.limit(5); // max 5 for search
        }

        const users = await usersCursor.toArray();
        res.json(users);
      } catch (error) {
        console.error("Search users error:", error);
        res.status(500).json({
          message: "Failed to search users",
        });
      }
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

    // UPDATE user role (admin or restore previous role)
    app.patch(
      "/users/:id/role",
      verifyFbToken,

      async (req, res) => {
        const { id } = req.params;
        const { makeAdmin } = req.body;

        try {
          const user = await usersCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!user) {
            return res.status(404).json({
              message: "User not found",
            });
          }

          let updateDoc = {};

          if (makeAdmin) {
            updateDoc = {
              $set: {
                role: "admin",
                previousRole: user.role || "user",
                updated_at: new Date().toISOString(),
              },
            };
          } else {
            updateDoc = {
              $set: {
                role: user.previousRole || "user",
                updated_at: new Date().toISOString(),
              },
              $unset: {
                previousRole: "",
              },
            };
          }

          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            updateDoc,
          );

          res.json({
            modifiedCount: result.modifiedCount,
          });
        } catch (error) {
          console.error("Update role error:", error);

          res.status(500).json({
            message: "Failed to update role",
          });
        }
      },
    );

    // -----------------------------
    // RIDER MANAGEMENT ENDPOINTS
    // -----------------------------

    app.get("/riders/active", verifyFbToken, verifyAdmin, async (req, res) => {
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

    app.get(
      "/riders/de-active",
      verifyFbToken,
      verifyAdmin,
      async (req, res) => {
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
      },
    );

    app.get("/riders/pending", verifyFbToken, verifyAdmin, async (req, res) => {
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

    app.get("/riders/available", async (req, res) => {
      const { district, region } = req.query;

      const query = {
        status: "active",
        district: district,
        region: region,
      };

      const riders = await ridersCollection.find(query).toArray();

      res.send(riders);
    });

    // GET: Pending deliveries for rider
    app.get("/rider/parcels", async (req, res) => {
      try {
        const riderEmail = req.query.email;

        if (!riderEmail) {
          return res.status(400).json({ message: "Rider email is required" });
        }

        const query = {
          assignedRiderEmail: riderEmail,
          deliveryStatus: { $in: ["rider-assigned", "in-transit"] },
        };

        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_date: -1 }) // latest first
          .toArray();

        res.json(parcels);
      } catch (error) {
        res.status(500).json({ error: error.message });
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

    // PATCH rider status and update user role accordingly
    app.patch("/riders/:id/status", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      try {
        const rider = await ridersCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!rider) {
          return res.status(404).json({
            message: "Rider not found",
          });
        }

        const user = await usersCollection.findOne({
          email: rider.email,
        });

        if (!user) {
          return res.status(404).json({
            message: "Associated user not found",
          });
        }

        let roleToSet;

        if (status === "active") {
          // store previous role if not already stored
          if (!rider.previousRole) {
            await ridersCollection.updateOne(
              { _id: new ObjectId(id) },
              {
                $set: {
                  previousRole: user.role,
                },
              },
            );
          }

          roleToSet = "rider";
        } else {
          // restore previous role if exists
          roleToSet = rider.previousRole || "user";
        }

        // update rider status
        const riderResult = await ridersCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status,
              updated_at: new Date().toISOString(),
            },
          },
        );

        // update user role
        const userResult = await usersCollection.updateOne(
          { email: rider.email },
          {
            $set: {
              role: roleToSet,
              updated_at: new Date().toISOString(),
            },
          },
        );

        res.json({
          modifiedCount: riderResult.modifiedCount,
          userRoleUpdated: userResult.modifiedCount,
          role: roleToSet,
        });
      } catch (error) {
        console.error("Status update error:", error);
        res.status(500).json({
          message: "Failed to update rider status and user role",
        });
      }
    });

    // Assign rider to parcel
    app.patch("/parcels/:id/assign-rider", async (req, res) => {
      try {
        const parcelId = req.params.id;
        const { riderId, riderName, riderEmail } = req.body;

        // update parcel
        const parcelUpdate = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },

          {
            $set: {
              deliveryStatus: "rider-assigned",
              assignedRiderId: riderId,
              assignedRiderName: riderName,
              assignedRiderEmail: riderEmail,
              assigned_at: new Date().toISOString(),
            },
          },
        );

        // update rider
        const riderUpdate = await ridersCollection.updateOne(
          { _id: new ObjectId(riderId) },

          {
            $set: {
              workStatus: "in-delivery",
              updated_at: new Date().toISOString(),
            },
          },
        );

        res.json({
          parcelModified: parcelUpdate.modifiedCount,
          riderModified: riderUpdate.modifiedCount,
        });
      } catch (error) {
        console.error("Assign Rider Error:", error);

        res.status(500).json({
          message: "Failed to assign rider",
        });
      }
    });

    app.delete("/riders/:id", async (req, res) => {
      const { id } = req.params;

      try {
        const rider = await ridersCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!rider) {
          return res.status(404).json({
            message: "Rider not found",
          });
        }

        // fallback to "user" if previousRole not found
        const roleToRestore = rider.previousRole || "user";

        // restore previous role
        const userResult = await usersCollection.updateOne(
          { email: rider.email },
          {
            $set: {
              role: roleToRestore,
              updated_at: new Date().toISOString(),
            },
          },
        );

        // delete rider document
        const riderResult = await ridersCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.json({
          deletedCount: riderResult.deletedCount,
          restoredRole: roleToRestore,
          userRoleUpdated: userResult.modifiedCount,
        });
      } catch (error) {
        console.error("Delete rider error:", error);
        res.status(500).json({
          message: "Failed to delete rider and restore previous role",
        });
      }
    });

    // -----------------------------
    // PARCEL MANAGEMENT ENDPOINTS
    // -----------------------------

    // GET: All Parcels
    app.get("/parcels", verifyFbToken, async (req, res) => {
      try {
        const { email, paymentStatus, deliveryStatus } = req.query;

        if (email && req.decoded.email !== email) {
          return res.status(403).json({
            message: "Forbidden: You can only access your own parcels",
          });
        }

        let query = {};

        if (email) {
          query.created_by = email;
        }
        if (paymentStatus) {
          query.paymentStatus = paymentStatus;
        }
        if (deliveryStatus) {
          query.deliveryStatus = deliveryStatus;
        }

        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_date: -1 })
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

    // update parcel delivery status and rider work status
    app.patch("/parcels/:id/status", verifyFbToken, verifyRider, async (req, res) => {
      try {
        const { id } = req.params;
        const { deliveryStatus } = req.body;

        // find parcel first
        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!parcel) {
          return res.status(404).json({
            message: "Parcel not found",
          });
        }

        // update parcel
        const parcelResult = await parcelCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              deliveryStatus,
              updated_at: new Date().toISOString(),
            },
          },
        );

        let riderResult = null;

        // determine rider work status
        if (parcel.assignedRiderId) {
          let riderWorkStatus = "in-delivery";

          if (deliveryStatus === "delivered") {
            riderWorkStatus = "free";
          }

          riderResult = await ridersCollection.updateOne(
            { _id: new ObjectId(parcel.assignedRiderId) },
            {
              $set: {
                workStatus: riderWorkStatus,
                updated_at: new Date().toISOString(),
              },
            },
          );
        }

        res.json({
          parcelModified: parcelResult.modifiedCount,
          riderModified: riderResult?.modifiedCount || 0,
        });
      } catch (error) {
        console.error("Update Parcel Status Error:", error);

        res.status(500).json({
          message: "Failed to update parcel status",
        });
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
        if (parcel.paymentStatus === "paid")
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
