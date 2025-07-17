// server.js
const express = require('express');
const mysql2 = require('mysql2');
const cors = require('cors');
require('dotenv').config(); // <--- ADDED: Loads environment variables from .env file for local development

const app = express();
// CORRECTED: Use process.env.PORT for Railway, fallback to 3001 for local development
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json()); // Middleware to parse JSON request bodies

// Database connection - Use Railway's auto-injected environment variables
// CORRECTED: Uses process.env variables for Railway deployment, with 'localhost' fallbacks for local dev
const db = mysql2.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '', // Your MySQL password if you have one locally
    database: process.env.MYSQL_DATABASE || 'firstapp',
    port: process.env.MYSQL_PORT || 3306 // MySQL default port
});

// Use promise-based connection for async/await in routes
const promiseDb = db.promise();

db.connect(err => {
    if (err) {
        console.error('Error connecting to the database:', err.stack);
        // It's good practice to exit the process if DB connection fails at startup
        process.exit(1);
    }
    console.log('Connected to MySQL database as ID ' + db.threadId);
});

// --- User Authentication Routes ---

// SIGNUP ROUTE
app.post('/signup', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    try {
        // Check if user already exists
        const [users] = await promiseDb.query("SELECT COUNT(*) AS count FROM users WHERE email = ?", [email]);

        if (users[0].count > 0) {
            return res.status(409).json({ error: 'Email already registered.' });
        }

        // Insert new user if email is not taken
        const insertSql = 'INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, NOW())';
        const values = [name, email, password];

        await promiseDb.query(insertSql, values);
        res.status(201).json({ success: true, message: 'User registered successfully!' });

    } catch (err) {
        console.error('Error during signup:', err);
        res.status(500).json({ error: 'Database error during signup.' });
    }
});

// LOGIN ROUTE
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        const [data] = await promiseDb.query("SELECT ID, name, email, password FROM users WHERE email = ?", [email]);

        if (data.length > 0) {
            const user = data[0];
            // In a real app, use bcrypt for password hashing and comparison:
            // const passwordMatch = await bcrypt.compare(password, user.password);
            // if (passwordMatch) { ... } else { ... }
            if (user.password === password) { // Using plain password for now (NOT RECOMMENDED FOR PRODUCTION)
                // Update last_login_at
                await promiseDb.query("UPDATE users SET last_login_at = NOW() WHERE ID = ?", [user.ID]);

                return res.json({
                    success: true,
                    message: "Login successful!",
                    name: user.name,
                    email: user.email,
                    role: "User", // Hardcoded role for now
                    id: user.ID
                });
            } else {
                return res.status(401).json({ success: false, error: "Invalid credentials." });
            }
        } else {
            return res.status(401).json({ success: false, error: "Invalid credentials." });
        }
    } catch (err) {
        console.error('Error during login query:', err);
        res.status(500).json({ error: 'Database error during login.' });
    }
});

// --- User Management Routes (for Users.jsx) ---

// GET all users
app.get('/users', async (req, res) => {
    try {
        const [data] = await promiseDb.query("SELECT ID, name, email FROM users"); // Do not select password
        res.json(data);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Failed to retrieve users.' });
    }
});

// DELETE a user
app.delete('/users/:id', async (req, res) => {
    const userId = req.params.id;
    try {
        const [result] = await promiseDb.query("DELETE FROM users WHERE ID = ?", [userId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        res.json({ success: true, message: 'User deleted successfully.' });
    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({ error: 'Failed to delete user.' });
    }
});

// UPDATE a user
app.put('/users/:id', async (req, res) => {
    const userId = req.params.id;
    const { name, email } = req.body;

    if (!name || !email) {
        return res.status(400).json({ error: 'Name and email are required for update.' });
    }

    try {
        const [result] = await promiseDb.query("UPDATE users SET name = ?, email = ? WHERE ID = ?", [name, email, userId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found or no changes made.' });
        }
        res.json({ success: true, message: 'User updated successfully.' });
    } catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({ error: 'Failed to update user.' });
    }
});

// --- NEW Report Data Endpoint ---
app.get('/reports', async (req, res) => {
    try {
        // 1. Fetch User Activity (using users table, assuming 'created_at' column)
        const [userActivityRows] = await promiseDb.query(
            "SELECT ID, name, created_at, last_login_at FROM users ORDER BY created_at DESC LIMIT 10"
        );
        const userActivity = userActivityRows.map(user => ({
            id: user.ID,
            user: user.name,
            // Determine a more meaningful action based on available data
            action: user.last_login_at ? `Logged in (${new Date(user.last_login_at).toLocaleString()})` : 'Registered',
            timestamp: new Date(user.created_at).toLocaleString() // Format date for display
        }));

        // 2. Fetch Data Trends
        // Registrations Last 7 Days
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
        const [recentRegistrations] = await promiseDb.query(
            "SELECT COUNT(*) AS count FROM users WHERE created_at >= ?",
            [sevenDaysAgo]
        );
        const registrationsLast7Days = recentRegistrations[0].count;

        // Active Users Today (more robust: users who logged in today)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayStartISO = todayStart.toISOString().slice(0, 19).replace('T', ' ');

        const [activeUsersResult] = await promiseDb.query(
            "SELECT COUNT(*) AS count FROM users WHERE last_login_at >= ?",
            [todayStartISO]
        );
        const activeUsersToday = activeUsersResult[0].count;

        // Total Users
        const [totalUsersResult] = await promiseDb.query("SELECT COUNT(*) AS count FROM users");
        const totalUsers = totalUsersResult[0].count; // Renamed for clarity

        // New Items Created Today (hardcoded as no 'items' table available)
        const newItemsCreatedToday = 0; // Requires an 'items' table and relevant data

        // System Performance (simulated as not database-driven)
        const systemPerformance = {
            cpuUsage: '18%',
            memoryUsage: '65%',
            diskSpace: '78% Used',
            uptime: '16 days, 2 hours',
        };

        res.json({
            userActivity,
            dataTrends: {
                registrationsLast7Days,
                activeUsersToday,
                totalUsers, // Added total users
                newItemsCreatedToday,
            },
            systemPerformance,
        });

    } catch (err) {
        console.error('Error fetching report data:', err);
        res.status(500).json({ error: 'Failed to retrieve report data from the database.' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});