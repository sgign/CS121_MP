const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ==============================
// Session Middleware
// ==============================
app.use(session({
    secret: "househop_secret_123",
    resave: false,
    saveUninitialized: true
}));

// ==============================
// MongoDB Connection
// ==============================
// mongoose.connect("mongodb://127.0.0.1:27017/househopDB")
//     .then(() => console.log("MongoDB Connected"))
//     .catch(err => console.log(err));

require("dotenv").config();
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.log(err));


// ==============================
// SCHEMAS + MODELS
// ==============================

// LISTING
const listingSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, required: true },
    location: { type: String, required: true },
    price: { type: Number, required: true },
    description: { type: String },
    image: { type: String },
    images: [{ type: String }],
    hostId: { type: String, required: true },
    contactNumber: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const Listing = mongoose.model("Listing", listingSchema);

// BOOKING
const bookingSchema = new mongoose.Schema({
    bookingId: { type: String, unique: true },
    listingId: { type: mongoose.Schema.Types.ObjectId, ref: "Listing", required: true },
    guestId: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    createdAt: { type: Date, default: Date.now }
});
const Booking = mongoose.model("Booking", bookingSchema);


// ==============================
// USER SCHEMA & INIT
// ==============================
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["guest", "host", "admin"], required: true }
});
const User = mongoose.model("User", userSchema);

async function initUsers() {
    try {
        const count = await User.countDocuments();
        if (count === 0) {
            await User.insertMany([
                { username: "admin", password: "123", role: "admin" },
                { username: "host", password: "123", role: "host" },
                { username: "guest", password: "123", role: "guest" },
            ]);
            console.log("Initialized default users");
        }
    } catch (err) {
        console.error("Error initializing users:", err);
    }
}
initUsers();


// ==============================
// AUTH MIDDLEWARE
// ==============================
function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.redirect("/login");
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.session.user) return res.redirect("/login");
        if (!roles.includes(req.session.user.role)) {
            return res.status(403).sendFile(path.join(__dirname, "public/html/forbidden.html"));
        }
        next();
    };
}


// ==============================
// AUTH ROUTES
// ==============================

// Login page
app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public/html/login.html"));
});

// Login POST — checks against DB
app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    req.session.user = { id: user._id.toString(), username: user.username, role: user.role };
    res.json({ role: user.role });
});

// Signup page
app.get("/signup", (req, res) => {
    res.sendFile(path.join(__dirname, "public/html/signup.html"));
});

// Signup POST
app.post("/signup", async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
        return res.status(400).json({ message: "All fields are required" });
    }
    if (!["guest", "host"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
    }
    
    try {
        const existing = await User.findOne({ username });
        if (existing) {
            return res.status(409).json({ message: "Username already exists" });
        }
        
        await User.create({ username, password, role });
        res.json({ message: "Account created successfully" });
    } catch (err) {
        res.status(500).json({ message: "Error creating account" });
    }
});

// Logout
app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
});

// Get current session user info (for frontend role checks)
app.get("/me", isAuthenticated, (req, res) => {
    res.json(req.session.user);
});


// ==============================
// PAGE ROUTES
// ==============================

// Root → redirect based on role
app.get("/", isAuthenticated, (req, res) => {
    const role = req.session.user.role;
    if (role === "guest") return res.redirect("/browse");
    if (role === "host") return res.redirect("/my-listings");
    if (role === "admin") return res.redirect("/admin/listings");
    res.redirect("/login");
});

// --- GUEST PAGES ---
app.get("/browse", isAuthenticated, requireRole("guest"), (req, res) => {
    res.sendFile(path.join(__dirname, "public/html/guest-browse.html"));
});

app.get("/booking/:id", isAuthenticated, requireRole("guest"), (req, res) => {
    res.sendFile(path.join(__dirname, "public/html/guest-booking.html"));
});

app.get("/my-bookings", isAuthenticated, requireRole("guest"), (req, res) => {
    res.sendFile(path.join(__dirname, "public/html/guest-my-bookings.html"));
});

// --- HOST PAGES ---
app.get("/create-listing", isAuthenticated, requireRole("host"), (req, res) => {
    res.sendFile(path.join(__dirname, "public/html/host-create-listing.html"));
});

app.get("/my-listings", isAuthenticated, requireRole("host"), (req, res) => {
    res.sendFile(path.join(__dirname, "public/html/host-my-listings.html"));
});

app.get("/booking-requests", isAuthenticated, requireRole("host"), (req, res) => {
    res.sendFile(path.join(__dirname, "public/html/host-booking-requests.html"));
});

// --- ADMIN PAGES ---
app.get("/admin/listings", isAuthenticated, requireRole("admin"), (req, res) => {
    res.sendFile(path.join(__dirname, "public/html/admin-listings.html"));
});

app.get("/admin/bookings", isAuthenticated, requireRole("admin"), (req, res) => {
    res.sendFile(path.join(__dirname, "public/html/admin-bookings.html"));
});

app.get("/admin/users", isAuthenticated, requireRole("admin"), (req, res) => {
    res.sendFile(path.join(__dirname, "public/html/admin-users.html"));
});


// ==============================
// LISTINGS API
// ==============================

// GET /listings — with search, filter, sort
app.get("/listings", isAuthenticated, async (req, res) => {
    const { search, location, type, sort, checkin, checkout } = req.query;

    let query = {};
    if (search) query.name = { $regex: search, $options: "i" };
    if (location) query.location = { $regex: location, $options: "i" };
    if (type) query.type = type;

    let sortObj = {};
    if (sort === "price_asc") sortObj.price = 1;
    if (sort === "price_desc") sortObj.price = -1;

    let listings = await Listing.find(query).sort(sortObj);

    if (checkin && checkout) {
        const checkinDate = new Date(checkin);
        const checkoutDate = new Date(checkout);
        
        const overlappingBookings = await Booking.find({
            status: "approved",
            $or: [
                { startDate: { $lt: checkoutDate }, endDate: { $gt: checkinDate } }
            ]
        });
        
        const bookedListingIds = overlappingBookings.map(b => b.listingId.toString());
        listings = listings.filter(l => !bookedListingIds.includes(l._id.toString()));
    }

    let result = listings.map(l => l.toObject());
    if (req.session.user.role === "guest") {
        result.forEach(r => r.contactNumber = undefined);
    }

    res.json(result);
});

// GET /listings/:id
app.get("/listings/:id", isAuthenticated, async (req, res) => {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: "Listing not found" });

    let listingObj = listing.toObject();

    if (req.session.user.role === "guest") {
        const approvedBooking = await Booking.findOne({
            listingId: listing._id,
            guestId: req.session.user.id,
            status: "approved",
            endDate: { $gte: new Date() }
        });

        if (!approvedBooking) {
            listingObj.contactNumber = undefined;
        }
    }

    res.json(listingObj);
});

// Image processing removed so Base64 strings are stored directly in MongoDB
app.post("/listings", isAuthenticated, requireRole("host"), async (req, res) => {
    try {
        const listing = await Listing.create({
            ...req.body,
            hostId: req.session.user.id
        });
        res.json(listing);
    } catch (err) {
        res.status(400).json({ message: "Failed to create listing: " + err.message });
    }
});

// PUT /listings/:id — host edits own listing
app.put("/listings/:id", isAuthenticated, requireRole("host"), async (req, res) => {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    if (listing.hostId !== req.session.user.id) {
        return res.status(403).json({ message: "Not your listing" });
    }
    const updated = await Listing.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updated);
});

// DELETE /listings/:id — host deletes own, admin deletes any
app.delete("/listings/:id", isAuthenticated, requireRole("host", "admin"), async (req, res) => {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: "Listing not found" });

    if (req.session.user.role === "host" && listing.hostId !== req.session.user.id) {
        return res.status(403).json({ message: "Not your listing" });
    }

    await Listing.findByIdAndDelete(req.params.id);
    await Booking.deleteMany({ listingId: req.params.id });
    res.json({ message: "Deleted" });
});


// ==============================
// BOOKINGS API
// ==============================

// GET /bookings/my — guest sees own bookings
app.get("/bookings/my", isAuthenticated, requireRole("guest"), async (req, res) => {
    const bookings = await Booking.find({ guestId: req.session.user.id })
        .populate("listingId");

    const result = bookings.map(b => {
        const obj = b.toObject();
        if (obj.listingId) {
            const isApproved = b.status === "approved";
            const isPastBooking = new Date(b.endDate) < new Date();
            
            if (!isApproved || isPastBooking) {
                obj.listingId.contactNumber = undefined;
            }
        }
        return obj;
    });

    res.json(result);
});

app.get("/bookings/host", isAuthenticated, requireRole("host"), async (req, res) => {
    const listings = await Listing.find({ hostId: req.session.user.id });
    const listingIds = listings.map(l => l._id);
    const bookings = await Booking.find({ listingId: { $in: listingIds } })
        .populate("listingId", "name location image type price");

    const validUserIds = bookings.map(b => b.guestId).filter(id => mongoose.Types.ObjectId.isValid(id));
    const users = await User.find({ _id: { $in: validUserIds } });

    const result = bookings.map(b => {
        const obj = b.toObject();
        const user = users.find(u => u._id.toString() === b.guestId);
        obj.guestUsername = user ? user.username : "Unknown";
        return obj;
    });

    res.json(result);
});

// GET /bookings/all -- admin sees all bookings
app.get("/bookings/all", isAuthenticated, requireRole("admin"), async (req, res) => {
    const bookings = await Booking.find().populate("listingId", "name location image hostId");
    
    const validUserIds = bookings.map(b => b.guestId).filter(id => mongoose.Types.ObjectId.isValid(id));
    const users = await User.find({ _id: { $in: validUserIds } });

    const result = bookings.map(b => {
        const obj = b.toObject();
        const user = users.find(u => u._id.toString() === b.guestId);
        obj.guestUsername = user ? user.username : "Unknown";
        return obj;
    });
    res.json(result);
});

// POST /bookings — guest creates a booking
app.post("/bookings", isAuthenticated, requireRole("guest"), async (req, res) => {
    const { listingId, startDate, endDate } = req.body;

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start >= end) {
        return res.status(400).json({ message: "End date must be after start date" });
    }

    const overlap = await Booking.findOne({
        listingId,
        status: "approved",
        $or: [{ startDate: { $lt: end }, endDate: { $gt: start } }]
    });

    if (overlap) {
        return res.status(409).json({ 
            message: "These dates overlap with an existing approved booking.",
            overlapStart: overlap.startDate,
            overlapEnd: overlap.endDate
        });
    }

    let isUnique = false;
    let generatedBookingId = "";
    while (!isUnique) {
        const randomHex = crypto.randomBytes(4).toString("hex").toUpperCase();
        generatedBookingId = `BKG-${randomHex}`;
        const existing = await Booking.findOne({ bookingId: generatedBookingId });
        if (!existing) {
            isUnique = true;
        }
    }

    const booking = await Booking.create({
        bookingId: generatedBookingId,
        listingId,
        guestId: req.session.user.id,
        startDate: start,
        endDate: end,
        status: "pending"
    });

    res.json(booking);
});

// PUT /bookings/:id/status — host approves or rejects
app.put("/bookings/:id/status", isAuthenticated, requireRole("host"), async (req, res) => {
    const { status } = req.body;

    if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Status must be approved or rejected" });
    }

    const booking = await Booking.findById(req.params.id).populate("listingId");
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.listingId.hostId !== req.session.user.id) {
        return res.status(403).json({ message: "Not your listing" });
    }

    if (status === "approved") {
        const overlap = await Booking.findOne({
            _id: { $ne: booking._id },
            listingId: booking.listingId._id,
            status: "approved",
            $or: [{ startDate: { $lt: booking.endDate }, endDate: { $gt: booking.startDate } }]
        });

        if (overlap) {
            return res.status(409).json({ message: "Cannot approve: overlaps with an existing approved booking" });
        }
    }

    booking.status = status;
    await booking.save();
    res.json(booking);
});


// ==============================
// ADMIN USER LIST
// ==============================
app.get("/admin/users-list", isAuthenticated, requireRole("admin"), async (req, res) => {
    // Return users from DB without passwords
    const users = await User.find({}, { password: 0 });
    const safe = users.map(u => {
        const isHardcoded = ["admin", "guest", "host"].includes(u.username);
        return { 
            id: u._id.toString(), 
            username: u.username, 
            role: u.role,
            joinDate: isHardcoded ? "N/A" : u._id.getTimestamp().toLocaleDateString()
        };
    });
    res.json(safe);
});


// ==============================
// 404 CATCH-ALL
// ==============================
app.get("/*splat", (req, res) => {
    res.sendFile(path.join(__dirname, "public/html/404.html"));
});


// ==============================
// ERROR HANDLER
// ==============================
app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ message: "File size limit exceeded! Please upload smaller images." });
    }
    res.status(500).json({ message: err.message || "Internal Server Error" });
});

app.listen(3000, () => {
    console.log("HouseHop running on http://localhost:3000");
});
