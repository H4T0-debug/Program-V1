//SON
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const PISTON_API = 'https://emmy-piston.vercel.app/api/v2'; // Public Piston API endpoint

app.use(cors());
app.use(express.json());

// Root Health Check Route
app.get('/', (req, res) => {
    res.json({ status: 'online', service: 'Program-V1 Roblox Bridge' });
});

/**
 * GET /runtimes
 * Fetches all available programming languages & versions from Piston API.
 */
app.get('/runtimes', async (req, res) => {
    try {
        const response = await axios.get(`${PISTON_API}/runtimes`);
        res.json({ success: true, runtimes: response.data });
    } catch (error) {
        console.error('Error fetching runtimes:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch available runtimes.' });
    }
});

/**
 * POST /execute
 * Sends source code to Piston API for remote execution.
 * Body format from Roblox: { language: "python", version: "*", code: "print('Hello World')" }
 */
app.post('/execute', async (req, res) => {
    const { language, version, code } = req.body;

    if (!language || !code) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing required parameters: "language" or "code".' 
        });
    }

    try {
        const pistonPayload = {
            language: language,
            version: version || '*', // Default to latest version if not specified
            files: [
                {
                    content: code
                }
            ]
        };

        const response = await axios.post(`${PISTON_API}/execute`, pistonPayload);

        res.json({
            success: true,
            language: response.data.language,
            version: response.data.version,
            output: response.data.run.output || 'Code executed with no output.',
            code: response.data.run.code, // Exit code (0 = success)
            stderr: response.data.run.stderr
        });
    } catch (error) {
        console.error('Execution Error:', error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            error: error.response?.data?.message || 'Execution request failed on remote compiler server.' 
        });
    }
});

app.listen(PORT, () => {
    console.log(`Program-V1 Backend running on port ${PORT}`);
});
                      
