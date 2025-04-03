const express = require('express');
// const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./src/config/db'); // Import DB connection
const routes = require('./src/routes/route'); // Import routes

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8050;

// Middleware
app.use(express.json());
app.use(cors());

// Connect to database
connectDB();

// Routes
app.use('/api', routes); 

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});