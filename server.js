const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const path = require("path");

const app = express();

app.use(express.json({ limit: '10mb' }));
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
mongoose.connect("mongodb://127.0.0.1:27017/househopDB")
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
// HARDCODED USERS (like Campus Connect)
// ==============================
const USERS = [
    { id: "1", username: "admin", password: "123", role: "admin" },
    { id: "2", username: "host", password: "123", role: "host" },
    { id: "3", username: "guest", password: "123", role: "guest" },
];


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

// Login POST — checks against hardcoded USERS
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const user = USERS.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ role: user.role });
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
    const { search, location, type, sort } = req.query;

    let query = {};
    if (search) query.name = { $regex: search, $options: "i" };
    if (location) query.location = { $regex: location, $options: "i" };
    if (type) query.type = type;

    let sortObj = {};
    if (sort === "price_asc") sortObj.price = 1;
    if (sort === "price_desc") sortObj.price = -1;

    const listings = await Listing.find(query).sort(sortObj);
    
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
            status: "approved"
        });

        if (!approvedBooking) {
            listingObj.contactNumber = undefined;
        }
    }

    res.json(listingObj);
});

// POST /listings — host creates listing
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
        if (b.status !== "approved") {
            obj.listingId.contactNumber = undefined;
        }
        return obj;
    });

    res.json(result);
});

// GET /bookings/host -- host sees bookings for their listings
app.get("/bookings/host", isAuthenticated, requireRole("host"), async (req, res) => {
    const listings = await Listing.find({ hostId: req.session.user.id });
    const listingIds = listings.map(l => l._id);
    const bookings = await Booking.find({ listingId: { $in: listingIds } })
        .populate("listingId", "name location image");

    const result = bookings.map(b => {
        const obj = b.toObject();
        const user = USERS.find(u => u.id === b.guestId);
        obj.guestUsername = user ? user.username : "Unknown";
        return obj;
    });

    res.json(result);
});

// GET /bookings/all -- admin sees all bookings
app.get("/bookings/all", isAuthenticated, requireRole("admin"), async (req, res) => {
    const bookings = await Booking.find().populate("listingId", "name location image");
    const result = bookings.map(b => {
        const obj = b.toObject();
        const user = USERS.find(u => u.id === b.guestId);
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

    // Prevent overlapping approved bookings
    const overlap = await Booking.findOne({
        listingId,
        status: "approved",
        $or: [{ startDate: { $lt: end }, endDate: { $gt: start } }]
    });

    if (overlap) {
        return res.status(409).json({ message: "These dates overlap with an existing approved booking" });
    }

    let isUnique = false;
    let generatedBookingId = "";
    while (!isUnique) {
        const randomDigits = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
        generatedBookingId = `BKG-${randomDigits}`;
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
app.get("/admin/users-list", isAuthenticated, requireRole("admin"), (req, res) => {
    // Return hardcoded users without passwords
    const safe = USERS.map(({ password, ...u }) => u);
    res.json(safe);
});


// ==============================
// 404 CATCH-ALL
// ==============================
app.get("/*splat", (req, res) => {
    res.sendFile(path.join(__dirname, "public/html/404.html"));
});


app.listen(3000, () => {
    console.log("HouseHop running on http://localhost:3000");
});
