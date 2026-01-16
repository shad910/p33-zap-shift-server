require("dotenv").config();
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
app.use(cors({
    origin: ['http://localhost:5173',],
    credentials: true
}));
app.use(cookieParser());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Zap-Shift server is running...........");
});

const run = async () => {
    try {
        const zapShift = client.db("zapShift");
        const parcelCollection = zapShift.collection("parcels");


        // Connect the client to the server (optional starting in v4.7)
        // await client.connect();
        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
};

run().catch(console.dir);

app.listen(port, () => {
    console.log(`Zap-Shift server is running on port ${port}.`);
});

// console.log("Mongo URI:", process.env.MDB_URI ? "Loaded ✅" : "Missing ❌");
// console.log("Firebase Key:", process.env.FB_SERVICE_KEY ? "Loaded ✅" : "Missing ❌");
